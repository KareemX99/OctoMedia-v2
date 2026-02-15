// Check ALL order fields including meta_data
const { EcommerceStore } = require('./models');
const WooCommerceRestApi = require("@woocommerce/woocommerce-rest-api").default;
const crypto = require('crypto');

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

(async () => {
    try {
        const store = await EcommerceStore.findOne();
        const apiKey = decryptCredential(store.apiKey);
        const apiSecret = decryptCredential(store.apiSecret);

        const api = new WooCommerceRestApi({
            url: store.storeUrl, consumerKey: apiKey, consumerSecret: apiSecret,
            version: 'wc/v3', queryStringAuth: true
        });

        const response = await api.get('orders', { per_page: 1, orderby: 'date', order: 'desc' });
        const order = response.data[0];

        console.log('=== FULL ORDER DATA ===');
        console.log('Order ID:', order.id);

        console.log('\n--- BILLING ---');
        console.log(JSON.stringify(order.billing, null, 2));

        console.log('\n--- SHIPPING ---');
        console.log(JSON.stringify(order.shipping, null, 2));

        console.log('\n--- META DATA (Custom Fields) ---');
        if (order.meta_data && order.meta_data.length > 0) {
            order.meta_data.forEach(m => {
                console.log(`${m.key}: ${m.value}`);
            });
        } else {
            console.log('No meta_data found');
        }

        console.log('\n--- CUSTOMER NOTE ---');
        console.log(order.customer_note || 'No note');

        process.exit(0);
    } catch (err) {
        console.error('Error:', err.message);
        process.exit(1);
    }
})();
