// WhatsApp Client Service - Using whatsapp-web.js with PostgreSQL Session Persistence
const { Client, LocalAuth, MessageMedia } = require('whatsapp-web.js');
const fs = require('fs');
const path = require('path');
const qrcode = require('qrcode');

class WhatsAppService {
    constructor() {
        this.clients = {}; // Store clients by userId
        this.qrCodes = {}; // Store QR codes for each user
        this.readyStates = {}; // Track which users have fully loaded WA Web stores
        this.mediaCache = {}; // In-memory media cache: { [messageId]: { mimetype, data, filename, cachedAt } }
        this.mediaCacheMax = 500; // Max cache entries before pruning oldest
        this.sessionDir = path.join(__dirname, '..', '.wwebjs_auth');
        this._reconnecting = false; // Flag to prevent concurrent reconnect calls

        // Create session directory if not exists
        if (!fs.existsSync(this.sessionDir)) {
            fs.mkdirSync(this.sessionDir, { recursive: true });
        }
    }

    // ============= DB SESSION HELPERS =============

    // Lazy-load the WhatsAppSession model (avoid circular dependency at require-time)
    _getSessionModel() {
        if (!this._SessionModel) {
            const { WhatsAppSession } = require('../models');
            this._SessionModel = WhatsAppSession;
        }
        return this._SessionModel;
    }

    // Save or update session in DB
    async _saveSessionToDB(userId, clientId, extraData = {}) {
        try {
            const WaSession = this._getSessionModel();
            const data = {
                userId,
                clientId,
                isActive: true,
                lastConnected: new Date(),
                ...extraData
            };

            await WaSession.upsert(data, { conflictFields: ['userId'] });
            console.log(`[WA DB] ✅ Session saved for user ${userId} (clientId: ${clientId})`);
        } catch (err) {
            console.error(`[WA DB] ❌ Failed to save session for user ${userId}:`, err.message);
        }
    }

    // Mark session as inactive in DB
    async _deactivateSessionInDB(userId, reason = null) {
        try {
            const WaSession = this._getSessionModel();
            await WaSession.update(
                { isActive: false, disconnectReason: reason },
                { where: { userId } }
            );
            console.log(`[WA DB] Session deactivated for user ${userId} (reason: ${reason})`);
        } catch (err) {
            console.error(`[WA DB] Failed to deactivate session for user ${userId}:`, err.message);
        }
    }

    // Delete session from DB completely
    async _deleteSessionFromDB(userId) {
        try {
            const WaSession = this._getSessionModel();
            await WaSession.destroy({ where: { userId } });
            console.log(`[WA DB] Session deleted for user ${userId}`);
        } catch (err) {
            console.error(`[WA DB] Failed to delete session for user ${userId}:`, err.message);
        }
    }

    // Get all active sessions from DB
    async _getActiveSessionsFromDB() {
        try {
            const WaSession = this._getSessionModel();
            return await WaSession.findAll({ where: { isActive: true } });
        } catch (err) {
            console.error('[WA DB] Failed to get active sessions:', err.message);
            return [];
        }
    }

    // ============= SMART AUTO-RECONNECT =============

