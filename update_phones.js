// Force update existing orders with phone from WooCommerce meta_data
const { EcommerceStore, EcommerceOrder } = require('./models');
const WooCommerceRestApi = require("@woocommerce/woocommerce-rest-api").default;
const crypto = require('crypto');
const { Op } = require('sequelize');

const ENCRYPTION_KEY = crypto.scryptSync(process.env.ENCRYPTION_KEY || 'dk-octobot-secret-key', 'salt', 32);

function decryptCredential(encrypted) {
    if (!encrypted) return null;
    try {
        if (encrypted.includes(':')) {
            const [ivHex, encryptedData] = encrypted.split(':');
            const iv = Buffer.from(ivHex, 'hex');
            const decipher = crypto.createDecipheriv('aes-256-cbc', ENCRYPTION_KEY, iv);
            let decrypted = decipher.update(encryptedData, 'hex', 'utf8');
            decrypted += decipher.final('utf8');
            return decrypted;
        }
        return encrypted;
    } catch (e) { return null; }
}

function extractPhoneFromMeta(metaData) {
    if (!metaData || !Array.isArray(metaData)) return null;
    for (const meta of metaData) {
        if (meta.key === '_billing__' || meta.key === '_billing_phone' ||
            meta.key === '_shipping_phone' || meta.key.includes('phone')) {
            if (meta.value && typeof meta.value === 'string' && meta.value.match(/^\d+$/)) {
                return meta.value;
            }
        }
    }
    return null;
}

(async () => {
    try {
        const store = await EcommerceStore.findOne();
        if (!store) {
            console.log('No store found');
            process.exit(1);
        }

        const apiKey = decryptCredential(store.apiKey);
        const apiSecret = decryptCredential(store.apiSecret);

        const api = new WooCommerceRestApi({
            url: store.storeUrl, consumerKey: apiKey, consumerSecret: apiSecret,
            version: 'wc/v3', queryStringAuth: true
        });

        console.log('=== Updating Orders with Phone from Meta Data ===\n');

        // Get orders that need phone update (NULL phone)
        const ordersToUpdate = await EcommerceOrder.findAll({
            where: {
                storeId: store.id,
                customerPhone: null
            },
            order: [['externalCreatedAt', 'DESC']],
            limit: 50 // Process 50 at a time
        });

        console.log(`Found ${ordersToUpdate.length} orders without phone. Fetching from WooCommerce...\n`);

        let updated = 0;

        for (const order of ordersToUpdate) {
            try {
                // Fetch fresh data from WooCommerce
                const response = await api.get(`orders/${order.externalId}`);
                const wooOrder = response.data;

                const phone = extractPhoneFromMeta(wooOrder.meta_data);

                if (phone) {
                    await order.update({ customerPhone: phone });
                    console.log(`✅ Order #${order.orderNumber}: Updated phone to ${phone}`);
                    updated++;
                } else {
                    console.log(`⚪ Order #${order.orderNumber}: No phone in meta_data`);
                }
            } catch (err) {
                console.log(`❌ Order #${order.orderNumber}: Error - ${err.message}`);
            }
        }

        console.log(`\n=== Done! Updated ${updated} orders with phone numbers ===`);
        process.exit(0);
    } catch (err) {
        console.error('Error:', err.message);
        process.exit(1);
    }
})();
