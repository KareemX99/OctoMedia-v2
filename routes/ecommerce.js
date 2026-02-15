// E-Commerce API Routes
const express = require('express');
const router = express.Router();
const { EcommerceStore, EcommerceProduct, EcommerceOrder } = require('../models');
const ecommerceService = require('../services/ecommerceService');
const { authMiddleware } = require('./auth');
const crypto = require('crypto');
const { Op } = require('sequelize');

// Encrypt credentials before storing (using modern crypto with IV)
const ENCRYPTION_KEY = crypto.scryptSync(process.env.ENCRYPTION_KEY || 'dk-octobot-secret-key', 'salt', 32);
const IV_LENGTH = 16;

function encryptCredential(text) {
    if (!text) return null;
    try {
        const iv = crypto.randomBytes(IV_LENGTH);
        const cipher = crypto.createCipheriv('aes-256-cbc', ENCRYPTION_KEY, iv);
        let encrypted = cipher.update(text, 'utf8', 'hex');
        encrypted += cipher.final('hex');
        // Prepend IV to encrypted data
        return iv.toString('hex') + ':' + encrypted;
    } catch (e) {
        console.error('[Encryption] Error:', e.message);
        return text; // Return as-is if encryption fails
    }
}

// Decrypt credentials when needed
function decryptCredential(encrypted) {
    if (!encrypted) return null;
    try {
        // Check if using new format (with IV)
        if (encrypted.includes(':')) {
            const [ivHex, encryptedData] = encrypted.split(':');
            const iv = Buffer.from(ivHex, 'hex');
            const decipher = crypto.createDecipheriv('aes-256-cbc', ENCRYPTION_KEY, iv);
            let decrypted = decipher.update(encryptedData, 'hex', 'utf8');
            decrypted += decipher.final('utf8');
            return decrypted;
        } else {
            // Legacy format - return as-is (user needs to reconnect store)
            console.warn('[Decryption] Legacy encrypted data detected. User should reconnect store.');
            return encrypted;
        }
    } catch (e) {
        console.error('[Decryption] Error:', e.message);
        return null; // Return null instead of encrypted data to force reconnection
    }
}

// ============= STORE MANAGEMENT =============

// Get all connected stores for user
router.get('/stores', authMiddleware, async (req, res) => {
    try {
        const stores = await EcommerceStore.findAll({
            where: { userId: req.user.id },
            attributes: ['id', 'platform', 'storeName', 'storeUrl', 'isActive', 'lastSync', 'syncStatus', 'createdAt']
        });
        res.json({ stores });
    } catch (err) {
        console.error('[E-Commerce] Error getting stores:', err.message);
        res.status(500).json({ error: 'Failed to get stores' });
    }
});

// Connect new store
router.post('/stores/connect', authMiddleware, async (req, res) => {
    try {
        const { platform, storeUrl, apiKey, apiSecret, accessToken, storeName, config } = req.body;
        console.log('[E-Commerce] Connect request:', { platform, storeUrl, apiKey: apiKey ? '***' : null });

        if (!platform || (!storeUrl && platform !== 'zid' && platform !== 'easyorder')) {
            return res.status(400).json({ error: 'Platform and storeUrl are required' });
        }

        // Test connection first
        const credentials = { storeUrl, apiKey, apiSecret, accessToken, consumerKey: apiKey, consumerSecret: apiSecret };
        const testResult = await ecommerceService.testConnection(platform, credentials);

        if (!testResult.success) {
            console.error('[E-Commerce] Connection test failed:', testResult.error);
            return res.status(400).json({
                error: 'Connection test failed',
                details: testResult.error
            });
        }

        // Check if store already exists
        // Build where condition dynamically to handle platforms without storeUrl
        const whereCondition = {
            userId: req.user.id,
            platform
        };

        // Only add storeUrl to query if it's defined
        if (storeUrl) {
            whereCondition.storeUrl = storeUrl;
        }

        let store = await EcommerceStore.findOne({
            where: whereCondition
        });

        if (store) {
            // Update existing store
            const updateData = {
                storeName: testResult.storeName || storeName || store.storeName,
                apiKey: encryptCredential(apiKey),
                apiSecret: encryptCredential(apiSecret),
                accessToken: encryptCredential(accessToken),
                config: config || store.config,
                isActive: true,
                syncStatus: 'idle' // Reset status
            };
            // Generate webhookToken if not exists
            if (!store.webhookToken && platform === 'easyorder') {
                updateData.webhookToken = crypto.randomBytes(16).toString('hex');
            }
            await store.update(updateData);
            console.log(`[E-Commerce] Store updated: ${platform} - ${storeUrl}`);
        } else {
            // Create new store
            store = await EcommerceStore.create({
                userId: req.user.id,
                platform,
                storeName: testResult.storeName || storeName || storeUrl || 'Store',
                storeUrl: storeUrl || (platform === 'zid' ? 'https://zid.store/linked-via-api' : platform === 'easyorder' ? 'https://easy-orders.net/linked-via-api' : ''),
                apiKey: encryptCredential(apiKey),
                apiSecret: encryptCredential(apiSecret),
                accessToken: encryptCredential(accessToken),
                config: config || {},
                isActive: true,
                webhookSecret: crypto.randomBytes(32).toString('hex'),
                webhookToken: platform === 'easyorder' ? crypto.randomBytes(16).toString('hex') : null
            });
            console.log(`[E-Commerce] Store connected: ${platform} - ${storeUrl}`);
        }

        res.json({
            success: true,
            store: {
                id: store.id,
                platform: store.platform,
                storeName: store.storeName,
                storeUrl: store.storeUrl,
                isActive: store.isActive,
                webhookToken: store.webhookToken || null
            }
        });

    } catch (err) {
        console.error('[E-Commerce] Error connecting store:', err.message);
        res.status(500).json({ error: 'Failed to connect store' });
    }
});

