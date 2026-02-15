// Facebook Integration Module
class FacebookIntegration {
    constructor() {
        this.baseUrl = window.location.origin;
        this.userId = localStorage.getItem('fb_user_id');
        this.pages = [];
        this.isSharedAccess = false;
        this.sharedData = null;
    }

    // Initialize shared access for non-admin users
    async initSharedAccess() {
        const token = localStorage.getItem('octobot_token');
        if (!token) return false;

        try {
            const response = await fetch(`${this.baseUrl}/api/shared-platforms`, {
                headers: { 'Authorization': `Bearer ${token}` }
            });
            const data = await response.json();

            if (data.useShared && data.hasConnection) {
                // Use shared credentials
                this.isSharedAccess = true;
                this.sharedData = data;
                this.userId = data.sharedFbUserId;
                localStorage.setItem('fb_user_id', data.sharedFbUserId);
                console.log('[FB] Using shared access from:', data.sharedUserName);
                return true;
            }
            return false;
        } catch (err) {
            console.error('[FB] Shared access init failed:', err);
            return false;
        }
    }

    // Check if connected
    isConnected() {
        return !!this.userId;
    }

    // Connect Facebook Account
    async connect() {
        try {
            // Get OctoBot user ID from localStorage for multi-admin support
            const userData = JSON.parse(localStorage.getItem('octobot_user') || '{}');
            const octobotUserId = userData.id || '';

            // Fetch the auth URL from server to avoid IIS redirect rewriting
            const response = await fetch(`${this.baseUrl}/auth/facebook?json=true&octobotUserId=${encodeURIComponent(octobotUserId)}`, {
                headers: { 'Accept': 'application/json' }
            });
            const data = await response.json();
            if (data.authUrl) {
                // Redirect directly from browser to Facebook
                window.location.href = data.authUrl;
            } else {
                console.error('No auth URL received from server');
            }
        } catch (err) {
            console.error('Failed to get auth URL:', err);
        }
    }


    // Handle auth callback
    handleAuthCallback() {
        const params = new URLSearchParams(window.location.search);
        if (params.get('auth') === 'success') {
            this.userId = params.get('userId');
            localStorage.setItem('fb_user_id', this.userId);
            window.history.replaceState({}, '', '/');
            return true;
        }
        if (params.get('error')) {
            console.error('Auth error:', params.get('error'));
            return false;
        }
        return null;
    }

