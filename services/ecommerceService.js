// E-Commerce Service - Unified service for all e-commerce platforms
const axios = require('axios');
const crypto = require('crypto');

class EcommerceService {
    constructor() {
        this.platforms = {
            shopify: new ShopifyAdapter(),
            woocommerce: new WooCommerceAdapter(),
            salla: new SallaAdapter(),
            zid: new ZidAdapter(),
            easyorder: new EasyOrderAdapter(),
            custom: new CustomApiAdapter()
        };
    }

    // Get adapter for platform
    getAdapter(platform) {
        return this.platforms[platform];
    }

    // Test connection to store
    async testConnection(platform, credentials) {
        const adapter = this.getAdapter(platform);
        if (!adapter) throw new Error(`Platform ${platform} not supported`);
        return await adapter.testConnection(credentials);
    }

    // Sync products from store
    async syncProducts(store, onPage = null, onTotal = null, after = null) {
        const adapter = this.getAdapter(store.platform);
        if (!adapter) throw new Error(`Platform ${store.platform} not supported`);
        return await adapter.getProducts(store, onPage, onTotal, after);
    }

    // Sync orders from store
    async syncOrders(store, options = {}, onPage = null, onTotal = null, after = null) {
        const adapter = this.getAdapter(store.platform);
        if (!adapter) throw new Error(`Platform ${store.platform} not supported`);
        return await adapter.getOrders(store, options, onPage, onTotal, after);
    }

    // Get single order
    async getOrder(store, orderId) {
        const adapter = this.getAdapter(store.platform);
        if (!adapter) throw new Error(`Platform ${store.platform} not supported`);
        return await adapter.getOrder(store, orderId);
    }

    // Update order status
    async updateOrderStatus(store, orderId, status) {
        const adapter = this.getAdapter(store.platform);
        if (!adapter) throw new Error(`Platform ${store.platform} not supported`);
        return await adapter.updateOrderStatus(store, orderId, status);
    }
}

// ==================== SHOPIFY ADAPTER ====================
class ShopifyAdapter {
    async testConnection(credentials) {
        try {
            const { storeUrl, accessToken } = credentials;
            const url = `https://${storeUrl}/admin/api/2024-01/shop.json`;
            const response = await axios.get(url, {
                headers: { 'X-Shopify-Access-Token': accessToken }
            });
            return { success: true, storeName: response.data.shop.name };
        } catch (error) {
            return { success: false, error: error.response?.data?.errors || error.message };
        }
    }

    async getProducts(store) {
        try {
            const url = `https://${store.storeUrl}/admin/api/2024-01/products.json?limit=250`;
            const response = await axios.get(url, {
                headers: { 'X-Shopify-Access-Token': store.accessToken }
            });

            return response.data.products.map(p => ({
                externalId: String(p.id),
                name: p.title,
                description: p.body_html,
                price: parseFloat(p.variants[0]?.price || 0),
                comparePrice: parseFloat(p.variants[0]?.compare_at_price || 0),
                currency: 'USD',
                images: p.images.map(i => i.src),
                variants: p.variants.map(v => ({
                    id: v.id,
                    title: v.title,
                    price: v.price,
                    sku: v.sku,
                    inventory: v.inventory_quantity
                })),
                inventory: p.variants.reduce((sum, v) => sum + (v.inventory_quantity || 0), 0),
                sku: p.variants[0]?.sku,
                status: p.status === 'active' ? 'active' : 'draft',
                tags: p.tags ? p.tags.split(',').map(t => t.trim()) : []
            }));
        } catch (error) {
            console.error('[Shopify] Error fetching products:', error.message);
            throw error;
        }
    }

    async getOrders(store, options = {}) {
        try {
            const params = new URLSearchParams({
                limit: options.limit || 50,
                status: options.status || 'any'
            });
            if (options.since) params.append('created_at_min', options.since);

            const url = `https://${store.storeUrl}/admin/api/2024-01/orders.json?${params}`;
            const response = await axios.get(url, {
                headers: { 'X-Shopify-Access-Token': store.accessToken }
            });

            return response.data.orders.map(o => this.mapOrder(o));
        } catch (error) {
            console.error('[Shopify] Error fetching orders:', error.message);
            throw error;
        }
    }

