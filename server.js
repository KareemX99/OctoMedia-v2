// DK-OctoBot - Backend Server
// Last reload: 2026-01-11T01:47:00Z - Fixed assignedFbUserId
const SERVER_CODE_VERSION = 'FB_FIX_V2_2026011101';  // Unique version to verify reload
console.log('===========================================');
console.log('[SERVER] Starting with code version:', SERVER_CODE_VERSION);
console.log('===========================================');
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const axios = require('axios');
const cors = require('cors');
const schedule = require('node-schedule');
const fs = require('fs');
const path = require('path');
const multer = require('multer');
require('dotenv').config();

// Security Packages
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const hpp = require('hpp');

// Global Error Handlers
process.on('uncaughtException', (err) => {
    console.error('CRITICAL ERROR (Uncaught Exception):', err);
    // Keep alive for debug? No, better restart, but log it first
});

process.on('unhandledRejection', (reason, promise) => {
    console.error('CRITICAL ERROR (Unhandled Rejection):', reason);
});

// Database & Auth
const { testConnection } = require('./config/database');
const { syncDatabase, User, Platform, Conversation, Message, Campaign, TeamActivity, DailyStats, EcommerceStore, EcommerceOrder } = require('./models');
const { router: authRouter, authMiddleware } = require('./routes/auth');

// Services
const instagramService = require('./services/instagram');
const instagramPrivateService = require('./services/instagramPrivate');
const telegramService = require('./services/telegram');
const competitorScraper = require('./services/competitorScraper');
const campaignService = require('./services/campaignService');
const googleSheetsService = require('./services/googleSheets');
const whatsappService = require('./services/whatsapp');

const app = express();
const PORT = process.env.PORT || 3000;

// Trust proxy - required when behind reverse proxy (Nginx, IIS, Cloudflare, etc.)
// This fixes express-rate-limit X-Forwarded-For header warning
app.set('trust proxy', 1);

// Multer setup for file uploads
const uploadDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir);

const storage = multer.diskStorage({
    destination: (req, file, cb) => cb(null, uploadDir),
    filename: (req, file, cb) => {
        // Clean filename: remove spaces, special chars
        const cleanName = file.originalname.replace(/[^a-zA-Z0-9.-]/g, '_');
        cb(null, `${Date.now()}-${cleanName}`);
    }
});
const upload = multer({ storage, limits: { fileSize: 50 * 1024 * 1024 } }); // 50MB limit

// ============= SECURITY MIDDLEWARE =============

// Helmet - Security Headers (XSS, Clickjacking, MIME sniffing protection)
// CSP configured to allow Facebook SDK, Socket.IO, Telegram, and other needed resources
app.use(helmet({
    contentSecurityPolicy: {
        directives: {
            defaultSrc: ["'self'", "https:", "wss:", "ws:"],
            scriptSrc: ["'self'", "'unsafe-inline'", "'unsafe-eval'", "https:", "blob:"],
            scriptSrcAttr: ["'unsafe-inline'"], // Allow inline event handlers
            styleSrc: ["'self'", "'unsafe-inline'", "https:"],
            fontSrc: ["'self'", "https:", "data:"],
            imgSrc: ["'self'", "data:", "https:", "blob:"],
            connectSrc: ["'self'", "https:", "wss:", "ws:", "http://localhost:*"],
            frameSrc: ["'self'", "https:"],
            objectSrc: ["'none'"],
            mediaSrc: ["'self'", "https:", "blob:"],
            workerSrc: ["'self'", "blob:"]
        }
    },
    crossOriginEmbedderPolicy: false,
    crossOriginResourcePolicy: { policy: "cross-origin" },
    crossOriginOpenerPolicy: false,
    permissionsPolicy: {
        features: {
            geolocation: [],
            microphone: [],
            camera: [],
            payment: [],
            usb: []
        }
    }
}));

// Permissions-Policy header (manual - Helmet doesn't support all options)
app.use((req, res, next) => {
    res.setHeader('Permissions-Policy', 'geolocation=(), microphone=(), camera=(), payment=(), usb=()');
    next();
});

// Rate Limiting - Prevent brute force & DDoS
const generalLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 1000000, // 1M requests - Effectively disabled to fix user access
    message: { error: 'طلبات كثيرة جداً، حاول مرة أخرى لاحقاً' },
    standardHeaders: true,
    legacyHeaders: false
});

const authLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 10, // 10 login attempts per 15 minutes
    message: { error: 'محاولات دخول كثيرة، حاول بعد 15 دقيقة' },
    standardHeaders: true,
    legacyHeaders: false
});

const apiLimiter = rateLimit({
    windowMs: 1 * 60 * 1000, // 1 minute
    max: 1000, // 1000 API requests per minute - Increased for chat polling
    message: { error: 'تجاوزت الحد الأقصى للطلبات' },
    standardHeaders: true,
    legacyHeaders: false
});

// Apply rate limiters
app.use(generalLimiter);
app.use('/api/auth/login', authLimiter);
app.use('/api/auth/register', authLimiter);

// Apply API limiter to all /api/ routes EXCEPT /api/support
app.use('/api/', (req, res, next) => {
    if (req.path.startsWith('/support')) {
        return next();
    }
    apiLimiter(req, res, next);
});

// HPP - HTTP Parameter Pollution protection
app.use(hpp());

// CORS - Configured for security
app.use(cors({
    origin: process.env.BASE_URL || 'https://octomedia.octobot.it.com',
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH'],
    allowedHeaders: ['Content-Type', 'Authorization'],
    credentials: true
}));

// Body parser with size limit
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Static files
app.use(express.static('.'));
app.use(express.static(path.join(__dirname, 'public')));
app.use('/uploads', express.static(uploadDir));

// Auth Routes
app.use('/api/auth', authRouter);

// E-Commerce Routes
const ecommerceRouter = require('./routes/ecommerce');
app.use('/api/ecommerce', ecommerceRouter);

// ============= WHATSAPP API ROUTES =============

// Helper to attach Socket.IO listeners to WA Client
const attachWaListeners = (client, userId) => {
    if (client._socketAttached) return; // Already attached

    console.log(`[WA API] Attaching Socket.IO listeners for user ${userId}`);

    // Use named functions so we can track them without removeAllListeners
    // (removeAllListeners('message') would break whatsapp-web.js internals)
    const onMessage = async (msg) => {
        if (!global.io) return;
        console.log(`[WA API] 📩 Incoming message from ${msg.from} | fromMe: ${msg.fromMe} | type: ${msg.type}`);
        try {
            const chat = await msg.getChat();
            const contact = await msg.getContact();
            global.io.to(`wa-${userId}`).emit('wa-new-message', {
                chatId: chat.id._serialized,
                message: {
                    id: msg.id._serialized,
                    body: msg.body,
                    from: msg.from,
                    to: msg.to,
                    type: msg.type,
                    hasMedia: msg.hasMedia,
                    timestamp: msg.timestamp,
                    fromMe: msg.fromMe,
                    ack: msg.ack
                },
                chat: {
                    id: chat.id._serialized,
                    name: chat.name || contact.pushname || chat.id.user,
                    isGroup: chat.isGroup,
                    unreadCount: chat.unreadCount,
                    pinned: chat.pinned || false
                }
            });
        } catch (e) {
            console.error('[WA API] Error in message listener:', e.message);
        }
    };

    const onMessageCreate = async (msg) => {
        if (!msg.fromMe || !global.io) return;
        try {
            const chat = await msg.getChat();
            global.io.to(`wa-${userId}`).emit('wa-new-message', {
                chatId: chat.id._serialized,
                message: {
                    id: msg.id._serialized,
                    body: msg.body,
                    from: msg.from,
                    to: msg.to,
                    type: msg.type,
                    hasMedia: msg.hasMedia,
                    timestamp: msg.timestamp,
                    fromMe: true,
                    ack: msg.ack
                },
                chat: {
                    id: chat.id._serialized,
                    name: chat.name || chat.id.user,
                    isGroup: chat.isGroup,
                    unreadCount: 0,
                    pinned: chat.pinned || false
                }
            });
        } catch (e) {
            console.error('[WA API] Error in message_create listener:', e.message);
        }
    };

    const onMessageAck = (msg, ack) => {
        if (!global.io) return;
        global.io.to(`wa-${userId}`).emit('wa-message-ack', {
            messageId: msg.id._serialized,
            ack: ack
        });
    };

    // Attach listeners (do NOT removeAllListeners — it breaks wwebjs internals)
    client.on('message', onMessage);
    client.on('message_create', onMessageCreate);
    client.on('message_ack', onMessageAck);

    client._socketAttached = true;
};

// Get WhatsApp connection status
app.get('/api/whatsapp/status', authMiddleware, async (req, res) => {
    try {
        const userId = req.user.id;
        const status = await whatsappService.getStatus(userId);

        // Ensure socket listeners are attached if connected
        if (status.status === 'connected' || status.status === 'authenticating') {
            try {
                const client = await whatsappService.getClient(userId);
                attachWaListeners(client, userId);
            } catch (e) {
                console.error('[WA API] Failed to attach listeners on status check:', e.message);
            }
        }

        const accountInfo = await whatsappService.getAccountInfo(userId);
        res.json({ ...status, account: accountInfo });
    } catch (err) {
        console.error('[WA API] Status error:', err.message);
        res.json({ status: 'disconnected', authenticated: false, ready: false, qrCode: null, account: null });
    }
});

// Connect WhatsApp (initialize client + start QR flow)
app.post('/api/whatsapp/connect', authMiddleware, async (req, res) => {
    try {
        const userId = req.user.id;
        console.log(`[WA API] Connecting for user ${userId}...`);

        // Set up message listener for real-time forwarding via Socket.IO
        const client = await whatsappService.getClient(userId);

        // Attach standard listeners
        attachWaListeners(client, userId);

        // Additional connect-specific listeners (ready, qr)
        client.removeAllListeners('ready');

        // Notify when ready + set readyStates flag (important: removeAllListeners above removes the service's handler)
        client.on('ready', () => {
            console.log(`[WA API] Client ready for user ${userId}`);
            whatsappService.readyStates[userId] = true;
            if (global.io) {
                global.io.to(`wa-${userId}`).emit('wa-ready', { status: 'connected' });
            }
        });

        // Notify when QR refreshes
        const origQrHandler = client.listeners('qr');
        client.on('qr', (qr) => {
            if (global.io) {
                global.io.to(`wa-${userId}`).emit('wa-qr', { qrCode: whatsappService.getQrCode(userId) });
            }
        });

        const result = await whatsappService.initialize(userId);
        res.json(result);
    } catch (err) {
        console.error('[WA API] Connect error:', err.message);
        res.status(500).json({ success: false, error: err.message });
    }
});

// Disconnect WhatsApp
app.post('/api/whatsapp/disconnect', authMiddleware, async (req, res) => {
    try {
        const userId = req.user.id;
        const result = await whatsappService.logout(userId);
        res.json(result);
    } catch (err) {
        console.error('[WA API] Disconnect error:', err.message);
        res.status(500).json({ success: false, error: err.message });
    }
});

// Get all WhatsApp chats (with pinned support)
app.get('/api/whatsapp/chats', authMiddleware, async (req, res) => {
    try {
        const userId = req.user.id;
        console.log(`[WA API] Getting chats for user ${userId}...`);
        const chats = await whatsappService.getChats(userId);
        console.log(`[WA API] Got ${chats.length} chats for user ${userId}`);
        // Sort: Pinned first, then by timestamp descending
        chats.sort((a, b) => {
            if (a.pinned && !b.pinned) return -1;
            if (!a.pinned && b.pinned) return 1;
            return (b.timestamp || 0) - (a.timestamp || 0);
        });
        res.json({ chats });
    } catch (err) {
        console.error('[WA API] Get chats error:', err.message);
        res.status(500).json({ chats: [], error: err.message });
    }
});

// Get messages for a specific chat
app.get('/api/whatsapp/chats/:chatId/messages', authMiddleware, async (req, res) => {
    try {
        const userId = req.user.id;
        const chatId = decodeURIComponent(req.params.chatId);
        const limit = parseInt(req.query.limit) || 50;
        const messages = await whatsappService.getMessages(userId, chatId, limit);
        res.json({ messages });
    } catch (err) {
        console.error('[WA API] Get messages error:', err.message);
        res.status(500).json({ messages: [], error: err.message });
    }
});

// Send text message
app.post('/api/whatsapp/chats/:chatId/send', authMiddleware, async (req, res) => {
    try {
        const userId = req.user.id;
        const chatId = decodeURIComponent(req.params.chatId);
        const { message } = req.body;
        if (!message) return res.status(400).json({ success: false, error: 'Message is required' });
        const result = await whatsappService.sendMessage(userId, chatId, message);
        res.json(result);
    } catch (err) {
        console.error('[WA API] Send message error:', err.message);
        res.status(500).json({ success: false, error: err.message });
    }
});

// Send media message
app.post('/api/whatsapp/chats/:chatId/send-media', authMiddleware, upload.single('media'), async (req, res) => {
    try {
        const userId = req.user.id;
        const chatId = decodeURIComponent(req.params.chatId);
        const caption = req.body.caption || '';
        if (!req.file) return res.status(400).json({ success: false, error: 'Media file is required' });
        const result = await whatsappService.sendMedia(userId, chatId, req.file.path, caption);
        res.json(result);
    } catch (err) {
        console.error('[WA API] Send media error:', err.message);
        res.status(500).json({ success: false, error: err.message });
    }
});

// Get WhatsApp QR code (polling endpoint)
app.get('/api/whatsapp/qr', authMiddleware, async (req, res) => {
    try {
        const userId = req.user.id;
        const qrCode = whatsappService.getQrCode(userId);
        res.json({ qrCode });
    } catch (err) {
        res.json({ qrCode: null });
    }
});

// Download media from a message (supports query token for <img>/<video>/<audio> src)
app.get('/api/whatsapp/media/:chatId/:messageId', async (req, res) => {
    try {
        // Auth: accept Bearer header OR ?token= query param
        const headerToken = req.headers.authorization?.replace('Bearer ', '');
        const queryToken = req.query.token;
        const token = headerToken || queryToken;

        if (!token) {
            console.log('[WA Media Route] No token provided');
            return res.status(401).json({ error: 'No token provided' });
        }

        let decoded;
        try {
            const jwt = require('jsonwebtoken');
            decoded = jwt.verify(token, process.env.JWT_SECRET || 'octobot-saas-secret-key-2024');
        } catch (e) {
            console.log('[WA Media Route] Invalid token:', e.message);
            return res.status(401).json({ error: 'Invalid token' });
        }

        const userId = decoded.id;
        const chatId = decodeURIComponent(req.params.chatId);
        const messageId = decodeURIComponent(req.params.messageId);
        console.log(`[WA Media Route] Request — userId: ${userId}, chatId: ${chatId}, messageId: ${messageId}`);

        const media = await whatsappService.getMediaFromMessage(userId, chatId, messageId);
        if (!media) {
            console.log(`[WA Media Route] 404 — media not found for messageId: ${messageId}`);
            return res.status(404).json({ error: 'Media not found' });
        }
        console.log(`[WA Media Route] 200 — sending ${media.mimetype}, ${media.data.length} bytes`);
        res.set('Content-Type', media.mimetype);
        res.set('Content-Disposition', `inline; filename="${media.filename || 'media'}"`);
        res.set('Cache-Control', 'private, max-age=3600');
        res.send(Buffer.from(media.data, 'base64'));
    } catch (err) {
        console.error('[WA Media Route] Server error:', err.message);
        res.status(500).json({ error: err.message });
    }
});

// Data storage (in production, use a database)
const DATA_FILE = path.join(__dirname, 'data.json');
let appData = {
    users: {},
    scheduledPosts: [],
    settings: { subscriptionText: '' }
};

// Load data from file
function loadData() {
    try {
        if (fs.existsSync(DATA_FILE)) {
            appData = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
        }
    } catch (err) {
        console.log('No existing data file, starting fresh');
    }
}

// Save data to file
function saveData() {
    fs.writeFileSync(DATA_FILE, JSON.stringify(appData, null, 2));
}

loadData();

// ============= DEBUG ENDPOINT =============
// Check if server code is updated
app.get('/api/debug/version', (req, res) => {
    const fbUsers = Object.keys(appData.users).map(id => ({
        id,
        name: appData.users[id].name,
        connectedAt: appData.users[id].connectedAt
    }));
    res.json({
        version: SERVER_CODE_VERSION,
        fbUsersCount: Object.keys(appData.users).length,
        fbUsers,
        timestamp: new Date().toISOString()
    });
});

// ============= ONLINE STATUS TRACKING =============
// Store online users with last activity timestamp
const onlineUsers = {};

// Heartbeat endpoint - users ping this every 30 seconds
app.post('/api/heartbeat', (req, res) => {
    const { userId, userName, role } = req.body;

    if (!userId) {
        return res.status(400).json({ error: 'userId required' });
    }

    onlineUsers[userId] = {
        userId,
        userName: userName || 'Unknown',
        role: role || 'employee',
        lastActive: Date.now(),
        status: 'online'
    };

    res.json({ success: true });
});

// Get all online users
app.get('/api/online-users', (req, res) => {
    const now = Date.now();
    const TIMEOUT = 60 * 1000; // 60 seconds timeout

    // Filter and return only online users (active within last 60 seconds)
    const users = Object.values(onlineUsers).map(user => ({
        ...user,
        status: (now - user.lastActive) < TIMEOUT ? 'online' : 'offline',
        lastActiveAgo: Math.floor((now - user.lastActive) / 1000) // seconds ago
    }));

    res.json({ users });
});

// User logout/disconnect endpoint
app.post('/api/user-offline', (req, res) => {
    const { userId } = req.body;

    if (userId && onlineUsers[userId]) {
        onlineUsers[userId].status = 'offline';
        onlineUsers[userId].lastActive = 0; // Mark as disconnected
    }

    res.json({ success: true });
});

// ============= PRIVATE SUPPORT CHAT API =============
const { TeamMessage } = require('./models');

// Get support messages (private chat with admin)
app.get('/api/support/messages', authMiddleware, async (req, res) => {
    try {
        const { userId } = req.query;
        const currentUserId = req.user.id;
        const isAdmin = req.user.role === 'admin';
        const { Op } = require('sequelize');

        // Determine the conversation partner
        // If admin: get messages with specific employee (userId)
        // If employee: get messages with any admin
        let whereClause;

        if (isAdmin && userId) {
            // Admin viewing chat with specific employee
            whereClause = {
                isGroupMessage: false,
                [Op.or]: [
                    { senderId: currentUserId, receiverId: userId },
                    { senderId: userId, receiverId: currentUserId }
                ]
            };
        } else if (!isAdmin) {
            // Employee viewing their support chat
            whereClause = {
                isGroupMessage: false,
                [Op.or]: [
                    { senderId: currentUserId },
                    { receiverId: currentUserId }
                ]
            };
        } else {
            return res.json({ messages: [] });
        }

        const messages = await TeamMessage.findAll({
            where: whereClause,
            order: [['createdAt', 'ASC']],
            limit: 100
        });

        res.json({ messages });
    } catch (err) {
        console.error('Support messages error:', err);
        res.status(500).json({ error: 'Failed to get messages' });
    }
});

// Get all support conversations (Admin only)
app.get('/api/support/conversations', authMiddleware, async (req, res) => {
    try {
        console.log('[Support Conversations] Admin:', req.user?.id);

        if (req.user.role !== 'admin') {
            return res.status(403).json({ error: 'Admin only' });
        }

        const { Op } = require('sequelize');
        const currentUserId = req.user.id;

        // Get all non-admin users
        const employees = await User.findAll({
            where: { role: { [Op.ne]: 'admin' } },
            attributes: ['id', 'name', 'email', 'role']
        });

        console.log('[Support Conversations] Found employees:', employees.length);

        // Get conversations info for each employee
        const conversations = await Promise.all(employees.map(async (emp) => {
            try {
                // Get last message between admin and employee
                const lastMessage = await TeamMessage.findOne({
                    where: {
                        isGroupMessage: false,
                        [Op.or]: [
                            { senderId: emp.id, receiverId: currentUserId },
                            { senderId: currentUserId, receiverId: emp.id }
                        ]
                    },
                    order: [['createdAt', 'DESC']]
                });

                // Get unread count (simple isRead check)
                const unreadCount = await TeamMessage.count({
                    where: {
                        isGroupMessage: false,
                        senderId: emp.id,
                        receiverId: currentUserId,
                        isRead: false
                    }
                });

                let lastMsgPreview = lastMessage?.message;
                if (!lastMsgPreview && lastMessage?.attachment) {
                    lastMsgPreview = lastMessage.attachment.type === 'image' ? '📷 صورة' : '📎 ملف';
                }

                return {
                    id: emp.id,
                    name: emp.name,
                    email: emp.email,
                    role: emp.role,
                    lastMessage: lastMsgPreview || null,
                    lastMessageTime: lastMessage?.createdAt || null,
                    unreadCount
                };
            } catch (empErr) {
                console.error('[Support Conversations] Error for employee', emp.id, empErr.message);
                return {
                    id: emp.id,
                    name: emp.name,
                    email: emp.email,
                    role: emp.role,
                    lastMessage: null,
                    lastMessageTime: null,
                    unreadCount: 0
                };
            }
        }));

        // Sort by last message time
        conversations.sort((a, b) => {
            if (!a.lastMessageTime) return 1;
            if (!b.lastMessageTime) return -1;
            return new Date(b.lastMessageTime) - new Date(a.lastMessageTime);
        });

        console.log('[Support Conversations] Returning:', conversations.length, 'conversations');
        res.json({ conversations });
    } catch (err) {
        console.error('[Support Conversations] ERROR:', err.message);
        res.status(500).json({ error: 'Failed to get conversations' });
    }
});

// ============= FACEBOOK PAGE SYNC =============
app.post('/api/facebook/sync-pages', authMiddleware, async (req, res) => {
    try {
        const { pages } = req.body;
        const userId = req.user.id; // From authMiddleware

        if (!Array.isArray(pages)) {
            return res.status(400).json({ error: 'Pages must be an array' });
        }

        const results = [];
        for (const page of pages) {
            // Get token from frontend request first, then fallback to appData.users storage
            let pageAccessToken = page.access_token;

            // If no token from frontend, look in appData.users (where /api/pages stores them)
            if (!pageAccessToken) {
                for (const fbUserId of Object.keys(appData.users)) {
                    const fbUser = appData.users[fbUserId];
                    if (fbUser.pages && fbUser.pages[page.id]) {
                        pageAccessToken = fbUser.pages[page.id].accessToken;
                        console.log('[Sync] Found token in appData.users for page:', page.id);
                        break;
                    }
                }
            }

            // Upsert Platform record
            const [platform, created] = await Platform.findOrCreate({
                where: { platformId: page.id, userId },
                defaults: {
                    type: 'facebook',
                    name: page.name || 'Unknown Page',
                    accessToken: pageAccessToken,
                    isActive: true,
                    metadata: { picture: page.picture?.data?.url || '' }
                }
            });

            if (!created) {
                // Update token if we have one (don't overwrite with null)
                if (pageAccessToken) {
                    platform.accessToken = pageAccessToken;
                }
                if (page.picture?.data?.url) {
                    platform.metadata = { ...platform.metadata, picture: page.picture.data.url };
                }
                await platform.save();
            }
            results.push(platform.id);

            // Auto-subscribe to Webhooks (Feed & Messages)
            // This ensures we receive real-time events for analytics
            try {
                const tokenToUse = platform.accessToken;
                if (tokenToUse) {
                    await axios.post(`https://graph.facebook.com/v19.0/${page.id}/subscribed_apps`, null, {
                        params: {
                            subscribed_fields: 'feed,messages,message_echoes',
                            access_token: tokenToUse
                        }
                    });
                    console.log(`[Sync] ✅ Auto-subscribed page ${page.id} to webhooks`);
                }
            } catch (webhookErr) {
                console.error(`[Sync] ⚠️ Failed to subscribe page ${page.id} to webhooks:`, webhookErr.response?.data || webhookErr.message);
            }
        }

        res.json({ success: true, count: results.length });
    } catch (err) {
        console.error('Page Sync Error:', err);
        res.status(500).json({ error: 'Failed to sync pages' });
    }
});

