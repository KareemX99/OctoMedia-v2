// Quick script to check EasyOrder product images in database
const { Sequelize } = require('sequelize');

// Use same config as the app (from config/database.js)
const sequelize = new Sequelize('octobot_social_saas', 'postgres', 'Eng.OctoBot-DK-Kareem-DODGE.12', {
    host: '178.63.34.211',
    port: 10034,
    dialect: 'postgres',
    logging: false
});

async function checkImages() {
    try {
        await sequelize.authenticate();
        console.log('Connected to database');

        // Query products from store 7 (EasyOrder)
        const [results] = await sequelize.query(`
            SELECT id, name, images 
            FROM ecommerce_products 
            WHERE "storeId" = 7 
            LIMIT 5
        `);

        console.log('\n=== EasyOrder Products (Store 7) ===\n');
        results.forEach((p, i) => {
            console.log(`${i + 1}. ${p.name}`);
            console.log(`   Images: ${JSON.stringify(p.images)}`);
            console.log('');
        });

        // Count total
        const [countResult] = await sequelize.query(`
            SELECT COUNT(*) as total,
                   COUNT(CASE WHEN images IS NOT NULL AND images::text != '[]' THEN 1 END) as with_images
            FROM ecommerce_products 
            WHERE "storeId" = 7
        `);
        console.log('Summary:', countResult[0]);

    } catch (err) {
        console.error('Error:', err.message);
    } finally {
        await sequelize.close();
    }
}

checkImages();