    async getOrder(store, orderId) {
        try {
            const url = `https://${store.storeUrl}/admin/api/2024-01/orders/${orderId}.json`;
            const response = await axios.get(url, {
                headers: { 'X-Shopify-Access-Token': store.accessToken }
            });
            return this.mapOrder(response.data.order);
        } catch (error) {
            console.error('[Shopify] Error fetching order:', error.message);
            throw error;
        }
    }

    mapOrder(o) {
        return {
            externalId: String(o.id),
            orderNumber: o.name || o.order_number,
            customerName: o.customer ? `${o.customer.first_name} ${o.customer.last_name}` : '',
            customerEmail: o.email,
            customerPhone: o.phone || o.customer?.phone,
            items: o.line_items.map(i => ({
                id: i.id,
                name: i.name,
                quantity: i.quantity,
                price: i.price
            })),
            subtotal: parseFloat(o.subtotal_price || 0),
            discount: parseFloat(o.total_discounts || 0),
            shipping: parseFloat(o.shipping_lines?.[0]?.price || 0),
            tax: parseFloat(o.total_tax || 0),
            totalPrice: parseFloat(o.total_price || 0),
            currency: o.currency,
            status: this.mapStatus(o.fulfillment_status, o.financial_status),
            paymentStatus: o.financial_status === 'paid' ? 'paid' : 'pending',
            shippingAddress: o.shipping_address || {},
            externalCreatedAt: new Date(o.created_at)
        };
    }

    mapStatus(fulfillment, financial) {
        if (fulfillment === 'fulfilled') return 'completed';
        if (fulfillment === 'partial') return 'processing';
        if (financial === 'refunded') return 'refunded';
        return 'pending';
    }

    async updateOrderStatus(store, orderId, status) {
        // Shopify uses fulfillments for status updates
        // This is a simplified implementation
        console.log(`[Shopify] Update order ${orderId} to ${status}`);
        return { success: true };
    }
}

// ==================== WOOCOMMERCE ADAPTER ====================
// Import official library
const WooCommerceRestApi = require("@woocommerce/woocommerce-rest-api").default;

class WooCommerceAdapter {
    constructor() {
        this.api = null; // Instance will be created per store connection
    }

    // Create API instance helper
    createApi(store) {
        return new WooCommerceRestApi({
            url: store.storeUrl,
            consumerKey: store.apiKey,  // DB field name mapping
            consumerSecret: store.apiSecret,
            version: 'wc/v3',
            queryStringAuth: true // Force query string auth which worked before
        });
    }

    async testConnection(store) {
        try {
            const api = this.createApi(store);
            const response = await api.get("system_status");
            return { success: true, storeName: response.data?.environment?.site_url || store.storeUrl };
        } catch (error) {
            console.error('[WooCommerce] Connection error:', error.response?.data?.message || error.message);
            return { success: false, error: error.response?.data?.message || error.message };
        }
    }

    async getAllPages(endpoint, store, onPage = null, resourceName = 'Items', perPage = 25, onTotal = null, after = null, extraParams = {}) {
        const api = this.createApi(store);
        let items = [];
        let page = 1;
        let totalPages = 1;

        // Build query params
        const params = {
            per_page: perPage,
            page: page,
            ...extraParams
        };
        if (after) {
            params.after = after;
            console.log(`[WooCommerce] Incremental sync: Fetching items after ${after}`);
        }

        do {
            try {
                console.log(`[WooCommerce] Fetching ${resourceName} page ${page}...`);

                // Update page param for next iteration
                params.page = page;

                const response = await api.get(endpoint, params);

                // Check for total items header on first page
                if (page === 1 && onTotal) {
                    const totalItems = response.headers['x-wp-total'];
                    if (totalItems) {
                        onTotal(parseInt(totalItems));
                    }
                }

                if (Array.isArray(response.data)) {
                    items = items.concat(response.data);

                    // Callback for incremental save
                    if (onPage) {
                        await onPage(response.data);
                    }
                }

                const totalPagesHeader = response.headers['x-wp-totalpages'];
                if (totalPagesHeader) {
                    totalPages = parseInt(totalPagesHeader);
                } else if (response.data.length < perPage) {
                    // Less than full page means last page
                    totalPages = page;
                } else {
                    // Fallback if header missing but full page returned: assume more
                    if (page === totalPages) totalPages++;
                }

                page++;
            } catch (error) {
                console.error(`[WooCommerce] Error on page ${page}:`, error.message);
                break;
            }
        } while (page <= totalPages);

        return items;
    }