    /**
     * Auto-reconnect all active sessions from DB on server startup.
     * Uses a queue with delay to avoid overwhelming CPU/RAM.
     * @param {number} delayMs - Delay between each session initialization (default: 5000ms)
     */
    async autoReconnectAll(delayMs = 5000) {
        if (this._reconnecting) {
            console.log('[WA AutoReconnect] Already reconnecting, skipping...');
            return;
        }

        this._reconnecting = true;
        console.log('[WA AutoReconnect] 🔄 Starting auto-reconnect for active sessions...');

        try {
            const activeSessions = await this._getActiveSessionsFromDB();

            if (activeSessions.length === 0) {
                console.log('[WA AutoReconnect] No active sessions found in DB.');
                this._reconnecting = false;
                return;
            }

            console.log(`[WA AutoReconnect] Found ${activeSessions.length} active session(s). Reconnecting with ${delayMs}ms delay between each...`);

            for (let i = 0; i < activeSessions.length; i++) {
                const session = activeSessions[i];
                const userId = session.userId;

                try {
                    console.log(`[WA AutoReconnect] (${i + 1}/${activeSessions.length}) Reconnecting user ${userId}...`);

                    // Check if session files exist on disk (LocalAuth needs them)
                    const sessionPath = this.getSessionPath(userId);
                    if (!fs.existsSync(sessionPath)) {
                        console.log(`[WA AutoReconnect] ⚠️ No session files for user ${userId} on disk. Marking inactive.`);
                        await this._deactivateSessionInDB(userId, 'session_files_missing');
                        continue;
                    }

                    // Create client and initialize
                    await this.getClient(userId);
                    await this.initialize(userId);

                    console.log(`[WA AutoReconnect] ✅ User ${userId} initialization started.`);
                } catch (err) {
                    console.error(`[WA AutoReconnect] ❌ Failed to reconnect user ${userId}:`, err.message);
                }

                // Wait before next session to let the server "breathe"
                if (i < activeSessions.length - 1) {
                    console.log(`[WA AutoReconnect] Waiting ${delayMs}ms before next session...`);
                    await new Promise(resolve => setTimeout(resolve, delayMs));
                }
            }

            console.log('[WA AutoReconnect] ✅ Auto-reconnect complete.');
        } catch (err) {
            console.error('[WA AutoReconnect] ❌ Critical error:', err.message);
        } finally {
            this._reconnecting = false;
        }
    }

    // ============= CORE CLIENT METHODS =============

    // Get session path for user
    getSessionPath(userId) {
        return path.join(this.sessionDir, `session-${userId}`);
    }

    // Initialize or get client for user
    async getClient(userId) {
        if (this.clients[userId]) {
            return this.clients[userId];
        }

        const sessionPath = this.getSessionPath(userId);
        const clientId = `session-${userId}`;

        const client = new Client({
            authStrategy: new LocalAuth({
                dataPath: sessionPath
            }),
            puppeteer: {
                headless: true,
                args: [
                    '--no-sandbox',
                    '--disable-setuid-sandbox',
                    '--disable-dev-shm-usage',
                    '--disable-accelerated-2d-canvas',
                    '--no-first-run',
                    '--no-zygote',
                    '--disable-gpu'
                ]
            }
        });

        // Event handlers
        client.on('qr', async (qr) => {
            console.log(`[WA] QR Code generated for user ${userId}`);
            try {
                const qrImage = await qrcode.toDataURL(qr);
                this.qrCodes[userId] = qrImage;
            } catch (err) {
                console.error('[WA] QR generation error:', err.message);
            }
        });

        client.on('authenticated', () => {
            console.log(`[WA] User ${userId} authenticated successfully`);
            this.qrCodes[userId] = null;

            // Save session to DB on successful authentication
            this._saveSessionToDB(userId, clientId);

            // Mark as ready after short delay to let stores load
            setTimeout(() => {
                this.readyStates[userId] = true;
                console.log(`[WA] User ${userId} readyState set to true (post-auth)`);
            }, 5000);
        });

        client.on('auth_failure', async (msg) => {
            console.error(`[WA] Auth failure for user ${userId}:`, msg);
            // Mark session as inactive on auth failure
            await this._deactivateSessionInDB(userId, `auth_failure: ${msg}`);
        });

        client.on('disconnected', async (reason) => {
            console.log(`[WA] User ${userId} disconnected:`, reason);
            delete this.clients[userId];
            delete this.readyStates[userId];

            // Update DB: mark inactive with reason (but keep the session for potential reconnect)
            if (reason === 'LOGOUT') {
                // Explicit logout — delete session entirely
                await this._deleteSessionFromDB(userId);
            } else {
                // Unexpected disconnect — keep session, mark inactive with reason
                await this._deactivateSessionInDB(userId, reason);
            }
        });

        client.on('ready', async () => {
            console.log(`[WA] User ${userId} is ready — stores loaded`);
            this.readyStates[userId] = true;

            // Update DB with phone number and lastConnected
            try {
                const phone = client.info?.wid?.user || null;
                await this._saveSessionToDB(userId, clientId, {
                    phoneNumber: phone,
                    disconnectReason: null // Clear any previous disconnect reason
                });
            } catch (err) {
                console.error(`[WA] Error updating session on ready:`, err.message);
            }
        });

        this.clients[userId] = client;

        return client;
    }

