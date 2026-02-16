// Campaign Service - إدارة الحملات في الخلفية
const axios = require('axios');
const fs = require('fs');
const path = require('path');

class CampaignService {
    constructor() {
        this.activeCampaigns = new Map(); // campaignId -> running state
        this.liveProgress = new Map(); // campaignId -> {sentCount, failedCount, status, totalRecipients}
        this.Campaign = null;
        this.appData = null;
        this.FB_GRAPH_URL = 'https://graph.facebook.com/v21.0';
        this.messengerBot = null; // Puppeteer automation (fallback)
    }

    // Set the Puppeteer automation instance for fallback messaging
    setAutomation(bot) {
        this.messengerBot = bot;
        console.log(`[Campaign] 🤖 Automation ${bot ? 'connected (fallback ready)' : 'disconnected'}`);
    }

    // Helper to normalize campaign ID to string for consistent Map key matching
    normalizeId(id) {
        return String(id);
    }

    // Helper to emit real-time progress via Socket.IO
    emitProgress(campaignId, progress, status) {
        if (global.io) {
            const data = {
                campaignId: String(campaignId),
                sentCount: progress.sentCount || 0,
                failedCount: progress.failedCount || 0,
                totalRecipients: progress.totalRecipients || 0,
                status: status || progress.status,
                progress: Math.round(((progress.sentCount || 0) + (progress.failedCount || 0)) / (progress.totalRecipients || 1) * 100),
                lastMessage: progress.lastMessage
            };
            global.io.to(`campaign-${campaignId}`).emit('campaign-update', data);
            console.log(`[Socket.IO] Emitted campaign-update for ${campaignId}: ${data.sentCount}/${data.totalRecipients}`);
        }
    }

    init(CampaignModel, appData) {
        this.Campaign = CampaignModel;
        this.appData = appData;
        console.log('[Campaign Service] Initialized');

        // Resume any running campaigns on startup
        this.resumeActiveCampaigns();
    }

    async resumeActiveCampaigns() {
        if (!this.Campaign) return;

        try {
            const runningCampaigns = await this.Campaign.findAll({
                where: { status: ['running', 'paused'] }
            });

            for (const campaign of runningCampaigns) {
                // Initialize liveProgress cache for resumed campaigns (critical for real-time updates)
                const cacheKey = String(campaign.id);
                if (!this.liveProgress.has(cacheKey)) {
                    this.liveProgress.set(cacheKey, {
                        sentCount: campaign.sentCount || 0,
                        failedCount: campaign.failedCount || 0,
                        status: campaign.status,
                        totalRecipients: campaign.totalRecipients || campaign.recipients?.length || 0,
                        lastMessage: campaign.lastMessage || null
                    });
                    console.log(`[Campaign] Initialized liveProgress for campaign ${campaign.id}: ${campaign.sentCount}/${campaign.totalRecipients}`);
                }

                if (campaign.status === 'running') {
                    console.log(`[Campaign] Resuming campaign ${campaign.id}`);
                    this.runCampaign(campaign.id);
                }
            }
        } catch (err) {
            console.error('[Campaign] Error resuming campaigns:', err.message);
        }
    }

    // Parse Spintax text (handles nested spintax)
    parseSpintax(text) {
        if (!text) return text;

        let result = text;
        let maxIterations = 50; // Prevent infinite loops
        let iteration = 0;

        // Keep processing until no more spintax patterns exist
        while (result.includes('{') && result.includes('|') && iteration < maxIterations) {
            const before = result;

            // Process innermost spintax first (those without nested braces)
            result = result.replace(/\{([^{}]+)\}/g, (match, group) => {
                const options = group.split('|');
                return options[Math.floor(Math.random() * options.length)];
            });

            // If no change was made, break to prevent infinite loop
            if (result === before) break;

            iteration++;
        }

        return result;
    }

