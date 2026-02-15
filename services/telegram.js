// Telegram Client Service - Using GramJS
const { TelegramClient } = require('telegram');
const { StringSession } = require('telegram/sessions');
const { Api } = require('telegram/tl');
const { computeCheck } = require('telegram/Password');
const fs = require('fs');
const path = require('path');

class TelegramService {
    constructor() {
        this.clients = {}; // Store clients by userId
        this.sessionDir = path.join(__dirname, '..', '.tg_sessions');
        this.pendingLogins = {}; // Store pending login states

        // Create session directory if not exists
        if (!fs.existsSync(this.sessionDir)) {
            fs.mkdirSync(this.sessionDir, { recursive: true });
        }

        // Load API credentials from environment
        this.apiId = parseInt(process.env.TELEGRAM_API_ID) || 0;
        this.apiHash = process.env.TELEGRAM_API_HASH || '';
    }

    // Get session file path
    getSessionPath(userId) {
        return path.join(this.sessionDir, `${userId}.session`);
    }

    // Save session
    saveSession(userId, sessionString) {
        try {
            fs.writeFileSync(this.getSessionPath(userId), sessionString);
            console.log(`[TG] Session saved for user ${userId}`);
        } catch (err) {
            console.error('[TG] Error saving session:', err.message);
        }
    }

    // Load session
    loadSession(userId) {
        try {
            const sessionPath = this.getSessionPath(userId);
            if (fs.existsSync(sessionPath)) {
                const session = fs.readFileSync(sessionPath, 'utf8');
                console.log(`[TG] Session loaded for user ${userId}`);
                return session;
            }
        } catch (err) {
            console.error('[TG] Error loading session:', err.message);
        }
        return '';
    }

    // Check if API credentials are configured
    isConfigured() {
        return this.apiId > 0 && this.apiHash.length > 0;
    }

    // Start login process (send code to phone)
    async startLogin(userId, phoneNumber) {
        try {
            const client = await this.getClient(userId);

            if (!client.connected) {
                await client.connect();
            }

            // Send code request
            const result = await client.sendCode(
                { apiId: this.apiId, apiHash: this.apiHash },
                phoneNumber
            );

            // Store pending login state
            this.pendingLogins[userId] = {
                phoneNumber,
                phoneCodeHash: result.phoneCodeHash,
                timestamp: Date.now()
            };

            console.log(`[TG] Code sent to ${phoneNumber}`);
            return { success: true, phoneCodeHash: result.phoneCodeHash };
        } catch (err) {
            console.error('[TG] Start login error:', err.message);

            if (err.message.includes('PHONE_NUMBER_INVALID')) {
                return { success: false, error: 'رقم الهاتف غير صحيح' };
            }
            if (err.message.includes('PHONE_NUMBER_FLOOD')) {
                return { success: false, error: 'تم إرسال الكثير من الطلبات. حاول لاحقاً' };
            }

            return { success: false, error: err.message };
        }
    }

    // Verify code and complete login
    async verifyCode(userId, code, password = null) {
        try {
            const pending = this.pendingLogins[userId];
            if (!pending) {
                return { success: false, error: 'لا يوجد عملية تسجيل دخول قيد الانتظار' };
            }

            const client = await this.getClient(userId);

            if (!client.connected) {
                await client.connect();
            }

            try {
                // Try to sign in with code
                await client.invoke(
                    new Api.auth.SignIn({
                        phoneNumber: pending.phoneNumber,
                        phoneCodeHash: pending.phoneCodeHash,
                        phoneCode: code
                    })
                );
            } catch (signInErr) {
                // Check if 2FA is required
                if (signInErr.message.includes('SESSION_PASSWORD_NEEDED')) {
                    if (!password) {
                        return { success: false, error: 'مطلوب كلمة مرور التحقق بخطوتين', code: '2FA_REQUIRED' };
                    }

                    // Try to sign in with password
                    try {
                        const passwordResult = await client.invoke(new Api.account.GetPassword());
                        // Use computeCheck from GramJS Password module for SRP authentication
                        const srpCheck = await computeCheck(passwordResult, password);
                        await client.invoke(
                            new Api.auth.CheckPassword({
                                password: srpCheck
                            })
                        );
                    } catch (pwdErr) {
                        console.error('[TG] 2FA error:', pwdErr.message);
                        if (pwdErr.message.includes('PASSWORD_HASH_INVALID')) {
                            return { success: false, error: 'كلمة المرور غير صحيحة' };
                        }
                        return { success: false, error: pwdErr.message };
                    }
                } else if (signInErr.message.includes('PHONE_CODE_INVALID')) {
                    return { success: false, error: 'الكود غير صحيح' };
                } else if (signInErr.message.includes('PHONE_CODE_EXPIRED')) {
                    return { success: false, error: 'انتهت صلاحية الكود. أعد المحاولة' };
                } else {
                    throw signInErr;
                }
            }

            // Save session
            const sessionString = client.session.save();
            this.saveSession(userId, sessionString);

            // Clear pending login
            delete this.pendingLogins[userId];

            console.log(`[TG] User ${userId} logged in successfully`);
            return { success: true };
        } catch (err) {
            console.error('[TG] Verify code error:', err.message);
            return { success: false, error: err.message };
        }
    }

