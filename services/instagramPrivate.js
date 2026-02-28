// Instagram Private API Service - Direct Login
const { IgApiClient, IgCheckpointError } = require('instagram-private-api');
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

    // Get or create client for user (with updated constants)
    getClient(userId) {
        if (!this.clients[userId]) {
            const ig = new IgApiClient();

            // Override outdated library constants (v222 is blocked by Instagram)
            // Using a recent working version to avoid "unsupported_version" checkpoint
            ig.state.constants = {
                ...ig.state.constants,
                APP_VERSION: '349.0.0.43.108',
                APP_VERSION_CODE: '604247854',
                BLOKS_VERSION_ID: 'dff3eebcee4112e534770fb4f1572040c413f89556980f8c74649f48dc7fd44f',
                SIGNATURE_KEY: '46024e8f31e295869a0e861eaed42cb1dd8454b55232d85f6c6764365079374b',
                SIGNATURE_VERSION: '4',
            };

            this.clients[userId] = ig;
        }
        return this.clients[userId];
    }

    // Get session file path
    getSessionPath(userId) {
        return path.join(this.sessionDir, `${userId}.json`);
    }

    // Save session
    async saveSession(userId, ig, username = null) {
        try {
            // Ensure session directory exists
            if (!fs.existsSync(this.sessionDir)) {
                fs.mkdirSync(this.sessionDir, { recursive: true });
            }
            const session = await ig.state.serialize();
            delete session.constants;

            // Store username alongside session for device generation on reload
            const sessionData = {
                username: username || this._usernameCache?.[userId] || null,
                session: session,
                savedAt: new Date().toISOString()
            };

            fs.writeFileSync(this.getSessionPath(userId), JSON.stringify(sessionData));
            console.log(`[IG] ✅ Session saved for user ${userId} (username: ${sessionData.username})`);
        } catch (err) {
            console.error('[IG] ❌ Error saving Instagram session:', err.message);
        }
    }

    // Load session
    async loadSession(userId, ig) {
        try {
            const sessionPath = this.getSessionPath(userId);
            if (fs.existsSync(sessionPath)) {
                const fileContent = JSON.parse(fs.readFileSync(sessionPath, 'utf8'));

                // Support both old format (direct session) and new format (with username wrapper)
                let session, username;
                if (fileContent.session && fileContent.username) {
                    // New format: { username, session, savedAt }
                    session = fileContent.session;
                    username = fileContent.username;
                } else {
                    // Old format: direct session object (no username)
                    session = fileContent;
                    username = null;
                }

                // Generate device BEFORE deserializing (critical for session validity)
                if (username) {
                    ig.state.generateDevice(username);
                    console.log(`[IG] Device generated for ${username} before session load`);

                    // Cache username for future saves
                    this._usernameCache = this._usernameCache || {};
                    this._usernameCache[userId] = username;
                }

                await ig.state.deserialize(session);
                console.log(`[IG] ✅ Session loaded for user ${userId}`);
                return true;
            }
        } catch (err) {
            console.error('[IG] ❌ Error loading Instagram session:', err.message);
        }
        return false;
    }

    // Helper: extract checkpoint data from error and set it on ig.state
    _extractCheckpointFromError(ig, err) {
        console.log('[IG] === Checkpoint Extraction Debug ===');
        console.log('[IG] Error type:', err?.constructor?.name);
        console.log('[IG] Error message:', err?.message);
        console.log('[IG] ig.state.checkpoint exists:', !!ig.state.checkpoint);

        // Method 1: Library already set ig.state.checkpoint (request.js:107 does this automatically)
        if (ig.state.checkpoint?.challenge?.api_path) {
            console.log(`[IG] ✅ Checkpoint already on ig.state: ${ig.state.checkpoint.challenge.api_path}`);
            return true;
        }

        // Method 1b: Library set checkpoint with checkpoint_url but no challenge object
        if (ig.state.checkpoint?.checkpoint_url && !ig.state.checkpoint?.challenge) {
            const cp = ig.state.checkpoint;
            let apiPath;
            try {
                apiPath = new URL(cp.checkpoint_url).pathname;
            } catch (e) {
                apiPath = cp.checkpoint_url;
            }
            apiPath = apiPath.replace(/^\/api\/v1/, '');
            cp.challenge = {
                url: cp.checkpoint_url,
                api_path: apiPath,
                hide_webview_header: false,
                lock: cp.lock || false,
                logout: false,
                native_flow: true
            };
            console.log(`[IG] ✅ Transformed checkpoint_url on ig.state to challenge format: ${apiPath}`);
            return true;
        }

        // Method 2: Error is IgCheckpointError instance (has .url and .apiUrl getters)
        if (err instanceof IgCheckpointError) {
            console.log('[IG] ✅ Error is IgCheckpointError instance');
            try {
                const body = err.response?.body;
                if (body?.challenge?.api_path) {
                    ig.state.checkpoint = body;
                    console.log(`[IG] ✅ Checkpoint extracted from IgCheckpointError: ${body.challenge.api_path}`);
                    return true;
                }
            } catch (e) {
                console.log('[IG] ⚠️ IgCheckpointError extraction failed:', e.message);
            }
        }

        // Method 3: Extract from error response body (may be nested differently)
        const body = err?.response?.body || err?.response?.data;
        if (body) {
            console.log('[IG] Response body keys:', Object.keys(body));
            if (body.challenge?.api_path) {
                ig.state.checkpoint = body;
                console.log(`[IG] ✅ Checkpoint from response body: ${body.challenge.api_path}`);
                return true;
            }
            if (body.message === 'challenge_required' || body.message === 'checkpoint_required') {
                // Transform checkpoint_url format into challenge format the library expects
                if (body.checkpoint_url && !body.challenge) {
                    let apiPath;
                    try {
                        const url = new URL(body.checkpoint_url);
                        apiPath = url.pathname; // e.g. /challenge/12345/abcdef/
                    } catch (e) {
                        // If checkpoint_url is already a path
                        apiPath = body.checkpoint_url;
                    }

                    // Remove /api/v1 prefix if present (the library adds it back)
                    apiPath = apiPath.replace(/^\/api\/v1/, '');

                    // Create synthetic challenge object matching library's expected format
                    body.challenge = {
                        url: body.checkpoint_url,
                        api_path: apiPath,
                        hide_webview_header: false,
                        lock: body.lock || false,
                        logout: false,
                        native_flow: true
                    };
                    console.log(`[IG] ✅ Created synthetic challenge from checkpoint_url: ${apiPath}`);
                }
                ig.state.checkpoint = body;
                console.log(`[IG] ✅ Checkpoint set from body (message: ${body.message})`);
                return true;
            }
        }

        // Method 4: Check raw error properties
        if (err?.checkpoint?.challenge?.api_path) {
            ig.state.checkpoint = err.checkpoint;
            console.log(`[IG] ✅ Checkpoint from err.checkpoint`);
            return true;
        }

        // Method 5: Wrapped error (IgNetworkError wrapping IgCheckpointError)
        const innerErr = err?.cause || err?.originalError || err?.error;
        if (innerErr) {
            console.log('[IG] Found inner error, trying extraction on it...');
            return this._extractCheckpointFromError(ig, innerErr);
        }

        // Method 6: ig.state.checkpoint was set but without challenge (partial data)
        if (ig.state.checkpoint) {
            console.log('[IG] ⚠️ ig.state.checkpoint exists but missing challenge.api_path');
            console.log('[IG] ig.state.checkpoint keys:', Object.keys(ig.state.checkpoint));
            // Still return true — challenge.auto() will attempt to use challengeUrl
            return true;
        }

        console.log('[IG] ❌ Could NOT extract checkpoint data from error');
        console.log('[IG] Error properties:', Object.getOwnPropertyNames(err || {}));
        try {
            console.log('[IG] Error JSON:', JSON.stringify(err, null, 2).substring(0, 500));
        } catch (e) { /* circular */ }
        return false;
    }

    // Helper: attempt to trigger challenge auto and return appropriate response
    async _handleChallenge(ig, userId, username) {
        this.challenges = this.challenges || {};
        this.challenges[userId] = {
            ig: ig,
            checkpoint: ig.state.checkpoint,
            username: username
        };

        try {
            await ig.challenge.auto(true); // true = prefer email
            console.log(`[IG] Challenge auto succeeded for ${username}`);
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
                    console.log('[IG] Session invalid, deleting stale session file...');
                    // Delete stale session to avoid checkpoint on re-login
                    try {
                        const sessionPath = this.getSessionPath(userId);
                        if (fs.existsSync(sessionPath)) {
                            fs.unlinkSync(sessionPath);
                            console.log('[IG] Stale session file deleted');
                        }
                    } catch (delErr) {
                        console.error('[IG] Failed to delete stale session:', delErr.message);
                    }

                    // Create fresh client with updated constants
                    delete this.clients[userId];
                    const freshIg = this.getClient(userId);
                    freshIg.state.generateDevice(username);
                }
            }

            // Use the current (possibly refreshed) client
            const currentIg = this.getClient(userId);

            // Attempt preLoginFlow - may trigger checkpoint
            try {
                await currentIg.simulate.preLoginFlow();
            } catch (preErr) {
                console.warn('[IG] preLoginFlow error:', preErr.message);
                // If preLoginFlow triggers checkpoint, extract and handle it
                if (this._extractCheckpointFromError(currentIg, preErr)) {
                    return await this._handleChallenge(currentIg, userId, username);
                }
                // Non-checkpoint preLogin errors are ignorable (continue to login)
            }

            try {
                await currentIg.account.login(username, password);
                await this.saveSession(userId, currentIg, username);

                // Run postLoginFlow in background (non-blocking)
                process.nextTick(async () => {
                    try {
                        await currentIg.simulate.postLoginFlow();
                    } catch (e) { /* ignore */ }
                });

                return { success: true, message: 'تم تسجيل الدخول بنجاح' };
            } catch (loginErr) {
                console.error('[IG] Login error:', loginErr.message);
                console.error('[IG] Login error type:', loginErr?.constructor?.name);

                // Try to extract checkpoint data from the error
                if (this._extractCheckpointFromError(currentIg, loginErr)) {
                    return await this._handleChallenge(currentIg, userId, username);
                }

                // Re-throw if not a checkpoint error
                throw loginErr;
            }
        } catch (err) {
            console.error('Instagram login error:', err.message);

            // Final fallback: check error message for challenge indicators
            const challengeIndicators = [
                'checkpoint',
                'challenge',
                'send you an email',
                'get back into your account',
                'verify your identity',
                'confirm your identity'
            ];

            const isChallenge = challengeIndicators.some(indicator =>
                err.message.toLowerCase().includes(indicator.toLowerCase())
            );

            if (isChallenge) {
                const ig = this.getClient(userId);

                // Last-resort: try to extract checkpoint from error
                this._extractCheckpointFromError(ig, err);

                this.challenges = this.challenges || {};
                this.challenges[userId] = { ig: ig, username: username };

                if (ig.state.checkpoint) {
                    // We have checkpoint data, try challenge.auto
                    try {
                        await ig.challenge.auto(true);
                        console.log(`[IG] Challenge auto from fallback succeeded for ${username}`);
                        return {
                            success: false,
                            code: 'challenge_required',
                            needsCode: true,
                            message: 'مطلوب كود تحقق - تم إرسال الكود إلى بريدك أو هاتفك'
                        };
                    } catch (autoErr) {
                        console.error('[IG] Challenge auto from fallback failed:', autoErr.message);
                    }
                }

                // No checkpoint data or auto failed - user must verify manually
                return {
                    success: false,
                    code: 'challenge_required',
                    needsCode: false,
                    message: 'مطلوب تحقق من الحساب - افتح تطبيق Instagram أو الموقع وأكد محاولة الدخول، ثم أعد تسجيل الدخول هنا'
                };
            }

            if (err.message.includes('two_factor')) {
                return {
                    success: false,
                    code: 'two_factor_required',
                    needsCode: true,
                    message: 'مطلوب كود المصادقة الثنائية (2FA)'
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
                return { success: false, error: 'لا يوجد طلب تحقق معلق - أعد تسجيل الدخول أولاً' };
            }

            const ig = challenge.ig;

            try {
                await ig.challenge.auto(true);
                return { success: true, message: 'تم إرسال كود جديد' };
            } catch (autoErr) {
                console.error('[IG] Resend auto failed:', autoErr.message);

                // Try challenge.reset() then auto() again
                try {
                    await ig.challenge.reset();
                    await ig.challenge.auto(true);
                    return { success: true, message: 'تم إرسال كود جديد' };
                } catch (resetErr) {
                    console.error('[IG] Resend reset+auto failed:', resetErr.message);
                    return {
                        success: false,
                        error: 'فشل إعادة إرسال الكود - أعد تسجيل الدخول وحاول مرة أخرى'
                    };
                }
            }
        } catch (err) {
            console.error('[IG] Resend code error:', err.message);
            return { success: false, error: err.message };
        }
    }

    // Check if logged in - returns { loggedIn, checkpoint, error }
    async isLoggedIn(userId) {
        try {
            const ig = this.getClient(userId);
            const sessionLoaded = await this.loadSession(userId, ig);
            if (!sessionLoaded) {
                console.log(`[IG] isLoggedIn: No session found for ${userId}`);
                return { loggedIn: false };
            }

            await ig.account.currentUser();
            console.log(`[IG] isLoggedIn: ✅ Session valid for ${userId}`);
            return { loggedIn: true };
        } catch (err) {
            console.log(`[IG] isLoggedIn: ❌ Session check failed for ${userId}: ${err.message}`);

            // Detect checkpoint_required — session is valid but account is flagged
            const isCheckpoint = err.message && (
                err.message.includes('checkpoint_required') ||
                err.message.includes('challenge_required')
            );

            if (isCheckpoint) {
                console.log(`[IG] isLoggedIn: 🔒 Checkpoint detected for ${userId}`);
                const ig = this.getClient(userId);

                // Try to extract checkpoint from the error
                this._extractCheckpointFromError(ig, err);

                return { loggedIn: false, checkpoint: true, ig };
            }

            return { loggedIn: false };
        }
    }

    // Auto-resolve checkpoint: trigger challenge and return status
    async checkAndResolveCheckpoint(userId, ig) {
        try {
            if (!ig) {
                ig = this.getClient(userId);
                await this.loadSession(userId, ig);
            }

            console.log(`[IG] checkAndResolveCheckpoint: Attempting to resolve for ${userId}`);

            // Get username from cache
            const username = this._usernameCache?.[userId] || 'unknown';

            // Store challenge state
            this.challenges = this.challenges || {};
            this.challenges[userId] = {
                ig: ig,
                checkpoint: ig.state.checkpoint,
                username: username
            };

            // Try to auto-trigger challenge (sends code to email/SMS)
            try {
                await ig.challenge.auto(true); // prefer email
                console.log(`[IG] checkAndResolveCheckpoint: ✅ Challenge auto succeeded`);
                return {
                    success: true,
                    needsCode: true,
                    message: 'مطلوب كود تحقق - تم إرسال الكود إلى بريدك أو هاتفك'
                };
            } catch (autoErr) {
                console.error(`[IG] checkAndResolveCheckpoint: Challenge auto failed:`, autoErr.message);
                return {
                    success: true,
                    needsCode: true,
                    message: 'مطلوب كود تحقق - افتح Instagram وأكد محاولة الدخول'
                };
            }
        } catch (err) {
            console.error('[IG] checkAndResolveCheckpoint error:', err.message);
            return {
                success: false,
                message: 'فشل في معالجة التحقق - أعد تسجيل الدخول'
            };
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