    // Start a new campaign
    async startCampaign({ userId, pageId, pageName, messageTemplate, messageTag, delay, recipients, mediaFiles, imageUrls }) {
        try {
            const campaign = await this.Campaign.create({
                userId,
                pageId,
                pageName,
                messageTemplate,
                messageTag: 'POST_PURCHASE_UPDATE', // Default for shipping/order updates
                delay: delay || 3000,
                recipients,
                totalRecipients: recipients.length,
                mediaFiles: mediaFiles || [],
                imageUrls: imageUrls || [], // Remote image URLs from e-commerce products
                status: 'running',
                startedAt: new Date()
            });

            console.log(`[Campaign] Started campaign ${campaign.id} for ${recipients.length} recipients`);

            // Initialize live progress cache for real-time updates
            const cacheKey = String(campaign.id);
            this.liveProgress.set(cacheKey, {
                sentCount: 0,
                failedCount: 0,
                status: 'running',
                totalRecipients: recipients.length,
                lastMessage: null
            });

            // Start the campaign loop (non-blocking)
            this.runCampaign(campaign.id);

            return { success: true, campaignId: campaign.id };
        } catch (err) {
            console.error('[Campaign] Error starting:', err.message);
            return { success: false, error: err.message };
        }
    }

    // Run campaign in background
    async runCampaign(campaignId) {
        // Normalize campaignId to string for consistent Map key matching
        const normalizedId = this.normalizeId(campaignId);

        // Prevent duplicate runs
        if (this.activeCampaigns.has(normalizedId)) {
            console.log(`[Campaign] ${normalizedId} already running`);
            return;
        }

        this.activeCampaigns.set(normalizedId, { running: true });

        try {
            const campaign = await this.Campaign.findByPk(campaignId);
            if (!campaign) {
                console.error(`[Campaign] Not found: ${campaignId}`);
                return;
            }
            console.log(`[Campaign] Found campaign, userId: ${campaign.userId}, pageId: ${campaign.pageId}`);
            console.log(`[Campaign] appData users available:`, Object.keys(this.appData.users || {}));

            const user = this.appData.users[campaign.userId];
            if (!user) {
                console.error(`[Campaign] User not found: ${campaign.userId}`);
                await campaign.update({ status: 'failed', error: 'User not found' });
                return;
            }

            console.log(`[Campaign] User found, pages available:`, Object.keys(user.pages || {}));

            if (!user.pages?.[campaign.pageId]) {
                console.error(`[Campaign] Page not found: ${campaign.pageId}`);
                await campaign.update({ status: 'failed', error: 'Page not found' });
                return;
            }

            const pageToken = user.pages[campaign.pageId].accessToken;
            const recipients = campaign.recipients;
            let currentIndex = campaign.currentIndex;

            // Ensure liveProgress cache exists for this campaign (important for real-time UI updates)
            const cacheKey = String(campaignId);
            if (!this.liveProgress.has(cacheKey)) {
                this.liveProgress.set(cacheKey, {
                    sentCount: campaign.sentCount || 0,
                    failedCount: campaign.failedCount || 0,
                    status: campaign.status,
                    totalRecipients: campaign.totalRecipients || recipients.length,
                    lastMessage: campaign.lastMessage || null
                });
                console.log(`[Campaign] Created liveProgress cache for ${campaignId}: ${campaign.sentCount || 0}/${campaign.totalRecipients}`);
            }

            console.log(`[Campaign] Running from index ${currentIndex}/${recipients.length}, pageToken exists: ${!!pageToken}`);

            while (currentIndex < recipients.length) {
                // Refresh campaign state
                await campaign.reload();

                // Check if paused or cancelled
                if (campaign.status === 'paused') {
                    console.log(`[Campaign] ${campaignId} paused at index ${currentIndex}`);
                    break;
                }

                if (campaign.status === 'cancelled') {
                    console.log(`[Campaign] ${campaignId} cancelled`);
                    break;
                }

                const recipient = recipients[currentIndex];
                const uniqueMessage = this.parseSpintax(campaign.messageTemplate);

                // Send message
                try {
                    console.log(`[Campaign] Sending to ${recipient.name} (${currentIndex + 1}/${recipients.length})`);

                    // ===== Facebook API with Message Tags =====
                    await this.sendMessage(pageToken, recipient, uniqueMessage, campaign.messageTag, campaign.mediaFiles, campaign.imageUrls);
                    console.log(`[Campaign] ✅ Sent to ${recipient.name} via Message Tags`);

                    // Update live progress cache IMMEDIATELY for real-time UI updates
                    const progress = this.liveProgress.get(cacheKey);
                    if (progress) {
                        progress.sentCount++;
                        progress.lastMessage = uniqueMessage;
                        console.log(`[Campaign LIVE] ${campaignId}: ${progress.sentCount}/${progress.totalRecipients} sent`);

                        // Emit real-time update via Socket.IO
                        this.emitProgress(campaignId, progress, 'running');
                    }

                    // Also update database (async, doesn't block UI)
                    campaign.increment('sentCount');
                    campaign.update({
                        currentIndex: currentIndex + 1,
                        lastMessage: uniqueMessage
                    });

                } catch (sendErr) {
                    const fbErrData = sendErr.response?.data?.error;
                    const errMsg = sendErr.message;

                    // Classify the error
                    let errorType = 'other';
                    if (errMsg.includes('نافذة المراسلة') || errMsg.includes('outside window') || fbErrData?.code === 10) {
                        errorType = 'outside_window';
                    } else if (errMsg.includes('غير متاح') || errMsg.includes('isn\'t available') || fbErrData?.code === 551) {
                        errorType = 'unavailable';
                    }

                    const shortErr = errorType === 'outside_window' ? '⏰ خارج النافذة'
                        : errorType === 'unavailable' ? '🚫 حساب غير متاح'
                            : `❓ ${errMsg}`;

                    console.error(`[Campaign] ❌ ${recipient.name}: ${shortErr}`);

                    // Update live progress cache IMMEDIATELY
                    const progress = this.liveProgress.get(cacheKey);
                    if (progress) {
                        progress.failedCount++;
                        // Track error categories
                        if (!progress.errorBreakdown) progress.errorBreakdown = { outside_window: 0, unavailable: 0, other: 0 };
                        progress.errorBreakdown[errorType]++;
                        console.log(`[Campaign LIVE] ${campaignId}: ${progress.sentCount} sent, ${progress.failedCount} failed`);

                        // Emit real-time update via Socket.IO
                        this.emitProgress(campaignId, progress, 'running');
                    }

                    // Also update database
                    const failedList = [...(campaign.failedList || []), { name: recipient.name, error: shortErr, type: errorType }];
                    campaign.increment('failedCount');
                    campaign.update({
                        currentIndex: currentIndex + 1,
                        failedList
                    });
                }

                currentIndex++;

                // Delay between messages (AI mode uses random 5-30 seconds)
                if (currentIndex < recipients.length) {
                    let delayMs = campaign.delay;
                    if (campaign.delay === 'ai' || campaign.delay === 0) {
                        // AI Smart Mode: Random delay between 5-30 seconds
                        delayMs = Math.floor(Math.random() * (30000 - 5000 + 1)) + 5000;
                        console.log(`[Campaign] AI Mode: Next delay = ${Math.round(delayMs / 1000)}s`);
                    }
                    await this.sleep(delayMs);
                }
            }

            // Check if completed
            await campaign.reload();
            if (campaign.status === 'running' && currentIndex >= recipients.length) {
                await campaign.update({
                    status: 'completed',
                    completedAt: new Date()
                });

                // Update live progress status
                const progress = this.liveProgress.get(cacheKey);
                if (progress) {
                    progress.status = 'completed';
                    // Emit completion event via Socket.IO
                    this.emitProgress(campaignId, progress, 'completed');

                    // Print detailed summary
                    const eb = progress.errorBreakdown || {};
                    console.log(`\n[Campaign] ✅ === CAMPAIGN ${campaignId} COMPLETED ===`);
                    console.log(`[Campaign] 📊 Total: ${progress.totalRecipients}`);
                    console.log(`[Campaign] ✅ Sent: ${progress.sentCount}`);
                    console.log(`[Campaign] ❌ Failed: ${progress.failedCount}`);
                    if (eb.outside_window) console.log(`[Campaign]    ⏰ Outside window: ${eb.outside_window}`);
                    if (eb.unavailable) console.log(`[Campaign]    🚫 Unavailable: ${eb.unavailable}`);
                    if (eb.other) console.log(`[Campaign]    ❓ Other errors: ${eb.other}`);
                    console.log(`[Campaign] 📈 Success rate: ${Math.round(progress.sentCount / progress.totalRecipients * 100)}%\n`);
                }

                console.log(`[Campaign] ${campaignId} completed!`);

                // Clean up cache after 30 seconds (keep for final UI update)
                setTimeout(() => this.liveProgress.delete(cacheKey), 30000);
            }

        } catch (err) {
            console.error(`[Campaign] Error running ${campaignId}:`, err.message);

            // Update live progress status to failed
            const cacheKey = String(campaignId);
            const progress = this.liveProgress.get(cacheKey);
            if (progress) {
                progress.status = 'failed';
            }

            try {
                await this.Campaign.update(
                    { status: 'failed', error: err.message },
                    { where: { id: campaignId } }
                );
            } catch (e) { }

            // Clean up cache after 30 seconds
            setTimeout(() => this.liveProgress.delete(cacheKey), 30000);
        } finally {
            this.activeCampaigns.delete(normalizedId);
        }
    }