    // Initialize client (start)
    async initialize(userId) {
        try {
            const client = await this.getClient(userId);

            if (!client.pupPage) {
                await client.initialize();
            }

            return { success: true };
        } catch (err) {
            console.error('[WA] Initialize error:', err.message);
            return { success: false, error: err.message };
        }
    }

    // Get QR code for user
    getQrCode(userId) {
        return this.qrCodes[userId] || null;
    }

    // Check if user is logged in
    async isLoggedIn(userId) {
        try {
            const client = await this.getClient(userId);
            return client.info?.wid !== undefined;
        } catch (err) {
            console.error('[WA] Check login error:', err.message);
            return false;
        }
    }

    // Get account info
    async getAccountInfo(userId) {
        try {
            const client = await this.getClient(userId);

            if (!client.info?.wid) {
                return null;
            }

            return {
                id: client.info.wid._serialized,
                phone: client.info.wid.user,
                name: client.info.pushname || client.info.wid.user
            };
        } catch (err) {
            console.error('[WA] Get account info error:', err.message);
            return null;
        }
    }

    // Get all chats
    async getChats(userId) {
        try {
            const client = await this.getClient(userId);

            // Guard: don't try to get chats if stores aren't ready
            if (!this.readyStates[userId]) {
                console.log('[WA] getChats skipped - client not ready yet (stores not loaded)');
                return [];
            }

            // Try up to 3 times with 5s delay (stores may still be loading)
            let lastError = null;
            for (let attempt = 1; attempt <= 3; attempt++) {
                try {
                    const chats = await client.getChats();
                    console.log(`[WA] getChats success: ${chats.length} chats (attempt ${attempt})`);
                    return chats.map(chat => ({
                        id: chat.id._serialized,
                        name: chat.name || chat.id.user,
                        isGroup: chat.isGroup,
                        archived: chat.archived || false,
                        pinned: chat.pinned || false,
                        isMuted: chat.isMuted || false,
                        unreadCount: chat.unreadCount,
                        lastMessage: chat.lastMessage?.body || '',
                        timestamp: chat.lastMessage?.timestamp || chat.lastMessage?._timestamp || 0,
                        labels: chat.labels || []
                    }));
                } catch (innerErr) {
                    lastError = innerErr;
                    console.log(`[WA] getChats attempt ${attempt}/3 failed: ${innerErr.message}`);
                    if (attempt < 3) {
                        await new Promise(resolve => setTimeout(resolve, 5000));
                    }
                }
            }
            console.error('[WA] getChats all attempts failed:', lastError?.message);
            return [];
        } catch (err) {
            console.error('[WA] Get chats error:', err.message);
            return [];
        }
    }

    // Get chat by ID
    async getChat(userId, chatId) {
        try {
            const client = await this.getClient(userId);
            const chat = await client.getChatById(chatId);

            return {
                id: chat.id._serialized,
                name: chat.name || chat.id.user,
                isGroup: chat.isGroup,
                isArchived: chat.archived,
                unreadCount: chat.unreadCount,
                pinned: chat.pinned,
                owner: chat.owner?._serialized,
                participants: chat.isGroup ? chat.participants.map(p => ({
                    id: p.id._serialized,
                    isAdmin: p.isAdmin,
                    isSuperAdmin: p.isSuperAdmin
                })) : []
            };
        } catch (err) {
            console.error('[WA] Get chat error:', err.message);
            return null;
        }
    }