    async getProducts(store, onPage = null, onTotal = null, after = null) {
        // Wrapper for product mapping - filter out products with price 0
        const mapper = (products) => products
            .filter(p => parseFloat(p.price || 0) > 0) // Skip products with no price
            .map(p => ({
                externalId: String(p.id),
                name: p.name,
                description: p.description,
                price: parseFloat(p.price || 0),
                comparePrice: parseFloat(p.regular_price || 0),
                currency: 'EGP',
                images: p.images ? p.images.map(i => i.src) : [],
                variants: p.variations || [],
                inventory: p.stock_quantity || 0,
                sku: p.sku,
                status: p.status === 'publish' ? 'active' : 'draft',
                category: p.categories?.[0]?.name,
                tags: p.tags?.map(t => t.name) || []
            }));

        try {
            // Use getAllPages with "products" endpoint
            return await this.getAllPages('products', store, async (batch) => {
                if (onPage) await onPage(mapper(batch));
            }, 'Products', 100, onTotal, after);
        } catch (error) {
            console.error('[WooCommerce] Error fetching products:', error.message);
            throw error;
        }
    }

    async getOrders(store, options = {}, onPage = null, onTotal = null, after = null) {
        // Use self to capture context for mapOrders
        const self = this;
        const mapper = (orders) => self.mapOrders(orders);

        try {
            const params = {
                status: options.status || 'any',
                orderby: 'date',
                order: 'desc'
            };

            // If limit is small, simple fetch
            if (options.limit && options.limit <= 100) {
                const api = this.createApi(store);
                const response = await api.get('orders', { ...params, per_page: options.limit });
                const mapped = mapper(response.data);
                if (onPage) await onPage(mapped);
                return mapped;
            }

            // Full sync with pagination - pass orderby and order params
            return await this.getAllPages('orders', store, async (batch) => {
                if (onPage) await onPage(mapper(batch));
            }, 'Orders', 100, onTotal, after, { orderby: 'date', order: 'desc' });

        } catch (error) {
            console.error('[WooCommerce] Error fetching orders:', error.message);
            if (error.response?.status === 404) return [];
            throw error;
        }
    }

    mapOrders(orders) {
        return orders.map(o => {
            // Extract phone from meta_data (for custom checkout plugins)
            let metaPhone = null;
            let metaEmail = null;
            if (o.meta_data && Array.isArray(o.meta_data)) {
                for (const meta of o.meta_data) {
                    // Check for phone in various custom fields
                    if (meta.key === '_billing__' || meta.key === '_billing_phone' ||
                        meta.key === '_shipping_phone' || meta.key.includes('phone')) {
                        if (meta.value && typeof meta.value === 'string' && meta.value.match(/^\d+$/)) {
                            metaPhone = meta.value;
                            break;
                        }
                    }
                }
                // Check for email in meta_data
                for (const meta of o.meta_data) {
                    if (meta.key.includes('email') && meta.value && meta.value.includes('@')) {
                        metaEmail = meta.value;
                        break;
                    }
                }
            }

            return {
                externalId: String(o.id),
                orderNumber: o.number || String(o.id),
                customerName: o.billing ? `${o.billing.first_name} ${o.billing.last_name}` : 'Guest',
                customerEmail: o.billing?.email || o.customer_email || metaEmail,
                customerPhone: o.billing?.phone || o.customer_phone || metaPhone,
                items: o.line_items?.map(i => ({
                    id: i.id,
                    name: i.name,
                    productId: i.product_id,
                    quantity: i.quantity,
                    price: parseFloat(i.price || 0),
                    total: parseFloat(i.total || 0)
                })) || [],
                subtotal: parseFloat(o.total || 0) - parseFloat(o.total_tax || 0) - parseFloat(o.shipping_total || 0),
                discount: parseFloat(o.discount_total || 0),
                shipping: parseFloat(o.shipping_total || 0),
                tax: parseFloat(o.total_tax || 0),
                totalPrice: parseFloat(o.total || 0),
                currency: o.currency,
                status: this.mapStatus(o.status),
                paymentStatus: o.date_paid ? 'paid' : (o.status === 'completed' ? 'paid' : 'pending'),
                shippingAddress: o.shipping || o.billing || {},
                externalCreatedAt: new Date(o.date_created)
            };
        });
    }