    // Send single message using POST_PURCHASE_UPDATE tag
    async sendMessage(pageToken, recipient, message, messageTag, mediaFiles, imageUrls = []) {
        const TAG = 'POST_PURCHASE_UPDATE'; // Default for shipping/order updates

        // Helper to send a single API call
        const sendWithTag = async (payload) => {
            return axios.post(`${this.FB_GRAPH_URL}/me/messages`, {
                ...payload,
                recipient: { id: recipient.id },
                messaging_type: 'MESSAGE_TAG',
                tag: TAG
            }, { params: { access_token: pageToken } });
        };

        // Send remote image URLs first (from e-commerce products)
        for (const imageUrl of imageUrls) {
            try {
                const encodedUrl = encodeURI(decodeURI(imageUrl));
                console.log(`[Campaign] Sending remote image: ${encodedUrl}`);

                try {
                    await sendWithTag({
                        message: {
                            attachment: {
                                type: 'image',
                                payload: { url: encodedUrl, is_reusable: true }
                            }
                        }
                    });
                    console.log(`[Campaign] ✅ Remote image sent (tag: ${TAG})`);
                } catch (tagErr) {
                    const fbErr = tagErr.response?.data?.error;
                    if (fbErr?.code === 551) throw tagErr;
                    console.error(`[Campaign] ❌ Failed to send remote image (tag: ${TAG}): ${fbErr?.message || tagErr.message}`);
                }
            } catch (imgErr) {
                const imgFbErr = imgErr.response?.data?.error;
                const imgErrDetail = imgFbErr
                    ? `code=${imgFbErr.code}, subcode=${imgFbErr.error_subcode}, msg=${imgFbErr.message}`
                    : imgErr.message;
                console.error(`[Campaign] ❌ Failed to send remote image: ${imgErrDetail}`);
            }
        }

        // Send local media files
        for (const mediaPath of mediaFiles) {
            if (fs.existsSync(mediaPath)) {
                const FormData = require('form-data');
                const form = new FormData();
                form.append('message', JSON.stringify({
                    attachment: {
                        type: 'image',
                        payload: { is_reusable: true }
                    }
                }));
                form.append('filedata', fs.createReadStream(mediaPath));

                const uploadRes = await axios.post(`${this.FB_GRAPH_URL}/me/message_attachments`, form, {
                    headers: form.getHeaders(),
                    params: { access_token: pageToken }
                });

                const attachmentId = uploadRes.data.attachment_id;

                try {
                    await sendWithTag({
                        message: {
                            attachment: {
                                type: 'image',
                                payload: { attachment_id: attachmentId }
                            }
                        }
                    });
                    console.log(`[Campaign] ✅ Media sent (tag: ${TAG})`);
                } catch (tagErr) {
                    const fbErr = tagErr.response?.data?.error;
                    if (fbErr?.code === 551) throw tagErr;

                    // Tag failed → try Puppeteer fallback
                    if (this.messengerBot && this.messengerBot.isLoggedIn) {
                        try {
                            console.log(`[Campaign] 🤖 Tag failed → Trying Puppeteer for media...`);
                            const result = await this.messengerBot.sendMessage(recipient.id, null, mediaPath);
                            if (result.success) {
                                console.log(`[Campaign] 🤖 ✅ Media sent via Puppeteer`);
                            } else {
                                throw new Error('خارج نافذة المراسلة - فشل الإرسال (Tag + Puppeteer)');
                            }
                        } catch (autoErr) {
                            console.error(`[Campaign] 🤖 ❌ Puppeteer media failed: ${autoErr.message}`);
                            throw new Error('خارج نافذة المراسلة - فشل الإرسال (Tag + Puppeteer)');
                        }
                    } else {
                        throw new Error(`خارج نافذة المراسلة (${fbErr?.message || tagErr.message})`);
                    }
                }
            }
        }

        // Send text message using POST_PURCHASE_UPDATE
        if (message) {
            try {
                await sendWithTag({ message: { text: message } });
                console.log(`[Campaign] ✅ Text sent (tag: ${TAG})`);
                return; // Success!
            } catch (tagErr) {
                const fbError = tagErr.response?.data?.error;
                const errorCode = fbError?.code;

                // User not available (deleted/blocked)
                if (errorCode === 551) {
                    throw new Error('المستخدم غير متاح (حساب محذوف أو محظور)');
                }

                // Tag failed → try Puppeteer as fallback
                if (this.messengerBot && this.messengerBot.isLoggedIn) {
                    try {
                        console.log(`[Campaign] 🤖 Tag failed → Trying Puppeteer for ${recipient.name}...`);
                        const result = await this.messengerBot.sendMessage(recipient.id, message);
                        if (result.success) {
                            console.log(`[Campaign] 🤖 ✅ Sent via Puppeteer to ${recipient.name}`);
                            return; // Success via automation!
                        } else {
                            throw new Error(result.error || 'Puppeteer send failed');
                        }
                    } catch (autoErr) {
                        console.error(`[Campaign] 🤖 ❌ Puppeteer also failed: ${autoErr.message}`);
                        throw new Error(`فشل الإرسال بكل الطرق (POST_PURCHASE_UPDATE + Puppeteer)`);
                    }
                }

                // No Puppeteer available
                const finalErr = fbError?.message || 'فشل الإرسال';
                throw new Error(`خارج نافذة المراسلة - POST_PURCHASE_UPDATE فشل (${finalErr})`);
            }
        }
    }

