// WhatsApp Client Service - Using whatsapp-web.js
const { Client, LocalAuth, MessageMedia } = require('whatsapp-web.js');
const fs = require('fs');
const path = require('path');
const qrcode = require('qrcode');

class WhatsAppService {
    constructor() {
        this.clients = {}; // Store clients by userId
        this.qrCodes = {}; // Store QR codes for each user
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
        });

        client.on('auth_failure', (msg) => {
            console.error(`[WA] Auth failure for user ${userId}:`, msg);
        });

        client.on('disconnected', (reason) => {
            console.log(`[WA] User ${userId} disconnected:`, reason);
            delete this.clients[userId];
        });

        client.on('ready', () => {
            console.log(`[WA] User ${userId} is ready`);
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
            const chats = await client.getChats();

            return chats.map(chat => ({
                id: chat.id._serialized,
                name: chat.name || chat.id.user,
                isGroup: chat.isGroup,
                isArchived: chat.archived,
                unreadCount: chat.unreadCount,
                lastMessage: chat.lastMessage?.body || '',
                timestamp: chat.lastMessage?._timestamp || 0
            }));
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
                from: msg.from._serialized,
                to: msg.to._serialized,
                author: msg.author?._serialized || '',
                type: msg.type,
                hasMedia: msg.hasMedia,
                timestamp: msg.timestamp,
                isGroup: msg.from.includes('@g.us'),
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
            const result = await client.sendMessage(chatId, message);

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
        const ready = client.pupPage !== null;
        let status = 'initializing';

        if (authenticated && ready) {
            status = 'connected';
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
}

// Export singleton instance
module.exports = new WhatsAppService();
