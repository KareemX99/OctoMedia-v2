// Check customer data for aggregation
const { EcommerceOrder } = require('./models');
const { Op } = require('sequelize');

(async () => {
    try {
        // Get latest orders with phone info
        const latestOrders = await EcommerceOrder.findAll({
            attributes: ['externalCreatedAt', 'customerName', 'customerEmail', 'customerPhone'],
            order: [['externalCreatedAt', 'DESC']],
            limit: 15
        });

        console.log('=== Latest 15 Orders (with Phone) ===');
        latestOrders.forEach((o, i) => {
            const date = new Date(o.externalCreatedAt).toLocaleDateString('en-GB');
            console.log(`${i + 1}. ${o.customerName} | Email: ${o.customerEmail || 'NULL'} | Phone: ${o.customerPhone || 'NULL'} | ${date}`);
        });

        // Check unique customers from today
        const today = new Date();
        today.setHours(0, 0, 0, 0);

        const todayOrders = await EcommerceOrder.findAll({
            where: { externalCreatedAt: { [Op.gte]: today } },
            attributes: ['customerName', 'customerEmail', 'customerPhone', 'externalCreatedAt']
        });

        console.log('\n=== Today\'s Customers ===');
        const customerMap = new Map();
        for (const o of todayOrders) {
            const identifier = o.customerEmail || o.customerPhone || 'unknown';
            if (identifier !== 'unknown') {
                customerMap.set(identifier, {
                    name: o.customerName,
                    lastOrder: o.externalCreatedAt
                });
            }
        }

        console.log(`Unique customers today: ${customerMap.size}`);
        customerMap.forEach((v, k) => {
            console.log(`- ${v.name} (${k}) - Last: ${new Date(v.lastOrder).toLocaleString('en-GB')}`);
        });

        process.exit(0);
    } catch (err) {
        console.error('Error:', err.message);
        process.exit(1);
    }
})();