    mapStatus(status) {
        const map = {
            'pending': 'pending',
            'processing': 'processing',
            'on-hold': 'pending',
            'completed': 'completed',
            'cancelled': 'cancelled',
            'refunded': 'refunded',
            'failed': 'cancelled'
        };
        return map[status] || 'pending';
    }

    async getOrder(store, orderId) {
        const api = this.createApi(store);
        const response = await api.get(`orders/${orderId}`);
        return response.data;
    }

    async updateOrderStatus(store, orderId, status) {
        const api = this.createApi(store);
        await api.put(`orders/${orderId}`, { status });
        return { success: true };
    }
}

// ==================== SALLA ADAPTER ====================
class SallaAdapter {
    async testConnection(credentials) {
        try {
            const { storeUrl, apiKey } = credentials;
            const response = await axios.get(`${storeUrl}/api/v1/store`, {
                headers: { Authorization: `Bearer ${apiKey}` }
            });
            return { success: true, storeName: response.data.data?.name || storeUrl };
        } catch (error) {
            return { success: false, error: error.response?.data?.message || error.message };
        }
    }

    async getProducts(store) {
        try {
            const response = await axios.get(`${store.storeUrl}/api/v1/products`, {
                headers: { Authorization: `Bearer ${store.accessToken}` }
            });

            return response.data.data.map(p => ({
                externalId: String(p.id),
                name: p.name,
                description: p.description,
                price: parseFloat(p.price?.amount || 0),
                currency: p.price?.currency || 'SAR',
                images: p.images?.map(i => i.url) || [],
                inventory: p.quantity || 0,
                status: p.status === 'active' ? 'active' : 'draft'
            }));
        } catch (error) {
            console.error('[Salla] Error fetching products:', error.message);
            throw error;
        }
    }

    async getOrders(store, options = {}) {
        try {
            const response = await axios.get(`${store.storeUrl}/api/v1/orders`, {
                headers: { Authorization: `Bearer ${store.accessToken}` }
            });

            return response.data.data.map(o => ({
                externalId: String(o.id),
                orderNumber: o.reference_id,
                customerName: o.customer?.name,
                customerEmail: o.customer?.email,
                customerPhone: o.customer?.mobile,
                totalPrice: parseFloat(o.total?.amount || 0),
                currency: o.total?.currency || 'SAR',
                status: o.status,
                externalCreatedAt: new Date(o.created_at)
            }));
        } catch (error) {
            console.error('[Salla] Error fetching orders:', error.message);
            throw error;
        }
    }

    async getOrder(store, orderId) {
        const response = await axios.get(`${store.storeUrl}/api/v1/orders/${orderId}`, {
            headers: { Authorization: `Bearer ${store.accessToken}` }
        });
        return response.data.data;
    }

    async updateOrderStatus(store, orderId, status) {
        await axios.put(`${store.storeUrl}/api/v1/orders/${orderId}`, { status }, {
            headers: { Authorization: `Bearer ${store.accessToken}` }
        });
        return { success: true };
    }
}