    // Disconnect
    async disconnect() {
        if (!this.userId) return;
        await fetch(`${this.baseUrl}/auth/facebook/disconnect`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ userId: this.userId })
        });
        localStorage.removeItem('fb_user_id');
        this.userId = null;
        this.pages = [];
    }

    // Get user info
    async getUser() {
        if (!this.userId) return null;
        try {
            const res = await fetch(`${this.baseUrl}/api/user/${this.userId}`);
            if (!res.ok) throw new Error('User not found');
            return await res.json();
        } catch (err) {
            console.error(err);
            return null;
        }
    }

    // Get user's pages
    async getPages() {
        if (!this.userId) return [];
        try {
            const res = await fetch(`${this.baseUrl}/api/pages/${this.userId}`);
            if (!res.ok) throw new Error('Failed to fetch pages');
            const data = await res.json();
            this.pages = data.pages;
            return data.pages;
        } catch (err) {
            console.error(err);
            return [];
        }
    }

    // Publish post immediately
    async publish(pageId, message, options = {}) {
        const res = await fetch(`${this.baseUrl}/api/publish`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                userId: this.userId,
                pageId,
                message,
                link: options.link,
                mediaData: options.mediaData || [],
                mediaType: options.mediaType,
                imageUrls: options.imageUrls || [], // Array of remote image URLs
                cta: options.cta || '', // Call-to-Action button type
                whatsappNumber: options.whatsappNumber || '' // WhatsApp number for CTA
            })
        });
        return await res.json();
    }

    // Schedule post
    async schedule(pageId, message, scheduledTime, options = {}) {
        const res = await fetch(`${this.baseUrl}/api/schedule`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                userId: this.userId,
                pageId,
                message,
                scheduledTime,
                link: options.link,
                imageUrl: options.imageUrl || options.mediaData,
                mediaUrls: options.mediaUrls || [],
                mediaType: options.mediaType,
                cta: options.cta || '' // Call-to-Action button type
            })
        });
        return await res.json();
    }

    // Get scheduled posts
    async getScheduledPosts() {
        if (!this.userId) return [];
        try {
            const res = await fetch(`${this.baseUrl}/api/scheduled/${this.userId}`);
            const data = await res.json();
            return data.posts;
        } catch (err) {
            console.error(err);
            return [];
        }
    }

    // Cancel scheduled post
    async cancelScheduled(postId) {
        const res = await fetch(`${this.baseUrl}/api/scheduled/${postId}`, {
            method: 'DELETE'
        });
        return await res.json();
    }

    // Get page insights
    async getInsights(pageId) {
        try {
            const res = await fetch(`${this.baseUrl}/api/insights/${this.userId}/${pageId}`);
            return await res.json();
        } catch (err) {
            console.error(err);
            return null;
        }
    }

    // Get engagement stats
    async getEngagement(pageId, period = 'week') {
        try {
            const res = await fetch(`${this.baseUrl}/api/analytics/${this.userId}/${pageId}/engagement?period=${period}`);
            return await res.json();
        } catch (err) {
            console.error(err);
            return null;
        }
    }

    // Get message stats
    async getMessageStats(pageId) {
        try {
            const res = await fetch(`${this.baseUrl}/api/analytics/${this.userId}/${pageId}/messages`);
            return await res.json();
        } catch (err) {
            console.error(err);
            return null;
        }
    }

    // Get active ads
    async getActiveAds(pageId) {
        try {
            const res = await fetch(`${this.baseUrl}/api/analytics/${this.userId}/${pageId}/ads`);
            return await res.json();
        } catch (err) {
            console.error(err);
            return null;
        }
    }

    // Get page health score
    async getHealthScore(pageId) {
        try {
            const res = await fetch(`${this.baseUrl}/api/analytics/${this.userId}/${pageId}/health`);
            return await res.json();
        } catch (err) {
            console.error(err);
            return null;
        }
    }

    // Get best posting times
    async getBestTimes(pageId) {
        try {
            const res = await fetch(`${this.baseUrl}/api/analytics/${this.userId}/${pageId}/best-times`);
            return await res.json();
        } catch (err) {
            console.error(err);
            return null;
        }
    }

    // Get live engagements (reactions, comments, shares)
    async getLiveEngagements(pageId) {
        try {
            const res = await fetch(`${this.baseUrl}/api/engagement/${this.userId}/${pageId}/live`);
            return await res.json();
        } catch (err) {
            console.error(err);
            return { engagements: [], stats: {} };
        }
    }

    // ============= INBOX =============

    // Get conversations with pagination
    async getConversations(pageId, limit = 100, afterCursor = null) {
        try {
            let url = `${this.baseUrl}/api/inbox/${this.userId}/${pageId}/conversations?limit=${limit}`;
            if (afterCursor) {
                url += `&after=${afterCursor}`;
            }
            const res = await fetch(url);
            return await res.json();
        } catch (err) {
            console.error(err);
            return { conversations: [], hasMore: false };
        }
    }

    async getMessages(pageId, conversationId) {
        try {
            // Add timestamp to prevent caching
            const timestamp = Date.now();
            const res = await fetch(`${this.baseUrl}/api/inbox/${this.userId}/${pageId}/messages/${conversationId}?t=${timestamp}`);
            return await res.json();
        } catch (err) {
            console.error(err);
            return { messages: [] };
        }
    }

    async sendReply(pageId, recipientId, message) {
        try {
            const res = await fetch(`${this.baseUrl}/api/inbox/${this.userId}/${pageId}/reply`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ recipientId, message })
            });
            return await res.json();
        } catch (err) {
            console.error(err);
            return { error: 'Failed to send' };
        }
    }

    async sendReplyWithMedia(pageId, recipientId, message, mediaFile, mediaType) {
        try {
            const formData = new FormData();
            formData.append('recipientId', recipientId);
            formData.append('media', mediaFile);
            formData.append('mediaType', mediaType); // 'image' or 'video'
            if (message) formData.append('message', message);

            const res = await fetch(`${this.baseUrl}/api/inbox/${this.userId}/${pageId}/reply-with-media`, {
                method: 'POST',
                body: formData
            });
            return await res.json();
        } catch (err) {
            console.error(err);
            return { error: 'Failed to send media' };
        }
    }

    // ============= ADS =============

    // Get ad accounts linked to user
    async getAdAccounts() {
        try {
            const res = await fetch(`${this.baseUrl}/api/ad-accounts/${this.userId}`);
            return await res.json();
        } catch (err) {
            console.error(err);
            return { accounts: [], error: 'Failed to fetch ad accounts' };
        }
    }

    // Get ads from specific ad account
    async getAds(adAccountId) {
        try {
            const res = await fetch(`${this.baseUrl}/api/ads/${this.userId}/${adAccountId}`);
            return await res.json();
        } catch (err) {
            console.error(err);
            return { ads: [] };
        }
    }

    // Get campaigns from specific ad account
    async getAdCampaigns(adAccountId) {
        try {
            const res = await fetch(`${this.baseUrl}/api/ad-campaigns/${this.userId}/${adAccountId}`);
            return await res.json();
        } catch (err) {
            console.error(err);
            return { campaigns: [] };
        }
    }

    // ============= PAGE STATS =============

    async getPageStats(pageId) {
        try {
            const res = await fetch(`${this.baseUrl}/api/page-stats/${this.userId}/${pageId}`);
            return await res.json();
        } catch (err) {
            console.error(err);
            return null;
        }
    }

    // Subscribe page to webhooks for real-time engagement notifications
    async subscribeToWebhook(pageId) {
        try {
            const res = await fetch(`${this.baseUrl}/api/webhook/subscribe/${this.userId}/${pageId}`, {
                method: 'POST'
            });
            const data = await res.json();
            if (data.success) {
                console.log(`[FB] ✅ Page ${pageId} subscribed to webhooks`);
            }
            return data;
        } catch (err) {
            console.error('[FB] Webhook subscription error:', err);
            return { success: false, error: err.message };
        }
    }

    // ============= COMPETITOR =============

    async analyzeCompetitor(pageUsername) {
        try {
            const res = await fetch(`${this.baseUrl}/api/competitor/${encodeURIComponent(pageUsername)}`);
            return await res.json();
        } catch (err) {
            console.error(err);
            return null;
        }
    }

    // ============= BROADCAST =============

    // Get recipients with pagination - use fetchAll=true to get ALL customers
    async getBroadcastRecipients(pageId, limit = 100, afterCursor = null, fetchAll = false) {
        try {
            let url = `${this.baseUrl}/api/broadcast/${this.userId}/${pageId}/recipients?limit=${limit}`;
            if (afterCursor) {
                url += `&after=${afterCursor}`;
            }
            if (fetchAll) {
                url += `&fetchAll=true`;
            }
            const res = await fetch(url);
            return await res.json();
        } catch (err) {
            console.error(err);
            return { recipients: [], total: 0, eligible: 0, hasMore: false };
        }
    }

    // Search conversations by sender ID
    async searchBySenderId(pageId, senderId) {
        try {
            const res = await fetch(`${this.baseUrl}/api/inbox/${this.userId}/${pageId}/search?senderId=${encodeURIComponent(senderId)}`);
            return await res.json();
        } catch (err) {
            console.error(err);
            return { found: false, error: 'Search failed' };
        }
    }

    async sendBroadcast(pageId, message, recipientIds, mediaFile, mediaType) {
        try {
            const formData = new FormData();
            formData.append('message', message);
            formData.append('recipientIds', typeof recipientIds === 'string' ? recipientIds : JSON.stringify(recipientIds));
            if (mediaFile) {
                formData.append('media', mediaFile);
                formData.append('mediaType', mediaType);
            }

            const res = await fetch(`${this.baseUrl}/api/broadcast/${this.userId}/${pageId}/send`, {
                method: 'POST',
                body: formData
            });
            return await res.json();
        } catch (err) {
            console.error(err);
            return { error: 'Broadcast failed' };
        }
    }

    // Send to single recipient for progress tracking (with media and message tag support)
    async sendBroadcastOne(pageId, recipientId, recipientName, message, mediaFile, messageTag = 'HUMAN_AGENT') {
        try {
            const formData = new FormData();
            formData.append('recipientId', recipientId);
            formData.append('recipientName', recipientName);
            formData.append('messageTag', messageTag);
            if (message) formData.append('message', message);
            if (mediaFile) formData.append('media', mediaFile);

            const res = await fetch(`${this.baseUrl}/api/broadcast/${this.userId}/${pageId}/send-one`, {
                method: 'POST',
                body: formData
            });
            return await res.json();
        } catch (err) {
            console.error(err);
            return { success: false, error: 'Send failed' };
        }
    }

    // ============= BROWSER AUTOMATION =============

    async initAutomation(headless = false) {
        try {
            const res = await fetch(`${this.baseUrl}/api/automation/init`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ headless })
            });
            return await res.json();
        } catch (err) {
            console.error(err);
            return { success: false, error: 'Init failed' };
        }
    }

    async checkAutomationStatus() {
        try {
            const res = await fetch(`${this.baseUrl}/api/automation/status`);
            return await res.json();
        } catch (err) {
            console.error(err);
            return { initialized: false, isLoggedIn: false };
        }
    }

    async loginAutomation(email, password) {
        try {
            const res = await fetch(`${this.baseUrl}/api/automation/login`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ email, password })
            });
            return await res.json();
        } catch (err) {
            console.error(err);
            return { success: false, error: 'Login failed' };
        }
    }

    async sendViaAutomation(recipientId, recipientName, message, mediaFile) {
        try {
            const formData = new FormData();
            formData.append('recipientId', recipientId);
            formData.append('recipientName', recipientName);
            if (message) formData.append('message', message);
            if (mediaFile) formData.append('media', mediaFile);

            const res = await fetch(`${this.baseUrl}/api/automation/send`, {
                method: 'POST',
                body: formData
            });
            return await res.json();
        } catch (err) {
            console.error(err);
            return { success: false, error: 'Send failed' };
        }
    }

    async closeAutomation() {
        try {
            const res = await fetch(`${this.baseUrl}/api/automation/close`, {
                method: 'POST'
            });
            return await res.json();
        } catch (err) {
            console.error(err);
            return { success: false };
        }
    }

    // ============= BACKEND CAMPAIGNS =============

    async startCampaign({ pageId, pageName, messageTemplate, messageTag, delay, recipients, mediaFiles }) {
        try {
            const formData = new FormData();
            formData.append('userId', this.userId);
            formData.append('pageId', pageId);
            formData.append('pageName', pageName || '');
            formData.append('messageTemplate', messageTemplate);
            formData.append('messageTag', messageTag);
            formData.append('delay', delay);
            formData.append('recipients', JSON.stringify(recipients));

            // Add media files (local) and remote image URLs
            if (mediaFiles && mediaFiles.length > 0) {
                const remoteUrls = [];
                for (const media of mediaFiles) {
                    if (media.isRemote && media.url) {
                        // Remote URL (e.g., product images from e-commerce)
                        remoteUrls.push(media.url);
                    } else if (media.file) {
                        // Local file upload
                        formData.append('media', media.file);
                    }
                }
                // Send remote URLs as JSON array
                if (remoteUrls.length > 0) {
                    formData.append('imageUrls', JSON.stringify(remoteUrls));
                }
            }

            const res = await fetch(`${this.baseUrl}/api/campaigns/start`, {
                method: 'POST',
                body: formData
            });
            return await res.json();
        } catch (err) {
            console.error(err);
            return { success: false, error: 'Failed to start campaign' };
        }
    }

    async pauseCampaign(campaignId) {
        try {
            const res = await fetch(`${this.baseUrl}/api/campaigns/${campaignId}/pause`, {
                method: 'POST'
            });
            return await res.json();
        } catch (err) {
            console.error(err);
            return { success: false, error: err.message };
        }
    }

    async resumeCampaign(campaignId) {
        try {
            const res = await fetch(`${this.baseUrl}/api/campaigns/${campaignId}/resume`, {
                method: 'POST'
            });
            return await res.json();
        } catch (err) {
            console.error(err);
            return { success: false, error: err.message };
        }
    }

    async cancelCampaign(campaignId) {
        try {
            const res = await fetch(`${this.baseUrl}/api/campaigns/${campaignId}/cancel`, {
                method: 'POST'
            });
            return await res.json();
        } catch (err) {
            console.error(err);
            return { success: false, error: err.message };
        }
    }

    async getCampaignStatus(campaignId) {
        try {
            const res = await fetch(`${this.baseUrl}/api/campaigns/${campaignId}/status`);
            return await res.json();
        } catch (err) {
            console.error(err);
            return { error: err.message };
        }
    }

    async getActiveCampaigns() {
        try {
            const res = await fetch(`${this.baseUrl}/api/campaigns/active/${this.userId}`);
            return await res.json();
        } catch (err) {
            console.error(err);
            return { campaigns: [] };
        }
    }
}

// Export for use
window.fbIntegration = new FacebookIntegration();