// Disconnect/delete store
router.delete('/stores/:storeId', authMiddleware, async (req, res) => {
    try {
        const { storeId } = req.params;

        const store = await EcommerceStore.findOne({
            where: { id: storeId, userId: req.user.id }
        });

        if (!store) {
            return res.status(404).json({ error: 'Store not found' });
        }

        // Delete related products and orders first
        await EcommerceProduct.destroy({ where: { storeId } });
        await EcommerceOrder.destroy({ where: { storeId } });
        await store.destroy();

        console.log(`[E-Commerce] Store disconnected: ${store.platform} - ${store.storeUrl}`);
        res.json({ success: true });

    } catch (err) {
        console.error('[E-Commerce] Error disconnecting store:', err.message);
        res.status(500).json({ error: 'Failed to disconnect store' });
    }
});

// Sync store products
// Sync store products (Background Process)
router.post('/stores/:storeId/sync', authMiddleware, async (req, res) => {
    try {
        const { storeId } = req.params;
        console.log(`[E-Commerce] Requesting sync for store ${storeId}...`);

        const store = await EcommerceStore.findOne({
            where: { id: storeId, userId: req.user.id }
        });

        if (!store) {
            return res.status(404).json({ error: 'Store not found' });
        }

        // Update sync status to 'syncing' immediately
        await store.update({ syncStatus: 'syncing' });

        // Decrypt credentials
        const storeData = {
            ...store.toJSON(),
            apiKey: decryptCredential(store.apiKey)?.trim(),
            apiSecret: decryptCredential(store.apiSecret)?.trim(),
            accessToken: decryptCredential(store.accessToken)?.trim()
        };

        // Respond immediately to connection to prevent timeout
        res.json({
            success: true,
            message: 'Sync started in background',
            syncStatus: 'syncing',
            syncedProducts: 0,
            syncedOrders: 0
        });

        // Run Sync in Background
        (async () => {
            try {
                console.log(`[E-Commerce] Background sync started for store ${storeId}`);

                let totalProducts = 0;
                let totalOrders = 0;

                // Run Syncs in Parallel
                let totalProductsToSync = 0;
                let totalOrdersToSync = 0;

                // Use lastSync date for incremental sync (Delta Sync)
                // If lastSync exists, we only fetch items AFTER that date.
                const lastSyncDate = store.lastSync ? new Date(store.lastSync).toISOString() : null;

                if (lastSyncDate) {
                    console.log(`[E-Commerce] Starting Incremental Sync (After: ${lastSyncDate})`);
                } else {
                    console.log('[E-Commerce] Starting Full Sync');
                }

                const syncProductsTask = ecommerceService.syncProducts(
                    storeData,
                    async (batch) => {
                        console.log(`[E-Commerce] Bulk saving ${batch.length} products...`);
                        try {
                            // Prepare batch data with storeId
                            const records = batch.map(product => ({
                                storeId: store.id,
                                externalId: product.externalId,
                                name: product.name,
                                description: product.description,
                                price: product.price,
                                comparePrice: product.comparePrice,
                                currency: product.currency,
                                images: product.images,
                                variants: product.variants,
                                inventory: product.inventory,
                                sku: product.sku,
                                status: product.status,
                                category: product.category,
                                tags: product.tags,
                                syncedAt: new Date()
                            }));

                            // Bulk upsert - much faster than individual upserts
                            await EcommerceProduct.bulkCreate(records, {
                                updateOnDuplicate: ['name', 'description', 'price', 'comparePrice', 'currency', 'images', 'variants', 'inventory', 'sku', 'status', 'category', 'tags', 'syncedAt']
                            });
                            totalProducts += batch.length;
                        } catch (err) {
                            console.error(`[E-Commerce] Bulk product save error:`, err.message);
                            // Fallback to individual saves on error
                            for (const product of batch) {
                                try {
                                    await EcommerceProduct.upsert({
                                        storeId: store.id,
                                        externalId: product.externalId,
                                        ...product,
                                        syncedAt: new Date()
                                    });
                                    totalProducts++;
                                } catch (e) { /* skip */ }
                            }
                        }

                        // Emit progress update
                        if (global.io) {
                            global.io.emit('ecom-sync-progress', {
                                storeId: store.id,
                                userId: store.userId, // Add userId for client filtering
                                syncedProducts: totalProducts,
                                totalProducts: totalProductsToSync,
                                syncedOrders: totalOrders,
                                totalOrders: totalOrdersToSync,
                                status: 'syncing'
                            });
                        }
                    },
                    (total) => {
                        console.log(`[E-Commerce] Total products to sync: ${total}`);
                        totalProductsToSync = total;
                        if (global.io) {
                            global.io.emit('ecom-sync-start', {
                                storeId: store.id,
                                userId: store.userId, // Add userId for client filtering
                                totalProducts: total,
                                status: 'syncing'
                            });
                        }
                    },
                    lastSyncDate
                );

                const syncOrdersTask = (async () => {
                    try {
                        await ecommerceService.syncOrders(
                            storeData,
                            {},
                            async (batch) => {
                                console.log(`[E-Commerce] Bulk saving ${batch.length} orders...`);
                                try {
                                    // Prepare batch data with storeId
                                    const records = batch.filter(o => o.externalId).map(order => ({
                                        storeId: store.id,
                                        externalId: order.externalId,
                                        orderNumber: order.orderNumber,
                                        customerName: order.customerName,
                                        customerEmail: order.customerEmail,
                                        customerPhone: order.customerPhone,
                                        items: order.items,
                                        subtotal: order.subtotal,
                                        discount: order.discount,
                                        shipping: order.shipping,
                                        tax: order.tax,
                                        totalPrice: order.totalPrice,
                                        currency: order.currency,
                                        status: order.status,
                                        paymentStatus: order.paymentStatus,
                                        shippingAddress: order.shippingAddress,
                                        externalCreatedAt: order.externalCreatedAt,
                                        syncedAt: new Date()
                                    }));

                                    // Bulk upsert - much faster than individual upserts
                                    await EcommerceOrder.bulkCreate(records, {
                                        updateOnDuplicate: ['orderNumber', 'customerName', 'customerEmail', 'customerPhone', 'items', 'subtotal', 'discount', 'shipping', 'tax', 'totalPrice', 'currency', 'status', 'paymentStatus', 'shippingAddress', 'externalCreatedAt', 'syncedAt']
                                    });
                                    totalOrders += records.length;
                                } catch (err) {
                                    console.error(`[E-Commerce] Bulk order save error:`, err.message);
                                    // Fallback to individual saves on error
                                    for (const order of batch) {
                                        try {
                                            if (!order.externalId) continue;
                                            await EcommerceOrder.upsert({
                                                storeId: store.id,
                                                externalId: order.externalId,
                                                ...order,
                                                syncedAt: new Date()
                                            });
                                            totalOrders++;
                                        } catch (e) { /* skip */ }
                                    }
                                }

                                // Emit progress update
                                if (global.io) {
                                    global.io.emit('ecom-sync-progress', {
                                        storeId: store.id,
                                        userId: store.userId, // Add userId for client filtering
                                        syncedProducts: totalProducts,
                                        totalProducts: totalProductsToSync,
                                        syncedOrders: totalOrders,
                                        totalOrders: totalOrdersToSync,
                                        status: 'syncing'
                                    });
                                }
                            },
                            (total) => {
                                console.log(`[E-Commerce] Total orders to sync: ${total}`);
                                totalOrdersToSync = total;
                            },
                            lastSyncDate
                        );
                    } catch (err) {
                        console.error('[E-Commerce] Error syncing orders (non-fatal):', err.message);
                    }
                })();

                await Promise.all([syncProductsTask, syncOrdersTask]);

                // Update lastSync timestamp
                await store.update({ lastSync: new Date() });

                // 3. Finish Sync
                await store.update({
                    lastSync: new Date(),
                    syncStatus: 'idle'
                });

                // Emit final success event
                if (global.io) {
                    global.io.emit('ecom-sync-progress', {
                        storeId: store.id,
                        userId: store.userId, // Add userId for client filtering
                        syncedProducts: totalProducts,
                        syncedOrders: totalOrders,
                        status: 'idle', // Finished
                        lastSync: new Date()
                    });
                }

                console.log(`[E-Commerce] Background sync completed. Total: ${totalProducts} products, ${totalOrders} orders.`);

            } catch (err) {
                console.error('[E-Commerce] CRITICAL BACKGROUND SYNC ERROR:', err);
                await store.update({ syncStatus: 'error' });
            }
        })();

    } catch (err) {
        console.error('[E-Commerce] Sync init error:', err.message);
        res.status(500).json({ error: 'Failed to start sync', details: err.message });

        // Try to reset status if possible
        try {
            await EcommerceStore.update({ syncStatus: 'error' }, { where: { id: req.params.storeId } });
        } catch (e) { }
    }
});

