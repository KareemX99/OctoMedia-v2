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
const WhatsAppSession = require('./WhatsAppSession')(sequelize);

// Define associations
User.hasMany(Platform, { foreignKey: 'userId', as: 'platforms' });
Platform.belongsTo(User, { foreignKey: 'userId', as: 'user' });

// WhatsApp Session Associations
User.hasOne(WhatsAppSession, { foreignKey: 'userId', as: 'waSession' });
WhatsAppSession.belongsTo(User, { foreignKey: 'userId', as: 'user' });

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

// Sync all models - skip heavy sync since tables already exist
async function syncDatabase() {
    try {
        // Just verify we can query the database
        const [results] = await sequelize.query("SELECT COUNT(*) as cnt FROM pg_tables WHERE schemaname='public'");
        console.log(`✅ Database ready (${results[0].cnt} tables found)`);
        return true;
    } catch (error) {
        console.error('❌ Error verifying database:', error.message);
        return false;
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
    WhatsAppSession,
    syncDatabase
};
