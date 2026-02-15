// Fetch FRESH order from WooCommerce API (not from database)
const { EcommerceStore } = require('./models');
const WooCommerceRestApi = require("@woocommerce/woocommerce-rest-api").default;

(async () => {
    try {
        // Get first store
        const store = await EcommerceStore.findOne();
        if (!store) {
            console.log('No store found');
            process.exit(1);
        }

        console.log('Store:', store.storeName);
        console.log('API Key:', store.apiKey ? 'Present' : 'Missing');
        console.log('API Secret:', store.apiSecret ? 'Present' : 'Missing');

        // Create WooCommerce API
        const api = new WooCommerceRestApi({
            url: store.storeUrl,
            consumerKey: store.apiKey,
            consumerSecret: store.apiSecret,
            version: 'wc/v3',
            queryStringAuth: true
        });

        // Get latest order directly from WooCommerce
        console.log('\nFetching latest order from WooCommerce...');
        const response = await api.get('orders', { per_page: 1, orderby: 'date', order: 'desc' });
        const order = response.data[0];

        console.log('\n========== RAW WOOCOMMERCE ORDER ==========');
        console.log('Order ID:', order.id);
        console.log('Date:', order.date_created);
        console.log('\n--- BILLING (Customer Contact Info) ---');
        console.log('First Name:', order.billing?.first_name);
        console.log('Last Name:', order.billing?.last_name);
        console.log('Email:', order.billing?.email);
        console.log('Phone:', order.billing?.phone);
        console.log('Address:', order.billing?.address_1);
        console.log('City:', order.billing?.city);
        console.log('State:', order.billing?.state);
        console.log('Country:', order.billing?.country);

        console.log('\n--- SHIPPING ---');
        console.log('First Name:', order.shipping?.first_name);
        console.log('Last Name:', order.shipping?.last_name);
        console.log('Phone:', order.shipping?.phone);
        console.log('Address:', order.shipping?.address_1);

        console.log('\n--- META DATA (Custom Fields) ---');
        if (order.meta_data && order.meta_data.length > 0) {
            order.meta_data.forEach(m => {
                console.log(`${m.key}: ${m.value}`);
            });
        } else {
            console.log('No meta data found');
        }

        process.exit(0);
    } catch (err) {
        console.error('Error:', err.message);
        if (err.response) {
            console.error('Response:', err.response.data);
        }
        process.exit(1);
    }
})();