// ============= STATS =============

// Get e-commerce statistics for dashboard
router.get('/stats', authMiddleware, async (req, res) => {
    try {
        const userId = req.user.id;

        // Get all store IDs for this user
        const userStores = await EcommerceStore.findAll({
            where: { userId },
            attributes: ['id']
        });
        const storeIds = userStores.map(s => s.id);

        if (storeIds.length === 0) {
            return res.json({
                todayOrders: 0,
                pendingOrders: 0,
                totalProducts: 0,
                todayRevenue: 0
            });
        }

        // Today's date range
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const tomorrow = new Date(today);
        tomorrow.setDate(tomorrow.getDate() + 1);

        // Count today's orders (using externalCreatedAt - order date in WooCommerce)
        const todayOrders = await EcommerceOrder.count({
            where: {
                storeId: { [Op.in]: storeIds },
                externalCreatedAt: { [Op.gte]: today, [Op.lt]: tomorrow }
            }
        });

        // Find top selling product today (from order items)
        let topSellingProduct = null;
        try {
            const todayOrders2 = await EcommerceOrder.findAll({
                where: {
                    storeId: { [Op.in]: storeIds },
                    externalCreatedAt: { [Op.gte]: today, [Op.lt]: tomorrow }
                },
                attributes: ['items']
            });

            // Count product occurrences from order items
            const productCounts = {};
            for (const order of todayOrders2) {
                const items = order.items || [];
                for (const item of items) {
                    const name = item.name || item.product_name || 'Unknown';
                    const qty = item.quantity || 1;
                    productCounts[name] = (productCounts[name] || 0) + qty;
                }
            }

            // Find the most sold product
            let maxCount = 0;
            for (const [name, count] of Object.entries(productCounts)) {
                if (count > maxCount) {
                    maxCount = count;
                    topSellingProduct = { name, count };
                }
            }
        } catch (e) {
            console.error('[E-Commerce Stats] Top selling error:', e.message);
        }

        // Count total products
        const totalProducts = await EcommerceProduct.count({
            where: {
                storeId: { [Op.in]: storeIds }
            }
        });

        // Calculate today's revenue (using externalCreatedAt)
        const todayRevenueResult = await EcommerceOrder.sum('totalPrice', {
            where: {
                storeId: { [Op.in]: storeIds },
                externalCreatedAt: { [Op.gte]: today, [Op.lt]: tomorrow }
            }
        });
        const todayRevenue = todayRevenueResult || 0;

        res.json({
            todayOrders,
            topSellingProduct,
            totalProducts,
            todayRevenue
        });

    } catch (err) {
        console.error('[E-Commerce] Stats error:', err.message);
        console.error('[E-Commerce] Stats stack:', err.stack);
        res.status(500).json({ error: 'Failed to get stats', details: err.message });
    }
});



