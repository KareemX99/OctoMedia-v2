// Check all EasyOrder stores in database
const { Sequelize } = require('sequelize');

const sequelize = new Sequelize('octobot_social_saas', 'postgres', 'Eng.OctoBot-DK-Kareem-DODGE.12', {
    host: '178.63.34.211',
    port: 10034,
    dialect: 'postgres',
    logging: false
});

async function checkStores() {
    try {
        const [stores] = await sequelize.query(`
            SELECT id, platform, "storeName", "storeUrl", 
                   SUBSTRING("apiKey" FROM 1 FOR 8) as "apiKeyPrefix",
                   "lastSync", "syncStatus"
            FROM ecommerce_stores 
            WHERE platform = 'easyorder'
            ORDER BY id DESC
        `);

        console.log('=== EasyOrder Stores ===\n');
        stores.forEach(s => {
            console.log(`ID: ${s.id}`);
            console.log(`Name: ${s.storeName}`);
            console.log(`URL: ${s.storeUrl}`);
            console.log(`API Key: ${s.apiKeyPrefix}...`);
            console.log(`Last Sync: ${s.lastSync}`);
            console.log(`Status: ${s.syncStatus}`);
            console.log('---');
        });

    } catch (err) {
        console.error('Error:', err.message);
    } finally {
        await sequelize.close();
    }
}

checkStores();