    // Pause campaign
    async pauseCampaign(campaignId) {
        try {
            const campaign = await this.Campaign.findByPk(campaignId);
            if (!campaign) return { success: false, error: 'Campaign not found' };

            if (campaign.status !== 'running') {
                return { success: false, error: 'Campaign is not running' };
            }

            await campaign.update({ status: 'paused' });

            // Update liveProgress cache for real-time UI updates
            const cacheKey = String(campaignId);
            let progress = this.liveProgress.get(cacheKey);
            if (progress) {
                progress.status = 'paused';
                console.log(`[Campaign LIVE] ${campaignId} status updated to paused`);
            } else {
                // Create cache entry if it doesn't exist
                this.liveProgress.set(cacheKey, {
                    sentCount: campaign.sentCount || 0,
                    failedCount: campaign.failedCount || 0,
                    status: 'paused',
                    totalRecipients: campaign.totalRecipients,
                    lastMessage: campaign.lastMessage || null
                });
                console.log(`[Campaign LIVE] ${campaignId} created new cache entry with paused status`);
            }

            console.log(`[Campaign] ${campaignId} paused`);

            // Emit paused status via Socket.IO for instant UI update
            const finalProgress = this.liveProgress.get(cacheKey);
            if (finalProgress) {
                this.emitProgress(campaignId, finalProgress, 'paused');
            }

            return { success: true };
        } catch (err) {
            return { success: false, error: err.message };
        }
    }