// ============= PRODUCTS =============

// Get all products
router.get('/products', authMiddleware, async (req, res) => {
    try {
        const { storeId, search, status, limit = 50, offset = 0 } = req.query;

        const where = {};
        const storeWhere = { userId: req.user.id };

        if (storeId) where.storeId = storeId;
        if (status) where.status = status;
        if (search) {
            where[Op.or] = [
                { name: { [Op.iLike]: `%${search}%` } },
                { sku: { [Op.iLike]: `%${search}%` } },
                { externalId: { [Op.iLike]: `%${search}%` } },
                { category: { [Op.iLike]: `%${search}%` } }
            ];
        }

        console.log(`[E-Commerce] GET /products - Limit: ${limit}, Offset: ${offset}, Search: ${search || 'none'}`);

        const products = await EcommerceProduct.findAndCountAll({
            where,
            include: [{
                model: EcommerceStore,
                as: 'store',
                where: storeWhere,
                attributes: ['id', 'platform', 'storeName']
            }],
            limit: parseInt(limit),
            offset: parseInt(offset),
            order: [['createdAt', 'DESC']]
        });

        console.log(`[E-Commerce] Found ${products.count} products. Returning ${products.rows.length} rows.`);

        res.json({
            products: products.rows,
            total: products.count,
            limit: parseInt(limit),
            offset: parseInt(offset)
        });

    } catch (err) {
        console.error('[E-Commerce] Error getting products:', err.message);
        res.status(500).json({ error: 'Failed to get products' });
    }
});

// Get single product
router.get('/products/:productId', authMiddleware, async (req, res) => {
    try {
        const product = await EcommerceProduct.findByPk(req.params.productId, {
            include: [{
                model: EcommerceStore,
                as: 'store',
                where: { userId: req.user.id },
                attributes: ['id', 'platform', 'storeName', 'storeUrl']
            }]
        });

        if (!product) {
            return res.status(404).json({ error: 'Product not found' });
        }

        res.json({ product });

    } catch (err) {
        console.error('[E-Commerce] Error getting product:', err.message);
        res.status(500).json({ error: 'Failed to get product' });
    }
});