    // Check if user is logged in
    async isLoggedIn(userId) {
        try {
            const sessionPath = this.getSessionPath(userId);
            if (!fs.existsSync(sessionPath)) {
                return false;
            }

            const client = await this.getClient(userId);

            if (!client.connected) {
                await client.connect();
            }

            // Try to get current user
            const me = await client.getMe();
            return !!me;
        } catch (err) {
            console.error('[TG] Check login error:', err.message);
            return false;
        }
    }

    // Get account info
    async getAccountInfo(userId) {
        try {
            const client = await this.getClient(userId);

            if (!client.connected) {
                await client.connect();
            }

            const me = await client.getMe();

            let photoUrl = null;
            if (me.photo) {
                try {
                    const photoBuffer = await client.downloadProfilePhoto(me);
                    if (photoBuffer) {
                        photoUrl = `data:image/jpeg;base64,${photoBuffer.toString('base64')}`;
                    }
                } catch (e) {
                    console.log('[TG] Could not download profile photo');
                }
            }

            return {
                id: me.id.toString(),
                username: me.username || '',
                firstName: me.firstName || '',
                lastName: me.lastName || '',
                phone: me.phone || '',
                photo: photoUrl
            };
        } catch (err) {
            console.error('[TG] Get account info error:', err.message);
            return null;
        }
    }

    // Get dialogs (conversations)
    async getDialogs(userId, limit = 50) {
        try {
            const client = await this.getClient(userId);

            if (!client.connected) {
                await client.connect();
            }

            const dialogs = await client.getDialogs({ limit });

            // Map dialogs with profile photos
            const dialogsWithPhotos = await Promise.all(dialogs.map(async (dialog) => {
                let photo = null;
                let type = 'private';

                if (dialog.isGroup) {
                    type = 'group';
                } else if (dialog.isChannel) {
                    type = 'channel';
                }

                // Try to download profile photo
                try {
                    if (dialog.entity && dialog.entity.photo) {
                        const photoBuffer = await client.downloadProfilePhoto(dialog.entity, { isBig: false });
                        if (photoBuffer) {
                            photo = `data:image/jpeg;base64,${photoBuffer.toString('base64')}`;
                        }
                    }
                } catch (photoErr) {
                    // Silent fail - will use default avatar
                }

                return {
                    id: dialog.id.toString(),
                    title: dialog.title || dialog.name || 'محادثة',
                    type: type,
                    unreadCount: dialog.unreadCount || 0,
                    lastMessage: dialog.message?.message || '',
                    lastMessageDate: dialog.message?.date ? dialog.message.date * 1000 : null,
                    photo: photo
                };
            }));

            return dialogsWithPhotos;
        } catch (err) {
            console.error('[TG] Get dialogs error:', err.message);
            return [];
        }
    }