// ============= ANALYTICS API =============
app.get('/api/analytics/:pageId', authMiddleware, async (req, res) => {
    const { pageId } = req.params;
    const { period } = req.query; // day, week, month

    try {
        // 1. Get Page Access Token (Try DB first, then Fallback Header)
        let accessToken = null;
        let platform = null;

        try {
            platform = await Platform.findOne({ where: { platformId: pageId, userId: req.user.id } });
            if (platform) accessToken = platform.accessToken;
        } catch (dbErr) {
            console.warn('[Analytics] DB Access Error (Platform):', dbErr.message);
        }

        // Fallback: Check header if DB failed or returned no token
        if (!accessToken) {
            accessToken = req.headers['x-page-token'];
            console.log('[Analytics] Using fallback token from header. Token length:', accessToken ? accessToken.length : 'null');
        }

        if (!accessToken) {
            console.log('[Analytics] No access token found (DB or Header)');
            return res.status(404).json({ error: 'Page not connected or token missing' });
        }

        const fbPeriod = period === 'month' ? 'days_28' : period === 'week' ? 'week' : 'day';

        // 2. Fetch Page Stats, Posts with Engagement, and Conversations IN PARALLEL
        let pageData = { fan_count: 0, name: 'Unknown' };
        let posts = [];
        let conversationsCount = 0;

        // Run all Facebook API requests in parallel for faster loading
        const [pageResult, postsResult, convResult] = await Promise.allSettled([
            // Fetch page info
            axios.get(`https://graph.facebook.com/v19.0/${pageId}`, {
                params: {
                    fields: 'fan_count,name,followers_count',
                    access_token: accessToken
                },
                timeout: 10000 // 10 second timeout
            }),
            // Fetch posts with engagement (reduced to 50 for speed)
            axios.get(`https://graph.facebook.com/v19.0/${pageId}/posts`, {
                params: {
                    fields: 'id,message,created_time,shares,likes.summary(true),comments.summary(true),reactions.summary(true)',
                    limit: 50,
                    access_token: accessToken
                },
                timeout: 15000 // 15 second timeout
            }),
            // Fetch conversations count (reduced to 100 for speed)
            axios.get(`https://graph.facebook.com/v19.0/${pageId}/conversations`, {
                params: {
                    fields: 'id',
                    limit: 100,
                    access_token: accessToken
                },
                timeout: 10000 // 10 second timeout
            })
        ]);

        // Process results
        if (pageResult.status === 'fulfilled') {
            pageData = pageResult.value.data;
        }
        if (postsResult.status === 'fulfilled') {
            posts = postsResult.value.data?.data || [];
        }
        if (convResult.status === 'fulfilled') {
            conversationsCount = convResult.value.data?.data?.length || 0;
        }

        // FIXED: Proper Egypt Timezone Handling (UTC+2) for Analytics
        // This ensures proper "Daily" filtering for posts made between 00:00-02:00 Egypt time
        const now = new Date();
        const EGYPT_OFFSET_HOURS = 2;
        const EGYPT_OFFSET_MS = EGYPT_OFFSET_HOURS * 60 * 60 * 1000;

        // Calculate "Egypt Time" components by shifting UTC time
        // This gives us a Date object where getUTCHours() matches Egypt time
        const nowUtcMs = now.getTime() + (now.getTimezoneOffset() * 60000);
        const egyptNowDate = new Date(nowUtcMs + EGYPT_OFFSET_MS);

        // Helper to get YYYY-MM-DD from the shifted date
        const getEgyptDateStr = (dateObj) => {
            return dateObj.toISOString().slice(0, 10);
        };

        let filterDateStr;        // For DB Query (DATEONLY string)
        let filterTimestamp = 0;  // For JS Filter (UTC Timestamp)

        // Helper: Get start of day timestamp in UTC for a given "Egypt Date"
        // 1. Take shifted date (Egypt time)
        // 2. Set to 00:00:00 UTC (which represents 00:00:00 Egypt)
        // 3. Subtract offset to get true UTC timestamp of Egypt Midnight
        const getEgyptNavStartOfDayInUtc = (dateObj) => {
            const d = new Date(dateObj);
            d.setUTCHours(0, 0, 0, 0);
            return d.getTime() - EGYPT_OFFSET_MS;
        };

        if (period === 'day') {
            // Today
            filterDateStr = getEgyptDateStr(egyptNowDate);
            filterTimestamp = getEgyptNavStartOfDayInUtc(egyptNowDate);
        } else if (period === 'week') {
            // Last 7 days
            const weekAgo = new Date(egyptNowDate);
            weekAgo.setUTCDate(weekAgo.getUTCDate() - 7);
            filterDateStr = getEgyptDateStr(weekAgo);
            filterTimestamp = getEgyptNavStartOfDayInUtc(weekAgo);
        } else if (period === 'month') {
            // Last 30 days
            const monthAgo = new Date(egyptNowDate);
            monthAgo.setUTCDate(monthAgo.getUTCDate() - 30);
            filterDateStr = getEgyptDateStr(monthAgo);
            filterTimestamp = getEgyptNavStartOfDayInUtc(monthAgo);
        } else {
            // Default 30 days
            const defaultAgo = new Date(egyptNowDate);
            defaultAgo.setUTCDate(defaultAgo.getUTCDate() - 30);
            filterDateStr = getEgyptDateStr(defaultAgo);
            filterTimestamp = getEgyptNavStartOfDayInUtc(defaultAgo);
        }

        // Fetch persistent stats from DB (Graceful degradation if DB fails)
        let dbStats = [];
        try {
            if (platform) { // Only try fetching stats if we have a valid platform record
                const { Op } = require('sequelize');
                dbStats = await DailyStats.findAll({
                    where: {
                        pageId,
                        date: { [Op.gte]: filterDateStr }
                    }
                });
            }
        } catch (dbErr) {
            console.warn('[Analytics] DB Access Error (DailyStats):', dbErr.message);
            // Continue with empty dbStats - relying on live Graph API data
        }

        let totalReactions = 0;
        let totalComments = 0;
        let totalShares = 0;
        let totalMessages = 0;

        dbStats.forEach(stat => {
            totalReactions += stat.reactions || 0;
            totalComments += stat.comments || 0;
            totalShares += stat.shares || 0;
            totalMessages += stat.messages || 0;
        });

        let totalEngagement = totalReactions + totalComments + totalShares;

        // Cold Start Fallback: Use Graph API data when DB stats are empty
        // For 'day' period, we ONLY rely on DailyStats (populated by webhooks) 
        // because Graph API shows total engagement on posts, not today's engagement specifically.
        // For week/month, we can use Graph API as a bootstrap if DB is empty.
        const shouldUseFallback = (totalEngagement === 0 && posts.length > 0 && period !== 'day');

        if (shouldUseFallback) {
            // Filter posts by date using the calculated timestamp
            const filteredPosts = posts.filter(post => {
                if (!post.created_time) return true;
                const postTime = new Date(post.created_time).getTime();
                return postTime >= filterTimestamp;
            });

            filteredPosts.forEach(post => {
                totalReactions += post.reactions?.summary?.total_count || 0;
                totalComments += post.comments?.summary?.total_count || 0;
                totalShares += (post.shares?.count || 0);
            });
            totalEngagement = totalReactions + totalComments + totalShares;
        }

        // Build chart data from DB (group by day for last 7 days)
        const last7Days = [];
        for (let i = 6; i >= 0; i--) {
            const d = new Date(egyptNowDate);
            d.setUTCDate(d.getUTCDate() - i);
            const dateStr = getEgyptDateStr(d);

            const dayStat = dbStats.find(s => s.date === dateStr);
            const dailyEngagement = dayStat ? (dayStat.reactions + dayStat.comments + dayStat.shares) : 0;

            last7Days.push({
                date: dateStr,
                label: d.toLocaleDateString('ar-EG', { weekday: 'short' }),
                engagement: dailyEngagement
            });
        }

        const chartLabels = last7Days.map(d => d.label);
        const chartData = last7Days.map(d => d.engagement);

        const data = {
            engagement: {
                total: totalEngagement,
                percentage: 0,
                labels: chartLabels,
                datasets: [{ data: chartData }]
            },
            messages: {
                total: conversationsCount,
                percentage: 0
            },
            shares: {
                total: totalShares,
                percentage: 0
            },
            comments: {
                total: totalComments,
                percentage: 0
            },
            healthScore: Math.min(100, Math.round((totalEngagement / Math.max(posts.length, 1)) * 10)),
            pageStats: {
                postCount: posts.length,
                fanCount: pageData.fan_count || 0,
                hasMore: posts.length >= 100
            }
        };

        res.json(data);

    } catch (error) {
        console.error('Analytics API Error:', error.response?.data || error.message);
        res.status(502).json({ error: 'Failed to fetch Facebook data' });
    }
});

// Send support message
app.post('/api/support/send', authMiddleware, upload.single('file'), async (req, res) => {
    try {
        console.log('[Support Send] Received request body:', req.body);
        console.log('[Support Send] Received file:', req.file);

        const { receiverId, message } = req.body;
        const senderId = req.user.id;

        // Get senderName - fetch from DB if not in token
        let senderName = req.user.name;
        if (!senderName) {
            const userRecord = await User.findByPk(senderId, { attributes: ['name'] });
            senderName = userRecord?.name || 'مستخدم';
        }

        if (!message && !req.file) {
            return res.status(400).json({ error: 'Message or file required' });
        }

        // Prepare attachment if file exists
        let attachment = null;
        if (req.file) {
            attachment = {
                type: 'image', // For now assume image, or derive from mimetype
                url: `/uploads/${req.file.filename}`,
                name: req.file.originalname
            };
        }

        // If employee, find admin to send to
        let finalReceiverId = receiverId;
        if (req.user.role !== 'admin' && !receiverId) {
            const admin = await User.findOne({ where: { role: 'admin' } });
            if (admin) {
                finalReceiverId = admin.id;
            }
        }

        const newMessage = await TeamMessage.create({
            senderId,
            senderName,
            receiverId: finalReceiverId,
            message: message || '',
            attachment,
            isGroupMessage: false,
            isRead: false
        });

        // Emit real-time notification
        if (global.io) {
            global.io.emit('new-support-message', {
                message: newMessage, // This now includes attachment
                recipientId: finalReceiverId,
                senderId,
                senderName
            });
        }

        res.json({ success: true, message: newMessage });
    } catch (err) {
        console.error('[Support Send] ERROR:', err.message);
        res.status(500).json({ error: 'Failed to send message' });
    }
});

// Get unread support count for current user
app.get('/api/support/unread', authMiddleware, async (req, res) => {
    try {
        const currentUserId = req.user.id;

        const count = await TeamMessage.count({
            where: {
                isGroupMessage: false,
                receiverId: currentUserId,
                isRead: false
            }
        });

        res.json({ unreadCount: count });
    } catch (err) {
        console.error('Unread count error:', err);
        res.json({ unreadCount: 0 });
    }
});

// Mark support messages as read
app.post('/api/support/mark-read', authMiddleware, async (req, res) => {
    try {
        const { senderId } = req.body;
        const currentUserId = req.user.id;
        const { Op } = require('sequelize');

        const whereClause = {
            isGroupMessage: false,
            receiverId: currentUserId,
            isRead: false
        };

        if (senderId) {
            whereClause.senderId = senderId;
        }

        await TeamMessage.update(
            { isRead: true },
            { where: whereClause }
        );

        res.json({ success: true });
    } catch (err) {
        console.error('Mark read error:', err);
        res.json({ success: false });
    }
});

// Facebook Graph API Base URL
const FB_GRAPH_URL = 'https://graph.facebook.com/v21.0';
const FB_APP_ID = process.env.FB_APP_ID;
const FB_APP_SECRET = process.env.FB_APP_SECRET;
const REDIRECT_URI = `${process.env.BASE_URL || 'http://localhost:3000'}/auth/facebook/callback`;

// ============= LOG SYSTEM =============
const systemLogs = [];
const MAX_LOGS = 500;

// External log file
const LOG_FILE = path.join(__dirname, 'server.log');
const MAX_LOG_SIZE = 5 * 1024 * 1024; // 5MB

// Function to write to log file
function writeToLogFile(message) {
    try {
        const logMessage = `${new Date().toISOString()} - ${message}\n`;

        // Check file size and rotate if needed
        if (fs.existsSync(LOG_FILE)) {
            const stats = fs.statSync(LOG_FILE);
            if (stats.size > MAX_LOG_SIZE) {
                // Rotate log file
                const backupFile = path.join(__dirname, `server.log.${Date.now()}`);
                fs.renameSync(LOG_FILE, backupFile);
                console.log(`📋 Log file rotated to: ${backupFile}`);
            }
        }

        // Append to log file
        fs.appendFileSync(LOG_FILE, logMessage);
    } catch (err) {
        // Silently fail to avoid infinite loop
    }
}

// Custom logger that stores logs
function addLog(type, message) {
    const log = {
        timestamp: new Date().toISOString(),
        type,
        message: typeof message === 'object' ? JSON.stringify(message) : String(message)
    };
    systemLogs.push(log);
    if (systemLogs.length > MAX_LOGS) {
        systemLogs.shift();
    }

    // Write to external log file
    const logMessage = `[${type.toUpperCase()}] ${log.message}`;
    writeToLogFile(logMessage);

    // Also log to console
    console.log(`[${type}] ${log.message}`);
}

// Override console methods to capture logs
const originalLog = console.log;
const originalError = console.error;
const originalWarn = console.warn;

console.log = (...args) => {
    const message = args.map(a => typeof a === 'object' ? JSON.stringify(a) : String(a)).join(' ');
    systemLogs.push({ timestamp: new Date().toISOString(), type: 'info', message });
    if (systemLogs.length > MAX_LOGS) systemLogs.shift();

    // Write to external log file
    writeToLogFile(`[INFO] ${message}`);

    originalLog.apply(console, args);
};

console.error = (...args) => {
    const message = args.map(a => typeof a === 'object' ? JSON.stringify(a) : String(a)).join(' ');
    systemLogs.push({ timestamp: new Date().toISOString(), type: 'error', message });
    if (systemLogs.length > MAX_LOGS) systemLogs.shift();

    // Write to external log file
    writeToLogFile(`[ERROR] ${message}`);

    originalError.apply(console, args);
};

console.warn = (...args) => {
    const message = args.map(a => typeof a === 'object' ? JSON.stringify(a) : String(a)).join(' ');
    systemLogs.push({ timestamp: new Date().toISOString(), type: 'warning', message });
    if (systemLogs.length > MAX_LOGS) systemLogs.shift();

    // Write to external log file
    writeToLogFile(`[WARNING] ${message}`);

    originalWarn.apply(console, args);
};

// ============= ROUTES =============

// Serve main page
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

// Sitemap for SEO (explicit route with correct Content-Type)
app.get('/sitemap.xml', (req, res) => {
    res.setHeader('Content-Type', 'application/xml');
    res.sendFile(path.join(__dirname, 'sitemap.xml'));
});

// Robots.txt for SEO
app.get('/robots.txt', (req, res) => {
    res.setHeader('Content-Type', 'text/plain');
    res.sendFile(path.join(__dirname, 'robots.txt'));
});

// Favicon - return empty to avoid 404
app.get('/favicon.ico', (req, res) => res.status(204).end());

// Serve logs page
app.get('/logs', (req, res) => {
    res.sendFile(path.join(__dirname, 'logs.html'));
});

// Get logs API
app.get('/api/logs', (req, res) => {
    res.json({ logs: systemLogs.slice(-200) }); // Return last 200 logs
});

// Clear logs API
app.delete('/api/logs', (req, res) => {
    systemLogs.length = 0;
    res.json({ success: true });
});

// ============= SETTINGS API =============

// Get settings (public)
app.get('/api/settings', (req, res) => {
    res.json(appData.settings || { subscriptionText: '' });
});

// Save settings (admin only)
app.post('/api/settings', authMiddleware, (req, res) => {
    if (req.user.role !== 'admin') {
        return res.status(403).json({ error: 'Admin only' });
    }
    const { subscriptionText } = req.body;
    if (!appData.settings) appData.settings = {};
    appData.settings.subscriptionText = subscriptionText || '';
    saveData();
    res.json({ success: true, settings: appData.settings });
});

// ============= ANALYTICS SYNC FUNCTION =============
// This function syncs engagement data from Facebook Graph API to DailyStats table
// It runs hourly via scheduled job and emits real-time updates via Socket.IO

async function syncAllPagesAnalytics() {
    try {
        console.log('[Analytics Sync] 📊 Starting sync for all pages...');

        // Get Egypt timezone date
        const now = new Date();
        const egyptOffset = 2 * 60;
        const utcTime = now.getTime() + (now.getTimezoneOffset() * 60000);
        const egyptDate = new Date(utcTime + (egyptOffset * 60000));
        const today = `${egyptDate.getFullYear()}-${String(egyptDate.getMonth() + 1).padStart(2, '0')}-${String(egyptDate.getDate()).padStart(2, '0')}`;

        console.log('[Analytics Sync] Egypt Date:', today);

        // Get all active Facebook pages from Platform table
        const platforms = await Platform.findAll({
            where: { type: 'facebook', isActive: true }
        });

        console.log('[Analytics Sync] Found', platforms.length, 'Facebook pages');

        for (const platform of platforms) {
            const pageId = platform.platformId;
            const accessToken = platform.accessToken;

            if (!accessToken) {
                console.log('[Analytics Sync] ⚠️ No token for page:', pageId);
                continue;
            }

            try {
                // Fetch today's posts with engagement
                const postsResponse = await axios.get(`https://graph.facebook.com/v19.0/${pageId}/posts`, {
                    params: {
                        fields: 'id,message,created_time,shares,reactions.summary(true),comments.summary(true)',
                        since: Math.floor(new Date(today + 'T00:00:00+02:00').getTime() / 1000), // Egypt midnight
                        access_token: accessToken
                    },
                    timeout: 15000
                });

                const posts = postsResponse.data?.data || [];

                let totalReactions = 0;
                let totalComments = 0;
                let totalShares = 0;

                posts.forEach(post => {
                    totalReactions += post.reactions?.summary?.total_count || 0;
                    totalComments += post.comments?.summary?.total_count || 0;
                    totalShares += post.shares?.count || 0;
                });

                // Get or create DailyStats record for today
                const [stats, created] = await DailyStats.findOrCreate({
                    where: { pageId, date: today },
                    defaults: {
                        pageId,
                        date: today,
                        reactions: 0,
                        comments: 0,
                        shares: 0,
                        messages: 0
                    }
                });

                // Update with latest values (use max to not lose webhook-recorded values)
                const updatedReactions = Math.max(stats.reactions, totalReactions);
                const updatedComments = Math.max(stats.comments, totalComments);
                const updatedShares = Math.max(stats.shares, totalShares);

                await stats.update({
                    reactions: updatedReactions,
                    comments: updatedComments,
                    shares: updatedShares
                });

                console.log(`[Analytics Sync] ✅ Page ${pageId}: R:${updatedReactions} C:${updatedComments} S:${updatedShares}`);

                // Emit real-time update via Socket.IO
                if (global.io) {
                    global.io.emit('analytics-update', {
                        pageId,
                        type: 'sync',
                        stats: {
                            reactions: updatedReactions,
                            comments: updatedComments,
                            shares: updatedShares,
                            messages: stats.messages
                        },
                        timestamp: new Date().toISOString()
                    });
                }

            } catch (pageErr) {
                console.error(`[Analytics Sync] ❌ Page ${pageId} error:`, pageErr.response?.data?.error?.message || pageErr.message);
            }
        }

        console.log('[Analytics Sync] ✅ Sync completed!');

    } catch (err) {
        console.error('[Analytics Sync] ❌ Fatal error:', err.message);
    }
}

// API endpoint to manually trigger sync
app.post('/api/analytics/sync', authMiddleware, async (req, res) => {
    if (req.user.role !== 'admin') {
        return res.status(403).json({ error: 'Admin only' });
    }

    console.log('[Analytics Sync] 🔄 Manual sync triggered by:', req.user.email);
    await syncAllPagesAnalytics();
    res.json({ success: true, message: 'Sync completed' });
});

// ============= FACEBOOK WEBHOOKS =============
const FB_WEBHOOK_VERIFY_TOKEN = 'dk_octobot_verify_2024';

// Store webhook events in memory (for real-time display)
const webhookEvents = [];
const MAX_WEBHOOK_EVENTS = 100;

// Webhook statistics counters (reset daily)
let webhookStats = {
    messages: 0,
    comments: 0,
    reactions: 0,
    shares: 0,
    lastReset: new Date().toDateString()
};

// Reset stats daily
function resetStatsIfNewDay() {
    const today = new Date().toDateString();
    if (webhookStats.lastReset !== today) {
        webhookStats = {
            messages: 0,
            comments: 0,
            reactions: 0,
            shares: 0,
            lastReset: today
        };
    }
}

// Webhook Verification (GET) - Facebook uses this to verify your endpoint
app.get('/webhook/facebook', (req, res) => {
    const mode = req.query['hub.mode'];
    const token = req.query['hub.verify_token'];
    const challenge = req.query['hub.challenge'];

    console.log('[Webhook] Verification request:', { mode, token, challenge: challenge?.substring(0, 20) + '...' });

    if (mode === 'subscribe' && token === FB_WEBHOOK_VERIFY_TOKEN) {
        console.log('[Webhook] ✅ Verification successful!');
        res.status(200).send(challenge);
    } else {
        console.log('[Webhook] ❌ Verification failed - token mismatch');
        res.sendStatus(403);
    }
});

// Webhook Event Receiver (POST) - Facebook sends events here
app.post('/webhook/facebook', (req, res) => {
    const body = req.body;

    console.log('[Webhook] 📥 Received event:', JSON.stringify(body).substring(0, 200));

    // Verify this is from a page subscription
    if (body.object === 'page') {
        resetStatsIfNewDay();

        body.entry.forEach(entry => {
            const pageId = entry.id;

            // Handle Messaging Events (new messages)
            if (entry.messaging) {
                entry.messaging.forEach(event => {
                    if (event.message) {
                        // Check if this is an echo (message sent BY the page)
                        const isEcho = event.message.is_echo;
                        const recipientId = event.recipient?.id;
                        const senderId = event.sender?.id;

                        webhookStats.messages++;
                        const webhookEvent = {
                            id: Date.now().toString(),
                            type: isEcho ? 'echo' : 'message',
                            pageId,
                            senderId: senderId,
                            recipientId: recipientId,
                            senderName: isEcho ? 'الصفحة' : 'مستخدم',
                            content: event.message.text || '[مرفق]',
                            timestamp: new Date().toISOString()
                        };
                        webhookEvents.unshift(webhookEvent);
                        if (webhookEvents.length > MAX_WEBHOOK_EVENTS) webhookEvents.pop();

                        console.log(`[Webhook] 💬 ${isEcho ? 'Echo (Page sent)' : 'New message'} - sender: ${senderId}, recipient: ${recipientId}`);

                        // Emit real-time notification via Socket.IO
                        if (global.io) {

                            // WARNING: Facebook sends echoes for ALL messages (even years old) on sync.
                            // We MUST filter out old messages to avoid spamming the UI.
                            const msgTimestamp = event.timestamp || Date.now();
                            const isRecent = (Date.now() - msgTimestamp) < 10 * 60 * 1000; // 10 minutes

                            if (!isRecent) {
                                console.log('[Webhook] ⚠️ Skipping old message/echo:', event.message.mid);
                                return;
                            }

                            if (isEcho) {
                                // Message sent from page - notify about sent message
                                global.io.emit('page-sent-message', {
                                    pageId,
                                    recipientId: recipientId,
                                    message: event.message.text || '[مرفق]',
                                    mid: event.message.mid,
                                    timestamp: new Date().toISOString()
                                });
                                console.log('[Socket.IO] 📤 Emitted page-sent-message event');
                            } else {
                                // Message from customer
                                global.io.emit('new-fb-message', {
                                    pageId,
                                    senderId: senderId,
                                    message: event.message.text || '[مرفق]',
                                    mid: event.message.mid,
                                    timestamp: new Date().toISOString()
                                });
                                console.log('[Socket.IO] 📤 Emitted new-fb-message event');

                                // PERSIST MESSAGE STAT TO DB
                                (async () => {
                                    try {
                                        // Get Egypt timezone date (UTC+2)
                                        const now = new Date();
                                        const egyptOffset = 2 * 60;
                                        const utcTime = now.getTime() + (now.getTimezoneOffset() * 60000);
                                        const egyptDate = new Date(utcTime + (egyptOffset * 60000));
                                        const today = `${egyptDate.getFullYear()}-${String(egyptDate.getMonth() + 1).padStart(2, '0')}-${String(egyptDate.getDate()).padStart(2, '0')}`;
                                        console.log('[Webhook] Saving message stat for Egypt date:', today);
                                        const [stats, created] = await DailyStats.findOrCreate({
                                            where: { pageId, date: today },
                                            defaults: {
                                                pageId,
                                                date: today,
                                                reactions: 0,
                                                comments: 0,
                                                shares: 0,
                                                messages: 0
                                            }
                                        });
                                        await stats.increment('messages');
                                        console.log('[Webhook] 💾 Message stat saved to DB for page:', pageId);
                                    } catch (dbErr) {
                                        console.error('[Webhook] ❌ Failed to save message stat:', dbErr.message);
                                    }
                                })();
                            }
                        }
                    }
                });
            }

            // Handle Postback Events (button clicks from templates)
            if (entry.messaging) {
                entry.messaging.forEach(event => {
                    if (event.postback) {
                        const payload = event.postback.payload || '';
                        const senderId = event.sender?.id;

                        console.log(`[Webhook] 🔘 Postback received: ${payload} from ${senderId}`);

                        // Handle "Mark as paid" postback from native FB order card
                        if (payload.startsWith('MARK_PAID_')) {
                            const orderNumber = payload.replace('MARK_PAID_', '');
                            console.log(`[Webhook] 💰 Customer marked order ${orderNumber} as paid`);

                            // Emit socket event for dashboard real-time update
                            if (global.io) {
                                global.io.emit('order-status-update', {
                                    pageId,
                                    orderNumber,
                                    status: 'paid',
                                    source: 'customer',
                                    senderId,
                                    timestamp: new Date().toISOString()
                                });
                            }

                            // Send confirmation reply to customer
                            const pageToken = findPageTokenByPageId(pageId);
                            if (pageToken) {
                                axios.post(`${FB_GRAPH_URL}/me/messages`, {
                                    recipient: { id: senderId },
                                    message: { text: `✅ تم تأكيد الدفع للطلب #${orderNumber}. شكراً لك!` },
                                    messaging_type: 'RESPONSE'
                                }, {
                                    params: { access_token: pageToken }
                                }).catch(err => {
                                    console.error('[Webhook] Failed to send postback reply:', err.response?.data?.error?.message || err.message);
                                });
                            }
                        }
                    }
                });
            }

            // Handle Feed Events (comments, reactions, shares)
            if (entry.changes) {
                entry.changes.forEach(change => {
                    const value = change.value;
                    let eventType = null;
                    let content = '';

                    if (change.field === 'feed') {
                        // Log the event for debugging
                        const eventTime = value.created_time ? new Date(value.created_time).getTime() : Date.now();
                        const ageMinutes = Math.round((Date.now() - eventTime) / 60000);
                        console.log(`[Webhook] 📥 Feed event received - item: ${value.item}, age: ${ageMinutes} mins`);

                        // ALWAYS record to DailyStats, but only emit real-time UI updates for recent events

                        if (value.item === 'comment') {
                            eventType = 'comment';
                            webhookStats.comments++;
                            content = value.message || 'تعليق جديد';
                        } else if (value.item === 'reaction') {
                            eventType = 'reaction';
                            webhookStats.reactions++;
                            content = `${value.reaction_type || 'إعجاب'}`;
                        } else if (value.item === 'share') {
                            eventType = 'share';
                            webhookStats.shares++;
                            content = 'مشاركة جديدة';
                        } else if (value.item === 'like') {
                            eventType = 'reaction';
                            webhookStats.reactions++;
                            content = 'إعجاب';
                        }


                        if (eventType) {
                            const webhookEvent = {
                                id: Date.now().toString(),
                                type: eventType,
                                pageId,
                                senderId: value.from?.id || value.sender_id,
                                senderName: value.from?.name || 'مستخدم',
                                content,
                                postId: value.post_id,
                                timestamp: new Date().toISOString()
                            };
                            webhookEvents.unshift(webhookEvent);
                            if (webhookEvents.length > MAX_WEBHOOK_EVENTS) webhookEvents.pop();
                            console.log(`[Webhook] ${eventType === 'comment' ? '💬' : eventType === 'reaction' ? '❤️' : '🔄'} New ${eventType} from:`, value.from?.name);

                            // PERSIST STATS TO DB
                            (async () => {
                                try {
                                    // Get Egypt timezone date (UTC+2)
                                    const now = new Date();
                                    const egyptOffset = 2 * 60;
                                    const utcTime = now.getTime() + (now.getTimezoneOffset() * 60000);
                                    const egyptDate = new Date(utcTime + (egyptOffset * 60000));
                                    const today = `${egyptDate.getFullYear()}-${String(egyptDate.getMonth() + 1).padStart(2, '0')}-${String(egyptDate.getDate()).padStart(2, '0')}`;
                                    console.log('[Webhook] Saving stats for Egypt date:', today);
                                    const [stats, created] = await DailyStats.findOrCreate({
                                        where: { pageId, date: today },
                                        defaults: {
                                            pageId,
                                            date: today,
                                            reactions: 0,
                                            comments: 0,
                                            shares: 0,
                                            messages: 0
                                        }
                                    });

                                    if (eventType === 'comment') {
                                        await stats.increment('comments');
                                    } else if (eventType === 'reaction') {
                                        await stats.increment('reactions');
                                    } else if (eventType === 'share') {
                                        await stats.increment('shares');
                                    }
                                    console.log('[Webhook] 💾 Stats saved to DB for page:', pageId);
                                } catch (dbErr) {
                                    console.error('[Webhook] ❌ Failed to save stats to DB:', dbErr.message);
                                }
                            })();

                            // Emit real-time analytics update via Socket.IO
                            if (global.io) {
                                global.io.emit('analytics-update', {
                                    pageId,
                                    type: eventType,
                                    stats: webhookStats,
                                    event: webhookEvent
                                });
                                console.log('[Socket.IO] 📊 Emitted analytics-update for page:', pageId);
                            }
                        }
                    }
                });
            }
        });

        // Always respond with 200 OK quickly (Facebook requirement)
        res.status(200).send('EVENT_RECEIVED');
    } else {
        res.sendStatus(404);
    }
});