// ============= ORDERS =============

// Get all orders
router.get('/orders', authMiddleware, async (req, res) => {
    try {
        const { storeId, status, search, limit = 50, offset = 0, today } = req.query;

        const where = {};
        const storeWhere = { userId: req.user.id };

        if (storeId) where.storeId = storeId;
        if (status && status !== 'all') where.status = status;
        if (search) {
            where[Op.or] = [
                { customerName: { [Op.iLike]: `%${search}%` } },
                { customerEmail: { [Op.iLike]: `%${search}%` } },
                { customerPhone: { [Op.iLike]: `%${search}%` } },
                { orderNumber: { [Op.iLike]: `%${search}%` } }
            ];
        }

        // Filter for today's orders only
        if (today === 'true') {
            const todayStart = new Date();
            todayStart.setHours(0, 0, 0, 0);
            const todayEnd = new Date(todayStart);
            todayEnd.setDate(todayEnd.getDate() + 1);
            where.externalCreatedAt = { [Op.gte]: todayStart, [Op.lt]: todayEnd };
        }

        const orders = await EcommerceOrder.findAndCountAll({
            where,
            include: [{
                model: EcommerceStore,
                as: 'store',
                where: storeWhere,
                attributes: ['id', 'platform', 'storeName']
            }],
            limit: parseInt(limit),
            offset: parseInt(offset),
            order: [['externalCreatedAt', 'DESC']]
        });

        res.json({
            orders: orders.rows,
            total: orders.count,
            limit: parseInt(limit),
            offset: parseInt(offset)
        });

    } catch (err) {
        console.error('[E-Commerce] Error getting orders:', err.message);
        res.status(500).json({ error: 'Failed to get orders' });
    }
});

// Get single order
router.get('/orders/:orderId', authMiddleware, async (req, res) => {
    try {
        const order = await EcommerceOrder.findByPk(req.params.orderId, {
            include: [{
                model: EcommerceStore,
                as: 'store',
                where: { userId: req.user.id },
                attributes: ['id', 'platform', 'storeName', 'storeUrl']
            }]
        });

        if (!order) {
            return res.status(404).json({ error: 'Order not found' });
        }

        res.json({ order });

    } catch (err) {
        console.error('[E-Commerce] Error getting order:', err.message);
        res.status(500).json({ error: 'Failed to get order' });
    }
});

// Link order to Facebook customer
router.post('/orders/:orderId/link-customer', authMiddleware, async (req, res) => {
    try {
        const { facebookPsid } = req.body;
        const { orderId } = req.params;

        const order = await EcommerceOrder.findByPk(orderId, {
            include: [{
                model: EcommerceStore,
                as: 'store',
                where: { userId: req.user.id }
            }]
        });

        if (!order) {
            return res.status(404).json({ error: 'Order not found' });
        }

        await order.update({ facebookPsid });

        console.log(`[E-Commerce] Order ${orderId} linked to FB customer ${facebookPsid}`);
        res.json({ success: true, order });

    } catch (err) {
        console.error('[E-Commerce] Error linking customer:', err.message);
        res.status(500).json({ error: 'Failed to link customer' });
    }
});

// Get orders for a Facebook customer (by PSID)
router.get('/orders/customer/:psid', authMiddleware, async (req, res) => {
    try {
        const { psid } = req.params;

        const orders = await EcommerceOrder.findAll({
            where: { facebookPsid: psid },
            include: [{
                model: EcommerceStore,
                as: 'store',
                where: { userId: req.user.id },
                attributes: ['id', 'platform', 'storeName']
            }],
            order: [['createdAt', 'DESC']]
        });

        res.json({ orders });

    } catch (err) {
        console.error('[E-Commerce] Error getting customer orders:', err.message);
        res.status(500).json({ error: 'Failed to get orders' });
    }
});

// ============= CUSTOMERS =============