    // Get or create client for user
    async getClient(userId) {
        if (!this.isConfigured()) {
            throw new Error('Telegram API credentials not configured. Set TELEGRAM_API_ID and TELEGRAM_API_HASH in .env');
        }

        if (!this.clients[userId]) {
            const sessionString = this.loadSession(userId);
            const session = new StringSession(sessionString);

            this.clients[userId] = new TelegramClient(session, this.apiId, this.apiHash, {
                connectionRetries: 5,
                deviceModel: 'DK-OctoBot Dashboard',
                systemVersion: 'Windows',
                appVersion: '1.0.0',
                autoReconnect: true,
                retryDelay: 1000
            });
        }

        // Ensure connection
        const client = this.clients[userId];
        if (!client.connected) {
            try {
                await client.connect();
                console.log(`[TG] Reconnected client for user ${userId}`);
            } catch (err) {
                console.error('[TG] Failed to reconnect:', err.message);
                // Try to recreate client if connection fails
                delete this.clients[userId];
                return await this.getClient(userId);
            }
        }

        return client;
    }

    // Get messages from a dialog
    async getMessages(userId, dialogId, limit = 50) {
        try {
            const client = await this.getClient(userId);

            // Get entity (dialog)
            const entity = await client.getEntity(dialogId);

            // Get messages
            const messages = await client.getMessages(entity, { limit });

            // Get my user id
            const me = await client.getMe();
            const myId = me.id.toString();

            // Determine if this is a group/channel
            const isGroup = entity.className === 'Chat' || entity.className === 'Channel';

            // Cache for sender information to avoid duplicate fetches
            const senderCache = {};

            // Process messages and fetch sender info for groups
            const processedMessages = await Promise.all(messages.map(async (msg) => {
                let mediaUrl = null;
                let mediaType = null;

                if (msg.media) {
                    // Debug: log media structure
                    console.log('[TG DEBUG] Media className:', msg.media.className);
                    console.log('[TG DEBUG] Has photo:', !!msg.media.photo);
                    console.log('[TG DEBUG] Has document:', !!msg.media.document);

                    // Check for photos (including MessageMediaPhoto class)
                    if (msg.media.photo || msg.media.className === 'MessageMediaPhoto') {
                        mediaType = 'photo';
                    } else if (msg.media.document) {
                        const mimeType = msg.media.document.mimeType || '';
                        if (mimeType.startsWith('video/')) {
                            mediaType = 'video';
                        } else if (mimeType.startsWith('audio/')) {
                            mediaType = 'audio';
                        } else if (mimeType.startsWith('image/')) {
                            mediaType = 'photo';
                        } else {
                            mediaType = 'document';
                        }
                    } else if (msg.media.voice) {
                        mediaType = 'voice';
                    }

                    console.log('[TG DEBUG] Final mediaType:', mediaType);
                }

                const senderId = msg.senderId?.toString() || '';
                const isFromMe = senderId === myId;

                let senderName = null;
                let senderPhoto = null;

                // For group messages from others, fetch sender info
                if (isGroup && !isFromMe && senderId) {
                    try {
                        // Check cache first
                        if (!senderCache[senderId]) {
                            const sender = await client.getEntity(parseInt(senderId));

                            // Get sender name
                            senderName = sender.firstName || sender.title || 'مستخدم';
                            if (sender.lastName) {
                                senderName += ' ' + sender.lastName;
                            }

                            // Try to get sender photo
                            if (sender.photo) {
                                try {
                                    const photoBuffer = await client.downloadProfilePhoto(sender, { isBig: false });
                                    if (photoBuffer) {
                                        senderPhoto = `data:image/jpeg;base64,${photoBuffer.toString('base64')}`;
                                    }
                                } catch (photoErr) {
                                    // Silent fail - will use default avatar
                                }
                            }

                            // Cache the sender info
                            senderCache[senderId] = { senderName, senderPhoto };
                        } else {
                            // Use cached info
                            ({ senderName, senderPhoto } = senderCache[senderId]);
                        }
                    } catch (senderErr) {
                        console.log('[TG] Could not fetch sender info:', senderErr.message);
                    }
                }

                return {
                    id: msg.id.toString(),
                    text: msg.message || '',
                    date: msg.date * 1000,
                    senderId: senderId,
                    isFromMe: isFromMe,
                    senderName: senderName,
                    senderPhoto: senderPhoto,
                    mediaType: mediaType,
                    mediaUrl: mediaUrl,
                    replyToMsgId: msg.replyToMsgId?.toString() || null
                };
            }));

            return processedMessages.reverse(); // Reverse to show oldest first
        } catch (err) {
            console.error('[TG] Get messages error:', err.message);
            return [];
        }
    }

