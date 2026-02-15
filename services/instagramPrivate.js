// Instagram Private API Service - Direct Login
const { IgApiClient } = require('instagram-private-api');
const fs = require('fs');
const path = require('path');

class InstagramPrivateService {
    constructor() {
        this.clients = {}; // Store clients by userId
        this.sessionDir = path.join(__dirname, '..', '.ig_sessions');
        this.userIdCache = {}; // Cache for user IDs

        // Create session directory if not exists
        if (!fs.existsSync(this.sessionDir)) {
            fs.mkdirSync(this.sessionDir, { recursive: true });
        }
    }

    // Get or create client for user
    getClient(userId) {
        if (!this.clients[userId]) {
            this.clients[userId] = new IgApiClient();
        }
        return this.clients[userId];
    }

    // Get session file path
    getSessionPath(userId) {
        return path.join(this.sessionDir, `${userId}.json`);
    }

    // Save session
    async saveSession(userId, ig) {
        try {
            // Ensure session directory exists
            if (!fs.existsSync(this.sessionDir)) {
                fs.mkdirSync(this.sessionDir, { recursive: true });
            }
            const session = await ig.state.serialize();
            delete session.constants;
            fs.writeFileSync(this.getSessionPath(userId), JSON.stringify(session));
        } catch (err) {
            console.error('Error saving Instagram session:', err.message);
        }
    }

    // Load session
    async loadSession(userId, ig) {
        try {
            const sessionPath = this.getSessionPath(userId);
            if (fs.existsSync(sessionPath)) {
                const session = JSON.parse(fs.readFileSync(sessionPath, 'utf8'));
                await ig.state.deserialize(session);
                return true;
            }
        } catch (err) {
            console.error('Error loading Instagram session:', err.message);
        }
        return false;
    }

    // Login to Instagram
    async login(userId, username, password) {
        try {
            const ig = this.getClient(userId);
            ig.state.generateDevice(username);

            const sessionLoaded = await this.loadSession(userId, ig);

            if (sessionLoaded) {
                try {
                    await ig.account.currentUser();
                    return { success: true, message: 'تم تسجيل الدخول (session موجودة)' };
                } catch (e) {
                    // Session invalid
                }
            }

            // Attempt login with challenge handling
            await ig.simulate.preLoginFlow();

            try {
                await ig.account.login(username, password);
                await this.saveSession(userId, ig);
                return { success: true, message: 'تم تسجيل الدخول بنجاح' };
            } catch (loginErr) {
                // Check if challenge required
                if (ig.state.checkpoint) {
                    // Store challenge state for this user
                    this.challenges = this.challenges || {};
                    this.challenges[userId] = {
                        ig: ig,
                        checkpoint: ig.state.checkpoint,
                        username: username
                    };

                    try {
                        // Request verification code
                        await ig.challenge.auto(true); // true = prefer email
                        const challengeUrl = ig.state.checkpoint?.url;

                        console.log(`[IG] Challenge required for ${username}, URL: ${challengeUrl}`);

                        return {
                            success: false,
                            code: 'challenge_required',
                            needsCode: true,
                            message: 'مطلوب كود تحقق - تم إرسال الكود إلى بريدك أو هاتفك',
                            challengeType: 'verification'
                        };
                    } catch (challengeErr) {
                        console.error('[IG] Challenge auto failed:', challengeErr.message);
                        return {
                            success: false,
                            code: 'challenge_required',
                            needsCode: true,
                            message: 'مطلوب كود تحقق - افتح Instagram وأكد محاولة الدخول',
                            error: challengeErr.message
                        };
                    }
                }
                throw loginErr;
            }
        } catch (err) {
            console.error('Instagram login error:', err.message);

            // Check for checkpoint/challenge in error - includes various error messages
            const challengeIndicators = [
                'checkpoint',
                'challenge',
                'send you an email',
                'get back into your account',
                'verify your identity',
                'confirm your identity',
                'two_factor'
            ];

            const isChallenge = challengeIndicators.some(indicator =>
                err.message.toLowerCase().includes(indicator.toLowerCase())
            );

            if (isChallenge) {
                const ig = this.getClient(userId);
                this.challenges = this.challenges || {};
                this.challenges[userId] = { ig: ig, username: arguments[1] };

                return {
                    success: false,
                    code: 'challenge_required',
                    needsCode: true,
                    message: 'مطلوب كود تحقق - تحقق من بريدك أو هاتفك، أو افتح تطبيق Instagram وأكد محاولة الدخول'
                };
            }
            if (err.message.includes('bad_password')) {
                return { success: false, error: 'كلمة المرور غير صحيحة', code: 'bad_password' };
            }
            if (err.message.includes('invalid_user')) {
                return { success: false, error: 'اسم المستخدم غير موجود', code: 'invalid_user' };
            }

            return { success: false, error: err.message };
        }
    }