// Get webhook statistics - FETCH FROM DATABASE for accurate daily counts
app.get('/api/webhook/stats', async (req, res) => {
    try {
        resetStatsIfNewDay();

        // Get optional pageId filter from query
        const { pageId } = req.query;

        // Get Egypt timezone date (UTC+2)
        const now = new Date();
        const egyptOffset = 2 * 60;
        const utcTime = now.getTime() + (now.getTimezoneOffset() * 60000);
        const egyptDate = new Date(utcTime + (egyptOffset * 60000));
        const today = `${egyptDate.getFullYear()}-${String(egyptDate.getMonth() + 1).padStart(2, '0')}-${String(egyptDate.getDate()).padStart(2, '0')}`;

        // Build where clause - filter by pageId if provided
        const whereClause = { date: today };
        if (pageId) {
            whereClause.pageId = pageId;
        }

        // Fetch today's stats from database
        const todayStats = await DailyStats.findAll({
            where: whereClause
        });

        // Calculate totals (for single page or all pages)
        let totalMessages = 0;
        let totalReactions = 0;
        let totalComments = 0;
        let totalShares = 0;

        todayStats.forEach(stat => {
            totalMessages += stat.messages || 0;
            totalReactions += stat.reactions || 0;
            totalComments += stat.comments || 0;
            totalShares += stat.shares || 0;
        });

        res.json({
            today: {
                messages: totalMessages,
                reactions: totalReactions,
                comments: totalComments,
                shares: totalShares,
                lastReset: today
            },
            totalEvents: webhookEvents.length,
            source: 'database',
            egyptDate: today,
            pageId: pageId || 'all'
        });
    } catch (err) {
        console.error('[Webhook Stats] Database error:', err.message);
        // Fallback to in-memory stats
        resetStatsIfNewDay();
        res.json({
            today: webhookStats,
            totalEvents: webhookEvents.length,
            source: 'memory',
            error: err.message
        });
    }
});

// Debug endpoint to view all DailyStats records
app.get('/api/debug/daily-stats', async (req, res) => {
    try {
        const { pageId } = req.query;
        const now = new Date();
        const todayLocal = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;

        let whereClause = {};
        if (pageId) {
            whereClause.pageId = pageId;
        }

        const stats = await DailyStats.findAll({
            where: whereClause,
            order: [['date', 'DESC']],
            limit: 50
        });

        res.json({
            serverLocalDate: todayLocal,
            serverUTCDate: now.toISOString().split('T')[0],
            serverTime: now.toISOString(),
            totalRecords: stats.length,
            records: stats.map(s => ({
                id: s.id,
                pageId: s.pageId,
                date: s.date,
                reactions: s.reactions,
                comments: s.comments,
                shares: s.shares,
                messages: s.messages
            }))
        });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Get recent webhook events
app.get('/api/webhook/events', (req, res) => {
    const limit = parseInt(req.query.limit) || 20;
    const type = req.query.type; // Optional filter by type: 'echo', 'message', etc.

    let events = webhookEvents;
    if (type) {
        events = events.filter(e => e.type === type);
    }

    res.json({
        events: events.slice(0, limit),
        totalEchos: webhookEvents.filter(e => e.type === 'echo').length,
        totalMessages: webhookEvents.filter(e => e.type === 'message').length
    });
});

// Test endpoint to manually trigger an echo event (for debugging)
app.post('/api/webhook/test-echo', (req, res) => {
    const { recipientId, message, pageId } = req.body;

    if (!recipientId || !message) {
        return res.status(400).json({ error: 'recipientId and message are required' });
    }

    console.log('[Test Echo] Emitting test page-sent-message event');

    if (global.io) {
        global.io.emit('page-sent-message', {
            pageId: pageId || 'test-page',
            recipientId: recipientId,
            message: message,
            timestamp: new Date().toISOString(),
            isTest: true
        });
        console.log('[Test Echo] ✅ Emitted to all clients');
        res.json({ success: true, message: 'Test echo emitted' });
    } else {
        res.status(500).json({ error: 'Socket.IO not initialized' });
    }
});

// Test endpoint to manually trigger an analytics-update event (for debugging)
app.post('/api/webhook/test-analytics', (req, res) => {
    const { pageId, type } = req.body;

    if (!pageId) {
        return res.status(400).json({ error: 'pageId is required' });
    }

    const eventType = type || 'reaction';
    console.log('[Test Analytics] Emitting test analytics-update event');

    if (global.io) {
        global.io.emit('analytics-update', {
            pageId,
            type: eventType,
            stats: webhookStats,
            event: {
                id: Date.now().toString(),
                type: eventType,
                pageId,
                senderId: 'test-user',
                senderName: 'مستخدم اختبار',
                content: eventType === 'comment' ? 'تعليق اختبار' : eventType === 'reaction' ? 'إعجاب' : 'مشاركة',
                timestamp: new Date().toISOString()
            }
        });
        console.log('[Test Analytics] ✅ Emitted analytics-update to all clients');
        res.json({ success: true, message: 'Test analytics-update emitted', pageId, type: eventType });
    } else {
        res.status(500).json({ error: 'Socket.IO not initialized' });
    }
});

// Get real-time stats for a specific page
app.get('/api/stats/:pageId', (req, res) => {
    const { pageId } = req.params;
    resetStatsIfNewDay();

    // Filter events for this page
    const pageEvents = webhookEvents.filter(e => e.pageId === pageId);

    res.json({
        stats: webhookStats,
        recentEvents: pageEvents.slice(0, 10),
        lastUpdated: new Date().toISOString()
    });
});

// Subscribe a page to webhooks (for feed events: comments, reactions, shares)
async function subscribePageToWebhook(pageId, pageToken) {
    try {
        const response = await axios.post(`${FB_GRAPH_URL}/${pageId}/subscribed_apps`, {
            access_token: pageToken,
            subscribed_fields: 'feed,messages'
        });
        console.log(`[Webhook] ✅ Page ${pageId} subscribed to webhooks:`, response.data);
        return { success: true };
    } catch (err) {
        console.error(`[Webhook] ❌ Failed to subscribe page ${pageId}:`, err.response?.data || err.message);
        return { success: false, error: err.response?.data?.error?.message || err.message };
    }
}

// API endpoint to manually subscribe a page to webhooks
app.post('/api/webhook/subscribe/:userId/:pageId', async (req, res) => {
    const { userId, pageId } = req.params;
    const user = appData.users[userId];

    if (!user || !user.pages?.[pageId]) {
        return res.status(404).json({ error: 'Page not found' });
    }

    const pageToken = user.pages[pageId].accessToken;
    const result = await subscribePageToWebhook(pageId, pageToken);

    res.json(result);
});

// ============= FACEBOOK AUTH =============


// Step 1: Get Facebook Login URL (returns JSON to avoid IIS redirect rewriting)
app.get('/auth/facebook', (req, res) => {
    const { octobotUserId } = req.query; // OctoBot user ID for multi-admin support

    const permissions = [
        'pages_show_list',
        'pages_read_engagement',
        'pages_manage_posts',
        'pages_read_user_content',
        'pages_manage_metadata',  // Required for webhook subscriptions
        'pages_messaging',        // Required for inbox/conversations
        'public_profile',
        'ads_read'
    ].join(',');

    // Include OctoBot user ID in state for multi-admin support
    const state = octobotUserId ? encodeURIComponent(octobotUserId) : '';

    const authUrl = `https://www.facebook.com/v18.0/dialog/oauth?` +
        `client_id=${FB_APP_ID}` +
        `&redirect_uri=${encodeURIComponent(REDIRECT_URI)}` +
        `&scope=${permissions}` +
        `&response_type=code` +
        (state ? `&state=${state}` : '');

    // Always return JSON with auth URL - client will redirect directly
    // This avoids IIS URL rewriting intercepting the redirect
    res.json({ authUrl });
});

// Step 2: Handle Facebook Callback
app.get('/auth/facebook/callback', async (req, res) => {
    const { code, error, state } = req.query;
    const octobotUserId = state ? decodeURIComponent(state) : null;

    if (error) {
        return res.redirect('/?error=' + encodeURIComponent(error));
    }

    try {
        // Exchange code for access token
        const tokenResponse = await axios.get(`${FB_GRAPH_URL}/oauth/access_token`, {
            params: {
                client_id: FB_APP_ID,
                client_secret: FB_APP_SECRET,
                redirect_uri: REDIRECT_URI,
                code: code
            }
        });

        const { access_token } = tokenResponse.data;

        // Get long-lived token
        const longTokenResponse = await axios.get(`${FB_GRAPH_URL}/oauth/access_token`, {
            params: {
                grant_type: 'fb_exchange_token',
                client_id: FB_APP_ID,
                client_secret: FB_APP_SECRET,
                fb_exchange_token: access_token
            }
        });

        const longLivedToken = longTokenResponse.data.access_token;

        // Get user info
        const userResponse = await axios.get(`${FB_GRAPH_URL}/me`, {
            params: {
                fields: 'id,name,picture',
                access_token: longLivedToken
            }
        });

        const user = userResponse.data;

        // Store user data with OctoBot user link for multi-admin support
        appData.users[user.id] = {
            id: user.id,
            name: user.name,
            picture: user.picture?.data?.url,
            accessToken: longLivedToken,
            connectedAt: new Date().toISOString(),
            octobotUserId: octobotUserId  // Link to OctoBot admin user
        };
        saveData();

        console.log(`[FB Auth] Connected Facebook ${user.name} (${user.id}) to OctoBot user ${octobotUserId}`);

        // Redirect to app with success
        res.redirect(`/?auth=success&userId=${user.id}`);

    } catch (err) {
        console.error('Facebook auth error:', err.response?.data || err.message);
        res.redirect('/?error=auth_failed');
    }
});

// Disconnect Facebook
app.post('/auth/facebook/disconnect', (req, res) => {
    const { userId } = req.body;
    if (appData.users[userId]) {
        delete appData.users[userId];
        saveData();
    }
    res.json({ success: true });
});

// ============= SHARED PLATFORMS (FOR EMPLOYEES) =============

// Get shared platform credentials (employees use admin's connections)
app.get('/api/shared-platforms', authMiddleware, async (req, res) => {
    try {
        // Get the current user's permissions from database
        const currentUser = await User.findByPk(req.user.id, {
            attributes: ['id', 'role', 'permissions']
        });

        if (!currentUser) {
            return res.status(404).json({ error: 'User not found' });
        }

        // Admin uses their own Facebook connection (linked to their OctoBot user ID)
        if (currentUser.role === 'admin') {
            // Find Facebook connection linked to this admin
            const adminFbConnection = Object.values(appData.users).find(
                fb => fb.octobotUserId === currentUser.id
            );

            if (adminFbConnection) {
                return res.json({
                    useShared: false,
                    hasOwnConnection: true,
                    fbUserId: adminFbConnection.id,
                    fbUserName: adminFbConnection.name,
                    message: 'Admin uses own credentials'
                });
            }

            return res.json({
                useShared: false,
                hasOwnConnection: false,
                message: 'Admin has no Facebook connection'
            });
        }

        // For employees: find the assigned admin's Facebook connection
        const fbPermissions = currentUser.permissions?.facebook || {};
        const assignedFbUserId = fbPermissions.assignedFbUserId;  // Direct FB user ID
        const assignedAdminId = fbPermissions.assignedAdminId;     // OctoBot admin ID
        console.log('[SharedPlatforms] Employee:', currentUser.id, 'assignedFbUserId:', assignedFbUserId, 'assignedAdminId:', assignedAdminId);

        let sharedFbUserId = null;
        let sharedUser = null;

        // PRIORITY 1: Use the specific FB user ID if saved (most accurate)
        if (assignedFbUserId && appData.users[assignedFbUserId]) {
            sharedUser = appData.users[assignedFbUserId];
            sharedFbUserId = assignedFbUserId;
            console.log('[SharedPlatforms] Using assignedFbUserId directly:', sharedUser.name, sharedFbUserId);
        }
        // PRIORITY 2: Fall back to finding by admin ID (use latest connection)
        else if (assignedAdminId) {
            // Find Facebook connection linked to the assigned admin
            // IMPORTANT: Get the LATEST connection (by connectedAt) if multiple exist
            const adminConnections = Object.values(appData.users)
                .filter(fb => fb.octobotUserId === assignedAdminId)
                .sort((a, b) => new Date(b.connectedAt) - new Date(a.connectedAt)); // Sort by date DESC

            if (adminConnections.length > 0) {
                sharedUser = adminConnections[0]; // Use the most recent connection
                sharedFbUserId = sharedUser.id;
                console.log('[SharedPlatforms] Found assigned admin FB (latest):', sharedUser.name, sharedFbUserId, 'connectedAt:', sharedUser.connectedAt);
            } else {
                console.log('[SharedPlatforms] No FB connection found for assignedAdminId:', assignedAdminId);
            }
        }



        // Fallback: if no assigned admin or admin has no FB, use first available
        if (!sharedUser) {
            const fbUserIds = Object.keys(appData.users);
            if (fbUserIds.length > 0) {
                sharedFbUserId = fbUserIds[0];
                sharedUser = appData.users[sharedFbUserId];
                console.log('[SharedPlatforms] FALLBACK - Using first FB user:', sharedUser.name, sharedFbUserId);
            }
        }


        if (!sharedUser) {
            return res.json({
                useShared: false,
                hasConnection: false,
                message: 'No Facebook connection available'
            });
        }

        // Get user's allowed pages from permissions
        const allowedPages = fbPermissions.allowedPages || [];

        // Filter pages based on allowed list (empty means NO pages for security)
        let availablePages = [];
        if (sharedUser.pages) {
            const allPages = Object.values(sharedUser.pages);
            if (allowedPages.length === 0) {
                // No pages allowed - employee must be explicitly assigned pages
                availablePages = [];
            } else {
                // Filter to allowed pages only
                availablePages = allPages
                    .filter(p => allowedPages.includes(p.id))
                    .map(p => ({ id: p.id, name: p.name }));
            }
        }


        // Employees use their own Telegram/Instagram accounts (sessions saved by their userId)
        // No shared access - each employee logs in once and their session is persisted
        let sharedTgUserId = null;  // null = employee uses their own account
        let sharedIgUserId = null;  // null = employee uses their own account


        res.json({
            useShared: true,
            hasConnection: true,
            // Facebook shared access
            sharedFbUserId: sharedFbUserId,
            sharedUserName: sharedUser.name,
            assignedAdminId: assignedAdminId,
            availablePages: availablePages,
            canView: fbPermissions.view !== false,
            canSend: fbPermissions.send !== false,
            canManage: fbPermissions.manage === true,
            // Telegram shared access
            telegram: {
                hasConnection: !!sharedTgUserId,
                sharedUserId: sharedTgUserId,
                canView: currentUser.permissions?.telegram?.view !== false,
                canSend: currentUser.permissions?.telegram?.send !== false
            },
            // Instagram shared access
            instagram: {
                hasConnection: !!sharedIgUserId,
                sharedUserId: sharedIgUserId,
                canView: currentUser.permissions?.instagram?.view !== false,
                canSend: currentUser.permissions?.instagram?.send !== false
            }
        });

    } catch (err) {
        console.error('Shared platforms error:', err);
        res.status(500).json({ error: 'Failed to get shared platforms' });
    }
});


// Get all Facebook-connected admins (for assigning employees)
app.get('/api/fb-connected-admins', authMiddleware, async (req, res) => {
    try {
        // Only admins can see this
        if (req.user.role !== 'admin') {
            return res.status(403).json({ error: 'Admin access required' });
        }

        const connectedAdmins = [];

        // Loop through all FB connections
        for (const fbUser of Object.values(appData.users)) {
            if (fbUser.octobotUserId) {
                // Get the OctoBot user info
                const octobotUser = await User.findByPk(fbUser.octobotUserId, {
                    attributes: ['id', 'name', 'email', 'role']
                });

                if (octobotUser && octobotUser.role === 'admin') {
                    // Get pages for this FB connection
                    const pages = fbUser.pages ? Object.values(fbUser.pages).map(p => ({
                        id: p.id,
                        name: p.name
                    })) : [];

                    connectedAdmins.push({
                        octobotUserId: octobotUser.id,
                        octobotUserName: octobotUser.name,
                        octobotUserEmail: octobotUser.email,
                        fbUserId: fbUser.id,
                        fbUserName: fbUser.name,
                        fbUserPicture: fbUser.picture,
                        connectedAt: fbUser.connectedAt,
                        pages: pages
                    });
                }
            }
        }

        // Also include FB connections without octobotUserId (legacy)
        for (const fbUser of Object.values(appData.users)) {
            if (!fbUser.octobotUserId) {
                const pages = fbUser.pages ? Object.values(fbUser.pages).map(p => ({
                    id: p.id,
                    name: p.name
                })) : [];

                connectedAdmins.push({
                    octobotUserId: null,
                    octobotUserName: 'حساب قديم',
                    fbUserId: fbUser.id,
                    fbUserName: fbUser.name,
                    fbUserPicture: fbUser.picture,
                    connectedAt: fbUser.connectedAt,
                    pages: pages,
                    isLegacy: true
                });
            }
        }

        res.json({ admins: connectedAdmins });
    } catch (err) {
        console.error('Get FB connected admins error:', err);
        res.status(500).json({ error: 'Failed to get connected admins' });
    }
});

// ============= FACEBOOK CUSTOM LABELS =============

// Helper: Find page access token by pageId (searches across all users)
function findPageTokenByPageId(pageId) {
    for (const userId of Object.keys(appData.users)) {
        const user = appData.users[userId];
        if (user.pages && user.pages[pageId] && user.pages[pageId].accessToken) {
            return user.pages[pageId].accessToken;
        }
    }
    return null;
}

// GET /api/labels/:pageId - Fetch all custom labels for a page
app.get('/api/labels/:pageId', async (req, res) => {
    const { pageId } = req.params;
    const pageToken = findPageTokenByPageId(pageId);

    if (!pageToken) {
        return res.status(404).json({ error: 'Page not found or no access token' });
    }

    try {
        const response = await axios.get(`${FB_GRAPH_URL}/${pageId}/custom_labels`, {
            params: {
                access_token: pageToken,
                fields: 'id,page_label_name',
                limit: 200
            }
        });
        const labels = (response.data.data || []).map(l => ({ id: l.id, name: l.page_label_name || l.name }));
        console.log(`[Labels] Fetched ${labels.length} labels for page ${pageId}`);
        res.json({ labels });
    } catch (err) {
        console.error('[Labels] Error fetching labels:', err.response?.data?.error?.message || err.message);
        res.status(500).json({ error: err.response?.data?.error?.message || 'Failed to fetch labels' });
    }
});

// POST /api/labels/:pageId - Create a new custom label
app.post('/api/labels/:pageId', async (req, res) => {
    const { pageId } = req.params;
    const { labelName } = req.body;
    const pageToken = findPageTokenByPageId(pageId);

    if (!pageToken) {
        return res.status(404).json({ error: 'Page not found or no access token' });
    }

    if (!labelName || !labelName.trim()) {
        return res.status(400).json({ error: 'labelName is required' });
    }

    try {
        const response = await axios.post(`${FB_GRAPH_URL}/${pageId}/custom_labels`, null, {
            params: {
                page_label_name: labelName.trim(),
                access_token: pageToken
            }
        });
        console.log(`[Labels] Created label "${labelName}" for page ${pageId}:`, response.data);
        res.json({ success: true, labelId: response.data.id, name: labelName.trim() });
    } catch (err) {
        console.error('[Labels] Error creating label:', err.response?.data?.error?.message || err.message);
        res.status(500).json({ error: err.response?.data?.error?.message || 'Failed to create label' });
    }
});

// DELETE /api/labels/:pageId/:labelId - Delete a custom label
app.delete('/api/labels/:pageId/:labelId', async (req, res) => {
    const { pageId, labelId } = req.params;
    const pageToken = findPageTokenByPageId(pageId);

    if (!pageToken) {
        return res.status(404).json({ error: 'Page not found or no access token' });
    }

    try {
        await axios.delete(`${FB_GRAPH_URL}/${labelId}`, {
            params: { access_token: pageToken }
        });
        console.log(`[Labels] Deleted label ${labelId} from page ${pageId}`);
        res.json({ success: true });
    } catch (err) {
        console.error('[Labels] Error deleting label:', err.response?.data?.error?.message || err.message);
        res.status(500).json({ error: err.response?.data?.error?.message || 'Failed to delete label' });
    }
});

// GET /api/labels/:pageId/user/:psid - Fetch labels assigned to a specific user
app.get('/api/labels/:pageId/user/:psid', async (req, res) => {
    const { pageId, psid } = req.params;
    const pageToken = findPageTokenByPageId(pageId);

    if (!pageToken) {
        return res.status(404).json({ error: 'Page not found or no access token' });
    }

    try {
        const response = await axios.get(`${FB_GRAPH_URL}/${psid}/custom_labels`, {
            params: {
                access_token: pageToken,
                fields: 'id,page_label_name',
                limit: 200
            }
        });
        const labels = (response.data.data || []).map(l => ({ id: l.id, name: l.page_label_name || l.name }));
        console.log(`[Labels] User ${psid} has ${labels.length} labels`);
        res.json({ labels });
    } catch (err) {
        console.error('[Labels] Error fetching user labels:', err.response?.data?.error?.message || err.message);
        res.status(500).json({ error: err.response?.data?.error?.message || 'Failed to fetch user labels' });
    }
});

// POST /api/labels/:pageId/:labelId/user/:psid - Assign a label to a user
app.post('/api/labels/:pageId/:labelId/user/:psid', async (req, res) => {
    const { pageId, labelId, psid } = req.params;
    const pageToken = findPageTokenByPageId(pageId);

    if (!pageToken) {
        return res.status(404).json({ error: 'Page not found or no access token' });
    }

    try {
        await axios.post(`${FB_GRAPH_URL}/${labelId}/label`, null, {
            params: {
                user: psid,
                access_token: pageToken
            }
        });
        console.log(`[Labels] Assigned label ${labelId} to user ${psid}`);
        res.json({ success: true });
    } catch (err) {
        console.error('[Labels] Error assigning label:', err.response?.data?.error?.message || err.message);
        res.status(500).json({ error: err.response?.data?.error?.message || 'Failed to assign label' });
    }
});

// DELETE /api/labels/:pageId/:labelId/user/:psid - Remove a label from a user
app.delete('/api/labels/:pageId/:labelId/user/:psid', async (req, res) => {
    const { pageId, labelId, psid } = req.params;
    const pageToken = findPageTokenByPageId(pageId);

    if (!pageToken) {
        return res.status(404).json({ error: 'Page not found or no access token' });
    }

    try {
        await axios.delete(`${FB_GRAPH_URL}/${labelId}/label`, {
            params: {
                user: psid,
                access_token: pageToken
            }
        });
        console.log(`[Labels] Removed label ${labelId} from user ${psid}`);
        res.json({ success: true });
    } catch (err) {
        console.error('[Labels] Error removing label:', err.response?.data?.error?.message || err.message);
        res.status(500).json({ error: err.response?.data?.error?.message || 'Failed to remove label' });
    }
});

// ============= USER & PAGES =============


// Get connected user
app.get('/api/user/:userId', (req, res) => {
    const user = appData.users[req.params.userId];
    if (!user) {
        return res.status(404).json({ error: 'User not found' });
    }
    res.json({
        id: user.id,
        name: user.name,
        picture: user.picture,
        connectedAt: user.connectedAt
    });
});

// Get user's Facebook pages
// Get user's Facebook pages with pagination support
app.get('/api/pages/:userId', async (req, res) => {
    const user = appData.users[req.params.userId];
    if (!user) {
        return res.status(404).json({ error: 'User not found' });
    }

    try {
        let allPages = [];
        let url = `${FB_GRAPH_URL}/me/accounts`;
        let params = {
            access_token: user.accessToken,
            limit: 100,
            fields: 'id,name,picture,access_token,category,fan_count'
        };

        // Loop through all pages (pagination)
        while (url) {
            const response = await axios.get(url, { params });
            const data = response.data;

            if (data.data && data.data.length > 0) {
                allPages = allPages.concat(data.data);
            }

            if (data.paging && data.paging.next) {
                url = data.paging.next;
                params = {}; // Next URL already contains params
            } else {
                url = null;
            }
        }

        console.log(`[Pages] Fetched ${allPages.length} pages for user ${user.name}`);

        // Store page tokens for later use
        if (!appData.users[user.id].pages) {
            appData.users[user.id].pages = {};
        }

        allPages.forEach(page => {
            appData.users[user.id].pages[page.id] = {
                id: page.id,
                name: page.name,
                accessToken: page.access_token,
                category: page.category,
                fanCount: page.fan_count
            };
        });
        saveData();

        // Return pages without tokens to frontend
        const pages = allPages.map(page => ({
            id: page.id,
            name: page.name,
            picture: page.picture?.data?.url,
            category: page.category,
            fanCount: page.fan_count
        }));

        res.json({ pages, count: pages.length });

    } catch (err) {
        console.error('Error fetching pages:', err.response?.data || err.message);
        res.status(500).json({ error: 'Failed to fetch pages' });
    }
});

// ============= PAGE STATS =============

// Get page statistics (fan count, post count)
app.get('/api/page-stats/:userId/:pageId', async (req, res) => {
    const { userId, pageId } = req.params;
    const user = appData.users[userId];

    if (!user || !user.pages?.[pageId]) {
        return res.status(404).json({ error: 'Page not found' });
    }

    const pageToken = user.pages[pageId].accessToken;

    try {
        // Get page info with fan_count
        const pageResponse = await axios.get(`${FB_GRAPH_URL}/${pageId}`, {
            params: {
                fields: 'fan_count,followers_count',
                access_token: pageToken
            }
        });

        // Get posts count (last 100 posts as estimate)
        const postsResponse = await axios.get(`${FB_GRAPH_URL}/${pageId}/posts`, {
            params: {
                limit: 100,
                access_token: pageToken
            }
        });

        const fanCount = pageResponse.data.fan_count || pageResponse.data.followers_count || 0;
        const posts = postsResponse.data.data || [];
        const hasMore = !!postsResponse.data.paging?.next;

        res.json({
            fanCount,
            postCount: posts.length,
            hasMore
        });

    } catch (err) {
        console.error('Error fetching page stats:', err.response?.data || err.message);
        res.status(500).json({
            error: 'Failed to fetch page stats',
            fanCount: user.pages[pageId].fanCount || 0,
            postCount: 0
        });
    }
});

// ============= POSTING =============

// Publish post immediately (supports single photo, multiple photos, or video)
app.post('/api/publish', async (req, res) => {
    const { userId, pageId, message, link, mediaData, mediaType } = req.body;
    // mediaData is array of { base64, filename } objects

    const user = appData.users[userId];
    if (!user || !user.pages?.[pageId]) {
        return res.status(404).json({ error: 'Page not found' });
    }

    const pageToken = user.pages[pageId].accessToken;

    try {
        let response;
        const FormData = require('form-data');

        // Helper: check if a filename is a video
        const isVideoFile = (filename) => {
            const videoExts = ['.mp4', '.mov', '.avi', '.wmv', '.flv', '.mkv', '.webm', '.m4v', '.3gp'];
            const ext = path.extname(filename).toLowerCase();
            return videoExts.includes(ext);
        };

        if (mediaData && mediaData.length > 0) {
            // Separate images and videos
            const imageFiles = mediaData.filter(m => !isVideoFile(m.filename));
            const videoFiles = mediaData.filter(m => isVideoFile(m.filename));

            console.log(`[Publish] Media breakdown: ${imageFiles.length} images, ${videoFiles.length} videos`);

            // Upload images as album post (photos endpoint)
            if (imageFiles.length > 1) {
                const photoIds = [];
                for (const img of imageFiles) {
                    const filePath = path.join(__dirname, 'uploads', img.filename);
                    if (fs.existsSync(filePath)) {
                        const form = new FormData();
                        form.append('source', fs.createReadStream(filePath));
                        form.append('published', 'false');
                        form.append('access_token', pageToken);

                        const uploadRes = await axios.post(`${FB_GRAPH_URL}/${pageId}/photos`, form, {
                            headers: form.getHeaders()
                        });
                        photoIds.push({ media_fbid: uploadRes.data.id });
                    }
                }

                if (photoIds.length > 0) {
                    let postData = { message, attached_media: photoIds, access_token: pageToken };
                    response = await axios.post(`${FB_GRAPH_URL}/${pageId}/feed`, postData);
                }
            }
            // Single image
            else if (imageFiles.length === 1) {
                const filePath = path.join(__dirname, 'uploads', imageFiles[0].filename);
                if (fs.existsSync(filePath)) {
                    const form = new FormData();
                    form.append('source', fs.createReadStream(filePath));
                    form.append('caption', message || '');
                    form.append('access_token', pageToken);

                    response = await axios.post(`${FB_GRAPH_URL}/${pageId}/photos`, form, {
                        headers: form.getHeaders()
                    });
                }
            }

            // Upload videos separately (videos endpoint) - Facebook only supports one video per post
            for (const vid of videoFiles) {
                const filePath = path.join(__dirname, 'uploads', vid.filename);
                if (fs.existsSync(filePath)) {
                    const form = new FormData();
                    form.append('source', fs.createReadStream(filePath));
                    form.append('description', message || '');
                    form.append('access_token', pageToken);

                    const vidResponse = await axios.post(`${FB_GRAPH_URL}/${pageId}/videos`, form, {
                        headers: form.getHeaders()
                    });
                    // Use video response if no image response
                    if (!response) response = vidResponse;
                    console.log(`[Publish] Video uploaded: ${vid.filename}`);
                }
            }

            // If only videos were uploaded and no images, response is already set above
        }
        // Remote image URLs (from e-commerce products) - supports multiple images
        else if (req.body.imageUrls && req.body.imageUrls.length > 0 && (!mediaData || mediaData.length === 0)) {
            const imageUrls = req.body.imageUrls;
            console.log('[Publish] Downloading remote images:', imageUrls.length, 'images');

            try {
                // Multiple images - create album post
                if (imageUrls.length > 1) {
                    const photoIds = [];
                    for (const imgUrl of imageUrls) {
                        try {
                            const imageResponse = await axios.get(imgUrl, { responseType: 'stream' });
                            const form = new FormData();
                            form.append('source', imageResponse.data);
                            form.append('published', 'false');
                            form.append('access_token', pageToken);

                            const uploadRes = await axios.post(`${FB_GRAPH_URL}/${pageId}/photos`, form, {
                                headers: form.getHeaders()
                            });
                            photoIds.push({ media_fbid: uploadRes.data.id });
                            console.log('[Publish] Uploaded image:', uploadRes.data.id);
                        } catch (imgErr) {
                            console.error('[Publish] Failed to download one image:', imgErr.message);
                        }
                    }

                    if (photoIds.length > 0) {
                        let postData = { message, attached_media: photoIds, access_token: pageToken };
                        response = await axios.post(`${FB_GRAPH_URL}/${pageId}/feed`, postData);
                        console.log('[Publish] Successfully posted album with', photoIds.length, 'images');
                    }
                }
                // Single image - just use direct photo post
                else {
                    const imageResponse = await axios.get(imageUrls[0], { responseType: 'stream' });
                    const form = new FormData();
                    form.append('source', imageResponse.data);
                    form.append('caption', message || '');
                    form.append('access_token', pageToken);

                    response = await axios.post(`${FB_GRAPH_URL}/${pageId}/photos`, form, {
                        headers: form.getHeaders()
                    });
                    console.log('[Publish] Successfully posted single image from URL');
                }
            } catch (imgErr) {
                console.error('[Publish] Failed to process images, falling back to link post:', imgErr.message);
                let postData = { message, access_token: pageToken };
                if (link) postData.link = link;
                response = await axios.post(`${FB_GRAPH_URL}/${pageId}/feed`, postData);
            }
        }
        // Text only or with link
        else {
            let postData = { message, access_token: pageToken };
            if (link) postData.link = link;

            console.log('[Publish] Text/Link post');
            response = await axios.post(`${FB_GRAPH_URL}/${pageId}/feed`, postData);
        }

        if (response) {
            res.json({
                success: true,
                postId: response.data.id || response.data.post_id,
                message: 'تم النشر بنجاح!'
            });
        } else {
            res.status(500).json({ error: 'فشل في النشر', details: 'لم يتم العثور على الملف' });
        }

    } catch (err) {
        console.error('Error publishing:', err.response?.data || err.message);
        res.status(500).json({
            error: 'فشل في النشر',
            details: err.response?.data?.error?.message
        });
    }
});

// ============= MEDIA UPLOAD =============

// Upload media file
app.post('/api/upload', upload.single('media'), (req, res) => {
    if (!req.file) {
        return res.status(400).json({ error: 'No file uploaded' });
    }

    const baseUrl = process.env.BASE_URL || `http://localhost:${PORT}`;
    const fileUrl = `${baseUrl}/uploads/${req.file.filename}`;

    console.log('[Upload] File uploaded:', req.file.filename);
    console.log('[Upload] BASE_URL:', baseUrl);
    console.log('[Upload] Full URL:', fileUrl);

    res.json({
        success: true,
        url: fileUrl,
        filename: req.file.filename,
        type: req.file.mimetype.startsWith('video') ? 'video' : 'image'
    });
});

// Schedule a post
app.post('/api/schedule', (req, res) => {
    const { userId, pageId, message, link, imageUrl, mediaUrls, mediaType, scheduledTime, cta } = req.body;

    console.log('[Schedule] Received:', { pageId, message: message?.substring(0, 50), imageUrl, mediaUrls, mediaType, scheduledTime, cta });

    const user = appData.users[userId];
    if (!user || !user.pages?.[pageId]) {
        return res.status(404).json({ error: 'Page not found' });
    }

    const scheduledDate = new Date(scheduledTime);
    const now = new Date();

    // Add 1 minute buffer to allow near-future scheduling
    // Also log for debugging timezone issues
    console.log('[Schedule] Time check - Scheduled:', scheduledDate.toISOString(), 'Now:', now.toISOString());

    if (scheduledDate.getTime() <= now.getTime() - 60000) { // Allow 1 minute buffer
        return res.status(400).json({ error: 'الوقت المحدد يجب أن يكون في المستقبل' });
    }

    const postId = Date.now().toString();
    const scheduledPost = {
        id: postId,
        userId,
        pageId,
        pageName: user.pages[pageId].name,
        message,
        link,
        imageUrl,
        mediaUrls: mediaUrls || [],
        mediaType: mediaType || (imageUrl ? 'photo' : null),
        cta: cta || '', // Call-to-Action button
        scheduledTime: scheduledDate.toISOString(),
        status: 'scheduled',
        createdAt: new Date().toISOString()
    };

    appData.scheduledPosts.push(scheduledPost);
    saveData();

    // Schedule the job
    schedulePost(scheduledPost);

    res.json({
        success: true,
        post: scheduledPost,
        message: 'تم جدولة المنشور بنجاح!'
    });
});

// Get scheduled posts
app.get('/api/scheduled/:userId', (req, res) => {
    const posts = appData.scheduledPosts.filter(
        p => p.userId === req.params.userId && p.status === 'scheduled'
    );
    res.json({ posts });
});

// Cancel scheduled post
app.delete('/api/scheduled/:postId', (req, res) => {
    const index = appData.scheduledPosts.findIndex(p => p.id === req.params.postId);
    if (index > -1) {
        appData.scheduledPosts[index].status = 'cancelled';
        saveData();

        // Cancel the scheduled job
        const job = schedule.scheduledJobs[`post_${req.params.postId}`];
        if (job) job.cancel();
    }
    res.json({ success: true });
});

// ============= SCHEDULER =============

function schedulePost(post) {
    const scheduledDate = new Date(post.scheduledTime);

    schedule.scheduleJob(`post_${post.id}`, scheduledDate, async () => {
        console.log(`Publishing scheduled post: ${post.id}`);

        const user = appData.users[post.userId];
        if (!user || !user.pages?.[post.pageId]) {
            console.error('User or page not found for scheduled post');
            post.status = 'failed';
            post.error = 'User or page not found';
            saveData();
            return;
        }

        const pageToken = user.pages[post.pageId].accessToken;

        try {
            let response;
            const FormData = require('form-data');

            // Build call_to_action if cta is provided
            let callToAction = null;
            if (post.cta) {
                callToAction = { type: post.cta };

                // Different CTAs need different value formats
                if (post.cta === 'MESSAGE_PAGE' || post.cta === 'WHATSAPP_MESSAGE' || post.cta === 'CALL_NOW') {
                    callToAction.value = {};
                } else if (post.link && ['LEARN_MORE', 'SHOP_NOW', 'SIGN_UP', 'BOOK_NOW'].includes(post.cta)) {
                    callToAction.value = { link: post.link };
                }
            }

            // Helper function to extract filename from URL or return as-is if already a filename
            const extractFilename = (item) => {
                if (typeof item === 'object' && item.filename) {
                    return item.filename;
                }
                if (typeof item === 'string') {
                    // Check if it's a URL
                    if (item.includes('/uploads/')) {
                        // Extract filename from URL like "https://.../uploads/filename.jpg"
                        return item.split('/uploads/').pop();
                    }
                    return item; // Already a filename
                }
                return null;
            };

            // Get media files - handle URLs, objects with filename, and plain strings
            let mediaFiles = [];
            if (post.imageUrl && Array.isArray(post.imageUrl)) {
                mediaFiles = post.imageUrl.map(extractFilename).filter(f => f);
            } else if (post.mediaUrls && Array.isArray(post.mediaUrls)) {
                mediaFiles = post.mediaUrls.map(extractFilename).filter(f => f);
            } else if (typeof post.imageUrl === 'string') {
                const filename = extractFilename(post.imageUrl);
                if (filename) mediaFiles = [filename];
            }

            console.log(`[Schedule] Media files extracted:`, mediaFiles);

            // Handle multiple photos
            if (mediaFiles.length > 1 && (post.mediaType === 'image' || post.mediaType === 'photos')) {
                const photoIds = [];
                for (const filename of mediaFiles) {
                    const filePath = path.join(__dirname, 'uploads', filename);
                    if (fs.existsSync(filePath)) {
                        const form = new FormData();
                        form.append('source', fs.createReadStream(filePath));
                        form.append('published', 'false');
                        form.append('access_token', pageToken);

                        const uploadRes = await axios.post(`${FB_GRAPH_URL}/${post.pageId}/photos`, form, {
                            headers: form.getHeaders()
                        });
                        photoIds.push({ media_fbid: uploadRes.data.id });
                    }
                }

                if (photoIds.length > 0) {
                    let postData = { message: post.message, attached_media: photoIds, access_token: pageToken };
                    if (callToAction) postData.call_to_action = callToAction;
                    response = await axios.post(`${FB_GRAPH_URL}/${post.pageId}/feed`, postData);
                }
            }
            // Handle single photo
            else if (mediaFiles.length === 1 && (post.mediaType === 'image' || post.mediaType === 'photo')) {
                const filePath = path.join(__dirname, 'uploads', mediaFiles[0]);
                if (fs.existsSync(filePath)) {
                    const form = new FormData();
                    form.append('source', fs.createReadStream(filePath));
                    form.append('caption', post.message || '');
                    form.append('access_token', pageToken);

                    response = await axios.post(`${FB_GRAPH_URL}/${post.pageId}/photos`, form, {
                        headers: form.getHeaders()
                    });
                } else {
                    console.error(`[Schedule] File not found: ${filePath}`);
                    throw new Error('File not found: ' + mediaFiles[0]);
                }
            }
            // Handle video
            else if (mediaFiles.length === 1 && post.mediaType === 'video') {
                const filePath = path.join(__dirname, 'uploads', mediaFiles[0]);
                if (fs.existsSync(filePath)) {
                    const form = new FormData();
                    form.append('source', fs.createReadStream(filePath));
                    form.append('description', post.message || '');
                    form.append('access_token', pageToken);

                    response = await axios.post(`${FB_GRAPH_URL}/${post.pageId}/videos`, form, {
                        headers: form.getHeaders()
                    });
                } else {
                    console.error(`[Schedule] Video file not found: ${filePath}`);
                    throw new Error('Video file not found: ' + mediaFiles[0]);
                }
            }
            // Text-only or with link
            else {
                let postData = { message: post.message, access_token: pageToken };
                if (post.link) postData.link = post.link;
                if (callToAction) postData.call_to_action = callToAction;
                response = await axios.post(`${FB_GRAPH_URL}/${post.pageId}/feed`, postData);
            }

            if (response) {
                post.status = 'published';
                post.publishedAt = new Date().toISOString();
                post.fbPostId = response.data.id || response.data.post_id;
                saveData();
                console.log(`[Schedule] ✅ Post ${post.id} published successfully!`);
            } else {
                throw new Error('No response from Facebook API');
            }

        } catch (err) {
            console.error('[Schedule] Post failed:', err.response?.data || err.message);
            post.status = 'failed';
            post.error = err.response?.data?.error?.message || err.message;
            saveData();
        }
    });
}

// Reschedule existing posts on server start
function rescheduleExistingPosts() {
    const pendingPosts = appData.scheduledPosts.filter(p => p.status === 'scheduled');
    pendingPosts.forEach(post => {
        const scheduledDate = new Date(post.scheduledTime);
        if (scheduledDate > new Date()) {
            schedulePost(post);
            console.log(`Rescheduled post: ${post.id} for ${post.scheduledTime}`);
        } else {
            post.status = 'missed';
            saveData();
        }
    });
}

// ============= PAGE INSIGHTS =============

app.get('/api/insights/:userId/:pageId', async (req, res) => {
    const { userId, pageId } = req.params;
    const user = appData.users[userId];

    if (!user || !user.pages?.[pageId]) {
        return res.status(404).json({ error: 'Page not found' });
    }

    const pageToken = user.pages[pageId].accessToken;

    try {
        const response = await axios.get(`${FB_GRAPH_URL}/${pageId}/insights`, {
            params: {
                access_token: pageToken,
                metric: 'page_impressions,page_engaged_users,page_fans',
                period: 'day'
            }
        });

        res.json({ insights: response.data.data });

    } catch (err) {
        console.error('Error fetching insights:', err.response?.data || err.message);
        res.status(500).json({ error: 'Failed to fetch insights' });
    }
});

// ============= ADVANCED ANALYTICS =============

// Get engagement stats using Page Insights (daily page engagement)
app.get('/api/analytics/:userId/:pageId/engagement', async (req, res) => {
    const { userId, pageId } = req.params;
    const { period = 'week' } = req.query;
    const user = appData.users[userId];

    if (!user || !user.pages?.[pageId]) {
        return res.status(404).json({ error: 'Page not found' });
    }

    const pageToken = user.pages[pageId].accessToken;

    try {
        // Always get last 10 posts regardless of date - count ALL reactions on them
        const postsResponse = await axios.get(`${FB_GRAPH_URL}/${pageId}/posts`, {
            params: {
                access_token: pageToken,
                fields: 'id,created_time,reactions.summary(true),comments.summary(true),shares',
                limit: 10  // Always get last 10 posts
            }
        });

        const posts = postsResponse.data.data || [];
        let totalReactions = 0, totalComments = 0, totalShares = 0;
        const dailyStats = {};

        // Count ALL reactions from last 10 posts (regardless of when they were created)
        posts.forEach(post => {
            const date = post.created_time.split('T')[0];
            if (!dailyStats[date]) dailyStats[date] = { reactions: 0, comments: 0, shares: 0 };

            const reactions = post.reactions?.summary?.total_count || 0;
            const comments = post.comments?.summary?.total_count || 0;
            const shares = post.shares?.count || 0;

            // Add to totals - no date filtering
            totalReactions += reactions;
            totalComments += comments;
            totalShares += shares;

            dailyStats[date].reactions += reactions;
            dailyStats[date].comments += comments;
            dailyStats[date].shares += shares;
        });

        console.log(`[Engagement] Page ${pageId}: ${totalReactions} reactions, ${totalComments} comments, ${totalShares} shares from ${posts.length} posts`);

        res.json({
            period,
            totals: {
                reactions: totalReactions,
                comments: totalComments,
                shares: totalShares
            },
            trends: {
                reactions: 'stable',
                reactionsChange: '0',
                comments: 'stable',
                commentsChange: '0'
            },
            daily: Object.entries(dailyStats).map(([date, stats]) => ({ date, ...stats }))
                .sort((a, b) => a.date.localeCompare(b.date)),
            postsCount: posts.length,
            source: 'last_10_posts'
        });


    } catch (err) {
        console.error('Error fetching engagement stats:', err.response?.data || err.message);
        res.status(500).json({
            error: 'Failed to fetch engagement stats',
            totals: { reactions: 0, comments: 0, shares: 0 },
            daily: []
        });
    }
});

// Get message stats (requires pages_messaging permission)
app.get('/api/analytics/:userId/:pageId/messages', async (req, res) => {
    const { userId, pageId } = req.params;
    const user = appData.users[userId];

    if (!user || !user.pages?.[pageId]) {
        return res.status(404).json({ error: 'Page not found' });
    }

    const pageToken = user.pages[pageId].accessToken;

    try {
        const response = await axios.get(`${FB_GRAPH_URL}/${pageId}/conversations`, {
            params: {
                access_token: pageToken,
                fields: 'updated_time,unread_count',
                limit: 100
            }
        });

        const conversations = response.data.data || [];
        const totalConversations = conversations.length;
        const unreadCount = conversations.reduce((sum, c) => sum + (c.unread_count || 0), 0);

        res.json({
            totalConversations,
            unreadCount,
            respondedCount: totalConversations - unreadCount
        });

    } catch (err) {
        console.error('Error fetching messages:', err.response?.data || err.message);
        // Return mock data if permission not available
        res.json({
            totalConversations: 0,
            unreadCount: 0,
            respondedCount: 0,
            note: 'يحتاج صلاحية pages_messaging'
        });
    }
});

// ============= LIVE ENGAGEMENT POLLING =============
// Get live/recent engagements (reactions, comments, shares) from recent posts
app.get('/api/engagement/:userId/:pageId/live', async (req, res) => {
    const { userId, pageId } = req.params;
    const user = appData.users[userId];

    if (!user || !user.pages?.[pageId]) {
        return res.status(404).json({ error: 'Page not found' });
    }

    const pageToken = user.pages[pageId].accessToken;
    const pageName = user.pages[pageId].name;

    try {
        // Get recent posts with their reactions and comments (increased limits)
        const postsResponse = await axios.get(`${FB_GRAPH_URL}/${pageId}/posts`, {
            params: {
                access_token: pageToken,
                fields: 'id,message,created_time,reactions.limit(100).summary(true){id,name,type},comments.limit(100).summary(true).filter(stream){id,from,message,created_time},shares',
                limit: 10
            }
        });

        const posts = postsResponse.data.data || [];
        const engagements = [];

        // Track totals from summary (more accurate than counting data array)
        let totalReactions = 0;
        let totalComments = 0;
        let totalShares = 0;

        posts.forEach(post => {
            const postPreview = post.message ? post.message.substring(0, 50) + (post.message.length > 50 ? '...' : '') : 'منشور';

            // Add to totals from summary (accurate count)
            totalReactions += post.reactions?.summary?.total_count || 0;
            totalComments += post.comments?.summary?.total_count || 0;
            totalShares += post.shares?.count || 0;

            // Add reactions (limited to what API returns)
            if (post.reactions?.data) {
                post.reactions.data.forEach(reaction => {
                    engagements.push({
                        id: `${post.id}_reaction_${reaction.id}`,
                        type: 'reaction',
                        reactionType: reaction.type?.toLowerCase() || 'like',
                        userName: reaction.name || 'مستخدم',
                        userId: reaction.id,
                        postId: post.id,
                        postPreview,
                        timestamp: post.created_time,
                        icon: getReactionIcon(reaction.type)
                    });
                });
            }

            // Add comments
            if (post.comments?.data) {
                post.comments.data.forEach(comment => {
                    engagements.push({
                        id: `${post.id}_comment_${comment.id}`,
                        type: 'comment',
                        userName: comment.from?.name || 'زائر',
                        userId: comment.from?.id,
                        message: comment.message,
                        postId: post.id,
                        postPreview,
                        timestamp: comment.created_time,
                        icon: '💬'
                    });
                });
            }

            // Add shares count (Facebook doesn't give individual share data)
            if (post.shares?.count > 0) {
                engagements.push({
                    id: `${post.id}_shares`,
                    type: 'share',
                    count: post.shares.count,
                    postId: post.id,
                    postPreview,
                    timestamp: post.created_time,
                    icon: '🔄'
                });
            }
        });

        // Sort by timestamp (most recent first)
        engagements.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));

        // Merge with webhook events for this page (these have real user names!)
        const pageWebhookEvents = webhookEvents
            .filter(e => e.pageId === pageId && (e.type === 'reaction' || e.type === 'comment' || e.type === 'share'))
            .map(e => ({
                id: `webhook_${e.id}`,
                type: e.type,
                reactionType: e.content?.toLowerCase() || 'like',
                userName: e.senderName || 'زائر',
                userId: e.senderId,
                message: e.type === 'comment' ? e.content : undefined,
                postId: e.postId,
                postPreview: 'من الإشعارات',
                timestamp: e.timestamp,
                icon: e.type === 'reaction' ? '❤️' : e.type === 'comment' ? '💬' : '🔄',
                fromWebhook: true
            }));

        // Combine: webhook events first (newest), then API data
        const allEngagements = [...pageWebhookEvents, ...engagements];

        // Remove duplicates by ID
        const uniqueEngagements = allEngagements.filter((item, index, self) =>
            index === self.findIndex(e => e.id === item.id)
        );

        // Sort all by timestamp
        uniqueEngagements.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));

        // Use summary totals (accurate) not array count (limited)
        const stats = {
            totalReactions,
            totalComments,
            totalShares
        };

        res.json({
            pageName,
            pageId,
            engagements: uniqueEngagements.slice(0, 50), // Return max 50 engagements
            stats,
            webhookEventsCount: pageWebhookEvents.length,
            lastUpdated: new Date().toISOString()
        });

    } catch (err) {
        console.error('Error fetching live engagements:', err.response?.data || err.message);
        res.status(500).json({
            error: 'Failed to fetch live engagements',
            details: err.response?.data?.error?.message || err.message
        });
    }
});