    // Send text message
    async sendMessage(userId, dialogId, text, replyTo = null) {
        try {
            const client = await this.getClient(userId);

            if (!client.connected) {
                await client.connect();
            }

            const entity = await client.getEntity(dialogId);

            const options = { message: text };
            if (replyTo) {
                options.replyTo = parseInt(replyTo);
            }

            const result = await client.sendMessage(entity, options);

            console.log(`[TG] Message sent to ${dialogId}${replyTo ? ` (reply to ${replyTo})` : ''}`);
            return { success: true, messageId: result.id.toString() };
        } catch (err) {
            console.error('[TG] Send message error:', err.message);
            return { success: false, error: err.message };
        }
    }

    // Delete message
    async deleteMessage(userId, dialogId, messageId) {
        try {
            const client = await this.getClient(userId);

            if (!client.connected) {
                await client.connect();
            }

            const entity = await client.getEntity(dialogId);

            // Delete the message
            await client.deleteMessages(entity, [parseInt(messageId)], { revoke: true });

            console.log(`[TG] Message ${messageId} deleted from ${dialogId}`);
            return { success: true };
        } catch (err) {
            console.error('[TG] Delete message error:', err.message);
            return { success: false, error: err.message };
        }
    }

    // Edit message
    async editMessage(userId, dialogId, messageId, newText) {
        try {
            const client = await this.getClient(userId);

            if (!client.connected) {
                await client.connect();
            }

            const entity = await client.getEntity(dialogId);

            console.log(`[TG] Editing message ${messageId} in ${dialogId}`);

            // Edit the message
            await client.editMessage(entity, {
                message: parseInt(messageId),
                text: newText
            });

            console.log(`[TG] Message ${messageId} edited successfully`);
            return { success: true };
        } catch (err) {
            console.error('[TG] Edit message error:', err);
            return { success: false, error: err.message };
        }
    }

    // Send File (Photo, Document, Video, etc.)
    async sendFile(userId, dialogId, fileBuffer, options = {}) {
        try {
            const client = await this.getClient(userId);
            if (!client.connected) await client.connect();

            const entity = await client.getEntity(dialogId);
            const { caption, fileName, mimeType } = options;

            // Detect file type from mimeType AND filename extension
            const ext = fileName ? fileName.toLowerCase().split('.').pop() : '';
            const imageExtensions = ['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp'];
            const videoExtensions = ['mp4', 'mov', 'avi', 'mkv', 'webm', '3gp'];

            // Check if it's an image
            const isImage = (mimeType && mimeType.startsWith('image/')) ||
                imageExtensions.includes(ext);

            // Check if it's a video
            const isVideo = (mimeType && mimeType.startsWith('video/')) ||
                videoExtensions.includes(ext);

            // File should be sent as document ONLY if it's not image/video
            const isDocument = !isImage && !isVideo;

            console.log(`[TG] Sending file: name=${fileName}, mime=${mimeType}, ext=${ext}`);
            console.log(`[TG] Type detection: isImage=${isImage}, isVideo=${isVideo}, forceDocument=${isDocument}`);

            // CRITICAL: GramJS needs the buffer to have a .name property with correct extension
            // Without this, it treats all buffers as documents
            let fileToSend = fileBuffer;

            // Create a custom file object that GramJS can recognize
            if (isImage || isVideo) {
                // Determine the correct file name with extension
                let targetFileName = fileName || `file.${ext}`;

                // If no extension or wrong extension, add the correct one based on mime type
                if (!targetFileName.includes('.') || !imageExtensions.includes(ext) && !videoExtensions.includes(ext)) {
                    if (isImage) {
                        // Default to jpg for images
                        if (mimeType === 'image/png') targetFileName = 'photo.png';
                        else if (mimeType === 'image/gif') targetFileName = 'photo.gif';
                        else if (mimeType === 'image/webp') targetFileName = 'photo.webp';
                        else targetFileName = 'photo.jpg';
                    } else if (isVideo) {
                        targetFileName = 'video.mp4';
                    }
                }

                // Attach the name to the buffer (GramJS checks for this)
                fileBuffer.name = targetFileName;
                fileToSend = fileBuffer;

                console.log(`[TG] Set buffer.name = "${targetFileName}"`);
            }

            const result = await client.sendFile(entity, {
                file: fileToSend,
                caption: caption || '',
                forceDocument: isDocument, // false for images/videos
                workers: 1,
                attributes: isVideo ? [
                    new Api.DocumentAttributeVideo({
                        w: 1280,
                        h: 720,
                        duration: 0,
                        supportsStreaming: true
                    })
                ] : undefined
            });

            console.log(`[TG] File sent to ${dialogId} (type: ${isImage ? 'photo' : isVideo ? 'video' : 'document'})`);
            return { success: true, messageId: result.id.toString() };
        } catch (err) {
            console.error('[TG] Send file error:', err.message);
            return { success: false, error: err.message };
        }
    }