// ==================== ZID ADAPTER ====================
class ZidAdapter {
    async testConnection(credentials) {
        try {
            const { apiKey, managerToken } = credentials;
            let token = apiKey;

            // Try with X-Manager-Token (typical for Zid tokens)
            try {
                const response = await axios.get('https://api.zid.sa/v1/managers/account/profile', {
                    headers: { 'X-Manager-Token': token }
                });
                return { success: true, storeName: response.data.user?.name || 'Zid Store', isManagerToken: true };
            } catch (err1) {
                console.log('[Zid] X-Manager-Token failed, trying Bearer... Error:', err1.message);
                // Try with Bearer (if OAuth)
                try {
                    const response = await axios.get('https://api.zid.sa/v1/managers/account/profile', {
                        headers: { 'Authorization': `Bearer ${token}` }
                    });
                    return { success: true, storeName: response.data.user?.name || 'Zid Store', isBearer: true };
                } catch (err2) {
                    console.error('[Zid] Bearer also failed:', err2.response?.data);
                    return { success: false, error: 'فشل الاتصال بمتجر زد. تأكد من صحة التوكين.' };
                }
            }
        } catch (error) {
            console.error('[Zid] Test connection fatal error:', error.message);
            // Even if profile fetch fails, try to return useful error
            return { success: false, error: 'فشل الاتصال بمتجر زد. تأكد من صحة التوكين.' };
        }
    }

    async getProducts(store) {
        try {
            // Unencrypt token (which is stored in apiKey/accessToken field)
            const token = store.apiKey || store.accessToken;

            const response = await axios.get('https://api.zid.sa/v1/products', {
                headers: {
                    'X-Manager-Token': token,
                    'Accept-Language': 'ar'
                }
            });

            return response.data.results?.map(p => ({
                externalId: String(p.id),
                name: p.name.ar || p.name.en || p.name,
                description: p.description?.ar || p.description?.en || '',
                price: parseFloat(p.price || 0),
                currency: 'SAR',
                images: p.images?.map(i => i.image) || [],
                inventory: p.quantity || 0,
                status: 'active' // Zid API might differ on status field
            })) || [];
        } catch (error) {
            console.error('[Zid] Error fetching products:', error.message);
            throw error;
        }
    }

    async getOrders(store, options = {}) {
        try {
            // Unencrypt token
            const token = store.apiKey || store.accessToken;

            const response = await axios.get('https://api.zid.sa/v1/managers/store/orders', {
                headers: {
                    'X-Manager-Token': token,
                    'Accept-Language': 'ar'
                }
            });

            return response.data.orders?.map(o => ({
                externalId: String(o.id),
                orderNumber: o.id, // Zid uses ID as order number usually
                customerName: `${o.customer?.name || ''}`,
                customerPhone: o.customer?.mobile,
                totalPrice: parseFloat(o.order_total || 0),
                status: o.order_status?.code || o.order_status,
                externalCreatedAt: new Date(o.created_at)
            })) || [];
        } catch (error) {
            console.error('[Zid] Error fetching orders:', error.message);
            throw error;
        }
    }

    async getOrder(store, orderId) {
        const token = store.apiKey || store.accessToken;
        const response = await axios.get(`https://api.zid.sa/v1/managers/store/orders/${orderId}`, {
            headers: { 'X-Manager-Token': token }
        });
        return response.data;
    }

    async updateOrderStatus(store, orderId, status) {
        // Zid status update implementation depends on specific status slug
        const token = store.apiKey || store.accessToken;
        await axios.post(`https://api.zid.sa/v1/managers/store/orders/${orderId}/change-order-status`, { order_status: status }, {
            headers: { 'X-Manager-Token': token }
        });
        return { success: true };
    }
}

// ==================== EASYORDER ADAPTER ====================
class EasyOrderAdapter {
    constructor() {
        this.baseUrl = 'https://api.easy-orders.net/api/v1';
    }

    async testConnection(credentials) {
        try {
            const { apiKey, storeUrl } = credentials;

            console.log('[EasyOrder] Testing connection with API key:', apiKey ? apiKey.substring(0, 8) + '...' : 'undefined');
            console.log('[EasyOrder] Calling endpoint:', `${this.baseUrl}/external-apps/products`);

            // Try to get products to verify API key
            const response = await axios.get(`${this.baseUrl}/external-apps/products`, {
                headers: {
                    'Api-Key': apiKey,
                    'Accept': 'application/json',
                    'Content-Type': 'application/json'
                },
                params: {
                    per_page: 1 // Just get 1 product to test connection
                }
            });

            console.log('[EasyOrder] Connection successful, status:', response.status);
            return {
                success: true,
                storeName: 'EasyOrder Store' // EasyOrder might not return store name in products endpoint
            };
        } catch (error) {
            console.error('[EasyOrder] Connection error:', {
                message: error.message,
                status: error.response?.status,
                statusText: error.response?.statusText,
                data: JSON.stringify(error.response?.data),
                url: error.config?.url
            });
            return {
                success: false,
                error: error.response?.data?.message || error.response?.data?.error || error.message || 'فشل الاتصال بمتجر EasyOrder. تأكد من صحة API Key.'
            };
        }
    }