// Helper function to get reaction icon
function getReactionIcon(type) {
    const icons = {
        'LIKE': '👍',
        'LOVE': '❤️',
        'HAHA': '😂',
        'WOW': '😮',
        'SAD': '😢',
        'ANGRY': '😡',
        'CARE': '🤗'
    };
    return icons[type?.toUpperCase()] || '👍';
}

// Get active ads
app.get('/api/analytics/:userId/:pageId/ads', async (req, res) => {
    const { userId, pageId } = req.params;
    const user = appData.users[userId];

    if (!user || !user.pages?.[pageId]) {
        return res.status(404).json({ error: 'Page not found' });
    }

    // Note: Ads API requires special permissions and ad account access
    // This is a simplified response - full implementation needs ads_read permission
    try {
        // Return placeholder - real implementation would query ads API
        res.json({
            activeAds: [],
            totalSpend: 0,
            note: 'يحتاج صلاحية ads_read وربط حساب إعلانات'
        });

    } catch (err) {
        console.error('Error fetching ads:', err.response?.data || err.message);
        res.status(500).json({ error: 'Failed to fetch ads' });
    }
});

// Get page health score
app.get('/api/analytics/:userId/:pageId/health', async (req, res) => {
    const { userId, pageId } = req.params;
    const user = appData.users[userId];

    if (!user || !user.pages?.[pageId]) {
        return res.status(404).json({ error: 'Page not found' });
    }

    const pageToken = user.pages[pageId].accessToken;

    try {
        // Get page info and recent activity
        const [pageInfo, postsResponse] = await Promise.all([
            axios.get(`${FB_GRAPH_URL}/${pageId}`, {
                params: {
                    access_token: pageToken,
                    fields: 'fan_count,followers_count,rating_count,overall_star_rating'
                }
            }),
            axios.get(`${FB_GRAPH_URL}/${pageId}/posts`, {
                params: {
                    access_token: pageToken,
                    fields: 'created_time,reactions.summary(true),comments.summary(true)',
                    limit: 10
                }
            })
        ]);

        const page = pageInfo.data;
        const posts = postsResponse.data.data || [];

        // Calculate health score based on various factors
        let score = 50; // Base score

        // Posting frequency (last 7 days)
        const weekAgo = new Date();
        weekAgo.setDate(weekAgo.getDate() - 7);
        const recentPosts = posts.filter(p => new Date(p.created_time) >= weekAgo);
        if (recentPosts.length >= 7) score += 20;
        else if (recentPosts.length >= 3) score += 10;
        else if (recentPosts.length === 0) score -= 10;

        // Engagement rate
        const avgEngagement = posts.reduce((sum, p) => {
            return sum + (p.reactions?.summary?.total_count || 0) + (p.comments?.summary?.total_count || 0);
        }, 0) / (posts.length || 1);

        if (avgEngagement > 100) score += 20;
        else if (avgEngagement > 50) score += 10;
        else if (avgEngagement > 10) score += 5;

        // Fan count bonus
        if (page.fan_count > 10000) score += 10;
        else if (page.fan_count > 1000) score += 5;

        score = Math.min(100, Math.max(0, score));

        const tips = [];
        if (recentPosts.length < 3) tips.push('انشر محتوى بشكل منتظم (3-7 منشورات أسبوعياً)');
        if (avgEngagement < 50) tips.push('جرب أنواع محتوى مختلفة لزيادة التفاعل');

        res.json({
            score,
            fanCount: page.fan_count || 0,
            followersCount: page.followers_count || 0,
            rating: page.overall_star_rating || null,
            postsThisWeek: recentPosts.length,
            avgEngagement: Math.round(avgEngagement),
            tips
        });

    } catch (err) {
        console.error('Error calculating health:', err.response?.data || err.message);
        res.status(500).json({ error: 'Failed to calculate health score' });
    }
});