    // Get messages from chat
    async getMessages(userId, chatId, limit = 50) {
        try {
            const client = await this.getClient(userId);
            const chat = await client.getChatById(chatId);
            const messages = await chat.fetchMessages({ limit });

            // Proactively cache media in background (non-blocking)
            const mediaMessages = messages.filter(m => m.hasMedia && !this.mediaCache[m.id._serialized]);
            if (mediaMessages.length > 0) {
                this._cacheMediaInBackground(mediaMessages);
            }

            return messages.map(msg => {
                const mapped = {
                    id: msg.id._serialized,
                    body: msg.body,
                    from: typeof msg.from === 'string' ? msg.from : msg.from?._serialized || '',
                    to: typeof msg.to === 'string' ? msg.to : msg.to?._serialized || '',
                    author: typeof msg.author === 'string' ? msg.author : msg.author?._serialized || '',
                    senderName: msg._data?.notifyName || '',
                    type: msg.type,
                    hasMedia: msg.hasMedia,
                    timestamp: msg.timestamp,
                    fromMe: msg.fromMe,
                    ack: msg.ack,
                    isGroup: (typeof msg.from === 'string' ? msg.from : '').includes('@g.us'),
                    isStatus: msg.id.fromMe === false && msg.type === 'status',
                    hasQuotedMsg: msg.hasQuotedMsg || false
                };

                // Include quoted message data if present
                if (msg.hasQuotedMsg && msg._data?.quotedMsg) {
                    const q = msg._data.quotedMsg;
                    mapped._quotedMsg = {
                        body: q.body || '',
                        type: q.type || 'chat',
                        fromMe: q.self === 'in' ? false : true,
                        senderName: q.notifyName || ''
                    };
                }

                return mapped;
            });
        } catch (err) {
            console.error('[WA] Get messages error:', err.message);
            return [];
        }
    }

    // Background media caching — downloads media and stores in memory
    async _cacheMediaInBackground(messages) {
        for (const msg of messages) {
            const msgId = msg.id._serialized;
            if (this.mediaCache[msgId]) continue; // Already cached
            try {
                const media = await msg.downloadMedia();
                if (media && media.data) {
                    this.mediaCache[msgId] = {
                        mimetype: media.mimetype,
                        data: media.data,
                        filename: media.filename || `media.${media.mimetype.split('/')[1] || 'bin'}`,
                        cachedAt: Date.now()
                    };
                    console.log(`[WA Media Cache] Cached ${msgId} (${media.mimetype}, ${media.data.length} chars)`);
                }
            } catch (e) {
                // Silently skip — media may be expired or unavailable
                console.log(`[WA Media Cache] Skip ${msgId}: ${e.message}`);
            }
        }
        // Prune cache if over limit
        this._pruneMediaCache();
    }

    // Prune oldest cache entries if over max limit
    _pruneMediaCache() {
        const keys = Object.keys(this.mediaCache);
        if (keys.length <= this.mediaCacheMax) return;
        // Sort by cachedAt ascending, remove oldest
        const sorted = keys.sort((a, b) => this.mediaCache[a].cachedAt - this.mediaCache[b].cachedAt);
        const toRemove = sorted.slice(0, keys.length - this.mediaCacheMax);
        for (const key of toRemove) {
            delete this.mediaCache[key];
        }
        console.log(`[WA Media Cache] Pruned ${toRemove.length} entries`);
    }

    // Send text message (with optional quote reply)
    async sendMessage(userId, chatId, message, options = {}) {
        try {
            const client = await this.getClient(userId);
            const sendOpts = { sendSeen: false };

            // Quote reply support
            if (options.quotedMessageId) {
                sendOpts.quotedMessageId = options.quotedMessageId;
            }

            const result = await client.sendMessage(chatId, message, sendOpts);

            return {
                success: true,
                messageId: result.id._serialized
            };
        } catch (err) {
            console.error('[WA] Send message error:', err.message);
            return { success: false, error: err.message };
        }
    }

    // Send media (image, video, document)
    async sendMedia(userId, chatId, mediaPath, caption = '') {
        try {
            const client = await this.getClient(userId);
            const media = await MessageMedia.fromFilePath(mediaPath);
            const result = await client.sendMessage(chatId, media, { caption });

            return {
                success: true,
                messageId: result.id._serialized
            };
        } catch (err) {
            console.error('[WA] Send media error:', err.message);
            return { success: false, error: err.message };
        }
    }