    // Logout
    async logout(userId) {
        try {
            const sessionPath = this.getSessionPath(userId);
            if (fs.existsSync(sessionPath)) {
                fs.unlinkSync(sessionPath);
            }

            if (this.clients[userId]) {
                try {
                    await this.clients[userId].disconnect();
                } catch (e) {
                    // Ignore disconnect errors
                }
                delete this.clients[userId];
            }

            delete this.pendingLogins[userId];

            console.log(`[TG] User ${userId} logged out`);
            return { success: true };
        } catch (err) {
            console.error('[TG] Logout error:', err.message);
            return { success: false, error: err.message };
        }
    }

    // Mark messages as read
    async markAsRead(userId, dialogId) {
        try {
            const client = await this.getClient(userId);

            if (!client.connected) {
                await client.connect();
            }

            const entity = await client.getEntity(dialogId);

            // Mark all messages as read in this dialog
            await client.invoke(
                new Api.messages.ReadHistory({
                    peer: entity,
                    maxId: 0 // 0 means mark all as read
                })
            );

            console.log(`[TG] Marked messages as read for dialog ${dialogId}`);
            return { success: true };
        } catch (err) {
            console.error('[TG] Mark as read error:', err.message);
            return { success: false, error: err.message };
        }
    }

    // Download media from message
    async downloadMedia(userId, dialogId, messageId) {
        try {
            const client = await this.getClient(userId);

            const entity = await client.getEntity(dialogId);
            const messages = await client.getMessages(entity, { ids: [parseInt(messageId)] });

            if (messages.length > 0 && messages[0].media) {
                const message = messages[0];
                const buffer = await client.downloadMedia(message);

                // Detect mime type
                let mimeType = 'application/octet-stream';
                if (message.media.photo) {
                    mimeType = 'image/jpeg';
                } else if (message.media.document) {
                    mimeType = message.media.document.mimeType || 'application/octet-stream';
                }

                return { buffer, mimeType };
            }

            return null;
        } catch (err) {
            console.error('[TG] Download media error:', err.message);
            return null;
        }
    }

    // Forward messages
    async forwardMessages(userId, toDialogId, fromDialogId, messageIds) {
        try {
            const client = await this.getClient(userId);
            if (!client.connected) await client.connect();

            const toEntity = await client.getEntity(toDialogId);
            const fromEntity = await client.getEntity(fromDialogId);

            // GramJS forwardMessages
            await client.forwardMessages(toEntity, {
                messages: Array.isArray(messageIds) ? messageIds.map(id => parseInt(id)) : [parseInt(messageIds)],
                fromPeer: fromEntity
            });

            console.log(`[TG] Forwarded messages ${messageIds} from ${fromDialogId} to ${toDialogId}`);
            return { success: true };
        } catch (err) {
            console.error('[TG] Forward error:', err.message);
            return { success: false, error: err.message };
        }
    }