    // Resume campaign
    async resumeCampaign(campaignId) {
        try {
            const campaign = await this.Campaign.findByPk(campaignId);
            if (!campaign) return { success: false, error: 'Campaign not found' };

            if (campaign.status !== 'paused') {
                return { success: false, error: 'Campaign is not paused' };
            }

            await campaign.update({ status: 'running' });

            // Update liveProgress cache for real-time UI updates
            const cacheKey = String(campaignId);
            console.log(`[Campaign LIVE DEBUG] resumeCampaign called for: ${campaignId}, cacheKey: ${cacheKey}`);
            console.log(`[Campaign LIVE DEBUG] liveProgress keys:`, Array.from(this.liveProgress.keys()));

            let progress = this.liveProgress.get(cacheKey);
            if (progress) {
                progress.status = 'running';
                console.log(`[Campaign LIVE] ${campaignId} status updated to running`);
            } else {
                // Create cache entry if it doesn't exist
                this.liveProgress.set(cacheKey, {
                    sentCount: campaign.sentCount || 0,
                    failedCount: campaign.failedCount || 0,
                    status: 'running',
                    totalRecipients: campaign.totalRecipients,
                    lastMessage: campaign.lastMessage || null
                });
                console.log(`[Campaign LIVE] ${campaignId} created new cache entry with running status`);
            }

            console.log(`[Campaign] ${campaignId} resumed`);

            // Emit running status via Socket.IO for instant UI update
            const finalProgress = this.liveProgress.get(cacheKey);
            if (finalProgress) {
                this.emitProgress(campaignId, finalProgress, 'running');
            }

            // Resume the loop
            this.runCampaign(campaignId);

            return { success: true };
        } catch (err) {
            return { success: false, error: err.message };
        }
    }