// Get aggregated customers from orders
router.get('/customers', authMiddleware, async (req, res) => {
    try {
        const { search, limit = 50, offset = 0 } = req.query;
        const userId = req.user.id;

        // Get all store IDs for this user
        const userStores = await EcommerceStore.findAll({
            where: { userId },
            attributes: ['id']
        });
        const storeIds = userStores.map(s => s.id);

        if (storeIds.length === 0) {
            return res.json({ customers: [], total: 0 });
        }

        // Build where clause
        const where = { storeId: { [Op.in]: storeIds } };

        // Add search filter
        if (search) {
            where[Op.or] = [
                { customerName: { [Op.iLike]: `%${search}%` } },
                { customerEmail: { [Op.iLike]: `%${search}%` } },
                { customerPhone: { [Op.iLike]: `%${search}%` } }
            ];
        }

        // Get all orders for aggregation
        const orders = await EcommerceOrder.findAll({
            where,
            attributes: ['customerName', 'customerEmail', 'customerPhone', 'totalPrice', 'externalCreatedAt', 'status'],
            order: [['externalCreatedAt', 'DESC']]
        });

        // Aggregate customers by email, phone, or name
        const customerMap = new Map();

        for (const order of orders) {
            // Use email as primary identifier, fallback to phone, then name
            const identifier = order.customerEmail || order.customerPhone || order.customerName || 'unknown';
            if (identifier === 'unknown') continue;

            if (!customerMap.has(identifier)) {
                customerMap.set(identifier, {
                    id: identifier,
                    name: order.customerName || 'عميل',
                    email: order.customerEmail,
                    phone: order.customerPhone,
                    totalOrders: 0,
                    totalSpent: 0,
                    lastOrderDate: order.externalCreatedAt,
                    orders: []
                });
            }

            const customer = customerMap.get(identifier);
            customer.totalOrders++;
            customer.totalSpent += parseFloat(order.totalPrice) || 0;
            if (order.externalCreatedAt > customer.lastOrderDate) {
                customer.lastOrderDate = order.externalCreatedAt;
            }
        }

        // Convert to array and sort by last order date (newest first)
        let customers = Array.from(customerMap.values());
        customers.sort((a, b) => new Date(b.lastOrderDate) - new Date(a.lastOrderDate));

        // Apply pagination
        const total = customers.length;
        customers = customers.slice(parseInt(offset), parseInt(offset) + parseInt(limit));

        res.json({
            customers,
            total,
            limit: parseInt(limit),
            offset: parseInt(offset)
        });

    } catch (err) {
        console.error('[E-Commerce] Error getting customers:', err.message);
        res.status(500).json({ error: 'Failed to get customers' });
    }
});

// Get customer orders by identifier (email, phone, or name)
router.get('/customers/:identifier/orders', authMiddleware, async (req, res) => {
    try {
        const { identifier } = req.params;
        const decodedIdentifier = decodeURIComponent(identifier);
        const userId = req.user.id;

        // Get all store IDs for this user
        const userStores = await EcommerceStore.findAll({
            where: { userId },
            attributes: ['id']
        });
        const storeIds = userStores.map(s => s.id);

        if (storeIds.length === 0) {
            return res.json({ orders: [], customer: null });
        }

        // Find orders by email, phone, or name
        const orders = await EcommerceOrder.findAll({
            where: {
                storeId: { [Op.in]: storeIds },
                [Op.or]: [
                    { customerEmail: decodedIdentifier },
                    { customerPhone: decodedIdentifier },
                    { customerName: decodedIdentifier }
                ]
            },
            include: [{
                model: EcommerceStore,
                as: 'store',
                attributes: ['id', 'platform', 'storeName']
            }],
            order: [['externalCreatedAt', 'DESC']]
        });

        if (orders.length === 0) {
            return res.status(404).json({ error: 'Customer not found' });
        }

        // Build customer info from first order
        const firstOrder = orders[0];
        const shippingAddr = firstOrder.shippingAddress || {};
        const customer = {
            id: identifier,
            name: firstOrder.customerName || 'عميل',
            email: firstOrder.customerEmail || shippingAddr.email,
            phone: firstOrder.customerPhone || shippingAddr.phone,
            address: shippingAddr.address_1 || shippingAddr.address1,
            city: shippingAddr.city,
            state: shippingAddr.state,
            country: shippingAddr.country,
            totalOrders: orders.length,
            totalSpent: orders.reduce((sum, o) => sum + (parseFloat(o.totalPrice) || 0), 0)
        };

        res.json({ customer, orders });

    } catch (err) {
        console.error('[E-Commerce] Error getting customer orders:', err.message);
        res.status(500).json({ error: 'Failed to get customer orders' });
    }
});

// ============= STATISTICS =============

// Get e-commerce dashboard stats
router.get('/stats', authMiddleware, async (req, res) => {
    try {
        const today = new Date();
        today.setHours(0, 0, 0, 0);

        const storeIds = await EcommerceStore.findAll({
            where: { userId: req.user.id },
            attributes: ['id']
        }).then(stores => stores.map(s => s.id));

        if (storeIds.length === 0) {
            return res.json({
                todayOrders: 0,
                totalProducts: 0,
                pendingOrders: 0,
                todayRevenue: 0
            });
        }

        const [todayOrders, totalProducts, pendingOrders, todayRevenue] = await Promise.all([
            EcommerceOrder.count({
                where: {
                    storeId: { [Op.in]: storeIds },
                    createdAt: { [Op.gte]: today }
                }
            }),
            EcommerceProduct.count({
                where: { storeId: { [Op.in]: storeIds } }
            }),
            EcommerceOrder.count({
                where: {
                    storeId: { [Op.in]: storeIds },
                    status: 'pending'
                }
            }),
            EcommerceOrder.sum('totalPrice', {
                where: {
                    storeId: { [Op.in]: storeIds },
                    createdAt: { [Op.gte]: today }
                }
            })
        ]);

        res.json({
            todayOrders: todayOrders || 0,
            totalProducts: totalProducts || 0,
            pendingOrders: pendingOrders || 0,
            todayRevenue: todayRevenue || 0
        });

    } catch (err) {
        console.error('[E-Commerce] Error getting stats:', err.message);
        res.status(500).json({ error: 'Failed to get stats' });
    }
});

