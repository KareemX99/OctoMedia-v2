// Message Model
const { DataTypes } = require('sequelize');
const { sequelize } = require('../config/database');

const Message = sequelize.define('Message', {
    id: {
        type: DataTypes.UUID,
        defaultValue: DataTypes.UUIDV4,
        primaryKey: true
    },
    externalId: {
        type: DataTypes.STRING, // Message ID from platform
        allowNull: true
    },
    platform: {
        type: DataTypes.ENUM('facebook', 'instagram', 'whatsapp'),
        allowNull: false
    },
    content: {
        type: DataTypes.TEXT,
        allowNull: true
    },
    messageType: {
        type: DataTypes.ENUM('text', 'image', 'video', 'audio', 'file'),
        defaultValue: 'text'
    },
    mediaUrl: {
        type: DataTypes.TEXT,
        allowNull: true
    },
    isFromPage: {
        type: DataTypes.BOOLEAN,
        defaultValue: false // true = sent by page/agent, false = from customer
    },
    sentAt: {
        type: DataTypes.DATE,
        allowNull: true
    },
    sentById: {
        type: DataTypes.UUID, // Agent who sent this message (if from page)
        allowNull: true
    },
    conversationId: {
        type: DataTypes.UUID,
        allowNull: false
    },
    tenantId: {
        type: DataTypes.UUID,
        allowNull: true
    }
}, {
    tableName: 'messages',
    timestamps: true
});

module.exports = Message;