    // Cancel campaign
    async cancelCampaign(campaignId) {
        try {
            const campaign = await this.Campaign.findByPk(campaignId);
            if (!campaign) return { success: false, error: 'Campaign not found' };

            await campaign.update({ status: 'cancelled', completedAt: new Date() });

            // Update liveProgress cache for real-time UI updates
            const cacheKey = String(campaignId);
            let progress = this.liveProgress.get(cacheKey);
            if (progress) {
                progress.status = 'cancelled';
                console.log(`[Campaign LIVE] ${campaignId} status updated to cancelled`);
            } else {
                // Create cache entry if it doesn't exist
                this.liveProgress.set(cacheKey, {
                    sentCount: campaign.sentCount || 0,
                    failedCount: campaign.failedCount || 0,
                    status: 'cancelled',
                    totalRecipients: campaign.totalRecipients,
                    lastMessage: campaign.lastMessage || null
                });
                console.log(`[Campaign LIVE] ${campaignId} created new cache entry with cancelled status`);
            }

            console.log(`[Campaign] ${campaignId} cancelled`);

            // Emit cancelled status via Socket.IO for instant UI update
            const finalProgress = this.liveProgress.get(cacheKey);
            if (finalProgress) {
                this.emitProgress(campaignId, finalProgress, 'cancelled');
            }

            return { success: true };
        } catch (err) {
            return { success: false, error: err.message };
        }
    }

    // Get campaign status - reads from live cache first for real-time updates
    async getCampaignStatus(campaignId) {
        try {
            // First check in-memory live progress cache (for running campaigns)
            const cacheKey = String(campaignId);
            const liveData = this.liveProgress.get(cacheKey);
            if (liveData) {
                const { sentCount, failedCount, status, totalRecipients, lastMessage } = liveData;
                console.log(`[Campaign Status LIVE] ${campaignId}: ${sentCount}/${totalRecipients} sent, ${failedCount} failed, status: ${status}`);

                return {
                    id: campaignId,
                    status: status,
                    totalRecipients: totalRecipients,
                    sentCount: sentCount,
                    failedCount: failedCount,
                    progress: Math.round((sentCount + failedCount) / totalRecipients * 100),
                    lastMessage: lastMessage,
                    failedList: [],
                    startedAt: null,
                    completedAt: null,
                    error: null
                };
            }

            // Fallback to database for completed/old campaigns
            const campaign = await this.Campaign.findByPk(campaignId);
            if (!campaign) return { error: 'Campaign not found' };

            const sentCount = campaign.sentCount || 0;
            const failedCount = campaign.failedCount || 0;
            const totalRecipients = campaign.totalRecipients || 1;

            console.log(`[Campaign Status DB] ${campaignId}: ${sentCount}/${totalRecipients} sent, ${failedCount} failed, status: ${campaign.status}`);

            return {
                id: campaign.id,
                status: campaign.status,
                totalRecipients: totalRecipients,
                sentCount: sentCount,
                failedCount: failedCount,
                progress: Math.round((sentCount + failedCount) / totalRecipients * 100),
                lastMessage: campaign.lastMessage,
                failedList: campaign.failedList || [],
                startedAt: campaign.startedAt,
                completedAt: campaign.completedAt,
                error: campaign.error
            };
        } catch (err) {
            console.error('[Campaign Status] Error:', err.message);
            return { error: err.message };
        }
    }

    // Get active campaigns for a user
    async getActiveCampaigns(userId) {
        try {
            const campaigns = await this.Campaign.findAll({
                where: {
                    userId,
                    status: ['running', 'paused', 'pending']
                },
                order: [['createdAt', 'DESC']]
            });

            return campaigns.map(c => ({
                id: c.id,
                pageId: c.pageId,
                pageName: c.pageName,
                status: c.status,
                totalRecipients: c.totalRecipients,
                sentCount: c.sentCount,
                failedCount: c.failedCount,
                progress: Math.round((c.sentCount + c.failedCount) / c.totalRecipients * 100),
                startedAt: c.startedAt
            }));
        } catch (err) {
            return [];
        }
    }

    sleep(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }
}

module.exports = new CampaignService();