// ============= WEBHOOKS =============

// Shopify webhook handler
router.post('/webhook/shopify/:storeId', async (req, res) => {
    try {
        const { storeId } = req.params;
        const topic = req.headers['x-shopify-topic'];

        console.log(`[E-Commerce Webhook] Shopify ${topic} for store ${storeId}`);

        // TODO: Verify webhook signature
        // TODO: Process different webhook topics (orders/create, products/update, etc.)

        res.status(200).send('OK');

    } catch (err) {
        console.error('[E-Commerce Webhook] Error:', err.message);
        res.status(500).send('Error');
    }
});

// WooCommerce webhook handler
router.post('/webhook/woocommerce/:storeId', async (req, res) => {
    try {
        const { storeId } = req.params;
        const topic = req.headers['x-wc-webhook-topic'];

        console.log(`[E-Commerce Webhook] WooCommerce ${topic} for store ${storeId}`);
        res.status(200).send('OK');

    } catch (err) {
        console.error('[E-Commerce Webhook] Error:', err.message);
        res.status(500).send('Error');
    }
});

// Salla webhook handler
router.post('/webhook/salla/:storeId', async (req, res) => {
    try {
        const { storeId } = req.params;
        const event = req.body.event;

        console.log(`[E-Commerce Webhook] Salla ${event} for store ${storeId}`);
        res.status(200).send('OK');

    } catch (err) {
        console.error('[E-Commerce Webhook] Error:', err.message);
        res.status(500).send('Error');
    }
});

// Zid webhook handler
router.post('/webhook/zid/:storeId', async (req, res) => {
    try {
        const { storeId } = req.params;

        console.log(`[E-Commerce Webhook] Zid event for store ${storeId}`);
        res.status(200).send('OK');

    } catch (err) {
        console.error('[E-Commerce Webhook] Error:', err.message);
        res.status(500).send('Error');
    }
});

// ============= AI AD CONTENT GENERATOR =============

const aiService = require('../services/aiService');

// Generate ad content using AI
router.post('/ai/generate', authMiddleware, async (req, res) => {
    try {
        const { productIds, message, newConversation } = req.body;
        const userId = req.user.id;

        if (!message) {
            return res.status(400).json({ error: 'Message is required' });
        }

        // Get products if IDs provided
        let products = [];
        if (productIds && productIds.length > 0) {
            products = await EcommerceProduct.findAll({
                where: {
                    id: { [Op.in]: productIds }
                },
                include: [{
                    model: EcommerceStore,
                    as: 'store',
                    where: { userId },
                    attributes: []
                }],
                attributes: ['id', 'name', 'description', 'price', 'category', 'inventory']
            });
        }

        console.log(`[AI Ad] Generating for user ${userId} with ${products.length} products`);

        const result = await aiService.generateAdContent(userId, products, message, newConversation);

        if (!result.success) {
            return res.status(500).json({ error: result.error });
        }

        res.json({
            success: true,
            content: result.content,
            historyLength: result.historyLength
        });

    } catch (err) {
        console.error('[AI Ad] Error:', err.message);
        res.status(500).json({ error: 'Failed to generate ad content' });
    }
});

// Get quick prompts
router.get('/ai/prompts', authMiddleware, (req, res) => {
    const prompts = aiService.getQuickPrompts();
    res.json({ prompts });
});

// Clear AI conversation history
router.post('/ai/clear', authMiddleware, (req, res) => {
    const userId = req.user.id;
    aiService.clearHistory(userId);
    res.json({ success: true });
});

// Get products for AI selection (simplified list)
router.get('/ai/products', authMiddleware, async (req, res) => {
    try {
        const { storeId, search, limit = 100 } = req.query;

        const where = {};
        const storeWhere = { userId: req.user.id };

        if (storeId) where.storeId = storeId;
        if (search) {
            where.name = { [Op.iLike]: `%${search}%` };
        }

        const products = await EcommerceProduct.findAll({
            where,
            include: [{
                model: EcommerceStore,
                as: 'store',
                where: storeWhere,
                attributes: ['id', 'storeName']
            }],
            attributes: ['id', 'name', 'description', 'price', 'category', 'images'],
            limit: parseInt(limit),
            order: [['name', 'ASC']]
        });

        res.json({ products });

    } catch (err) {
        console.error('[AI Ad] Error getting products:', err.message);
        res.status(500).json({ error: 'Failed to get products' });
    }
});