    async getProducts(store, onPage = null, onTotal = null, after = null) {
        try {
            const token = store.apiKey || store.accessToken;
            let allProducts = [];
            let page = 1;
            let hasMore = true;
            const perPage = 50;

            // If after date is provided, use it for incremental sync
            const params = { per_page: perPage };
            if (after) {
                params.updated_after = after;
                console.log(`[EasyOrder] Incremental sync: Fetching products after ${after}`);
            }

            while (hasMore) {
                params.page = page;
                console.log(`[EasyOrder] Fetching products page ${page}...`);

                const response = await axios.get(`${this.baseUrl}/external-apps/products`, {
                    headers: {
                        'Api-Key': token,
                        'Accept': 'application/json'
                    },
                    params
                });

                const products = response.data?.data || response.data?.products || [];
                const total = response.data?.meta?.total || response.data?.total || 0;

                // Report total on first page
                if (page === 1 && onTotal) {
                    onTotal(total);
                }

                if (products.length === 0) {
                    hasMore = false;
                    break;
                }

                // Map products to standard format
                const mappedProducts = products.map(p => ({
                    externalId: String(p.id),
                    name: p.name || p.title || '',
                    description: p.description || p.short_description || '',
                    price: parseFloat(p.price || p.sale_price || 0),
                    comparePrice: parseFloat(p.compare_price || p.regular_price || 0),
                    currency: p.currency || 'EGP',
                    images: this.extractImages(p),
                    variants: this.extractVariants(p),
                    inventory: p.quantity || p.stock_quantity || 0,
                    sku: p.sku || '',
                    status: p.status === 'active' || p.status === 'published' ? 'active' : 'draft',
                    category: p.category?.name || p.categories?.[0]?.name || '',
                    tags: p.tags?.map(t => t.name || t) || []
                }));

                allProducts = allProducts.concat(mappedProducts);

                // Callback for batch save
                if (onPage) {
                    await onPage(mappedProducts);
                }

                // Check if there are more pages
                const lastPage = response.data?.meta?.last_page || Math.ceil(total / perPage);
                hasMore = page < lastPage;
                page++;
            }

            console.log(`[EasyOrder] Total products fetched: ${allProducts.length}`);
            return allProducts;

        } catch (error) {
            console.error('[EasyOrder] Error fetching products:', error.message);
            if (error.response?.status === 401) {
                throw new Error('Invalid API Key - تأكد من صحة API Key');
            }
            throw error;
        }
    }

    extractImages(product) {
        // EasyOrder API uses 'thumb' field for product images
        // Check thumb first since it's the most common field for EasyOrder
        if (product.thumb) {
            return [product.thumb];
        }
        if (product.images && Array.isArray(product.images)) {
            return product.images.map(img => img.url || img.src || img);
        }
        if (product.image) {
            return [product.image.url || product.image.src || product.image];
        }
        if (product.thumbnail) {
            return [product.thumbnail];
        }
        if (product.photo) {
            return [product.photo.url || product.photo.src || product.photo];
        }
        if (product.media && Array.isArray(product.media)) {
            return product.media.map(m => m.url || m.src || m);
        }
        return [];
    }

    extractVariants(product) {
        if (!product.variants || !Array.isArray(product.variants)) return [];
        return product.variants.map(v => ({
            id: v.id,
            title: v.name || v.title || '',
            price: parseFloat(v.price || 0),
            sku: v.sku || '',
            inventory: v.quantity || v.stock_quantity || 0
        }));
    }