// Get best posting times
app.get('/api/analytics/:userId/:pageId/best-times', async (req, res) => {
    const { userId, pageId } = req.params;
    const user = appData.users[userId];

    if (!user || !user.pages?.[pageId]) {
        return res.status(404).json({ error: 'Page not found' });
    }

    const pageToken = user.pages[pageId].accessToken;

    try {
        const postsResponse = await axios.get(`${FB_GRAPH_URL}/${pageId}/posts`, {
            params: {
                access_token: pageToken,
                fields: 'created_time,reactions.summary(true),comments.summary(true)',
                limit: 50
            }
        });

        const posts = postsResponse.data.data || [];

        // Analyze engagement by day and hour
        const dayStats = {};
        const days = ['الأحد', 'الإثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت'];

        posts.forEach(post => {
            const date = new Date(post.created_time);
            const day = days[date.getDay()];
            const hour = date.getHours();
            const engagement = (post.reactions?.summary?.total_count || 0) + (post.comments?.summary?.total_count || 0);

            if (!dayStats[day]) dayStats[day] = {};
            if (!dayStats[day][hour]) dayStats[day][hour] = { total: 0, count: 0 };

            dayStats[day][hour].total += engagement;
            dayStats[day][hour].count += 1;
        });

        // Find best times for each day
        const bestTimes = days.map(day => {
            const hours = dayStats[day] || {};
            const sortedHours = Object.entries(hours)
                .map(([hour, data]) => ({
                    hour: parseInt(hour),
                    avgEngagement: data.total / data.count
                }))
                .sort((a, b) => b.avgEngagement - a.avgEngagement)
                .slice(0, 3);

            return {
                day,
                bestHours: sortedHours.length > 0
                    ? sortedHours.map(h => `${h.hour}:00`)
                    : ['10:00', '18:00', '21:00'] // Default suggestions
            };
        });

        res.json({ bestTimes });

    } catch (err) {
        console.error('Error analyzing best times:', err.response?.data || err.message);
        res.status(500).json({ error: 'Failed to analyze best posting times' });
    }
});

// ============= COMPETITOR ANALYSIS =============

const competitorAnalyzer = require('./services/competitorAnalyzer');
const groqService = require('./services/groqService');

// Initialize Groq AI service
groqService.init();

// ============= AI SPINTAX GENERATOR =============

// Generate spintax from plain message using AI
app.post('/api/spintax/generate', async (req, res) => {
    const { message } = req.body;

    if (!message) {
        return res.status(400).json({ error: 'يرجى إدخال رسالة' });
    }

    try {
        if (!groqService.isAvailable()) {
            // Fallback: manual spintax conversion
            const spintax = manualSpintaxConvert(message);
            return res.json({ spintax, ai: false });
        }

        const spintax = await groqService.generateSpintax(message);
        res.json({ spintax, ai: true });
    } catch (err) {
        console.error('[Spintax AI] Error:', err.message);
        // Fallback to manual conversion
        const spintax = manualSpintaxConvert(message);
        res.json({ spintax, ai: false });
    }
});

// Manual spintax conversion (fallback)
function manualSpintaxConvert(message) {
    const replacements = [
        // Greetings
        { find: /مرحباً?\s*/gi, replace: '{مرحباً|أهلاً|السلام عليكم} ' },
        { find: /أهلاً?\s*/gi, replace: '{مرحباً|أهلاً|السلام عليكم} ' },
        { find: /السلام عليكم\s*/gi, replace: '{مرحباً|أهلاً|السلام عليكم} ' },
        // We have
        { find: /لدينا\s*/gi, replace: '{لدينا|عندنا|نقدم لك} ' },
        { find: /عندنا\s*/gi, replace: '{لدينا|عندنا|نقدم لك} ' },
        // Offer
        { find: /عرض\s+رائع/gi, replace: '{عرض|خصم|تخفيض} {رائع|مميز|حصري}' },
        { find: /خصم\s+مميز/gi, replace: '{عرض|خصم|تخفيض} {رائع|مميز|حصري}' },
        // Contact
        { find: /تواصل معنا/gi, replace: '{تواصل معنا|راسلنا|اتصل بنا}' },
        { find: /راسلنا/gi, replace: '{تواصل معنا|راسلنا|اتصل بنا}' },
        // Now/Today
        { find: /الآن/gi, replace: '{الآن|اليوم|حالاً}' },
        { find: /اليوم/gi, replace: '{الآن|اليوم|حالاً}' },
    ];

    let result = message;
    for (const rep of replacements) {
        result = result.replace(rep.find, rep.replace);
    }
    return result;
}

// Analyze a competitor's Facebook page with comprehensive insights
app.post('/api/competitors/analyze', async (req, res) => {
    const { url } = req.body;

    if (!url) {
        return res.status(400).json({ error: 'يرجى إدخال رابط الصفحة' });
    }

    console.log(`[Competitor Analysis] Starting analysis for: ${url}`);

    try {
        // Step 1: Scrape the page
        const scrapedData = await competitorScraper.scrapeFacebookPage(url);

        if (scrapedData.error) {
            console.log(`[Competitor Analysis] Scraping error: ${scrapedData.error}`);
            return res.status(400).json({ error: scrapedData.error });
        }

        // Step 2: Generate basic analysis
        let analysis = competitorAnalyzer.analyzeCompetitor(scrapedData);

        // Step 3: Enhance with AI if available
        if (groqService.isAvailable()) {
            console.log('[Competitor Analysis] Enhancing with Groq AI...');
            const aiAnalysis = await groqService.analyzeCompetitor(scrapedData);

            if (aiAnalysis) {
                // Use AI-generated SWOT
                if (aiAnalysis.swot) {
                    if (aiAnalysis.swot.strengths?.length > 0) {
                        analysis.strengths = aiAnalysis.swot.strengths;
                    }
                    if (aiAnalysis.swot.weaknesses?.length > 0) {
                        analysis.weaknesses = aiAnalysis.swot.weaknesses;
                    }
                    if (aiAnalysis.swot.opportunities?.length > 0) {
                        analysis.opportunities = aiAnalysis.swot.opportunities;
                    }
                    if (aiAnalysis.swot.threats?.length > 0) {
                        analysis.threats = aiAnalysis.swot.threats;
                    }
                    analysis.swotRaw = aiAnalysis.swot.raw;
                }

                // Add AI top posts analysis
                if (aiAnalysis.topPosts) {
                    analysis.topPostsAI = aiAnalysis.topPosts;
                }

                // Add AI engagement analysis
                if (aiAnalysis.engagement) {
                    analysis.engagementAI = aiAnalysis.engagement;
                }

                analysis.aiPowered = true;
                console.log('[Competitor Analysis] AI enhancement complete');
            }
        } else {
            console.log('[Competitor Analysis] Groq AI not available, using basic analysis');
        }

        // Step 4: Combine scraped data with analysis
        const result = {
            ...scrapedData,
            analysis: analysis
        };

        console.log(`[Competitor Analysis] Successfully analyzed: ${scrapedData.name || 'Page'}`);
        res.json(result);

    } catch (err) {
        console.error('[Competitor Analysis] Error:', err.message);
        res.status(500).json({ error: 'خطأ في تحليل الصفحة: ' + err.message });
    }
});

// Get analysis for existing competitor data (without re-scraping)
app.post('/api/competitors/insights', async (req, res) => {
    const { competitorData } = req.body;

    if (!competitorData) {
        return res.status(400).json({ error: 'يرجى إرسال بيانات المنافس' });
    }

    try {
        const analysis = competitorAnalyzer.analyzeCompetitor(competitorData);
        res.json({ analysis });
    } catch (err) {
        console.error('[Competitor Insights] Error:', err.message);
        res.status(500).json({ error: 'خطأ في تحليل البيانات' });
    }
});

// Generate SWOT analysis for multiple competitors
app.post('/api/competitors/swot', async (req, res) => {
    const { competitors } = req.body;

    if (!competitors || !Array.isArray(competitors) || competitors.length === 0) {
        return res.status(400).json({ error: 'يرجى إرسال قائمة المنافسين' });
    }

    try {
        const swot = competitorScraper.generateSWOT(competitors);
        res.json({ swot });
    } catch (err) {
        console.error('[SWOT Analysis] Error:', err.message);
        res.status(500).json({ error: 'خطأ في إنشاء تحليل SWOT' });
    }
});

// ============= INBOX MANAGEMENT =============

// Helper: Find page token across all connected users
function findPageToken(userId, pageId) {
    // First try the specified user
    const user = appData.users[userId];
    if (user?.pages?.[pageId]?.accessToken) {
        return user.pages[pageId].accessToken;
    }
    // Search across all connected users
    for (const uid of Object.keys(appData.users)) {
        if (appData.users[uid]?.pages?.[pageId]?.accessToken) {
            return appData.users[uid].pages[pageId].accessToken;
        }
    }
    return null;
}

// Helper: Find page token by pageId only (searches all users)
function findPageTokenByPageId(pageId) {
    for (const uid of Object.keys(appData.users)) {
        if (appData.users[uid]?.pages?.[pageId]?.accessToken) {
            return appData.users[uid].pages[pageId].accessToken;
        }
    }
    return null;
}
// Get page conversations with pagination
app.get('/api/inbox/:userId/:pageId/conversations', async (req, res) => {
    const { userId, pageId } = req.params;
    const { limit = 100, after } = req.query; // Pagination params
    const user = appData.users[userId];

    // Try to find page token - first under the specified user, then across all users
    let pageToken = findPageToken(userId, pageId);

    if (!pageToken) {
        return res.status(404).json({ error: 'Page not found' });
    }

    try {
        // Build URL with pagination - include last message to check who sent it
        let url = `${FB_GRAPH_URL}/${pageId}/conversations`;
        const params = {
            access_token: pageToken,
            fields: 'id,updated_time,participants,snippet,messages.limit(1){from,message,created_time}',
            limit: parseInt(limit)
        };

        if (after) {
            params.after = after;
        }

        const response = await axios.get(url, { params });

        const conversations = response.data.data || [];
        const paging = response.data.paging;

        // Find the correct participant and check if last message was from page
        const mappedConversations = conversations.map(c => {
            const participant = c.participants?.data?.find(p => p.id !== pageId) || c.participants?.data?.[0];

            // Get last message to check who sent it
            const lastMessage = c.messages?.data?.[0];
            const lastMessageFromId = lastMessage?.from?.id;

            // needsReply = true if last message was from customer (not the page)
            const needsReply = lastMessageFromId && lastMessageFromId !== pageId;

            return {
                id: c.id,
                updatedTime: c.updated_time,
                participant: participant?.name || 'Unknown',
                participantId: participant?.id,
                needsReply: needsReply,
                snippet: c.snippet || ''
            };
        });

        res.json({
            conversations: mappedConversations,
            total: mappedConversations.length,
            hasMore: !!paging?.next,
            nextCursor: paging?.cursors?.after || null
        });

    } catch (err) {
        console.error('Error fetching conversations:', err.response?.data || err.message);
        res.status(500).json({ error: 'Failed to fetch conversations', details: err.response?.data?.error?.message });
    }
});

// Get messages in a conversation
app.get('/api/inbox/:userId/:pageId/messages/:conversationId', async (req, res) => {
    const { userId, pageId, conversationId } = req.params;
    const pageToken = findPageToken(userId, pageId);
    if (!pageToken) {
        return res.status(404).json({ error: 'Page not found' });
    }

    try {
        const response = await axios.get(`${FB_GRAPH_URL}/${conversationId}/messages`, {
            params: {
                access_token: pageToken,
                fields: 'id,message,from,created_time,attachments.limit(10){mime_type,name,size,image_data{url,preview_url,max_width,max_height},video_data{url,preview_url},file_url,type,title,url,payload}',
                limit: 50
            }
        });

        console.log(`[Inbox] Loaded ${response.data.data?.length || 0} messages for conversation ${conversationId}`);
        res.json({ messages: response.data.data || [] });

    } catch (err) {
        console.error('Error fetching messages:', err.response?.data || err.message);
        // Try fallback without attachments
        try {
            const fallbackResponse = await axios.get(`${FB_GRAPH_URL}/${conversationId}/messages`, {
                params: {
                    access_token: pageToken,
                    fields: 'id,message,from,created_time',
                    limit: 50
                }
            });
            console.log(`[Inbox] Fallback loaded ${fallbackResponse.data.data?.length || 0} messages`);
            res.json({ messages: fallbackResponse.data.data || [] });
        } catch (fallbackErr) {
            console.error('Fallback also failed:', fallbackErr.response?.data || fallbackErr.message);
            res.status(500).json({ error: 'Failed to fetch messages' });
        }
    }
});

// Send message reply
app.post('/api/inbox/:userId/:pageId/reply', async (req, res) => {
    const { userId, pageId } = req.params;
    const { recipientId, message } = req.body;

    const pageToken = findPageToken(userId, pageId);
    if (!pageToken) {
        return res.status(404).json({ error: 'Page not found' });
    }

    // Try different message tags - some don't require approval
    const tagsToTry = [
        'POST_PURCHASE_UPDATE',     // For order/shipping updates
        'ACCOUNT_UPDATE',           // For account notifications
        'CONFIRMED_EVENT_UPDATE'    // For event updates
    ];

    for (const tag of tagsToTry) {
        try {
            console.log(`[Reply] Trying MESSAGE_TAG with ${tag}...`);
            await axios.post(`${FB_GRAPH_URL}/me/messages`, {
                recipient: { id: recipientId },
                message: { text: message },
                messaging_type: 'MESSAGE_TAG',
                tag: tag
            }, {
                params: { access_token: pageToken }
            });

            console.log(`[Reply] Success with tag: ${tag}`);
            return res.json({ success: true, tag });

        } catch (err) {
            const fbError = err.response?.data?.error;
            console.log(`[Reply] ${tag} failed:`, fbError?.message?.substring(0, 80) || err.message);
            // Continue to next tag
        }
    }

    // All tags failed, try RESPONSE (24h window)
    try {
        console.log('[Reply] All tags failed, trying RESPONSE...');
        await axios.post(`${FB_GRAPH_URL}/me/messages`, {
            recipient: { id: recipientId },
            messaging_type: 'RESPONSE',
            message: { text: message }
        }, {
            params: { access_token: pageToken }
        });

        console.log('[Reply] Success with RESPONSE');
        return res.json({ success: true, type: 'RESPONSE' });

    } catch (fallbackErr) {
        const fallbackError = fallbackErr.response?.data?.error;
        console.error('[Reply] All methods failed:', fallbackError?.message || fallbackErr.message);
        res.status(500).json({
            error: 'Failed to send message',
            details: fallbackError?.message || 'انتهت نافذة 24 ساعة - جرب Browser Automation'
        });
    }
});

// ============= ADS MANAGEMENT =============

// Get ad accounts for user
app.get('/api/ad-accounts/:userId', async (req, res) => {
    const { userId } = req.params;
    const user = appData.users[userId];

    if (!user) {
        return res.status(404).json({ error: 'User not found' });
    }

    try {
        // Get ad accounts using user token
        const accountsResponse = await axios.get(`${FB_GRAPH_URL}/me/adaccounts`, {
            params: {
                access_token: user.accessToken,
                fields: 'id,name,account_status,currency,amount_spent'
            }
        });

        const accounts = accountsResponse.data.data || [];

        res.json({
            accounts: accounts.map(acc => ({
                id: acc.id,
                name: acc.name || 'حساب إعلانات',
                status: acc.account_status,
                currency: acc.currency,
                amountSpent: acc.amount_spent
            }))
        });

    } catch (err) {
        console.error('Error fetching ad accounts:', err.response?.data || err.message);
        res.json({
            accounts: [],
            error: err.response?.data?.error?.message || 'لا يمكن الوصول لحسابات الإعلانات'
        });
    }
});

// Get active ads from ad account (requires ads_read permission)
app.get('/api/ads/:userId/:adAccountId', async (req, res) => {
    const { userId, adAccountId } = req.params;
    const user = appData.users[userId];

    if (!user) {
        return res.status(404).json({ error: 'User not found' });
    }

    try {
        // Get ads from ad account
        const adsResponse = await axios.get(`${FB_GRAPH_URL}/${adAccountId}/ads`, {
            params: {
                access_token: user.accessToken,
                fields: 'id,name,status,effective_status,created_time,insights{impressions,clicks,spend,reach,cpc,cpm}',
                limit: 50
            }
        });

        const ads = adsResponse.data.data || [];

        res.json({
            ads: ads.map(ad => ({
                id: ad.id,
                name: ad.name || '',
                status: ad.effective_status || ad.status,
                createdTime: ad.created_time,
                impressions: ad.insights?.data?.[0]?.impressions || 0,
                clicks: ad.insights?.data?.[0]?.clicks || 0,
                spend: ad.insights?.data?.[0]?.spend || '0',
                reach: ad.insights?.data?.[0]?.reach || 0,
                cpc: ad.insights?.data?.[0]?.cpc || '0',
                cpm: ad.insights?.data?.[0]?.cpm || '0'
            }))
        });

    } catch (err) {
        console.error('Error fetching ads:', err.response?.data || err.message);
        res.json({
            ads: [],
            error: err.response?.data?.error?.message || 'يحتاج صلاحية ads_read'
        });
    }
});

// Get ad campaigns from ad account
app.get('/api/ad-campaigns/:userId/:adAccountId', async (req, res) => {
    const { userId, adAccountId } = req.params;
    const user = appData.users[userId];

    if (!user) {
        return res.status(404).json({ error: 'User not found' });
    }

    try {
        const campaignsResponse = await axios.get(`${FB_GRAPH_URL}/${adAccountId}/campaigns`, {
            params: {
                access_token: user.accessToken,
                fields: 'id,name,status,effective_status,objective,daily_budget,lifetime_budget,insights{impressions,clicks,spend,reach}',
                limit: 50
            }
        });

        const campaigns = campaignsResponse.data.data || [];

        res.json({
            campaigns: campaigns.map(c => ({
                id: c.id,
                name: c.name || '',
                status: c.effective_status || c.status,
                objective: c.objective,
                dailyBudget: c.daily_budget,
                lifetimeBudget: c.lifetime_budget,
                impressions: c.insights?.data?.[0]?.impressions || 0,
                clicks: c.insights?.data?.[0]?.clicks || 0,
                spend: c.insights?.data?.[0]?.spend || '0',
                reach: c.insights?.data?.[0]?.reach || 0
            }))
        });

    } catch (err) {
        console.error('Error fetching campaigns:', err.response?.data || err.message);
        res.json({
            campaigns: [],
            error: err.response?.data?.error?.message || 'يحتاج صلاحية ads_read'
        });
    }
});

// ============= INSTAGRAM MANAGEMENT =============

// Get Instagram account linked to Facebook page
app.get('/api/instagram/:userId/:pageId/account', async (req, res) => {
    const { userId, pageId } = req.params;
    const user = appData.users[userId];

    if (!user || !user.pages?.[pageId]) {
        return res.status(404).json({ error: 'Page not found' });
    }

    const pageToken = user.pages[pageId].accessToken;

    try {
        const igAccountId = await instagramService.getInstagramAccount(pageId, pageToken);

        if (!igAccountId) {
            return res.json({
                connected: false,
                message: 'لا يوجد حساب Instagram Business مربوط بهذه الصفحة'
            });
        }

        const igInfo = await instagramService.getInstagramInfo(igAccountId, pageToken);

        res.json({
            connected: true,
            account: {
                id: igAccountId,
                username: igInfo?.username,
                name: igInfo?.name,
                profilePicture: igInfo?.profile_picture_url,
                followers: igInfo?.followers_count
            }
        });
    } catch (err) {
        console.error('Error getting Instagram account:', err);
        res.status(500).json({ error: 'Failed to get Instagram account' });
    }
});

// Get Instagram conversations (DMs)
app.get('/api/instagram/:userId/:pageId/conversations', async (req, res) => {
    const { userId, pageId } = req.params;
    const { limit = 100, after } = req.query;
    const user = appData.users[userId];

    if (!user || !user.pages?.[pageId]) {
        return res.status(404).json({ error: 'Page not found' });
    }

    const pageToken = user.pages[pageId].accessToken;

    try {
        const igAccountId = await instagramService.getInstagramAccount(pageId, pageToken);

        if (!igAccountId) {
            return res.json({ conversations: [], message: 'No Instagram account linked' });
        }

        const result = await instagramService.getConversations(igAccountId, pageToken, parseInt(limit), after);

        const conversations = result.conversations.map(c => {
            const participant = c.participants?.data?.find(p => p.id !== igAccountId) || c.participants?.data?.[0];
            return {
                id: c.id,
                updatedTime: c.updated_time,
                participant: participant?.username || participant?.name || 'Unknown',
                participantId: participant?.id,
                platform: 'instagram'
            };
        });

        res.json({
            conversations,
            hasMore: !!result.paging?.next,
            nextCursor: result.paging?.cursors?.after || null
        });
    } catch (err) {
        console.error('Error fetching Instagram conversations:', err);
        res.status(500).json({ error: 'Failed to fetch Instagram conversations' });
    }
});

// Get Instagram messages
app.get('/api/instagram/:userId/:pageId/messages/:conversationId', async (req, res) => {
    const { userId, pageId, conversationId } = req.params;
    const user = appData.users[userId];

    if (!user || !user.pages?.[pageId]) {
        return res.status(404).json({ error: 'Page not found' });
    }

    const pageToken = user.pages[pageId].accessToken;

    try {
        const messages = await instagramService.getMessages(conversationId, pageToken);

        res.json({
            messages: messages.map(m => ({
                id: m.id,
                text: m.message,
                createdTime: m.created_time,
                from: m.from?.username || m.from?.name || 'Unknown',
                fromId: m.from?.id,
                attachments: m.attachments?.data || []
            }))
        });
    } catch (err) {
        console.error('Error fetching Instagram messages:', err);
        res.status(500).json({ error: 'Failed to fetch messages' });
    }
});

// Reply with media (Image/Video)
app.post('/api/inbox/:userId/:pageId/reply-with-media', upload.single('media'), async (req, res) => {
    const { userId, pageId } = req.params;
    const { recipientId, message, mediaType } = req.body;
    const user = appData.users[userId];

    if (!user || !user.pages?.[pageId]) {
        return res.status(404).json({ error: 'Page not found' });
    }

    const pageToken = user.pages[pageId].accessToken;

    try {
        if (!req.file) {
            return res.status(400).json({ error: 'No media file provided' });
        }

        console.log(`[Reply] Sending media reply to ${recipientId} (${mediaType})`);

        // Upload media to Facebook
        const FormData = require('form-data');
        const form = new FormData();

        form.append('message', JSON.stringify({
            attachment: {
                type: mediaType || 'image', // 'image' or 'video'
                payload: {
                    is_reusable: true
                }
            }
        }));
        form.append('filedata', fs.createReadStream(req.file.path));

        const uploadRes = await axios.post(`${FB_GRAPH_URL}/me/message_attachments`, form, {
            headers: form.getHeaders(),
            params: { access_token: pageToken }
        });

        const attachmentId = uploadRes.data.attachment_id;
        console.log(`[Reply] Media uploaded, attachment_id: ${attachmentId}`);

        // Clean up temp file
        try { fs.unlinkSync(req.file.path); } catch (e) { /* ignore */ }

        // Send message with attachment
        const messagePayload = {
            recipient: { id: recipientId },
            message: {
                attachment: {
                    type: mediaType || 'image',
                    payload: { attachment_id: attachmentId }
                }
            }
        };

        await axios.post(`${FB_GRAPH_URL}/me/messages`, messagePayload, {
            params: { access_token: pageToken }
        });

        // Send text caption if provided (as separate message, since API doesn't always support both reliably in one go for generic replies)
        if (message && message.trim()) {
            await axios.post(`${FB_GRAPH_URL}/me/messages`, {
                recipient: { id: recipientId },
                message: { text: message }
            }, {
                params: { access_token: pageToken }
            });
        }

        res.json({ success: true, attachmentId });

    } catch (err) {
        console.error('[Reply] Error sending media:', err.response?.data || err.message);
        // Try to clean up file if it exists
        if (req.file) {
            try { fs.unlinkSync(req.file.path); } catch (e) { /* ignore */ }
        }
        res.status(500).json({ error: 'Failed to send media' });
    }
});

// Reply with text (Standard)
app.post('/api/inbox/:userId/:pageId/reply', async (req, res) => {
    const { userId, pageId } = req.params;
    const { recipientId, message } = req.body;
    const user = appData.users[userId];

    if (!user || !user.pages?.[pageId]) {
        return res.status(404).json({ error: 'Page not found' });
    }

    const pageToken = user.pages[pageId].accessToken;

    try {
        await axios.post(`${FB_GRAPH_URL}/me/messages`, {
            recipient: { id: recipientId },
            message: { text: message }
        }, {
            params: { access_token: pageToken }
        });

        res.json({ success: true });
    } catch (err) {
        console.error('Error sending reply:', err.response?.data || err.message);
        res.status(500).json({ error: 'Failed to send reply' });
    }
});

// Send Instagram DM
app.post('/api/instagram/:userId/:pageId/send', async (req, res) => {
    const { userId, pageId } = req.params;
    const { recipientId, message } = req.body;
    const user = appData.users[userId];

    if (!user || !user.pages?.[pageId]) {
        return res.status(404).json({ error: 'Page not found' });
    }

    const pageToken = user.pages[pageId].accessToken;

    try {
        const igAccountId = await instagramService.getInstagramAccount(pageId, pageToken);

        if (!igAccountId) {
            return res.status(400).json({ error: 'No Instagram account linked' });
        }

        const result = await instagramService.sendMessage(igAccountId, recipientId, message, pageToken);

        res.json(result);
    } catch (err) {
        console.error('Error sending Instagram message:', err);
        res.status(500).json({ error: 'Failed to send message' });
    }
});


// ============= WHATSAPP REMOVED =============
// WhatsApp functionality has been removed from this application


// ============= PAGE STATS =============