// ============= EASYORDER WEBHOOK =============
// Receives real-time order notifications from EasyOrder
// This endpoint is PUBLIC (no auth) - EasyOrder sends POST requests here
// Each store has its own unique webhook URL: /webhook/easyorder/:token
router.post('/webhook/easyorder/:token', async (req, res) => {
    try {
        const { token } = req.params;
        const order = req.body;

        console.log(`[EasyOrder Webhook] Received order via token: ${token.substring(0, 8)}...`);

        // Find store by webhook token
        const store = await EcommerceStore.findOne({
            where: {
                webhookToken: token,
                platform: 'easyorder',
                isActive: true
            }
        });

        if (!store) {
            console.error('[EasyOrder Webhook] Invalid webhook token:', token.substring(0, 8));
            return res.status(404).json({ error: 'Invalid webhook token' });
        }

        if (!order || !order.id) {
            console.warn('[EasyOrder Webhook] Invalid payload - no order ID');
            return res.status(400).json({ error: 'Invalid order payload' });
        }

        console.log('[EasyOrder Webhook] Order data:', JSON.stringify(order, null, 2));

        // Map EasyOrder order to our schema
        const mappedOrder = {
            storeId: store.id,
            externalId: String(order.id),
            orderNumber: String(order.id).substring(0, 8),
            customerName: order.full_name || '',
            customerPhone: order.phone || '',
            customerEmail: order.email || null,
            items: (order.cart_items || []).map(item => ({
                productId: item.product_id,
                name: item.product?.name || `Product ${item.product_id}`,
                quantity: item.quantity || 1,
                price: parseFloat(item.price || 0),
                variantId: item.variant_id || null
            })),
            subtotal: parseFloat(order.cost || 0),
            shipping: parseFloat(order.shipping_cost || 0),
            totalPrice: parseFloat(order.total_cost || order.cost || 0),
            currency: 'EGP',
            status: mapEasyOrderStatus(order.status),
            paymentMethod: order.payment_method || 'cod',
            shippingAddress: {
                government: order.government || '',
                address: order.address || '',
                city: order.city || ''
            },
            notes: order.notes || null,
            externalCreatedAt: order.created_at ? new Date(order.created_at) : new Date(),
            syncedAt: new Date()
        };

        // Upsert order (insert or update if exists)
        await EcommerceOrder.upsert(mappedOrder, {
            conflictFields: ['storeId', 'externalId']
        });

        console.log(`[EasyOrder Webhook] ✅ Order ${order.id} saved for store ${store.id} (User: ${store.userId}, Total: ${mappedOrder.totalPrice} EGP)`);

        // Emit real-time update to dashboard
        if (global.io) {
            global.io.emit('ecom-new-order', {
                storeId: store.id,
                userId: store.userId,
                order: mappedOrder
            });
        }

        res.status(200).json({ success: true, message: 'Order received' });

    } catch (err) {
        console.error('[EasyOrder Webhook] Error processing order:', err.message);
        res.status(500).json({ error: 'Failed to process order' });
    }
});

// Get webhook URL for a specific store
router.get('/stores/:storeId/webhook-url', authMiddleware, async (req, res) => {
    try {
        const { storeId } = req.params;

        const store = await EcommerceStore.findOne({
            where: { id: storeId, userId: req.user.id }
        });

        if (!store) {
            return res.status(404).json({ error: 'Store not found' });
        }

        if (store.platform !== 'easyorder') {
            return res.json({ webhookUrl: null, message: 'Webhooks only available for EasyOrder' });
        }

        // Generate token if not exists
        if (!store.webhookToken) {
            store.webhookToken = crypto.randomBytes(16).toString('hex');
            await store.save();
        }

        // Build the webhook URL
        const baseUrl = process.env.BASE_URL || process.env.APP_URL || `${req.protocol}://${req.get('host')}`;
        const webhookUrl = `${baseUrl}/api/ecommerce/webhook/easyorder/${store.webhookToken}`;

        res.json({
            success: true,
            webhookUrl,
            webhookToken: store.webhookToken,
            instructions: {
                ar: 'انسخ هذا الرابط وضعه في إعدادات الـ Webhook في لوحة تحكم EasyOrder. اختر Type: Orders',
                en: 'Copy this URL and paste it in the Webhook settings in your EasyOrder dashboard. Select Type: Orders'
            }
        });

    } catch (err) {
        console.error('[Webhook URL] Error:', err.message);
        res.status(500).json({ error: 'Failed to get webhook URL' });
    }
});

// Map EasyOrder status to our status enum
function mapEasyOrderStatus(status) {
    const statusMap = {
        'pending': 'pending',
        'confirmed': 'processing',
        'processing': 'processing',
        'shipped': 'shipped',
        'delivered': 'delivered',
        'completed': 'completed',
        'cancelled': 'cancelled',
        'returned': 'refunded'
    };
    return statusMap[status?.toLowerCase()] || 'pending';
}

module.exports = router;