    async getOrders(store, options = {}, onPage = null, onTotal = null, after = null) {
        try {
            const token = store.apiKey || store.accessToken;
            let allOrders = [];
            let page = 1;
            let hasMore = true;
            const perPage = 50;

            const params = {
                per_page: perPage,
                order_by: 'created_at',
                order: 'desc'
            };

            // Status filter
            if (options.status && options.status !== 'any') {
                params.status = options.status;
            }

            // Incremental sync
            if (after) {
                params.created_after = after;
                console.log(`[EasyOrder] Incremental sync: Fetching orders after ${after}`);
            }

            while (hasMore) {
                params.page = page;
                console.log(`[EasyOrder] Fetching orders page ${page}...`);

                const response = await axios.get(`${this.baseUrl}/external-apps/orders`, {
                    headers: {
                        'Api-Key': token,
                        'Accept': 'application/json'
                    },
                    params
                });

                const orders = response.data?.data || response.data?.orders || [];
                const total = response.data?.meta?.total || response.data?.total || 0;

                // Report total on first page
                if (page === 1 && onTotal) {
                    onTotal(total);
                }

                if (orders.length === 0) {
                    hasMore = false;
                    break;
                }

                // Map orders to standard format
                const mappedOrders = this.mapOrders(orders);
                allOrders = allOrders.concat(mappedOrders);

                // Callback for batch save
                if (onPage) {
                    await onPage(mappedOrders);
                }

                // Check if there are more pages
                const lastPage = response.data?.meta?.last_page || Math.ceil(total / perPage);
                hasMore = page < lastPage;
                page++;
            }

            console.log(`[EasyOrder] Total orders fetched: ${allOrders.length}`);
            return allOrders;

        } catch (error) {
            console.error('[EasyOrder] Error fetching orders:', error.message);
            if (error.response?.status === 401) {
                throw new Error('Invalid API Key - تأكد من صحة API Key');
            }
            throw error;
        }
    }

    mapOrders(orders) {
        return orders.map(o => ({
            externalId: String(o.id),
            orderNumber: o.order_number || o.reference || String(o.id),
            customerName: o.customer?.name || o.customer_name || `${o.customer?.first_name || ''} ${o.customer?.last_name || ''}`.trim() || 'Guest',
            customerEmail: o.customer?.email || o.customer_email || '',
            customerPhone: o.customer?.phone || o.customer_phone || o.customer?.mobile || '',
            items: this.extractOrderItems(o),
            subtotal: parseFloat(o.subtotal || o.sub_total || 0),
            discount: parseFloat(o.discount || o.discount_total || 0),
            shipping: parseFloat(o.shipping_cost || o.shipping_total || o.delivery_cost || 0),
            tax: parseFloat(o.tax || o.tax_total || 0),
            totalPrice: parseFloat(o.total || o.total_amount || o.grand_total || 0),
            currency: o.currency || 'EGP',
            status: this.mapStatus(o.status),
            paymentStatus: this.mapPaymentStatus(o.payment_status),
            shippingAddress: this.extractAddress(o),
            externalCreatedAt: new Date(o.created_at || o.date)
        }));
    }

    extractOrderItems(order) {
        const items = order.items || order.products || order.line_items || [];
        return items.map(i => ({
            id: i.id || i.product_id,
            name: i.name || i.product_name || i.title || '',
            productId: i.product_id,
            quantity: parseInt(i.quantity || i.qty || 1),
            price: parseFloat(i.price || i.unit_price || 0),
            total: parseFloat(i.total || i.line_total || (i.price * i.quantity) || 0)
        }));
    }

    extractAddress(order) {
        const addr = order.shipping_address || order.address || order.delivery_address || {};
        return {
            first_name: addr.first_name || order.customer?.first_name || '',
            last_name: addr.last_name || order.customer?.last_name || '',
            address_1: addr.address || addr.street || addr.address_1 || '',
            address_2: addr.address_2 || '',
            city: addr.city || '',
            state: addr.state || addr.region || addr.governorate || '',
            postcode: addr.postcode || addr.zip || '',
            country: addr.country || 'EG',
            phone: addr.phone || order.customer?.phone || ''
        };
    }