// Get actual page post count and stats
app.get('/api/page-stats/:userId/:pageId', async (req, res) => {
    const { userId, pageId } = req.params;
    const user = appData.users[userId];

    if (!user || !user.pages?.[pageId]) {
        return res.status(404).json({ error: 'Page not found' });
    }

    const pageToken = user.pages[pageId].accessToken;

    try {
        // Get page info with post count
        const [pageInfo, postsResponse] = await Promise.all([
            axios.get(`${FB_GRAPH_URL}/${pageId}`, {
                params: {
                    access_token: pageToken,
                    fields: 'fan_count,followers_count,posts.limit(0).summary(true)'
                }
            }),
            axios.get(`${FB_GRAPH_URL}/${pageId}/posts`, {
                params: {
                    access_token: pageToken,
                    fields: 'id',
                    limit: 100
                }
            })
        ]);

        // Count actual posts (API limits at 100, but gives indication)
        const estimatedPostCount = postsResponse.data.data?.length || 0;

        res.json({
            fanCount: pageInfo.data.fan_count || 0,
            followersCount: pageInfo.data.followers_count || 0,
            postCount: estimatedPostCount,
            hasMore: postsResponse.data.paging?.next ? true : false
        });

    } catch (err) {
        console.error('Error fetching page stats:', err.response?.data || err.message);
        res.status(500).json({ error: 'Failed to fetch page stats' });
    }
});

// ============= COMPETITOR ANALYSIS =============

// Analyze a public page (competitor)
app.get('/api/competitor/:pageUsername', async (req, res) => {
    const { pageUsername } = req.params;

    // For public pages, we need an app access token
    const appToken = `${FB_APP_ID}|${FB_APP_SECRET}`;

    try {
        const response = await axios.get(`${FB_GRAPH_URL}/${pageUsername}`, {
            params: {
                access_token: appToken,
                fields: 'id,name,about,fan_count,followers_count,category,picture.width(200)'
            }
        });

        res.json({
            id: response.data.id,
            name: response.data.name,
            about: response.data.about || '',
            fanCount: response.data.fan_count || 0,
            followersCount: response.data.followers_count || 0,
            category: response.data.category || '',
            picture: response.data.picture?.data?.url || ''
        });

    } catch (err) {
        console.error('Error fetching competitor:', err.response?.data || err.message);
        res.status(404).json({ error: 'Page not found or not public' });
    }
});

// ============= BROADCAST MESSAGING =============

// Cache for broadcast recipients (5 min expiry)
const broadcastCache = new Map();
const CACHE_EXPIRY = 5 * 60 * 1000; // 5 minutes

// Get recipients with pagination and eligibility classification
// Supports fetchAll=true to automatically fetch ALL customers via pagination loop
app.get('/api/broadcast/:userId/:pageId/recipients', async (req, res) => {
    const { userId, pageId } = req.params;
    const { limit = 500, after, fetchAll = 'false' } = req.query; // Increased limit to 500
    const user = appData.users[userId];

    if (!user || !user.pages?.[pageId]) {
        return res.status(404).json({ error: 'Page not found' });
    }

    const pageToken = user.pages[pageId].accessToken;
    const shouldFetchAll = fetchAll === 'true';
    const cacheKey = `${pageId}_recipients`;

    // Check cache first (only for fetchAll requests)
    if (shouldFetchAll && broadcastCache.has(cacheKey)) {
        const cached = broadcastCache.get(cacheKey);
        if (Date.now() - cached.timestamp < CACHE_EXPIRY) {
            console.log(`[Broadcast] Returning ${cached.data.recipients.length} cached recipients for page ${pageId}`);
            return res.json(cached.data);
        } else {
            broadcastCache.delete(cacheKey);
        }
    }

    try {
        let allConversations = [];
        let nextUrl = `${FB_GRAPH_URL}/${pageId}/conversations?access_token=${pageToken}&fields=participants,updated_time,id&limit=500`;

        if (!shouldFetchAll && after) {
            nextUrl += `&after=${after}`;
        }

        // Fetch conversations - either one page or ALL pages
        if (shouldFetchAll) {
            // Auto-pagination: fetch ALL conversations with optimized settings
            console.log(`[Broadcast] Fetching ALL recipients for page ${pageId}...`);
            let pageCount = 0;
            const maxPages = 20; // 20 pages * 500 = 10,000 max customers
            const startTime = Date.now();

            while (nextUrl && pageCount < maxPages) {
                const response = await axios.get(nextUrl);
                const conversations = response.data.data || [];
                allConversations = allConversations.concat(conversations);
                nextUrl = response.data.paging?.next || null;
                pageCount++;

                // Log progress every 10 pages
                if (pageCount % 10 === 0) {
                    console.log(`[Broadcast] Loaded ${allConversations.length} conversations (page ${pageCount})...`);
                }
            }
            const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
            console.log(`[Broadcast] Total loaded: ${allConversations.length} conversations in ${elapsed}s`);
        } else {
            // Single page fetch (existing behavior)
            const response = await axios.get(nextUrl);
            allConversations = response.data.data || [];
        }

        const now = Date.now();
        const SEVEN_DAYS = 7 * 24 * 60 * 60 * 1000;

        const recipients = [];
        let eligibleCount = 0;

        for (const conv of allConversations) {
            const participant = conv.participants?.data?.find(p => p.id !== pageId);
            if (participant) {
                const lastUpdate = new Date(conv.updated_time).getTime();
                const daysAgo = Math.floor((now - lastUpdate) / (24 * 60 * 60 * 1000));
                const isEligible = (now - lastUpdate) <= SEVEN_DAYS; // Within 7 days

                if (isEligible) eligibleCount++;

                recipients.push({
                    id: participant.id,
                    name: participant.name || 'مستخدم',
                    conversationId: conv.id,
                    lastMessage: conv.updated_time,
                    isEligible,
                    daysAgo
                });
            }
        }

        // Sort by recency
        recipients.sort((a, b) => new Date(b.lastMessage) - new Date(a.lastMessage));

        // If fetchAll, there's no "more" since we got everything
        const hasMore = shouldFetchAll ? false : !!allConversations.length;

        const responseData = {
            recipients,
            total: recipients.length,
            eligible: eligibleCount,
            hasMore: shouldFetchAll ? false : hasMore,
            nextCursor: shouldFetchAll ? null : (allConversations.paging?.cursors?.after || null)
        };

        // Cache the results for fetchAll requests
        if (shouldFetchAll) {
            broadcastCache.set(cacheKey, {
                data: responseData,
                timestamp: Date.now()
            });
            console.log(`[Broadcast] Cached ${recipients.length} recipients for page ${pageId}`);
        }

        res.json(responseData);

    } catch (err) {
        console.error('Error fetching recipients:', err.response?.data || err.message);
        res.status(500).json({ error: 'Failed to fetch recipients' });
    }
});

// Search conversations by sender ID (PSID from webhooks)
app.get('/api/inbox/:userId/:pageId/search', async (req, res) => {
    const { userId, pageId } = req.params;
    const { senderId } = req.query;
    const user = appData.users[userId];

    if (!user || !user.pages?.[pageId]) {
        return res.status(404).json({ error: 'Page not found' });
    }

    if (!senderId) {
        return res.status(400).json({ error: 'Sender ID is required' });
    }

    const pageToken = user.pages[pageId].accessToken;

    try {
        console.log(`Searching for sender ID: ${senderId}`);

        // Method 1: Try to get conversation directly using user_id parameter
        let conversation = null;

        try {
            const directResponse = await axios.get(`${FB_GRAPH_URL}/${pageId}/conversations`, {
                params: {
                    access_token: pageToken,
                    fields: 'participants,updated_time,id,messages.limit(25){message,from,created_time}',
                    user_id: senderId
                }
            });

            if (directResponse.data.data && directResponse.data.data.length > 0) {
                conversation = directResponse.data.data[0];
            }
        } catch (e) {
            console.log('Direct user_id search failed, trying full scan...');
        }

        // Method 2: If direct search failed, scan through conversations
        if (!conversation) {
            let allConversations = [];
            let nextUrl = `${FB_GRAPH_URL}/${pageId}/conversations?access_token=${pageToken}&fields=participants,updated_time,id&limit=100`;

            while (nextUrl && allConversations.length < 500) {
                const response = await axios.get(nextUrl);
                if (response.data.data) {
                    allConversations = allConversations.concat(response.data.data);
                }
                nextUrl = response.data.paging?.next || null;
            }

            // Find conversation with this sender ID
            conversation = allConversations.find(conv =>
                conv.participants?.data?.some(p => p.id === senderId)
            );

            // If found, get the messages
            if (conversation) {
                const messagesResponse = await axios.get(`${FB_GRAPH_URL}/${conversation.id}`, {
                    params: {
                        access_token: pageToken,
                        fields: 'messages.limit(25){message,from,created_time}'
                    }
                });
                conversation.messages = messagesResponse.data.messages;
            }
        }

        if (conversation) {
            const messages = conversation.messages?.data || [];
            const participant = conversation.participants?.data?.find(p => p.id === senderId);
            const otherParticipant = conversation.participants?.data?.find(p => p.id !== pageId);

            console.log(`Found conversation with ${participant?.name || otherParticipant?.name}`);

            res.json({
                found: true,
                conversation: {
                    id: conversation.id,
                    participantId: senderId,
                    participantName: participant?.name || otherParticipant?.name || 'مستخدم',
                    lastMessage: conversation.updated_time,
                    messages: messages.map(m => ({
                        id: m.id,
                        text: m.message,
                        from: m.from?.name || 'Unknown',
                        fromId: m.from?.id,
                        isFromPage: m.from?.id === pageId,
                        time: m.created_time
                    }))
                }
            });
        } else {
            console.log(`No conversation found for sender ID: ${senderId}`);
            res.json({ found: false, message: 'لم يتم العثور على محادثة بهذا الـ Sender ID' });
        }

    } catch (err) {
        console.error('Error searching conversations:', err.response?.data || err.message);
        res.status(500).json({ error: 'Search failed', details: err.response?.data?.error?.message || err.message });
    }
});

// ============= CREATE ORDER (Receipt Template - Meta Business Suite Native) =============

// Create order and send as official Receipt Template to customer via Facebook Messenger
// This uses the same template_type:'receipt' that Meta Business Suite uses internally
app.post('/api/inbox/:userId/:pageId/create-order', async (req, res) => {
    const { userId, pageId } = req.params;
    const { recipientId, recipientName, orderNumber, currency, items, address, summary, paymentMethod, orderUrl, notes, storeName, discount } = req.body;

    console.log(`[CreateOrder] Creating order for recipient ${recipientId}, page ${pageId}`);

    const pageToken = findPageToken(userId, pageId);
    if (!pageToken) {
        return res.status(404).json({ error: 'Page not found' });
    }

    // Validate required fields
    if (!recipientId || !items || items.length === 0) {
        return res.status(400).json({ error: 'Missing required fields: recipientId, items' });
    }

    // Calculate totals
    const subtotal = summary?.subtotal || items.reduce((sum, item) => sum + (parseFloat(item.price) * parseInt(item.quantity)), 0);
    const shippingCost = summary?.shipping_cost || 0;
    const totalTax = summary?.total_tax || 0;
    const discountAmount = summary?.discount || discount?.amount || 0;
    const totalCost = summary?.total_cost || (subtotal + shippingCost + totalTax - discountAmount);
    const itemCount = items.reduce((sum, item) => sum + parseInt(item.quantity), 0);
    const itemNames = items.map(i => i.title).join(', ');
    const curr = currency || 'EGP';
    const finalOrderNumber = orderNumber || `ORD-${Date.now()}`;
    const payment = paymentMethod || 'Cash on Delivery';
    // Use the Facebook Page name as the store name (fallback to page data)
    const pageData = appData.users[userId]?.pages?.[pageId];
    const pageName = pageData?.name || '';
    const retailerName = storeName || pageName || 'Store';
    const baseUrl = process.env.BASE_URL || 'https://octomedia.octobot.it.com';


    // START: Save to Database (wrapped in try-catch to not block order sending)
    try {
        // Find or create a store for this user
        // Note: userId might be a Facebook numeric ID which won't match UUID columns
        let store = null;
        try {
            store = await EcommerceStore.findOne({ where: { userId: userId, platform: 'manual' } });
        } catch (dbLookupErr) {
            console.warn(`[CreateOrder] ⚠️ Store lookup failed (likely userId type mismatch): ${dbLookupErr.message}`);
        }

        if (!store) {
            try {
                const anyStore = await EcommerceStore.findOne({ where: { userId: userId } });
                if (anyStore) {
                    store = anyStore;
                }
            } catch (dbLookupErr) {
                console.warn(`[CreateOrder] ⚠️ Store lookup (any) failed: ${dbLookupErr.message}`);
            }
        }

        // Create the order in DB if we found/created a store
        if (store) {
            await EcommerceOrder.create({
                storeId: store.id,
                externalId: finalOrderNumber,
                orderNumber: finalOrderNumber,
                customerName: recipientName || 'Facebook User',
                facebookPsid: recipientId,
                items: items,
                subtotal: subtotal,
                discount: discountAmount,
                shipping: shippingCost,
                tax: totalTax,
                totalPrice: totalCost,
                currency: curr,
                paymentMethod: payment,
                shippingAddress: address || {},
                status: 'pending',
                notes: notes,
                paymentStatus: paymentMethod === 'Cash on Delivery' ? 'pending' : 'paid', // Assumption
                externalCreatedAt: new Date(),
                syncedAt: new Date()
            });
            console.log(`[CreateOrder] ✅ Saved order ${finalOrderNumber} to database (Store: ${store.id})`);
        }
    } catch (dbErr) {
        console.error('[CreateOrder] ⚠️ Failed to save order to database:', dbErr);
        // Don't fail the request, just log it. The primary goal here is sending the message.
    }
    // END: Save to Database

    // ============= RECEIPT TEMPLATE (Meta Business Suite Native) =============
    // Using the official Facebook Receipt Template - this is the SAME format
    // that Meta Business Suite uses when creating orders from the inbox.
    // Orders sent via this template appear as native receipt cards in Messenger
    // and are recognized by Meta's systems as real orders.

    // Build receipt elements (individual product items)
    const receiptElements = items.map(item => {
        const element = {
            title: item.title,
            subtitle: `x${item.quantity}`,
            quantity: parseInt(item.quantity),
            price: parseFloat(item.price) * parseInt(item.quantity),
            currency: curr
        };
        // Only add image_url if we have a valid one
        if (item.image_url && item.image_url.startsWith('http')) {
            element.image_url = item.image_url;
        }
        return element;
    });

    // Build adjustments array (discounts, coupons, etc.)
    const adjustments = [];
    if (discountAmount > 0) {
        const discountLabel = discount?.type === 'percent'
            ? `خصم ${discount.value}%`
            : 'خصم';
        adjustments.push({
            name: discountLabel,
            amount: discountAmount
        });
    }

    // Build receipt template payload (Official Facebook Receipt Template)
    // Docs: https://developers.facebook.com/docs/messenger-platform/send-messages/template/receipt/
    const receiptPayload = {
        template_type: 'receipt',
        recipient_name: recipientName || 'Customer',
        order_number: finalOrderNumber,
        currency: curr,
        payment_method: payment,
        timestamp: Math.floor(Date.now() / 1000).toString(),
        summary: {
            subtotal: subtotal,
            shipping_cost: shippingCost,
            total_tax: totalTax,
            total_cost: totalCost
        },
        elements: receiptElements
    };

    // Add order URL if provided
    if (orderUrl) {
        receiptPayload.order_url = orderUrl;
    } else {
        receiptPayload.order_url = `${baseUrl}/order/${finalOrderNumber}`;
    }

    // Add merchant name for receipt display
    if (retailerName) {
        receiptPayload.merchant_name = retailerName;
    }

    // Add shipping address if provided (all fields must be non-empty strings for Facebook API)
    if (address && address.street_1) {
        const receiptAddress = {
            street_1: address.street_1,
            country: address.country || 'EG'
        };
        // Only add optional fields if they have actual values (Facebook rejects empty strings)
        if (address.street_2) receiptAddress.street_2 = address.street_2;
        if (address.city) receiptAddress.city = address.city;
        if (address.postal_code) receiptAddress.postal_code = address.postal_code;
        if (address.state) receiptAddress.state = address.state;
        receiptPayload.address = receiptAddress;
    }

    // Add adjustments (discounts) if any
    if (adjustments.length > 0) {
        receiptPayload.adjustments = adjustments;
    }

    const messagePayload = {
        recipient: { id: recipientId },
        message: {
            attachment: {
                type: 'template',
                payload: receiptPayload
            }
        }
    };

    console.log(`[CreateOrder] 📧 Sending Receipt Template for order ${finalOrderNumber}...`);
    console.log(`[CreateOrder] Items: ${receiptElements.length}, Total: ${curr} ${totalCost.toFixed(2)}`);
    console.log(`[CreateOrder] Payload:`, JSON.stringify(receiptPayload, null, 2));

    // Try with different messaging approaches (fallback chain)
    const attempts = [
        { messaging_type: 'MESSAGE_TAG', tag: 'POST_PURCHASE_UPDATE' },
        { messaging_type: 'MESSAGE_TAG', tag: 'ACCOUNT_UPDATE' },
        { messaging_type: 'RESPONSE' }
    ];

    for (const attempt of attempts) {
        try {
            const payload = { ...messagePayload, messaging_type: attempt.messaging_type };
            if (attempt.tag) payload.tag = attempt.tag;

            const response = await axios.post(`${FB_GRAPH_URL}/me/messages`, payload, {
                params: { access_token: pageToken }
            });

            console.log(`[CreateOrder] ✅ Receipt Template sent successfully with ${attempt.tag || attempt.messaging_type}`);
            console.log(`[CreateOrder] Message ID: ${response.data.message_id}`);
            return res.json({
                success: true,
                messageId: response.data.message_id,
                orderNumber: finalOrderNumber,
                templateType: 'receipt',
                orderData: {
                    orderNumber: finalOrderNumber,
                    items,
                    totalCost,
                    subtotal,
                    shippingCost,
                    totalTax,
                    discount: discountAmount,
                    currency: curr,
                    paymentMethod: payment,
                    itemNames,
                    itemCount,
                    storeName: retailerName,
                    address,
                    orderUrl: orderUrl || `${baseUrl}/order/${finalOrderNumber}`,
                    notes,
                    createdAt: new Date().toISOString()
                }
            });
        } catch (err) {
            const errMsg = err.response?.data?.error?.message || err.message;
            const errCode = err.response?.data?.error?.code;
            console.log(`[CreateOrder] ⚠️ ${attempt.tag || attempt.messaging_type} failed (code: ${errCode}): ${errMsg}`);
            continue;
        }
    }

    console.error('[CreateOrder] ❌ All attempts failed for Receipt Template');
    res.status(500).json({ error: 'Failed to send order receipt. All messaging methods failed.', details: 'Receipt Template could not be delivered via any messaging type.' });
});

// ============= MARK ORDER AS PAID =============

// Mark order as paid (local status update only, no message to customer)
app.post('/api/inbox/:userId/:pageId/mark-paid', async (req, res) => {
    const { userId, pageId } = req.params;
    const { recipientId, orderNumber } = req.body;

    console.log(`[MarkPaid] Marking order ${orderNumber} as paid for recipient ${recipientId}`);

    if (!recipientId || !orderNumber) {
        return res.status(400).json({ error: 'Missing required fields: recipientId, orderNumber' });
    }

    try {
        // Find the order
        const order = await EcommerceOrder.findOne({
            where: { orderNumber: orderNumber }
        });

        if (order) {
            await order.update({
                paymentStatus: 'paid',
                status: 'paid' // Optional: also mark main status as paid/completed depending on logic
            });

            // Emit socket event for real-time UI update
            if (global.io) {
                global.io.emit('order-status-update', {
                    pageId,
                    orderNumber,
                    status: 'paid',
                    order: {
                        ...order.toJSON(),
                        totalCost: parseFloat(order.totalPrice),
                        subtotal: parseFloat(order.subtotal),
                        shippingCost: parseFloat(order.shipping),
                        totalTax: parseFloat(order.tax),
                        discount: parseFloat(order.discount),
                        itemCount: order.items ? order.items.reduce((s, i) => s + (i.quantity || 1), 0) : 0
                    },
                    timestamp: new Date().toISOString()
                });
            }

            console.log(`[MarkPaid] ✅ Order ${orderNumber} marked as paid`);

            // Return full order object for UI re-rendering
            return res.json({
                success: true,
                orderNumber,
                order: {
                    ...order.toJSON(),
                    // Ensure numeric fields are numbers for frontend formatting
                    totalCost: parseFloat(order.totalPrice),
                    subtotal: parseFloat(order.subtotal),
                    shippingCost: parseFloat(order.shipping),
                    totalTax: parseFloat(order.tax),
                    discount: parseFloat(order.discount),
                    itemCount: order.items ? order.items.reduce((s, i) => s + (i.quantity || 1), 0) : 0
                }
            });
        } else {
            console.warn(`[MarkPaid] ⚠️ Order ${orderNumber} not found in DB, sending simpler success`);
            return res.json({ success: true, orderNumber });
        }
    } catch (err) {
        console.error('[MarkPaid] Error updating order:', err);
        return res.status(500).json({ error: 'Failed to update order status' });
    }
});

// Send product with image to customer
app.post('/api/inbox/:userId/:pageId/send-product', async (req, res) => {
    const { userId, pageId } = req.params;
    const { recipientId, message, imageUrl } = req.body;

    console.log(`[Product Send] Sending to ${recipientId}, userId: ${userId}, pageId: ${pageId}`);
    console.log(`[Product Send] Image URL: ${imageUrl || 'none'}`);

    const user = appData.users[userId];

    if (!user || !user.pages?.[pageId]) {
        console.error(`[Product Send] User or page not found: userId=${userId}, pageId=${pageId}`);
        return res.status(404).json({ success: false, error: 'Page not found' });
    }

    const pageToken = user.pages[pageId].accessToken;
    let textSent = false;
    let imageSent = false;
    let imageError = null;

    try {
        // STEP 1: Send text message FIRST (Split if too long)
        if (message) {
            const MAX_LENGTH = 1900; // Safe limit below Facebook's 2000 char limit
            const chunks = [];

            for (let i = 0; i < message.length; i += MAX_LENGTH) {
                chunks.push(message.substring(i, i + MAX_LENGTH));
            }

            console.log(`[Product Send] Message length ${message.length}, splitting into ${chunks.length} chunks`);

            for (let i = 0; i < chunks.length; i++) {
                const chunk = chunks[i];
                console.log(`[Product Send] Sending chunk ${i + 1}/${chunks.length}...`);

                const textPayload = {
                    recipient: { id: recipientId },
                    messaging_type: 'MESSAGE_TAG',
                    tag: 'POST_PURCHASE_UPDATE',
                    message: { text: chunk }
                };

                try {
                    await axios.post(`${FB_GRAPH_URL}/me/messages`, textPayload, {
                        params: { access_token: pageToken }
                    });
                    textSent = true;
                    console.log(`[Product Send] Chunk ${i + 1} sent successfully with POST_PURCHASE_UPDATE!`);
                } catch (tagErr) {
                    // Try ACCOUNT_UPDATE if POST_PURCHASE_UPDATE is rejected
                    console.log(`[Product Send] POST_PURCHASE_UPDATE failed for chunk ${i + 1}, trying ACCOUNT_UPDATE...`);
                    textPayload.tag = 'ACCOUNT_UPDATE';
                    try {
                        await axios.post(`${FB_GRAPH_URL}/me/messages`, textPayload, {
                            params: { access_token: pageToken }
                        });
                        textSent = true;
                        console.log(`[Product Send] Chunk ${i + 1} sent successfully with ACCOUNT_UPDATE!`);
                    } catch (fallbackErr) {
                        console.error(`[Product Send] Chunk ${i + 1} send failed:`, fallbackErr.response?.data?.error?.message || fallbackErr.message);
                        // If one chunk fails, we mark textSent as false generally? Or just log?
                        // Let's keep trying other chunks but log error
                    }
                }

                // Small delay between chunks to ensure order
                if (i < chunks.length - 1) {
                    await new Promise(r => setTimeout(r, 300));
                }
            }

            // Delay before sending image
            await new Promise(r => setTimeout(r, 500));
        }

        // STEP 2: Download image from URL and upload via message_attachments API
        if (imageUrl) {
            try {
                console.log('[Product Send] Step 2: Downloading image from URL...');

                // Download image to temp file
                const tempFileName = `product_${Date.now()}.jpg`;
                const tempFilePath = path.join(__dirname, 'uploads', tempFileName);

                // Ensure uploads directory exists
                if (!fs.existsSync(path.join(__dirname, 'uploads'))) {
                    fs.mkdirSync(path.join(__dirname, 'uploads'), { recursive: true });
                }

                // Download image
                const imageResponse = await axios({
                    method: 'get',
                    url: imageUrl,
                    responseType: 'stream',
                    timeout: 30000,
                    headers: {
                        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
                    }
                });

                // Save to temp file
                const writer = fs.createWriteStream(tempFilePath);
                imageResponse.data.pipe(writer);

                await new Promise((resolve, reject) => {
                    writer.on('finish', resolve);
                    writer.on('error', reject);
                });

                console.log('[Product Send] Image downloaded successfully, uploading to Facebook...');

                // Upload to Facebook using message_attachments API
                const FormData = require('form-data');
                const form = new FormData();

                form.append('message', JSON.stringify({
                    attachment: {
                        type: 'image',
                        payload: {
                            is_reusable: true
                        }
                    }
                }));
                form.append('filedata', fs.createReadStream(tempFilePath));

                const uploadRes = await axios.post(`${FB_GRAPH_URL}/me/message_attachments`, form, {
                    headers: form.getHeaders(),
                    params: { access_token: pageToken }
                });

                const attachmentId = uploadRes.data.attachment_id;
                console.log('[Product Send] Image uploaded to Facebook, attachment_id:', attachmentId);

                // Clean up temp file
                try { fs.unlinkSync(tempFilePath); } catch (e) { /* ignore */ }

                // Send image using attachment_id
                const imagePayload = {
                    recipient: { id: recipientId },
                    messaging_type: 'MESSAGE_TAG',
                    tag: 'POST_PURCHASE_UPDATE',
                    message: {
                        attachment: {
                            type: 'image',
                            payload: { attachment_id: attachmentId }
                        }
                    }
                };

                try {
                    await axios.post(`${FB_GRAPH_URL}/me/messages`, imagePayload, {
                        params: { access_token: pageToken }
                    });
                    imageSent = true;
                    console.log('[Product Send] Image sent successfully with POST_PURCHASE_UPDATE!');
                } catch (imgTagErr) {
                    // Try ACCOUNT_UPDATE if POST_PURCHASE_UPDATE is rejected
                    console.log('[Product Send] POST_PURCHASE_UPDATE failed for image, trying ACCOUNT_UPDATE...');
                    imagePayload.tag = 'ACCOUNT_UPDATE';
                    await axios.post(`${FB_GRAPH_URL}/me/messages`, imagePayload, {
                        params: { access_token: pageToken }
                    });
                    imageSent = true;
                    console.log('[Product Send] Image sent successfully with ACCOUNT_UPDATE!');
                }

            } catch (imgErr) {
                imageError = imgErr.response?.data?.error?.message || imgErr.message;
                console.error('[Product Send] Image send FAILED!');
                console.error('[Product Send] Error details:', JSON.stringify(imgErr.response?.data || imgErr.message));
            }
        }

        res.json({
            success: true,
            textSent,
            imageSent,
            imageError: imageError || null
        });

    } catch (err) {
        console.error('[Product Send] Error:', err.response?.data?.error?.message || err.message);
        res.status(500).json({
            success: false,
            error: err.response?.data?.error?.message || err.message
        });
    }
});

