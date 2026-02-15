// Check ALL fields in an order - including meta_data
const { EcommerceOrder } = require('./models');

(async () => {
    try {
        // Get order with email (old one) to compare
        const { Op } = require('sequelize');

        const oldOrder = await EcommerceOrder.findOne({
            where: { customerEmail: { [Op.ne]: null } },
            order: [['externalCreatedAt', 'DESC']]
        });

        const newOrder = await EcommerceOrder.findOne({
            where: { customerEmail: null },
            order: [['externalCreatedAt', 'DESC']]
        });

        console.log('=== OLD Order (HAS email) ===');
        if (oldOrder) {
            console.log('Date:', new Date(oldOrder.externalCreatedAt).toLocaleDateString('en-GB'));
            console.log('Customer Name:', oldOrder.customerName);
            console.log('Customer Email:', oldOrder.customerEmail);
            console.log('Customer Phone:', oldOrder.customerPhone);
            console.log('Shipping Address:', JSON.stringify(oldOrder.shippingAddress, null, 2));
        }

        console.log('\n=== NEW Order (NO email) ===');
        if (newOrder) {
            console.log('Date:', new Date(newOrder.externalCreatedAt).toLocaleDateString('en-GB'));
            console.log('Customer Name:', newOrder.customerName);
            console.log('Customer Email:', newOrder.customerEmail);
            console.log('Customer Phone:', newOrder.customerPhone);
            console.log('Shipping Address:', JSON.stringify(newOrder.shippingAddress, null, 2));

            // Check all raw fields
            console.log('\n--- All Order Fields ---');
            const rawData = newOrder.toJSON();
            Object.keys(rawData).forEach(key => {
                if (rawData[key] !== null && rawData[key] !== undefined) {
                    const value = typeof rawData[key] === 'object' ? JSON.stringify(rawData[key]).slice(0, 100) : rawData[key];
                    console.log(`${key}: ${value}`);
                }
            });
        }

        process.exit(0);
    } catch (err) {
        console.error('Error:', err.message);
        process.exit(1);
    }
})();