    // Submit verification code for 2FA/Challenge
    async submitVerificationCode(userId, code) {
        try {
            this.challenges = this.challenges || {};
            const challenge = this.challenges[userId];

            if (!challenge || !challenge.ig) {
                return { success: false, error: 'لا يوجد طلب تحقق معلق - أعد تسجيل الدخول' };
            }

            const ig = challenge.ig;

            console.log(`[IG] Submitting verification code for ${challenge.username}: ${code}`);

            try {
                await ig.challenge.sendSecurityCode(code);
                await this.saveSession(userId, ig);

                // Clear challenge state
                delete this.challenges[userId];

                console.log(`[IG] Verification successful for ${challenge.username}`);
                return { success: true, message: 'تم التحقق بنجاح!' };
            } catch (codeErr) {
                console.error('[IG] Code verification failed:', codeErr.message);

                if (codeErr.message.includes('invalid') || codeErr.message.includes('incorrect')) {
                    return { success: false, error: 'الكود غير صحيح - جرب مرة أخرى' };
                }

                return { success: false, error: codeErr.message };
            }
        } catch (err) {
            console.error('[IG] Submit code error:', err.message);
            return { success: false, error: err.message };
        }
    }

    // Resend verification code
    async resendVerificationCode(userId) {
        try {
            this.challenges = this.challenges || {};
            const challenge = this.challenges[userId];

            if (!challenge || !challenge.ig) {
                return { success: false, error: 'لا يوجد طلب تحقق معلق' };
            }

            const ig = challenge.ig;
            await ig.challenge.auto(true);

            return { success: true, message: 'تم إرسال كود جديد' };
        } catch (err) {
            console.error('[IG] Resend code error:', err.message);
            return { success: false, error: err.message };
        }
    }

    // Check if logged in
    async isLoggedIn(userId) {
        try {
            const ig = this.getClient(userId);
            const sessionLoaded = await this.loadSession(userId, ig);
            if (!sessionLoaded) return false;
            await ig.account.currentUser();
            return true;
        } catch (err) {
            return false;
        }
    }

    // Get account info
    async getAccountInfo(userId) {
        try {
            const ig = this.getClient(userId);
            const user = await ig.account.currentUser();
            return {
                id: user.pk,
                username: user.username,
                fullName: user.full_name,
                profilePic: user.profile_pic_url
            };
        } catch (err) {
            console.error('Error getting account info:', err.message);
            return null;
        }
    }

    // Helper to get readable last message text
    getLastMessageText(item) {
        if (!item) return '';

        // If there's text, return it
        if (item.text) return item.text;

        // Map item types to Arabic descriptions
        const typeMap = {
            'media': '📷 صورة',
            'media_share': '📷 صورة',
            'voice_media': '🎤 رسالة صوتية',
            'video': '🎬 فيديو',
            'raven_media': '📷 صورة مؤقتة',
            'animated_media': '😄 ملصق',
            'link': '🔗 رابط',
            'story_share': '📖 قصة',
            'clip': '🎬 ريل',
            'felix_share': '🎬 ريل'
        };

        return typeMap[item.item_type] || item.item_type || '';
    }

    // Get inbox (conversations)
    async getInbox(userId, limit = 20) {
        try {
            const ig = this.getClient(userId);
            await this.loadSession(userId, ig);

            // Create fresh inbox feed to avoid caching
            const inbox = ig.feed.directInbox();
            inbox.cursor = undefined; // Reset cursor for fresh data

            const threads = await inbox.items();

            return threads.slice(0, limit).map(thread => ({
                id: thread.thread_id,
                title: thread.thread_title || thread.users?.map(u => u.username).join(', ') || 'محادثة',
                users: thread.users?.map(u => ({
                    id: u.pk,
                    username: u.username,
                    fullName: u.full_name,
                    profilePic: u.profile_pic_url
                })) || [],
                lastMessage: this.getLastMessageText(thread.last_permanent_item),
                lastActivityAt: thread.last_activity_at,
                // Better unread detection: check if thread is unread + use pending_score
                unreadCount: thread.read_state === 0 ? (thread.pending_score || 1) : 0
            }));
        } catch (err) {
            console.error('Error getting inbox:', err.message);
            return [];
        }
    }