// Send broadcast message
app.post('/api/broadcast/:userId/:pageId/send', upload.single('media'), async (req, res) => {
    const { userId, pageId } = req.params;
    const { recipientIds, message, mediaType } = req.body;
    const user = appData.users[userId];

    if (!user || !user.pages?.[pageId]) {
        return res.status(404).json({ error: 'Page not found' });
    }

    const pageToken = user.pages[pageId].accessToken;
    const targetIds = recipientIds === 'all' ? null : JSON.parse(recipientIds);

    try {
        // First get eligible recipients
        const conversationsResponse = await axios.get(`${FB_GRAPH_URL}/${pageId}/conversations`, {
            params: {
                access_token: pageToken,
                fields: 'participants,updated_time,id'
            }
        });

        const now = Date.now();
        const SEVEN_DAYS = 7 * 24 * 60 * 60 * 1000;

        let recipients = [];
        for (const conv of conversationsResponse.data.data || []) {
            const participant = conv.participants?.data?.find(p => p.id !== pageId);
            if (participant) {
                const lastUpdate = new Date(conv.updated_time).getTime();
                // Include all recipients regardless of time
                if (!targetIds || targetIds.includes(participant.id)) {
                    recipients.push({
                        id: participant.id,
                        name: participant.name || 'مستخدم'
                    });
                }
            }
        }

        // Upload media if provided
        let mediaAttachment = null;
        if (req.file && mediaType) {
            const filePath = req.file.path;
            const FormData = require('form-data');
            const form = new FormData();
            form.append('source', fs.createReadStream(filePath));
            form.append('access_token', pageToken);

            try {
                if (mediaType === 'image') {
                    const uploadRes = await axios.post(`${FB_GRAPH_URL}/${pageId}/photos`, form, {
                        headers: form.getHeaders(),
                        params: { published: false }
                    });
                    mediaAttachment = {
                        type: 'image',
                        payload: { attachment_id: uploadRes.data.id }
                    };
                } else if (mediaType === 'video') {
                    const uploadRes = await axios.post(`${FB_GRAPH_URL}/${pageId}/videos`, form, {
                        headers: form.getHeaders()
                    });
                    mediaAttachment = {
                        type: 'video',
                        payload: { attachment_id: uploadRes.data.id }
                    };
                }
            } catch (uploadErr) {
                console.error('Media upload failed:', uploadErr.response?.data || uploadErr.message);
            }
        }

        // Send messages
        const results = { success: [], failed: [] };

        for (const recipient of recipients) {
            try {
                const messagePayload = {
                    recipient: { id: recipient.id },
                    messaging_type: 'MESSAGE_TAG',
                    tag: 'POST_PURCHASE_UPDATE'
                };

                if (mediaAttachment) {
                    messagePayload.message = { attachment: mediaAttachment };
                    // Send media first, then text
                    await axios.post(`${FB_GRAPH_URL}/${pageId}/messages`, messagePayload, {
                        params: { access_token: pageToken }
                    });

                    if (message) {
                        messagePayload.message = { text: message };
                        await axios.post(`${FB_GRAPH_URL}/${pageId}/messages`, messagePayload, {
                            params: { access_token: pageToken }
                        });
                    }
                } else if (message) {
                    messagePayload.message = { text: message };
                    await axios.post(`${FB_GRAPH_URL}/${pageId}/messages`, messagePayload, {
                        params: { access_token: pageToken }
                    });
                }

                results.success.push({ id: recipient.id, name: recipient.name });
            } catch (sendErr) {
                console.error(`Failed to send to ${recipient.name}:`, sendErr.response?.data?.error?.message || sendErr.message);
                results.failed.push({
                    id: recipient.id,
                    name: recipient.name,
                    error: sendErr.response?.data?.error?.message || sendErr.message
                });
            }
        }

        res.json({
            success: true,
            sent: results.success.length,
            failed: results.failed.length,
            details: results
        });

    } catch (err) {
        console.error('Broadcast error:', err.response?.data || err.message);
        res.status(500).json({ error: 'Broadcast failed' });
    }
});

// Send single broadcast message (for progress tracking) - with media and Message Tag support
app.post('/api/broadcast/:userId/:pageId/send-one', upload.single('media'), async (req, res) => {
    const { userId, pageId } = req.params;
    const { recipientId, recipientName, message, messageTag } = req.body;
    const user = appData.users[userId];

    if (!user || !user.pages?.[pageId]) {
        return res.status(404).json({ error: 'Page not found' });
    }

    const pageToken = user.pages[pageId].accessToken;

    try {
        // If there's an image, upload it using attachment upload API
        let attachmentId = null;
        if (req.file) {
            const FormData = require('form-data');
            const form = new FormData();

            // Use attachment_upload for Messenger
            form.append('message', JSON.stringify({
                attachment: {
                    type: 'image',
                    payload: {
                        is_reusable: true
                    }
                }
            }));
            form.append('filedata', fs.createReadStream(req.file.path));

            const uploadRes = await axios.post(`${FB_GRAPH_URL}/me/message_attachments`, form, {
                headers: form.getHeaders(),
                params: { access_token: pageToken }
            });

            attachmentId = uploadRes.data.attachment_id;
        }

        // Determine messaging type based on Message Tag
        // Valid tags: POST_PURCHASE_UPDATE, ACCOUNT_UPDATE, CONFIRMED_EVENT_UPDATE
        const validTags = ['POST_PURCHASE_UPDATE', 'ACCOUNT_UPDATE', 'CONFIRMED_EVENT_UPDATE'];
        const tag = validTags.includes(messageTag) ? messageTag : 'POST_PURCHASE_UPDATE';

        const messagePayload = {
            recipient: { id: recipientId },
            messaging_type: 'MESSAGE_TAG',
            tag: tag
        };

        // Send image first if exists
        if (attachmentId) {
            messagePayload.message = {
                attachment: {
                    type: 'image',
                    payload: { attachment_id: attachmentId }
                }
            };
            await axios.post(`${FB_GRAPH_URL}/me/messages`, messagePayload, {
                params: { access_token: pageToken }
            });
        }

        // Then send text if exists
        if (message) {
            messagePayload.message = { text: message };

            try {
                // Try with MESSAGE_TAG first
                await axios.post(`${FB_GRAPH_URL}/me/messages`, messagePayload, {
                    params: { access_token: pageToken }
                });
            } catch (tagError) {
                // If tag fails, try with RESPONSE (24-hour window)
                console.log(`[Broadcast] Tag failed for ${recipientName}, trying RESPONSE...`);
                const fallbackPayload = {
                    recipient: { id: recipientId },
                    messaging_type: 'RESPONSE',
                    message: { text: message }
                };
                await axios.post(`${FB_GRAPH_URL}/me/messages`, fallbackPayload, {
                    params: { access_token: pageToken }
                });
            }
        }

        res.json({ success: true, recipientId, recipientName });

    } catch (err) {
        console.error(`Failed to send to ${recipientName}:`, err.response?.data?.error?.message || err.message);
        res.json({
            success: false,
            recipientId,
            recipientName,
            error: err.response?.data?.error?.message || err.message
        });
    }
});

// ============= BROWSER AUTOMATION =============

const MessengerAutomation = require('./messenger-automation');
let messengerBot = null;

// Initialize browser automation (runs in background by default)
app.post('/api/automation/init', async (req, res) => {
    const { headless = true } = req.body; // Default to headless (background)

    try {
        if (messengerBot) {
            await messengerBot.close();
        }

        messengerBot = new MessengerAutomation();
        await messengerBot.initialize(headless);

        // Try auto-login with saved cookies
        const isLoggedIn = await messengerBot.autoLogin();

        // Connect automation to campaign service for fallback messaging
        if (isLoggedIn) {
            campaignService.setAutomation(messengerBot);
        }

        res.json({
            success: true,
            initialized: true,
            isLoggedIn,
            headless
        });
    } catch (err) {
        console.error('Automation init failed:', err.message);
        res.json({ success: false, error: err.message });
    }
});

// Check browser login status (and save cookies if logged in)
app.get('/api/automation/status', async (req, res) => {
    if (!messengerBot) {
        return res.json({ initialized: false, isLoggedIn: false });
    }

    try {
        const isLoggedIn = await messengerBot.checkLoginStatus();

        // Save cookies if logged in (for session persistence)
        if (isLoggedIn) {
            await messengerBot.saveCookies();
        }

        res.json({ initialized: true, isLoggedIn });
    } catch (err) {
        res.json({ initialized: true, isLoggedIn: false, error: err.message });
    }
});

// Login to Facebook via browser
app.post('/api/automation/login', async (req, res) => {
    const { email, password } = req.body;

    if (!messengerBot) {
        return res.status(400).json({ error: 'Automation not initialized' });
    }

    try {
        const success = await messengerBot.login(email, password);

        // Connect automation to campaign service after successful login
        if (success) {
            campaignService.setAutomation(messengerBot);
        }

        res.json({ success });
    } catch (err) {
        res.json({ success: false, error: err.message });
    }
});

// Send message via browser automation
app.post('/api/automation/send', upload.single('media'), async (req, res) => {
    const { recipientId, recipientName, message } = req.body;
    const imagePath = req.file ? req.file.path : null;

    if (!messengerBot) {
        return res.status(400).json({ error: 'Automation not initialized' });
    }

    try {
        const result = await messengerBot.sendMessage(recipientId, message, imagePath);
        res.json({
            ...result,
            recipientId,
            recipientName
        });
    } catch (err) {
        res.json({
            success: false,
            recipientId,
            recipientName,
            error: err.message
        });
    }
});

// Close browser automation
app.post('/api/automation/close', async (req, res) => {
    if (messengerBot) {
        await messengerBot.close();
        messengerBot = null;
    }
    res.json({ success: true });
});

// ============= INSTAGRAM API =============

// Get Instagram account info
app.get('/api/instagram/:userId/:pageId/account', async (req, res) => {
    const { userId, pageId } = req.params;
    const user = appData.users[userId];

    if (!user || !user.pages?.[pageId]) {
        return res.status(404).json({ connected: false, message: 'الصفحة غير موجودة' });
    }

    try {
        const pageToken = user.pages[pageId].accessToken;
        const account = await instagramService.getInstagramAccount(pageId, pageToken);

        if (account) {
            const info = await instagramService.getInstagramInfo(account.id, pageToken);
            res.json({
                connected: true,
                account: {
                    id: account.id,
                    username: info?.username || account.username,
                    profilePicture: info?.profile_picture_url || '',
                    followers: info?.followers_count || 0
                }
            });
        } else {
            res.json({ connected: false, message: 'لم يتم العثور على حساب Instagram مرتبط بهذه الصفحة' });
        }
    } catch (err) {
        console.error('Instagram account error:', err);
        res.json({ connected: false, message: 'فشل في جلب معلومات Instagram' });
    }
});

// Get Instagram conversations with pagination
app.get('/api/instagram/:userId/:pageId/conversations', async (req, res) => {
    const { userId, pageId } = req.params;
    const { limit = 100, after } = req.query;
    const user = appData.users[userId];

    if (!user || !user.pages?.[pageId]) {
        return res.status(404).json({ error: 'Page not found' });
    }

    try {
        const pageToken = user.pages[pageId].accessToken;
        const account = await instagramService.getInstagramAccount(pageId, pageToken);

        if (!account) {
            return res.json({ conversations: [], hasMore: false });
        }

        const result = await instagramService.getConversations(account, pageToken, parseInt(limit), after);

        // Format conversations for frontend
        const formattedConversations = result.conversations.map(conv => ({
            id: conv.id,
            participant: conv.participants?.data?.[0]?.name || conv.participants?.data?.[0]?.username || 'مستخدم',
            participantId: conv.participants?.data?.[0]?.id || '',
            updatedTime: conv.updated_time,
            lastMessage: conv.messages?.data?.[0]?.message || ''
        }));

        res.json({
            conversations: formattedConversations,
            hasMore: !!result.paging?.cursors?.after,
            nextCursor: result.paging?.cursors?.after || null
        });
    } catch (err) {
        console.error('Instagram conversations error:', err);
        res.status(500).json({ error: 'Failed to fetch conversations' });
    }
});

// Search Instagram conversations by user ID or username
app.get('/api/instagram/:userId/:pageId/search', async (req, res) => {
    const { userId, pageId } = req.params;
    const { query } = req.query;
    const user = appData.users[userId];

    if (!user || !user.pages?.[pageId]) {
        return res.status(404).json({ error: 'Page not found' });
    }

    if (!query || query.length < 2) {
        return res.json({ conversations: [] });
    }

    try {
        const pageToken = user.pages[pageId].accessToken;
        const account = await instagramService.getInstagramAccount(pageId, pageToken);

        if (!account) {
            return res.json({ conversations: [] });
        }

        // Get all conversations (up to 100) and filter by search query
        const result = await instagramService.getConversations(account, pageToken, 100, null);

        const searchLower = query.toLowerCase();
        const filtered = result.conversations.filter(conv => {
            const participantName = conv.participants?.data?.[0]?.name?.toLowerCase() || '';
            const participantUsername = conv.participants?.data?.[0]?.username?.toLowerCase() || '';
            const participantId = conv.participants?.data?.[0]?.id || '';

            return participantName.includes(searchLower) ||
                participantUsername.includes(searchLower) ||
                participantId.includes(query);
        });

        const formattedConversations = filtered.map(conv => ({
            id: conv.id,
            participant: conv.participants?.data?.[0]?.name || conv.participants?.data?.[0]?.username || 'مستخدم',
            participantId: conv.participants?.data?.[0]?.id || '',
            updatedTime: conv.updated_time,
            lastMessage: conv.messages?.data?.[0]?.message || ''
        }));

        res.json({ conversations: formattedConversations });
    } catch (err) {
        console.error('Instagram search error:', err);
        res.status(500).json({ error: 'Failed to search conversations' });
    }
});

// Get Instagram messages
app.get('/api/instagram/:userId/:pageId/messages/:conversationId', async (req, res) => {
    const { userId, pageId, conversationId } = req.params;
    const user = appData.users[userId];

    if (!user || !user.pages?.[pageId]) {
        return res.status(404).json({ error: 'Page not found' });
    }

    try {
        const pageToken = user.pages[pageId].accessToken;
        const messages = await instagramService.getMessages(conversationId, pageToken);
        res.json({ messages });
    } catch (err) {
        console.error('Instagram messages error:', err);
        res.status(500).json({ error: 'Failed to fetch messages' });
    }
});

// Send Instagram message
app.post('/api/instagram/:userId/:pageId/send', async (req, res) => {
    const { userId, pageId } = req.params;
    const { recipientId, message } = req.body;
    const user = appData.users[userId];

    if (!user || !user.pages?.[pageId]) {
        return res.status(404).json({ error: 'Page not found' });
    }

    try {
        const pageToken = user.pages[pageId].accessToken;
        const account = await instagramService.getInstagramAccount(pageId, pageToken);

        if (!account) {
            return res.status(400).json({ error: 'Instagram account not found' });
        }

        const result = await instagramService.sendMessage(account.id, recipientId, message, pageToken);
        res.json(result);
    } catch (err) {
        console.error('Instagram send error:', err);
        res.status(500).json({ error: 'Failed to send message' });
    }
});

// ============= INSTAGRAM PRIVATE API (Direct Login) =============

// Message queue for rate limiting (prevent Instagram from dropping messages)
const igMessageQueues = {}; // userId -> { queue: [], processing: false }
const IG_MESSAGE_DELAY = 2000; // 2 seconds between messages

async function processIgMessageQueue(userId) {
    const queueData = igMessageQueues[userId];
    if (!queueData || queueData.processing || queueData.queue.length === 0) {
        return;
    }

    queueData.processing = true;

    while (queueData.queue.length > 0) {
        const { threadId, message, resolve, reject } = queueData.queue.shift();

        try {
            console.log(`[IG Queue] Processing message for thread ${threadId}`);
            const result = await instagramPrivateService.sendMessage(userId, threadId, message);
            resolve(result);
        } catch (err) {
            console.error(`[IG Queue] Error:`, err.message);
            reject(err);
        }

        // Wait before processing next message
        if (queueData.queue.length > 0) {
            console.log(`[IG Queue] Waiting ${IG_MESSAGE_DELAY}ms before next message...`);
            await new Promise(r => setTimeout(r, IG_MESSAGE_DELAY));
        }
    }

    queueData.processing = false;
}

function queueIgMessage(userId, threadId, message) {
    if (!igMessageQueues[userId]) {
        igMessageQueues[userId] = { queue: [], processing: false };
    }

    return new Promise((resolve, reject) => {
        igMessageQueues[userId].queue.push({ threadId, message, resolve, reject });
        processIgMessageQueue(userId);
    });
}

// Login to Instagram with username/password
app.post('/api/ig/:userId/login', async (req, res) => {
    const { userId } = req.params;
    const { username, password } = req.body;

    if (!username || !password) {
        return res.status(400).json({ success: false, error: 'اسم المستخدم وكلمة المرور مطلوبين' });
    }

    try {
        const result = await instagramPrivateService.login(userId, username, password);
        res.json(result);
    } catch (err) {
        console.error('Instagram login error:', err);
        res.status(500).json({ success: false, error: 'فشل تسجيل الدخول' });
    }
});

// Submit Instagram verification code (2FA/Challenge)
app.post('/api/ig/:userId/verify', async (req, res) => {
    const { userId } = req.params;
    const { code } = req.body;

    if (!code) {
        return res.status(400).json({ success: false, error: 'كود التحقق مطلوب' });
    }

    try {
        const result = await instagramPrivateService.submitVerificationCode(userId, code);
        res.json(result);
    } catch (err) {
        console.error('Instagram verify error:', err);
        res.status(500).json({ success: false, error: 'فشل التحقق' });
    }
});

// Resend Instagram verification code
app.post('/api/ig/:userId/resend-code', async (req, res) => {
    const { userId } = req.params;

    try {
        const result = await instagramPrivateService.resendVerificationCode(userId);
        res.json(result);
    } catch (err) {
        console.error('Instagram resend code error:', err);
        res.status(500).json({ success: false, error: 'فشل إعادة إرسال الكود' });
    }
});

// Check Instagram login status
app.get('/api/ig/:userId/status', async (req, res) => {
    const { userId } = req.params;

    try {
        const isLoggedIn = await instagramPrivateService.isLoggedIn(userId);
        if (isLoggedIn) {
            const account = await instagramPrivateService.getAccountInfo(userId);
            res.json({ loggedIn: true, account });
        } else {
            res.json({ loggedIn: false });
        }
    } catch (err) {
        console.error('Instagram status error:', err);
        res.json({ loggedIn: false });
    }
});

// Image proxy to bypass Instagram CORS restrictions
app.get('/api/image-proxy', async (req, res) => {
    const { url } = req.query;

    if (!url) {
        return res.status(400).send('URL required');
    }

    try {
        // Decode URL (it will be base64 encoded from frontend)
        const imageUrl = Buffer.from(url, 'base64').toString('utf8');

        // Fetch the image
        const response = await axios.get(imageUrl, {
            responseType: 'arraybuffer',
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
                'Accept': 'image/*'
            },
            timeout: 10000
        });

        // Set content type and cache headers
        res.set('Content-Type', response.headers['content-type'] || 'image/jpeg');
        res.set('Cache-Control', 'public, max-age=86400'); // Cache for 24 hours
        res.send(Buffer.from(response.data));
    } catch (err) {
        console.error('Image proxy error:', err.message);
        res.status(404).send('Image not found');
    }
});
// Get Instagram inbox
app.get('/api/ig/:userId/inbox', async (req, res) => {
    const { userId } = req.params;
    const { limit = 50 } = req.query;

    try {
        const conversations = await instagramPrivateService.getInbox(userId, parseInt(limit));
        res.json({ conversations });
    } catch (err) {
        console.error('Instagram inbox error:', err);
        res.status(500).json({ error: 'فشل في تحميل المحادثات' });
    }
});

// Get Instagram thread messages
app.get('/api/ig/:userId/thread/:threadId', async (req, res) => {
    const { userId, threadId } = req.params;
    const { limit = 100 } = req.query;

    try {
        // getMessages returns { messages, users, threadId }
        const result = await instagramPrivateService.getMessages(userId, threadId, parseInt(limit));
        res.json(result);
    } catch (err) {
        console.error('Instagram messages error:', err);
        res.status(500).json({ error: 'فشل في تحميل الرسائل', messages: [], users: [] });
    }
});

// Send Instagram message (with rate limiting queue)
app.post('/api/ig/:userId/send', async (req, res) => {
    const { userId } = req.params;
    const { threadId, message } = req.body;

    console.log(`[Server] Send request: userId=${userId}, threadId=${threadId}, message="${message?.substring(0, 30)}..."`);

    if (!threadId || !message) {
        console.log('[Server] Missing threadId or message');
        return res.status(400).json({ success: false, error: 'معرف المحادثة والرسالة مطلوبين' });
    }

    try {
        // Use message queue for rate limiting
        const queueLength = igMessageQueues[userId]?.queue?.length || 0;
        if (queueLength > 0) {
            console.log(`[Server] Message queued (${queueLength + 1} in queue)`);
        }

        const result = await queueIgMessage(userId, threadId, message);
        console.log('[Server] Send result:', result);
        res.json(result);
    } catch (err) {
        console.error('[Server] Instagram send error:', err);
        res.status(500).json({ success: false, error: 'فشل في إرسال الرسالة' });
    }
});

// Send Instagram photo
app.post('/api/ig/:userId/send-photo', upload.single('photo'), async (req, res) => {
    const { userId } = req.params;
    const { threadId } = req.body;

    console.log(`[Server] Photo send request: userId=${userId}, threadId=${threadId}`);

    if (!threadId || !req.file) {
        return res.status(400).json({ success: false, error: 'معرف المحادثة والصورة مطلوبين' });
    }

    try {
        const imageBuffer = fs.readFileSync(req.file.path);
        const result = await instagramPrivateService.sendPhoto(userId, threadId, imageBuffer);

        // Clean up uploaded file
        fs.unlinkSync(req.file.path);

        res.json(result);
    } catch (err) {
        console.error('[Server] Instagram photo send error:', err);
        if (req.file?.path) fs.unlinkSync(req.file.path);
        res.status(500).json({ success: false, error: 'فشل في إرسال الصورة' });
    }
});

// Send Instagram video
app.post('/api/ig/:userId/send-video', upload.single('video'), async (req, res) => {
    const { userId } = req.params;
    const { threadId } = req.body;

    console.log(`[Server] Video send request: userId=${userId}, threadId=${threadId}`);

    if (!threadId || !req.file) {
        return res.status(400).json({ success: false, error: 'معرف المحادثة والفيديو مطلوبين' });
    }

    try {
        const videoBuffer = fs.readFileSync(req.file.path);
        const result = await instagramPrivateService.sendVideo(userId, threadId, videoBuffer);

        // Clean up uploaded file
        fs.unlinkSync(req.file.path);

        res.json(result);
    } catch (err) {
        console.error('[Server] Instagram video send error:', err);
        if (req.file?.path) fs.unlinkSync(req.file.path);
        res.status(500).json({ success: false, error: 'فشل في إرسال الفيديو' });
    }
});

// Logout from Instagram
app.post('/api/ig/:userId/logout', async (req, res) => {
    const { userId } = req.params;

    try {
        const result = await instagramPrivateService.logout(userId);
        res.json(result);
    } catch (err) {
        console.error('Instagram logout error:', err);
        res.status(500).json({ success: false, error: 'فشل في تسجيل الخروج' });
    }
});

// ============= (Legacy WhatsApp routes removed — use /api/whatsapp/* with authMiddleware) =============

// ============= TELEGRAM API =============

// Check if Telegram is configured
app.get('/api/telegram/config', (req, res) => {
    res.json({ configured: telegramService.isConfigured() });
});

// Start Telegram login (send code)
app.post('/api/telegram/:userId/login', async (req, res) => {
    const { userId } = req.params;
    const { phoneNumber } = req.body;

    console.log(`[Server] Telegram login request: userId=${userId}, phone=${phoneNumber}`);

    if (!phoneNumber) {
        return res.status(400).json({ success: false, error: 'رقم الهاتف مطلوب' });
    }

    try {
        const result = await telegramService.startLogin(userId, phoneNumber);
        res.json(result);
    } catch (err) {
        console.error('[Server] Telegram login error:', err);
        res.status(500).json({ success: false, error: 'فشل في إرسال الكود' });
    }
});

// Verify Telegram code
app.post('/api/telegram/:userId/verify', async (req, res) => {
    const { userId } = req.params;
    const { code, password } = req.body;

    console.log(`[Server] Telegram verify request: userId=${userId}`);

    if (!code) {
        return res.status(400).json({ success: false, error: 'الكود مطلوب' });
    }

    try {
        const result = await telegramService.verifyCode(userId, code, password);
        res.json(result);
    } catch (err) {
        console.error('[Server] Telegram verify error:', err);
        res.status(500).json({ success: false, error: 'فشل في التحقق' });
    }
});

// Check Telegram login status
app.get('/api/telegram/:userId/status', async (req, res) => {
    const { userId } = req.params;

    try {
        const loggedIn = await telegramService.isLoggedIn(userId);
        res.json({ loggedIn });
    } catch (err) {
        console.error('[Server] Telegram status error:', err);
        res.json({ loggedIn: false });
    }
});

// Get Telegram account info
app.get('/api/telegram/:userId/account', async (req, res) => {
    const { userId } = req.params;

    try {
        const account = await telegramService.getAccountInfo(userId);
        if (account) {
            res.json({ success: true, account });
        } else {
            res.json({ success: false, error: 'لم يتم تسجيل الدخول' });
        }
    } catch (err) {
        console.error('[Server] Telegram account error:', err);
        res.status(500).json({ success: false, error: 'فشل في جلب معلومات الحساب' });
    }
});

// Get Telegram dialogs (conversations)
app.get('/api/telegram/:userId/dialogs', async (req, res) => {
    const { userId } = req.params;
    const { limit = 50 } = req.query;

    try {
        const dialogs = await telegramService.getDialogs(userId, parseInt(limit));
        res.json({ success: true, dialogs });
    } catch (err) {
        console.error('[Server] Telegram dialogs error:', err);
        res.status(500).json({ success: false, error: 'فشل في جلب المحادثات', dialogs: [] });
    }
});

// Get Telegram messages from a dialog
app.get('/api/telegram/:userId/messages/:dialogId', async (req, res) => {
    const { userId, dialogId } = req.params;
    const { limit = 50 } = req.query;

    try {
        const messages = await telegramService.getMessages(userId, dialogId, parseInt(limit));
        res.json({ success: true, messages });
    } catch (err) {
        console.error('[Server] Telegram messages error:', err);
        res.status(500).json({ success: false, error: 'فشل في جلب الرسائل', messages: [] });
    }
});