    mapStatus(status) {
        if (!status) return 'pending';
        const statusLower = status.toLowerCase();
        const map = {
            'pending': 'pending',
            'new': 'pending',
            'processing': 'processing',
            'preparing': 'processing',
            'shipped': 'processing',
            'out_for_delivery': 'processing',
            'delivered': 'completed',
            'completed': 'completed',
            'cancelled': 'cancelled',
            'canceled': 'cancelled',
            'refunded': 'refunded',
            'returned': 'refunded',
            'failed': 'cancelled'
        };
        return map[statusLower] || 'pending';
    }

    mapPaymentStatus(status) {
        if (!status) return 'pending';
        const statusLower = status.toLowerCase();
        if (['paid', 'completed', 'success', 'captured'].includes(statusLower)) return 'paid';
        if (['refunded', 'returned'].includes(statusLower)) return 'refunded';
        return 'pending';
    }

    async getOrder(store, orderId) {
        try {
            const token = store.apiKey || store.accessToken;
            const response = await axios.get(`${this.baseUrl}/orders/${orderId}`, {
                headers: {
                    'Authorization': `Bearer ${token}`,
                    'Accept': 'application/json'
                }
            });

            const order = response.data?.data || response.data?.order || response.data;
            return this.mapOrders([order])[0];
        } catch (error) {
            console.error('[EasyOrder] Error fetching order:', error.message);
            throw error;
        }
    }

    async updateOrderStatus(store, orderId, status) {
        try {
            const token = store.apiKey || store.accessToken;
            await axios.put(`${this.baseUrl}/orders/${orderId}`,
                { status },
                {
                    headers: {
                        'Authorization': `Bearer ${token}`,
                        'Accept': 'application/json',
                        'Content-Type': 'application/json'
                    }
                }
            );
            console.log(`[EasyOrder] Order ${orderId} status updated to ${status}`);
            return { success: true };
        } catch (error) {
            console.error('[EasyOrder] Error updating order status:', error.message);
            return { success: false, error: error.message };
        }
    }
}

// ==================== CUSTOM API ADAPTER ====================
class CustomApiAdapter {
    async testConnection(credentials) {
        try {
            const { storeUrl, apiKey } = credentials;
            const response = await axios.get(`${storeUrl}/test`, {
                headers: { Authorization: `Bearer ${apiKey}` }
            });
            return { success: true, storeName: response.data.name || storeUrl };
        } catch (error) {
            return { success: false, error: error.message };
        }
    }

    async getProducts(store) {
        try {
            const config = store.config || {};
            const productsEndpoint = config.productsEndpoint || '/products';
            const response = await axios.get(`${store.storeUrl}${productsEndpoint}`, {
                headers: { Authorization: `Bearer ${store.accessToken}` }
            });
            return response.data.products || response.data.data || response.data || [];
        } catch (error) {
            console.error('[Custom] Error fetching products:', error.message);
            throw error;
        }
    }

    async getOrders(store, options = {}) {
        try {
            const config = store.config || {};
            const ordersEndpoint = config.ordersEndpoint || '/orders';
            const response = await axios.get(`${store.storeUrl}${ordersEndpoint}`, {
                headers: { Authorization: `Bearer ${store.accessToken}` }
            });
            return response.data.orders || response.data.data || response.data || [];
        } catch (error) {
            console.error('[Custom] Error fetching orders:', error.message);
            throw error;
        }
    }

    async getOrder(store, orderId) {
        const config = store.config || {};
        const ordersEndpoint = config.ordersEndpoint || '/orders';
        const response = await axios.get(`${store.storeUrl}${ordersEndpoint}/${orderId}`, {
            headers: { Authorization: `Bearer ${store.accessToken}` }
        });
        return response.data;
    }

    async updateOrderStatus(store, orderId, status) {
        const config = store.config || {};
        const ordersEndpoint = config.ordersEndpoint || '/orders';
        await axios.put(`${store.storeUrl}${ordersEndpoint}/${orderId}`, { status }, {
            headers: { Authorization: `Bearer ${store.accessToken}` }
        });
        return { success: true };
    }
}

module.exports = new EcommerceService();