    // Get thread messages with user info
    async getMessages(userId, threadId, limit = 100) {
        try {
            const ig = this.getClient(userId);
            await this.loadSession(userId, ig);

            // Get my user ID
            let myUserId = this.userIdCache[userId];
            if (!myUserId) {
                try {
                    const currentUser = await ig.account.currentUser();
                    myUserId = String(currentUser.pk);
                    this.userIdCache[userId] = myUserId;
                    console.log(`[IG] My user ID: ${myUserId}`);
                } catch (e) {
                    console.error('[IG] Failed to get current user:', e.message);
                    myUserId = null;
                }
            }

            console.log(`[IG] Fetching messages for thread ${threadId}, myUserId: ${myUserId}`);

            // Create new feed instance each time to avoid caching issues
            const threadFeed = ig.feed.directThread({ thread_id: threadId });

            // Reset cursor to force fresh fetch (prevents using cached data)
            threadFeed.cursor = undefined;

            // Fetch messages with pagination
            let allMessages = [];
            let fetchCount = 0;
            const maxFetches = 10; // Increased to ensure we get 100+ messages

            while (allMessages.length < limit && fetchCount < maxFetches) {
                const batch = await threadFeed.items();
                if (!batch || batch.length === 0) break;

                allMessages = allMessages.concat(batch);
                fetchCount++;

                if (!threadFeed.isMoreAvailable()) break;
            }

            console.log(`[IG] Fetched ${allMessages.length} messages in ${fetchCount} requests`);

            // Get users from inbox
            let users = [];
            try {
                const inboxFeed = ig.feed.directInbox();
                const threads = await inboxFeed.items();
                const currentThread = threads.find(t => t.thread_id === threadId);
                if (currentThread && currentThread.users) {
                    users = currentThread.users;
                }
            } catch (e) {
                console.log('[IG] Could not get thread users:', e.message);
            }

            // Create user map
            const userMap = {};
            users.forEach(u => {
                userMap[String(u.pk)] = {
                    id: String(u.pk),
                    username: u.username,
                    fullName: u.full_name,
                    profilePic: u.profile_pic_url
                };
            });

            console.log(`[IG] Users: ${users.length}, myUserId: ${myUserId}`);

            // Sort and map messages
            const sortedMessages = allMessages
                .slice(0, limit)
                .sort((a, b) => Number(a.timestamp) - Number(b.timestamp))
                .map((msg, idx) => {
                    const msgUserId = String(msg.user_id);
                    const isFromMe = myUserId ? msgUserId === myUserId : false;

                    // Log first 5 messages for debugging with user ID details
                    if (idx < 5) {
                        const humanTime = new Date(Number(msg.timestamp) / 1000).toLocaleString('ar-EG');
                        console.log(`[IG Debug] Msg ${idx}: msgUserId=${msgUserId}, myUserId=${myUserId}, isFromMe=${isFromMe}, type=${msg.item_type}`);
                    }

                    // Extract media data based on item_type
                    let mediaUrl = null;
                    let mediaType = null;
                    let mediaThumbnail = null;
                    let duration = null;

                    if (msg.item_type === 'media' && msg.media) {
                        // Image or video in media
                        if (msg.media.video_versions && msg.media.video_versions.length > 0) {
                            mediaUrl = msg.media.video_versions[0].url;
                            mediaType = 'video';
                            mediaThumbnail = msg.media.image_versions2?.candidates?.[0]?.url;
                        } else if (msg.media.image_versions2?.candidates?.length > 0) {
                            mediaUrl = msg.media.image_versions2.candidates[0].url;
                            mediaType = 'image';
                        }
                    } else if (msg.item_type === 'voice_media' && msg.voice_media?.media) {
                        // Voice note
                        mediaUrl = msg.voice_media.media.audio?.audio_src;
                        mediaType = 'voice';
                        duration = msg.voice_media.media.audio?.duration;
                    } else if (msg.item_type === 'video' && msg.video_versions) {
                        // Direct video
                        mediaUrl = msg.video_versions[0]?.url;
                        mediaType = 'video';
                    } else if (msg.item_type === 'animated_media' && msg.animated_media?.images) {
                        // GIF/Sticker
                        mediaUrl = msg.animated_media.images.fixed_height?.url;
                        mediaType = 'gif';
                    } else if (msg.item_type === 'raven_media' && msg.visual_media?.media) {
                        // Disappearing photo/video
                        const visual = msg.visual_media.media;
                        if (visual.video_versions?.length > 0) {
                            mediaUrl = visual.video_versions[0].url;
                            mediaType = 'video';
                        } else if (visual.image_versions2?.candidates?.length > 0) {
                            mediaUrl = visual.image_versions2.candidates[0].url;
                            mediaType = 'image';
                        }
                    } else if (msg.item_type === 'clip' && msg.clip?.clip) {
                        // Reel share
                        mediaUrl = msg.clip.clip.video_versions?.[0]?.url;
                        mediaType = 'reel';
                        mediaThumbnail = msg.clip.clip.image_versions2?.candidates?.[0]?.url;
                    }

                    return {
                        id: msg.item_id,
                        type: msg.item_type,
                        text: msg.text || '',
                        timestamp: msg.timestamp,
                        userId: msgUserId,
                        isFromMe: isFromMe,
                        user: userMap[msgUserId] || null,
                        status: 'sent',
                        // Media fields
                        mediaUrl: mediaUrl,
                        mediaType: mediaType,
                        mediaThumbnail: mediaThumbnail,
                        duration: duration
                    };
                });

            return {
                messages: sortedMessages,
                users: Object.values(userMap),
                threadId: threadId
            };
        } catch (err) {
            console.error('[IG] Error getting messages:', err.message);
            return { messages: [], users: [], threadId };
        }
    }