    // Send media from URL
    async sendMediaFromUrl(userId, chatId, url, caption = '', mimeType = 'image/jpeg') {
        try {
            const client = await this.getClient(userId);
            const media = await MessageMedia.fromUrl(url, { mimeType });
            const result = await client.sendMessage(chatId, media, { caption });

            return {
                success: true,
                messageId: result.id._serialized
            };
        } catch (err) {
            console.error('[WA] Send media from URL error:', err.message);
            return { success: false, error: err.message };
        }
    }

    // Send location
    async sendLocation(userId, chatId, latitude, longitude, description = '') {
        try {
            const client = await this.getClient(userId);
            const result = await client.sendLocation(chatId, latitude, longitude, description);

            return {
                success: true,
                messageId: result.id._serialized
            };
        } catch (err) {
            console.error('[WA] Send location error:', err.message);
            return { success: false, error: err.message };
        }
    }

    // Create group
    async createGroup(userId, groupName, participants) {
        try {
            const client = await this.getClient(userId);
            const result = await client.createGroup(groupName, participants);

            return {
                success: true,
                groupId: result.gid._serialized
            };
        } catch (err) {
            console.error('[WA] Create group error:', err.message);
            return { success: false, error: err.message };
        }
    }

    // Add participant to group
    async addParticipant(userId, groupId, participantId) {
        try {
            const client = await this.getClient(userId);
            await client.addParticipant(groupId, participantId);

            return { success: true };
        } catch (err) {
            console.error('[WA] Add participant error:', err.message);
            return { success: false, error: err.message };
        }
    }

    // Remove participant from group
    async removeParticipant(userId, groupId, participantId) {
        try {
            const client = await this.getClient(userId);
            await client.removeParticipant(groupId, participantId);

            return { success: true };
        } catch (err) {
            console.error('[WA] Remove participant error:', err.message);
            return { success: false, error: err.message };
        }
    }

    // Get contact info
    async getContact(userId, contactId) {
        try {
            const client = await this.getClient(userId);
            const contact = await client.getContactById(contactId);

            return {
                id: contact.id._serialized,
                name: contact.pushname || contact.shortName || contact.id.user,
                number: contact.number,
                isMe: contact.isMe,
                isUser: contact.isUser,
                isGroup: contact.isGroup,
                isWAContact: contact.isWAContact,
                profilePic: contact.profilePicUrl
            };
        } catch (err) {
            console.error('[WA] Get contact error:', err.message);
            return null;
        }
    }

    // Get profile picture
    async getProfilePic(userId, contactId) {
        try {
            const client = await this.getClient(userId);
            const url = await client.getProfilePicUrl(contactId);
            return url;
        } catch (err) {
            console.error('[WA] Get profile pic error:', err.message);
            return null;
        }
    }

    // Logout user
    async logout(userId) {
        try {
            if (this.clients[userId]) {
                await this.clients[userId].logout();
                delete this.clients[userId];
                delete this.readyStates[userId];

                // Clean up session files
                const sessionPath = this.getSessionPath(userId);
                if (fs.existsSync(sessionPath)) {
                    fs.rmSync(sessionPath, { recursive: true, force: true });
                }
            }

            // Delete session from DB (explicit logout = full cleanup)
            await this._deleteSessionFromDB(userId);

            return { success: true };
        } catch (err) {
            console.error('[WA] Logout error:', err.message);
            return { success: false, error: err.message };
        }
    }

    // Destroy client
    async destroy(userId) {
        try {
            if (this.clients[userId]) {
                await this.clients[userId].destroy();
                delete this.clients[userId];
            }

            if (this.qrCodes[userId]) {
                delete this.qrCodes[userId];
            }

            return { success: true };
        } catch (err) {
            console.error('[WA] Destroy error:', err.message);
            return { success: false, error: err.message };
        }
    }

    // Get connection status
    async getStatus(userId) {
        const client = this.clients[userId];

        if (!client) {
            return {
                status: 'disconnected',
                authenticated: false,
                ready: false,
                qrCode: this.getQrCode(userId)
            };
        }

        const authenticated = client.info?.wid !== undefined;
        // ready = the 'ready' event has fired (stores are loaded)
        const ready = this.readyStates[userId] === true;
        let status = 'initializing';

        if (authenticated && ready) {
            status = 'connected';
        } else if (authenticated && !ready) {
            status = 'authenticating'; // authenticated but stores still loading
        } else if (this.getQrCode(userId)) {
            status = 'waiting_qr';
        }

        return {
            status: status,
            authenticated: authenticated,
            ready: ready,
            qrCode: this.getQrCode(userId)
        };
    }