// Send Telegram message
app.post('/api/telegram/:userId/send', async (req, res) => {
    const { userId } = req.params;
    const { dialogId, text, replyTo } = req.body;

    console.log(`[Server] Telegram send: userId=${userId}, dialogId=${dialogId}, replyTo=${replyTo || 'none'}`);

    if (!dialogId || !text) {
        return res.status(400).json({ success: false, error: 'معرف المحادثة والنص مطلوبين' });
    }

    try {
        const result = await telegramService.sendMessage(userId, dialogId, text, replyTo);
        res.json(result);
    } catch (err) {
        console.error('[Server] Telegram send error:', err);
        res.status(500).json({ success: false, error: 'فشل في إرسال الرسالة' });
    }
});

// Delete Telegram message
app.delete('/api/telegram/:userId/delete/:dialogId/:messageId', async (req, res) => {
    const { userId, dialogId, messageId } = req.params;

    console.log(`[Server] Telegram delete: userId=${userId}, dialogId=${dialogId}, messageId=${messageId}`);

    try {
        const result = await telegramService.deleteMessage(userId, dialogId, messageId);
        res.json(result);
    } catch (err) {
        console.error('[Server] Telegram delete error:', err);
        res.status(500).json({ success: false, error: 'فشل في حذف الرسالة' });
    }
});

// Edit Telegram message
app.put('/api/telegram/:userId/edit/:dialogId/:messageId', async (req, res) => {
    const { userId, dialogId, messageId } = req.params;
    const { text } = req.body;

    console.log(`[Server] Telegram edit: userId=${userId}, dialogId=${dialogId}, messageId=${messageId}`);

    if (!text) {
        return res.status(400).json({ success: false, error: 'النص مطلوب' });
    }

    try {
        const result = await telegramService.editMessage(userId, dialogId, messageId, text);
        res.json(result);
    } catch (err) {
        console.error('[Server] Telegram edit error:', err);
        res.status(500).json({ success: false, error: 'فشل في تعديل الرسالة' });
    }
});

// Forward Message
app.post('/api/telegram/:userId/forward', async (req, res) => {
    const { userId } = req.params;
    const { toDialogId, fromDialogId, messageId } = req.body;

    console.log(`[Server] Telegram forward: userId=${userId}, from=${fromDialogId}, to=${toDialogId}, msg=${messageId}`);

    if (!toDialogId || !fromDialogId || !messageId) {
        return res.status(400).json({ success: false, error: 'جميع البيانات مطلوبة' });
    }

    try {
        const result = await telegramService.forwardMessages(userId, toDialogId, fromDialogId, messageId);
        res.json(result);
    } catch (err) {
        console.error('[Server] Telegram forward error:', err);
        res.status(500).json({ success: false, error: 'فشل في توجيه الرسالة' });
    }
});

// Send Telegram File (Photo/Doc/Video)
app.post('/api/telegram/:userId/send-file', upload.single('file'), async (req, res) => {
    const { userId } = req.params;
    const { dialogId, caption } = req.body;

    console.log(`[Server] Telegram send file: userId=${userId}, dialogId=${dialogId}, file=${req.file?.originalname}`);

    if (!req.file || !dialogId) {
        return res.status(400).json({ success: false, error: 'الملف ومعرف المحادثة مطلوبين' });
    }

    try {
        const fileBuffer = fs.readFileSync(req.file.path);

        const result = await telegramService.sendFile(userId, dialogId, fileBuffer, {
            caption: caption || '',
            fileName: req.file.originalname,
            mimeType: req.file.mimetype
        });

        // Clean up uploaded file
        fs.unlinkSync(req.file.path);

        res.json(result);
    } catch (err) {
        console.error('[Server] Telegram send file error:', err);
        if (req.file && fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
        res.status(500).json({ success: false, error: 'فشل في إرسال الملف' });
    }
});

// Send Telegram photo
app.post('/api/telegram/:userId/send-photo', upload.single('photo'), async (req, res) => {
    const { userId } = req.params;
    const { dialogId, caption } = req.body;

    console.log(`[Server] Telegram photo send: userId=${userId}, dialogId=${dialogId}`);

    if (!dialogId || !req.file) {
        return res.status(400).json({ success: false, error: 'معرف المحادثة والصورة مطلوبين' });
    }

    try {
        // Detect file type and use appropriate extension  
        const mimeType = req.file.mimetype || '';
        const extension = mimeType.startsWith('video/') ? '.mp4' : '.jpg';

        // Save file with correct extension
        const tempFilePath = req.file.path + extension;
        fs.renameSync(req.file.path, tempFilePath);

        console.log(`[Server] Sending file: ${tempFilePath}, mimeType: ${mimeType}`);
        const result = await telegramService.sendFile(userId, dialogId, fs.readFileSync(tempFilePath), {
            caption: caption || '',
            fileName: req.file.originalname,
            mimeType: mimeType
        });

        // Clean up uploaded file
        if (fs.existsSync(tempFilePath)) {
            fs.unlinkSync(tempFilePath);
        }

        res.json(result);
    } catch (err) {
        console.error('[Server] Telegram photo send error:', err);
        // Clean up files
        if (req.file?.path && fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
        ['.jpg', '.mp4'].forEach(ext => {
            const filePath = req.file?.path + ext;
            if (filePath && fs.existsSync(filePath)) fs.unlinkSync(filePath);
        });
        res.status(500).json({ success: false, error: 'فشل فيإرسال الصورة' });
    }
});

// Logout from Telegram
app.post('/api/telegram/:userId/logout', async (req, res) => {
    const { userId } = req.params;

    try {
        const result = await telegramService.logout(userId);
        res.json(result);
    } catch (err) {
        console.error('[Server] Telegram logout error:', err);
        res.status(500).json({ success: false, error: 'فشل في تسجيل الخروج' });
    }
});

// Mark messages as read
app.post('/api/telegram/:userId/mark-read/:dialogId', async (req, res) => {
    const { userId, dialogId } = req.params;

    console.log(`[Server] Marking messages as read: userId=${userId}, dialogId=${dialogId}`);

    try {
        const result = await telegramService.markAsRead(userId, dialogId);
        res.json(result);
    } catch (err) {
        console.error('[Server] Mark as read error:', err);
        res.status(500).json({ success: false, error: 'فشل في تحديث الرسائل' });
    }
});

// Download media from message
app.get('/api/telegram/:userId/media/:dialogId/:messageId', async (req, res) => {
    const { userId, dialogId, messageId } = req.params;

    console.log(`[Server] Downloading media: userId=${userId}, dialogId=${dialogId}, messageId=${messageId}`);

    try {
        const result = await telegramService.downloadMedia(userId, dialogId, messageId);

        if (!result || !result.buffer) {
            return res.status(404).json({ success: false, error: 'Media not found' });
        }

        // Set appropriate content type and send buffer
        res.setHeader('Content-Type', result.mimeType);
        res.send(result.buffer);
    } catch (err) {
        console.error('[Server] Media download error:', err);
        res.status(500).json({ success: false, error: 'فشل في تحميل الملف' });
    }
});

// Search for Telegram users globally
app.get('/api/telegram/:userId/search', async (req, res) => {
    const { userId } = req.params;
    const { query } = req.query;

    console.log(`[Server] Telegram search: userId=${userId}, query="${query}"`);

    if (!query || query.length < 2) {
        return res.json({ success: true, results: [] });
    }

    try {
        const results = await telegramService.searchUsers(userId, query);
        res.json({ success: true, results });
    } catch (err) {
        console.error('[Server] Telegram search error:', err);
        res.status(500).json({ success: false, error: 'فشل في البحث', results: [] });
    }
});


// ============= START SERVER =============

// ============= COMPETITOR ANALYSIS =============

// Analyze a competitor's Facebook page
app.post('/api/competitors/analyze', async (req, res) => {
    const { url } = req.body;

    if (!url) {
        return res.status(400).json({ error: 'يرجى إدخال رابط الصفحة' });
    }

    console.log(`[Competitor] Analyzing: ${url}`);

    try {
        const result = await competitorScraper.scrapeFacebookPage(url);

        if (result.error) {
            return res.status(400).json({ error: result.error });
        }

        console.log(`[Competitor] Analysis complete for: ${result.name}`);
        res.json(result);

    } catch (err) {
        console.error('[Competitor] Error:', err.message);
        res.status(500).json({ error: 'خطأ في تحليل الصفحة' });
    }
});

// Get saved competitors from data
app.get('/api/competitors/:userId', (req, res) => {
    const userId = req.params.userId;
    const competitors = appData.users[userId]?.competitors || [];
    res.json({ competitors });
});

// Save a competitor
app.post('/api/competitors/:userId', (req, res) => {
    const userId = req.params.userId;
    const competitor = req.body;

    if (!appData.users[userId]) {
        appData.users[userId] = {};
    }
    if (!appData.users[userId].competitors) {
        appData.users[userId].competitors = [];
    }

    // Check if already exists
    const exists = appData.users[userId].competitors.find(c => c.url === competitor.url);
    if (exists) {
        // Update existing
        Object.assign(exists, competitor, { updatedAt: new Date().toISOString() });
    } else {
        // Add new
        competitor.addedAt = new Date().toISOString();
        appData.users[userId].competitors.push(competitor);
    }

    saveData();
    res.json({ success: true, competitors: appData.users[userId].competitors });
});

// Delete a competitor
app.delete('/api/competitors/:userId/:index', (req, res) => {
    const { userId, index } = req.params;

    if (appData.users[userId]?.competitors) {
        appData.users[userId].competitors.splice(parseInt(index), 1);
        saveData();
    }

    res.json({ success: true });
});

// Generate SWOT analysis for all competitors
app.get('/api/competitors/:userId/swot', (req, res) => {
    const userId = req.params.userId;
    const competitors = appData.users[userId]?.competitors || [];

    if (competitors.length === 0) {
        return res.json({ swot: null, message: 'لا يوجد منافسين' });
    }

    const swot = competitorScraper.generateSWOT(competitors);
    res.json({ swot });
});

// Compare competitors statistics
app.get('/api/competitors/:userId/compare', (req, res) => {
    const userId = req.params.userId;
    const competitors = appData.users[userId]?.competitors || [];

    const comparison = {
        names: competitors.map(c => c.name || 'منافس'),
        followers: competitors.map(c => c.followers || 0),
        likes: competitors.map(c => c.likes || 0),
        engagementRates: competitors.map(c => c.metrics?.engagementRate || 0),
        postsPerWeek: competitors.map(c => c.metrics?.postsPerWeek || 0)
    };

    res.json({ comparison });
});

// ============= CAMPAIGN API ROUTES =============

// Start a new campaign
app.post('/api/campaigns/start', upload.array('media', 5), async (req, res) => {
    try {
        const { userId, pageId, pageName, messageTemplate, messageTag, delay, recipients, imageUrls } = req.body;

        if (!userId || !pageId || !messageTemplate || !recipients) {
            return res.status(400).json({ success: false, error: 'Missing required fields' });
        }

        const parsedRecipients = typeof recipients === 'string' ? JSON.parse(recipients) : recipients;

        // Parse remote image URLs if provided
        let parsedImageUrls = [];
        if (imageUrls) {
            try {
                parsedImageUrls = typeof imageUrls === 'string' ? JSON.parse(imageUrls) : imageUrls;
                console.log('[Campaign] Received imageUrls:', parsedImageUrls);
            } catch (e) {
                console.log('[Campaign] Failed to parse imageUrls:', e.message);
            }
        }

        // Get media file paths
        const mediaFiles = (req.files || []).map(f => path.join(uploadDir, f.filename));

        const result = await campaignService.startCampaign({
            userId,
            pageId,
            pageName: pageName || '',
            messageTemplate,
            messageTag: messageTag || 'POST_PURCHASE_UPDATE',
            delay: parseInt(delay) || 3000,
            recipients: parsedRecipients,
            mediaFiles,
            imageUrls: parsedImageUrls
        });

        res.json(result);
    } catch (err) {
        console.error('[Campaign] Start error:', err);
        res.status(500).json({ success: false, error: err.message });
    }
});

// Get campaign status
app.get('/api/campaigns/:campaignId/status', async (req, res) => {
    const result = await campaignService.getCampaignStatus(req.params.campaignId);
    res.json(result);
});

// Pause campaign
app.post('/api/campaigns/:campaignId/pause', async (req, res) => {
    const result = await campaignService.pauseCampaign(req.params.campaignId);
    res.json(result);
});

// Resume campaign
app.post('/api/campaigns/:campaignId/resume', async (req, res) => {
    const result = await campaignService.resumeCampaign(req.params.campaignId);
    res.json(result);
});

// Cancel campaign
app.post('/api/campaigns/:campaignId/cancel', async (req, res) => {
    const result = await campaignService.cancelCampaign(req.params.campaignId);
    res.json(result);
});

// Get active campaigns for user
app.get('/api/campaigns/active/:userId', async (req, res) => {
    const campaigns = await campaignService.getActiveCampaigns(req.params.userId);
    res.json({ campaigns });
});

// ============= TEAM PERFORMANCE STATS =============

// Record team activity (called when messages are sent)
app.post('/api/team/activity', async (req, res) => {
    try {
        const { userId, userName, actionType, platform, conversationId, responseTime, messageLength, metadata } = req.body;

        if (!userId || !userName || !actionType || !platform) {
            return res.status(400).json({ error: 'Missing required fields' });
        }

        const activity = await TeamActivity.create({
            userId,
            userName,
            actionType,
            platform,
            conversationId: conversationId || null,
            responseTime: responseTime || null,
            messageLength: messageLength || null,
            metadata: metadata || {}
        });

        res.json({ success: true, activity });
    } catch (err) {
        console.error('Error recording team activity:', err);
        res.status(500).json({ error: 'Failed to record activity' });
    }
});

// Get team statistics overview
app.get('/api/team/stats', async (req, res) => {
    try {
        const { period = 'week' } = req.query;

        // Calculate date range
        const now = new Date();
        let startDate;
        switch (period) {
            case 'today':
                startDate = new Date(now.getFullYear(), now.getMonth(), now.getDate());
                break;
            case 'week':
                startDate = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
                break;
            case 'month':
                startDate = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
                break;
            default:
                startDate = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
        }

        // Get all activities in the period
        const activities = await TeamActivity.findAll({
            where: {
                createdAt: { [require('sequelize').Op.gte]: startDate },
                actionType: 'message_sent'
            },
            order: [['createdAt', 'DESC']]
        });

        // Calculate stats per user
        const userStats = {};
        activities.forEach(act => {
            if (!userStats[act.userId]) {
                userStats[act.userId] = {
                    userId: act.userId,
                    userName: act.userName,
                    messagesSent: 0,
                    totalResponseTime: 0,
                    responseCount: 0,
                    platforms: { facebook: 0, instagram: 0, telegram: 0, whatsapp: 0 }
                };
            }
            userStats[act.userId].messagesSent++;
            if (act.platform) {
                userStats[act.userId].platforms[act.platform]++;
            }
            if (act.responseTime) {
                userStats[act.userId].totalResponseTime += act.responseTime;
                userStats[act.userId].responseCount++;
            }
        });

        // Calculate averages and format response
        const stats = Object.values(userStats).map(user => ({
            ...user,
            avgResponseTime: user.responseCount > 0
                ? Math.round(user.totalResponseTime / user.responseCount)
                : null
        }));

        // Get daily breakdown for chart
        const dailyStats = {};
        activities.forEach(act => {
            const date = act.createdAt.toISOString().split('T')[0];
            if (!dailyStats[date]) {
                dailyStats[date] = 0;
            }
            dailyStats[date]++;
        });

        res.json({
            success: true,
            period,
            totalMessages: activities.length,
            userStats: stats,
            dailyStats,
            platformStats: stats.reduce((acc, user) => {
                Object.keys(user.platforms).forEach(p => {
                    acc[p] = (acc[p] || 0) + user.platforms[p];
                });
                return acc;
            }, {})
        });
    } catch (err) {
        console.error('Error getting team stats:', err);
        res.status(500).json({ error: 'Failed to get stats' });
    }
});

// Get leaderboard (top performers)
app.get('/api/team/leaderboard', async (req, res) => {
    try {
        const { period = 'week', limit = 10 } = req.query;

        const now = new Date();
        let startDate;
        switch (period) {
            case 'today':
                startDate = new Date(now.getFullYear(), now.getMonth(), now.getDate());
                break;
            case 'week':
                startDate = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
                break;
            case 'month':
                startDate = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
                break;
            default:
                startDate = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
        }

        const activities = await TeamActivity.findAll({
            where: {
                createdAt: { [require('sequelize').Op.gte]: startDate },
                actionType: 'message_sent'
            }
        });

        // Aggregate by user
        const userStats = {};
        activities.forEach(act => {
            if (!userStats[act.userId]) {
                userStats[act.userId] = {
                    userId: act.userId,
                    userName: act.userName,
                    messagesSent: 0,
                    avgResponseTime: null,
                    totalRT: 0,
                    rtCount: 0
                };
            }
            userStats[act.userId].messagesSent++;
            if (act.responseTime) {
                userStats[act.userId].totalRT += act.responseTime;
                userStats[act.userId].rtCount++;
            }
        });

        // Sort by messages sent
        const leaderboard = Object.values(userStats)
            .map(u => ({
                ...u,
                avgResponseTime: u.rtCount > 0 ? Math.round(u.totalRT / u.rtCount) : null
            }))
            .sort((a, b) => b.messagesSent - a.messagesSent)
            .slice(0, parseInt(limit));

        res.json({ success: true, leaderboard });
    } catch (err) {
        console.error('Error getting leaderboard:', err);
        res.status(500).json({ error: 'Failed to get leaderboard' });
    }
});

// Get individual user stats
app.get('/api/team/stats/:userId', async (req, res) => {
    try {
        const { userId } = req.params;
        const { period = 'week' } = req.query;

        const now = new Date();
        let startDate;
        switch (period) {
            case 'today':
                startDate = new Date(now.getFullYear(), now.getMonth(), now.getDate());
                break;
            case 'week':
                startDate = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
                break;
            case 'month':
                startDate = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
                break;
            default:
                startDate = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
        }

        const activities = await TeamActivity.findAll({
            where: {
                userId,
                createdAt: { [require('sequelize').Op.gte]: startDate }
            },
            order: [['createdAt', 'DESC']]
        });

        const messagesSent = activities.filter(a => a.actionType === 'message_sent').length;
        const responseTimes = activities.filter(a => a.responseTime).map(a => a.responseTime);
        const avgResponseTime = responseTimes.length > 0
            ? Math.round(responseTimes.reduce((a, b) => a + b, 0) / responseTimes.length)
            : null;

        const platforms = { facebook: 0, instagram: 0, telegram: 0, whatsapp: 0 };
        activities.forEach(a => {
            if (a.platform && platforms[a.platform] !== undefined) {
                platforms[a.platform]++;
            }
        });

        res.json({
            success: true,
            userId,
            period,
            messagesSent,
            avgResponseTime,
            platforms,
            recentActivity: activities.slice(0, 20)
        });
    } catch (err) {
        console.error('Error getting user stats:', err);
        res.status(500).json({ error: 'Failed to get user stats' });
    }
});

// ============= GOOGLE SHEETS API =============

// Get sheet data
app.get('/api/sheets/:spreadsheetId', authMiddleware, async (req, res) => {
    try {
        const { spreadsheetId } = req.params;
        const { range = 'Sheet1!A1:ZZ1000' } = req.query;

        const data = await googleSheetsService.getSheetData(spreadsheetId, range);
        res.json({ success: true, values: data });
    } catch (err) {
        console.error('Google Sheets API Error:', err);
        res.status(500).json({ error: 'Failed to fetch sheet data' });
    }
});

// Update sheet data
app.post('/api/sheets/:spreadsheetId/update', authMiddleware, async (req, res) => {
    try {
        const { spreadsheetId } = req.params;
        const { range, values } = req.body;

        if (!range || !values) {
            return res.status(400).json({ error: 'Range and values are required' });
        }

        const result = await googleSheetsService.updateSheetData(spreadsheetId, range, values);
        res.json({ success: true, result });
    } catch (err) {
        console.error('Google Sheets API Update Error:', err);
        res.status(500).json({ error: 'Failed to update sheet data' });
    }
});

async function startServer() {
    // Test database connection
    const dbConnected = await testConnection();
    if (dbConnected) {
        await syncDatabase();

        // Initialize Campaign Service after database is ready
        campaignService.init(Campaign, appData);

        // Create default admin if no users exist
        const userCount = await User.count();
        if (userCount === 0) {
            await User.create({
                email: 'admin@octobot.com',
                password: 'admin123',
                name: 'Admin',
                role: 'admin',
                isActive: true,
                isVerified: true,  // Admin is pre-verified
                isWorkingToday: true
            });
            console.log('👤 Default admin created: admin@octobot.com / admin123');
        } else {
            // Make sure existing admin is verified
            await User.update(
                { isVerified: true },
                { where: { email: 'admin@octobot.com' } }
            );
        }
    }

    // Create HTTP server and attach Socket.IO for real-time updates
    const server = http.createServer(app);
    const io = new Server(server, {
        cors: { origin: '*' }
    });

    // Make io accessible globally for campaignService to emit events
    global.io = io;

    // Socket.IO connection handling
    io.on('connection', (socket) => {
        console.log('[Socket.IO] Client connected:', socket.id);

        // Join campaign room for real-time updates
        socket.on('join-campaign', (campaignId) => {
            socket.join(`campaign-${campaignId}`);
            console.log(`[Socket.IO] Client ${socket.id} joined campaign-${campaignId}`);
        });

        // Join generic room (used by WhatsApp for wa-{userId} rooms)
        socket.on('join-room', (roomName) => {
            socket.join(roomName);
            console.log(`[Socket.IO] Client ${socket.id} joined room ${roomName}`);
        });

        socket.on('disconnect', () => {
            console.log('[Socket.IO] Client disconnected:', socket.id);
        });
    });

    // ============================================
    // Contact Form Email Endpoint
    // ============================================
    const nodemailer = require('nodemailer');

    const contactTransporter = nodemailer.createTransport({
        service: 'gmail',
        auth: {
            user: process.env.SMTP_USER || 'octobotchatbot@gmail.com',
            pass: process.env.SMTP_PASS || ''
        }
    });

    app.post('/api/contact', async (req, res) => {
        const { name, email, type, message } = req.body;

        if (!name || !email || !message) {
            return res.status(400).json({ error: 'جميع الحقول مطلوبة' });
        }

        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
            return res.status(400).json({ error: 'البريد الإلكتروني غير صالح' });
        }

        try {
            await contactTransporter.sendMail({
                from: `"DK-OctoBot Contact" <octobotchatbot@gmail.com>`,
                to: 'octobotchatbot@gmail.com',
                replyTo: email,
                subject: `[DK-OctoBot] ${type || 'استفسار'} - من ${name}`,
                html: `
                    <div dir="rtl" style="font-family: Arial, sans-serif; padding: 20px; background: #f5f5f5; border-radius: 10px;">
                        <h2 style="color: #4CC9F0; border-bottom: 2px solid #4CC9F0; padding-bottom: 10px;">📧 رسالة جديدة من نموذج الاتصال</h2>
                        <table style="width: 100%; border-collapse: collapse; margin: 20px 0;">
                            <tr><td style="padding: 10px; font-weight: bold; color: #333;">الاسم:</td><td style="padding: 10px; color: #555;">${name}</td></tr>
                            <tr style="background: #eee;"><td style="padding: 10px; font-weight: bold; color: #333;">البريد:</td><td style="padding: 10px;"><a href="mailto:${email}">${email}</a></td></tr>
                            <tr><td style="padding: 10px; font-weight: bold; color: #333;">نوع الاستفسار:</td><td style="padding: 10px; color: #555;">${type || 'غير محدد'}</td></tr>
                            <tr style="background: #eee;"><td style="padding: 10px; font-weight: bold; color: #333;">الرسالة:</td><td style="padding: 10px; color: #555; white-space: pre-wrap;">${message}</td></tr>
                        </table>
                        <p style="color: #999; font-size: 12px;">تم الإرسال من نموذج الاتصال في موقع DK-OctoBot</p>
                    </div>
                `
            });

            console.log(`[Contact] Email sent from ${name} (${email}) - Type: ${type}`);
            res.json({ success: true, message: 'تم إرسال رسالتك بنجاح' });
        } catch (err) {
            console.error('[Contact] Email send error:', err.message);
            res.status(500).json({ error: 'فشل في إرسال الرسالة. حاول مرة أخرى لاحقاً' });
        }
    });

    server.listen(PORT, () => {
        console.log(`\n🐙 DK-OctoBot Server running at http://localhost:${PORT}`);
        console.log(`\n📋 Setup Instructions:`);
        console.log(`   1. Copy .env.example to .env`);
        console.log(`   2. Add your Facebook App ID and Secret to .env`);
        console.log(`   3. In Facebook Developer Console, add this redirect URI:`);
        console.log(`      ${REDIRECT_URI}`);
        console.log(`\n📝 External Logs:`);
        console.log(`   All server logs are saved to: ${LOG_FILE}`);
        console.log(`   Max file size: 5MB (auto-rotation enabled)`);
        console.log(`\n🔌 Socket.IO enabled for real-time campaign updates`);
        console.log(`\n✅ Server ready!`);

        rescheduleExistingPosts();

        // ============= SCHEDULED ANALYTICS SYNC =============
        // Sync analytics every hour to ensure stats are always up-to-date
        console.log('[Scheduler] 📊 Setting up hourly analytics sync job...');

        schedule.scheduleJob('0 * * * *', async () => {
            console.log('[Analytics Sync] ⏰ Hourly sync started at:', new Date().toISOString());
            await syncAllPagesAnalytics();
        });

        // Also run a sync at server startup (after 30 seconds to let things initialize)
        setTimeout(async () => {
            console.log('[Analytics Sync] 🚀 Initial sync starting...');
            await syncAllPagesAnalytics();
        }, 30000);

        console.log('[Scheduler] ✅ Analytics sync job scheduled (runs every hour)');

        // ============= AUTO-START PUPPETEER AUTOMATION =============
        // Auto-initialize Puppeteer for campaign fallback (after 10 seconds)
        setTimeout(async () => {
            try {
                console.log('[Automation] 🤖 Auto-initializing Puppeteer for campaign fallback...');
                messengerBot = new MessengerAutomation();
                await messengerBot.initialize(true); // headless mode

                // Try auto-login with saved cookies
                const isLoggedIn = await messengerBot.autoLogin();

                if (isLoggedIn) {
                    campaignService.setAutomation(messengerBot);
                    console.log('[Automation] 🤖 ✅ Puppeteer ready! Campaigns will use it as fallback.');
                } else {
                    console.log('[Automation] 🤖 ⚠️ Puppeteer initialized but NOT logged in.');
                    console.log('[Automation] 🤖 Login via: POST /api/automation/login { email, password }');
                }
            } catch (err) {
                console.log('[Automation] 🤖 ⚠️ Auto-init skipped:', err.message);
                console.log('[Automation] 🤖 Initialize manually: POST /api/automation/init');
            }
        }, 10000);
    });
}

startServer();