    // Send message
    async sendMessage(userId, threadId, text) {
        try {
            const ig = this.getClient(userId);
            await this.loadSession(userId, ig);

            console.log(`[IG Send] Sending to thread ${threadId}: "${text.substring(0, 30)}..."`);

            const thread = ig.entity.directThread(threadId);
            const result = await thread.broadcastText(text);

            console.log(`[IG Send] Success:`, result?.item_id || 'OK');
            return { success: true, itemId: result?.item_id };
        } catch (err) {
            console.error('[IG Send] Error:', err.message);

            if (err.message.includes('feedback_required')) {
                return { success: false, error: 'Instagram يتطلب تأكيد الحساب', code: 'feedback_required' };
            }
            if (err.message.includes('challenge_required')) {
                return { success: false, error: 'مطلوب تأكيد الهوية', code: 'challenge' };
            }
            if (err.message.includes('login_required')) {
                return { success: false, error: 'الجلسة انتهت', code: 'login_required' };
            }

            return { success: false, error: err.message };
        }
    }

    // Send photo to thread
    async sendPhoto(userId, threadId, imageBuffer) {
        try {
            const ig = this.getClient(userId);
            await this.loadSession(userId, ig);

            console.log(`[IG Send Photo] Sending to thread ${threadId}`);

            const thread = ig.entity.directThread(threadId);
            const result = await thread.broadcastPhoto({
                file: imageBuffer
            });

            console.log(`[IG Send Photo] Success:`, result?.item_id || 'OK');
            return { success: true, itemId: result?.item_id };
        } catch (err) {
            console.error('[IG Send Photo] Error:', err.message);
            console.error('[IG Send Photo] Stack:', err.stack);
            if (err.response?.body) {
                console.error('[IG Send Photo] Response body:', JSON.stringify(err.response.body));
            }
            return { success: false, error: err.message };
        }
    }

    // Send video to thread
    async sendVideo(userId, threadId, videoBuffer) {
        try {
            const ig = this.getClient(userId);
            await this.loadSession(userId, ig);

            console.log(`[IG Send Video] Sending to thread ${threadId}`);

            const thread = ig.entity.directThread(threadId);
            const result = await thread.broadcastVideo({
                video: videoBuffer
            });

            console.log(`[IG Send Video] Success:`, result?.item_id || 'OK');
            return { success: true, itemId: result?.item_id };
        } catch (err) {
            console.error('[IG Send Video] Error:', err.message);
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
            delete this.clients[userId];
            delete this.userIdCache[userId];
            return { success: true };
        } catch (err) {
            console.error('Error logging out:', err.message);
            return { success: false, error: err.message };
        }
    }
}

module.exports = new InstagramPrivateService();
