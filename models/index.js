// Models Index - Export all models with associations
const { sequelize } = require('../config/database');
const { Model } = require('sequelize');

// CRITICAL FIX: Prevent ALL Sequelize sync/describe/alter operations on startup.
// The remote DB is slow (~1s per query) and concurrent ALTER TABLEs cause deadlocks.
// Schema is already correct in the database — no need to verify on every boot.
Model.prototype.sync = async function() { return this; };
sequelize.sync = async function() { return sequelize; };
const qi = sequelize.getQueryInterface();
qi.describeTable = async function(tableName) { return null; };
qi.addConstraint = async function() { return; };
qi.removeConstraint = async function() { return; };
qi.changeColumn = async function() { return; };
qi.addColumn = async function() { return; };
qi.addIndex = async function() { return; };
qi.showIndex = async function() { return []; };
qi.createTable = async function() { return; };

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

// Define associations (constraints: false to prevent ALTER TABLE deadlocks on startup)
User.hasMany(Platform, { foreignKey: 'userId', as: 'platforms', constraints: false });
Platform.belongsTo(User, { foreignKey: 'userId', as: 'user', constraints: false });

// WhatsApp Session Associations
User.hasOne(WhatsAppSession, { foreignKey: 'userId', as: 'waSession', constraints: false });
WhatsAppSession.belongsTo(User, { foreignKey: 'userId', as: 'user', constraints: false });

Platform.hasMany(Conversation, { foreignKey: 'platformId', as: 'conversations', constraints: false });
Conversation.belongsTo(Platform, { foreignKey: 'platformId', as: 'connectedPlatform', constraints: false });

Conversation.hasMany(Message, { foreignKey: 'conversationId', as: 'messages', constraints: false });
Message.belongsTo(Conversation, { foreignKey: 'conversationId', as: 'conversation', constraints: false });

Conversation.belongsTo(User, { foreignKey: 'assignedToId', as: 'assignedTo', constraints: false });
Message.belongsTo(User, { foreignKey: 'sentById', as: 'sentBy', constraints: false });

// E-Commerce Associations
User.hasMany(EcommerceStore, { foreignKey: 'userId', as: 'ecomStores', constraints: false });
EcommerceStore.belongsTo(User, { foreignKey: 'userId', as: 'user', constraints: false });

EcommerceStore.hasMany(EcommerceProduct, { foreignKey: 'storeId', as: 'products', constraints: false });
EcommerceProduct.belongsTo(EcommerceStore, { foreignKey: 'storeId', as: 'store', constraints: false });

EcommerceStore.hasMany(EcommerceOrder, { foreignKey: 'storeId', as: 'orders', constraints: false });
EcommerceOrder.belongsTo(EcommerceStore, { foreignKey: 'storeId', as: 'store', constraints: false });

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