    // Download media from a specific message
    async getMediaFromMessage(userId, chatId, messageId) {
        console.log(`[WA Media] === START === userId=${userId}, chatId=${chatId}, messageId=${messageId}`);

        // ① Check in-memory cache first (instant)
        if (this.mediaCache[messageId]) {
            const cached = this.mediaCache[messageId];
            console.log(`[WA Media] ✅ CACHE HIT — ${cached.mimetype}, ${cached.data.length} chars`);
            return cached;
        }

        try {
            const client = await this.getClient(userId);
            if (!this.readyStates[userId]) {
                console.log('[WA Media] Client not ready — skipping');
                throw new Error('Client not ready');
            }

            let msg = null;

            // ② Try direct message lookup first (most efficient)
            try {
                console.log('[WA Media] Trying direct getMessageById...');
                msg = await client.getMessageById(messageId);
                if (msg) {
                    console.log(`[WA Media] Direct lookup SUCCESS — type: ${msg.type}, hasMedia: ${msg.hasMedia}`);
                } else {
                    console.log('[WA Media] Direct lookup returned null');
                }
            } catch (e) {
                console.log('[WA Media] Direct lookup FAILED:', e.message);
            }

            // ③ Fallback: scan chat messages with larger limit
            if (!msg) {
                console.log('[WA Media] Falling back to chat scan (limit: 500)...');
                try {
                    const chat = await client.getChatById(chatId);
                    const messages = await chat.fetchMessages({ limit: 500 });
                    console.log(`[WA Media] Fetched ${messages.length} messages from chat`);
                    msg = messages.find(m => m.id._serialized === messageId);
                    if (msg) {
                        console.log(`[WA Media] Chat scan found message — type: ${msg.type}, hasMedia: ${msg.hasMedia}`);
                    } else {
                        console.log(`[WA Media] Chat scan did NOT find message ${messageId}`);
                    }
                } catch (chatErr) {
                    console.error('[WA Media] Chat scan FAILED:', chatErr.message);
                }
            }

            if (!msg) {
                console.log(`[WA Media] Message not found at all for ID: ${messageId}`);
                return null;
            }

            if (!msg.hasMedia) {
                console.log(`[WA Media] Message found but hasMedia is false (type: ${msg.type})`);
                return null;
            }

            // ④ Retry downloadMedia up to 3 times (can fail due to timeout/network)
            let media = null;
            for (let attempt = 1; attempt <= 3; attempt++) {
                try {
                    console.log(`[WA Media] Downloading media (attempt ${attempt}/3)...`);
                    media = await msg.downloadMedia();
                    if (media && media.data) {
                        console.log(`[WA Media] Download SUCCESS — mimetype: ${media.mimetype}, data size: ${media.data.length} chars`);
                        break;
                    } else {
                        console.log(`[WA Media] Download returned ${media ? 'empty media' : 'null'} (attempt ${attempt})`);
                        media = null;
                    }
                } catch (dlErr) {
                    console.error(`[WA Media] Download FAILED (attempt ${attempt}):`, dlErr.message);
                    if (attempt < 3) {
                        await new Promise(resolve => setTimeout(resolve, 1000 * attempt));
                    }
                }
            }

            if (!media) {
                console.log('[WA Media] All download attempts failed');
                return null;
            }

            const result = {
                mimetype: media.mimetype,
                data: media.data,
                filename: media.filename || `media.${media.mimetype.split('/')[1] || 'bin'}`
            };

            // ⑤ Cache for future requests
            this.mediaCache[messageId] = { ...result, cachedAt: Date.now() };
            this._pruneMediaCache();

            return result;
        } catch (err) {
            console.error('[WA Media] CRITICAL error:', err.message);
            return null;
        }
    }
}

// Export singleton instance
module.exports = new WhatsAppService();