    // Search for users globally (by username or name)
    async searchUsers(userId, query) {
        try {
            const client = await this.getClient(userId);
            if (!client.connected) await client.connect();

            console.log(`[TG] Searching for users: "${query}"`);

            const results = [];

            // Method 1: Try to resolve exact username (if starts with @)
            if (query.startsWith('@') || !query.includes(' ')) {
                const username = query.replace('@', '');
                try {
                    const resolved = await client.invoke(
                        new Api.contacts.ResolveUsername({ username })
                    );

                    if (resolved.users && resolved.users.length > 0) {
                        for (const user of resolved.users) {
                            let photo = null;
                            if (user.photo) {
                                try {
                                    const photoBuffer = await client.downloadProfilePhoto(user, { isBig: false });
                                    if (photoBuffer) {
                                        photo = `data:image/jpeg;base64,${photoBuffer.toString('base64')}`;
                                    }
                                } catch (e) { }
                            }

                            results.push({
                                id: user.id.toString(),
                                type: 'user',
                                title: `${user.firstName || ''} ${user.lastName || ''}`.trim() || user.username || 'مستخدم',
                                username: user.username || null,
                                phone: user.phone || null,
                                photo: photo,
                                isExact: true
                            });
                        }
                    }

                    // Also check for channels/groups
                    if (resolved.chats && resolved.chats.length > 0) {
                        for (const chat of resolved.chats) {
                            let photo = null;
                            if (chat.photo) {
                                try {
                                    const photoBuffer = await client.downloadProfilePhoto(chat, { isBig: false });
                                    if (photoBuffer) {
                                        photo = `data:image/jpeg;base64,${photoBuffer.toString('base64')}`;
                                    }
                                } catch (e) { }
                            }

                            results.push({
                                id: chat.id.toString(),
                                type: chat.broadcast ? 'channel' : 'group',
                                title: chat.title || 'مجموعة',
                                username: chat.username || null,
                                photo: photo,
                                isExact: true
                            });
                        }
                    }
                } catch (e) {
                    console.log(`[TG] Username resolve failed: ${e.message}`);
                }
            }

            // Method 2: Global search
            try {
                const searchResult = await client.invoke(
                    new Api.contacts.Search({
                        q: query,
                        limit: 20
                    })
                );

                if (searchResult.users) {
                    for (const user of searchResult.users) {
                        // Skip if already in results
                        if (results.find(r => r.id === user.id.toString())) continue;

                        let photo = null;
                        if (user.photo) {
                            try {
                                const photoBuffer = await client.downloadProfilePhoto(user, { isBig: false });
                                if (photoBuffer) {
                                    photo = `data:image/jpeg;base64,${photoBuffer.toString('base64')}`;
                                }
                            } catch (e) { }
                        }

                        results.push({
                            id: user.id.toString(),
                            type: 'user',
                            title: `${user.firstName || ''} ${user.lastName || ''}`.trim() || 'مستخدم',
                            username: user.username || null,
                            phone: user.phone || null,
                            photo: photo,
                            isExact: false
                        });
                    }
                }

                if (searchResult.chats) {
                    for (const chat of searchResult.chats) {
                        if (results.find(r => r.id === chat.id.toString())) continue;

                        let photo = null;
                        if (chat.photo) {
                            try {
                                const photoBuffer = await client.downloadProfilePhoto(chat, { isBig: false });
                                if (photoBuffer) {
                                    photo = `data:image/jpeg;base64,${photoBuffer.toString('base64')}`;
                                }
                            } catch (e) { }
                        }

                        results.push({
                            id: chat.id.toString(),
                            type: chat.broadcast ? 'channel' : 'group',
                            title: chat.title || 'مجموعة',
                            username: chat.username || null,
                            photo: photo,
                            isExact: false
                        });
                    }
                }
            } catch (e) {
                console.log(`[TG] Global search error: ${e.message}`);
            }

            console.log(`[TG] Found ${results.length} results for "${query}"`);
            return results;
        } catch (err) {
            console.error('[TG] Search users error:', err.message);
            return [];
        }
    }
}

module.exports = new TelegramService();
