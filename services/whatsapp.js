// WhatsApp Client Service - Using whatsapp-web.js
const { Client, LocalAuth, MessageMedia } = require('whatsapp-web.js');
const fs = require('fs');
const path = require('path');
const qrcode = require('qrcode');

class WhatsAppService {
    constructor() {
        this.clients = {}; // Store clients by userId
        this.qrCodes = {}; // Store QR codes for each user
        this.readyStates = {}; // Track which users have fully loaded WA Web stores
        this.sessionDir = path.join(__dirname, '..', '.wwebjs_auth');

        // Create session directory if not exists
        if (!fs.existsSync(this.sessionDir)) {
            fs.mkdirSync(this.sessionDir, { recursive: true });
        }
    }

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
            // Mark as ready after short delay to let stores load
            setTimeout(() => {
                this.readyStates[userId] = true;
                console.log(`[WA] User ${userId} readyState set to true (post-auth)`);
            }, 5000);
        });

        client.on('auth_failure', (msg) => {
            console.error(`[WA] Auth failure for user ${userId}:`, msg);
        });

        client.on('disconnected', (reason) => {
            console.log(`[WA] User ${userId} disconnected:`, reason);
            delete this.clients[userId];
            delete this.readyStates[userId];
        });

        client.on('ready', () => {
            console.log(`[WA] User ${userId} is ready — stores loaded`);
            this.readyStates[userId] = true;
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
                        isArchived: chat.archived,
                        pinned: chat.pinned || false,
                        unreadCount: chat.unreadCount,
                        lastMessage: chat.lastMessage?.body || '',
                        timestamp: chat.lastMessage?.timestamp || chat.lastMessage?._timestamp || 0
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

            return messages.map(msg => ({
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
                isStatus: msg.id.fromMe === false && msg.type === 'status'
            }));
        } catch (err) {
            console.error('[WA] Get messages error:', err.message);
            return [];
        }
    }

    // Send text message
    async sendMessage(userId, chatId, message) {
        try {
            const client = await this.getClient(userId);
            const result = await client.sendMessage(chatId, message, { sendSeen: false });

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

                // Clean up session
                const sessionPath = this.getSessionPath(userId);
                if (fs.existsSync(sessionPath)) {
                    fs.rmSync(sessionPath, { recursive: true, force: true });
                }
            }

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
        try {
            const client = await this.getClient(userId);
            if (!this.readyStates[userId]) {
                console.log('[WA Media] Client not ready — skipping');
                throw new Error('Client not ready');
            }

            let msg = null;

            // Try direct message lookup first (most efficient)
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

            // Fallback: scan chat messages with larger limit
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
                        // Log all message IDs for debugging
                        const mediaMessages = messages.filter(m => m.hasMedia);
                        console.log(`[WA Media] Media messages in chat: ${mediaMessages.length}`);
                        if (mediaMessages.length > 0) {
                            console.log(`[WA Media] Sample media msg IDs: ${mediaMessages.slice(0, 3).map(m => m.id._serialized).join(', ')}`);
                        }
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

            // Retry downloadMedia up to 3 times (can fail due to timeout/network)
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

            return {
                mimetype: media.mimetype,
                data: media.data,
                filename: media.filename || `media.${media.mimetype.split('/')[1] || 'bin'}`
            };
        } catch (err) {
            console.error('[WA Media] CRITICAL error:', err.message);
            return null;
        }
    }
}

// Export singleton instance
module.exports = new WhatsAppService();
