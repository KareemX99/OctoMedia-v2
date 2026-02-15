// Models Index - Export all models with associations
const { sequelize } = require('../config/database');
const User = require('./User');
const Platform = require('./Platform');
const Conversation = require('./Conversation');
const Message = require('./Message');
const Campaign = require('./Campaign')(sequelize);
const TeamActivity = require('./TeamActivity')(sequelize);
const TeamMessage = require('./TeamMessage')(sequelize);
// E-Commerce Models
const EcommerceStore = require('./EcommerceStore')(sequelize);
const EcommerceProduct = require('./EcommerceProduct')(sequelize);
const EcommerceOrder = require('./EcommerceOrder')(sequelize);
const DailyStats = require('./DailyStats')(sequelize);

// Define associations
User.hasMany(Platform, { foreignKey: 'userId', as: 'platforms' });
Platform.belongsTo(User, { foreignKey: 'userId', as: 'user' });

Platform.hasMany(Conversation, { foreignKey: 'platformId', as: 'conversations' });
Conversation.belongsTo(Platform, { foreignKey: 'platformId', as: 'connectedPlatform' });

Conversation.hasMany(Message, { foreignKey: 'conversationId', as: 'messages' });
Message.belongsTo(Conversation, { foreignKey: 'conversationId', as: 'conversation' });

Conversation.belongsTo(User, { foreignKey: 'assignedToId', as: 'assignedTo' });
Message.belongsTo(User, { foreignKey: 'sentById', as: 'sentBy' });

// E-Commerce Associations
User.hasMany(EcommerceStore, { foreignKey: 'userId', as: 'ecomStores' });
EcommerceStore.belongsTo(User, { foreignKey: 'userId', as: 'user' });

EcommerceStore.hasMany(EcommerceProduct, { foreignKey: 'storeId', as: 'products' });
EcommerceProduct.belongsTo(EcommerceStore, { foreignKey: 'storeId', as: 'store' });

EcommerceStore.hasMany(EcommerceOrder, { foreignKey: 'storeId', as: 'orders' });
EcommerceOrder.belongsTo(EcommerceStore, { foreignKey: 'storeId', as: 'store' });

// Sync all models
async function syncDatabase() {
    try {
        await Promise.all([
            User.sync({ alter: true }),
            Platform.sync({ alter: true }),
            Campaign.sync({ alter: true }), // alter: true to add new columns like imageUrls
            TeamActivity.sync({ alter: true }),
            TeamMessage.sync({ alter: true }),
            Conversation.sync({ alter: true }),
            Message.sync({ alter: true }),
            EcommerceStore.sync({ alter: true }),
            EcommerceProduct.sync({ alter: true }),
            EcommerceOrder.sync({ alter: true }),
            DailyStats.sync({ alter: true })
        ]);

        console.log('✅ All database tables synced!');
        return true;
    } catch (error) {
        console.log('⚠️ Parallel sync failed, trying sequential...');
        try {
            await User.sync({ alter: true });
            await Platform.sync({ alter: true });
            await Campaign.sync({ alter: true }); // alter: true to add new columns like imageUrls
            await TeamActivity.sync({ alter: true });
            await TeamMessage.sync({ alter: true });
            await Conversation.sync({ alter: true });
            await Message.sync({ alter: true });
            await EcommerceStore.sync({ alter: true });
            await EcommerceProduct.sync({ alter: true });
            await EcommerceOrder.sync({ alter: true });
            console.log('✅ All database tables synced (sequential)!');
            return true;
        } catch (seqError) {
            console.error('❌ Error syncing database:', seqError.message);
            return false;
        }
    }
}

module.exports = {
    sequelize,
    User,
    Platform,
    Conversation,
    Message,
    Campaign,
    TeamActivity,
    TeamMessage,
    EcommerceStore,
    EcommerceProduct,
    EcommerceOrder,
    DailyStats,
    syncDatabase
};
