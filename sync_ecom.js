const { sequelize } = require('./config/database');
const User = require('./models/User'); // User model is exported directly
const EcommerceStore = require('./models/EcommerceStore')(sequelize);

async function forceSync() {
    try {
        console.log('Syncing User table...');
        await User.sync({ alter: true });
        console.log('✅ User table synced!');

        console.log('Force syncing EcommerceStore (Recreate)...');
        // Using force true to drop and recreate table ensures type changes are applied
        await EcommerceStore.sync({ force: true });
        console.log('✅ EcommerceStore synced successfully!');
        process.exit(0);
    } catch (error) {
        console.error('❌ Error syncing:', error);
        process.exit(1);
    }
}

forceSync();
