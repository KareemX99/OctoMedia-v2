// Update ALL orders with missing phone - batch processing
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

const BATCH_SIZE = 100; // Process 100 orders at a time
const DELAY_MS = 500; // Delay between API calls to avoid rate limiting

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
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

        // Count total orders without phone
        const totalWithoutPhone = await EcommerceOrder.count({
            where: { storeId: store.id, customerPhone: null }
        });

        console.log('===========================================');
        console.log('  تحديث أرقام الموبايل للأوردرات القديمة');
        console.log('===========================================\n');
        console.log(`📊 إجمالي الأوردرات بدون رقم: ${totalWithoutPhone}`);
        console.log(`📦 حجم الدفعة: ${BATCH_SIZE} أوردر`);
        console.log(`⏱️  التأخير بين الطلبات: ${DELAY_MS}ms\n`);

        let processed = 0;
        let updated = 0;
        let failed = 0;
        let noPhone = 0;

        while (true) {
            // Get batch of orders without phone
            const orders = await EcommerceOrder.findAll({
                where: {
                    storeId: store.id,
                    customerPhone: null
                },
                order: [['externalCreatedAt', 'DESC']],
                limit: BATCH_SIZE
            });

            if (orders.length === 0) {
                console.log('\n✅ تم تحديث جميع الأوردرات!');
                break;
            }

            console.log(`\n📥 جاري معالجة دفعة من ${orders.length} أوردر...`);

            for (const order of orders) {
                try {
                    // Fetch from WooCommerce
                    const response = await api.get(`orders/${order.externalId}`);
                    const wooOrder = response.data;

                    const phone = extractPhoneFromMeta(wooOrder.meta_data);

                    if (phone) {
                        await order.update({ customerPhone: phone });
                        updated++;
                        process.stdout.write(`✅`);
                    } else {
                        noPhone++;
                        process.stdout.write(`⚪`);
                    }

                    processed++;

                    // Small delay to avoid rate limiting
                    await sleep(100);

                } catch (err) {
                    failed++;
                    process.stdout.write(`❌`);

                    // If rate limited, wait longer
                    if (err.response?.status === 429) {
                        console.log('\n⚠️ Rate limited! Waiting 30 seconds...');
                        await sleep(30000);
                    }
                }

                // Progress update every 50 orders
                if (processed % 50 === 0) {
                    console.log(`\n📊 التقدم: ${processed}/${totalWithoutPhone} | ✅ ${updated} | ⚪ ${noPhone} | ❌ ${failed}`);
                }
            }

            // Delay between batches
            await sleep(DELAY_MS);
        }

        console.log('\n\n===========================================');
        console.log('            📊 النتيجة النهائية');
        console.log('===========================================');
        console.log(`✅ تم التحديث: ${updated} أوردر`);
        console.log(`⚪ بدون رقم في WooCommerce: ${noPhone} أوردر`);
        console.log(`❌ فشل: ${failed} أوردر`);
        console.log(`📦 إجمالي المعالجة: ${processed} أوردر`);
        console.log('===========================================\n');

        process.exit(0);
    } catch (err) {
        console.error('Error:', err.message);
        process.exit(1);
    }
})();
