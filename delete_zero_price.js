const { EcommerceProduct } = require('./models');
const { Op } = require('sequelize');

(async () => {
    try {
        console.log('Deleting products with price 0...');
        const deleted = await EcommerceProduct.destroy({
            where: {
                [Op.or]: [
                    { price: 0 },
                    { price: null }
                ]
            }
        });
        console.log(`✅ Deleted ${deleted} products with price 0 or null!`);
        process.exit(0);
    } catch (e) {
        console.error('❌ Error:', e.message);
        process.exit(1);
    }
})();
