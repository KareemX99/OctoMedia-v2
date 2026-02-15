// Conversation Model
const { DataTypes } = require('sequelize');
const { sequelize } = require('../config/database');

const Conversation = sequelize.define('Conversation', {
    id: {
        type: DataTypes.UUID,
        defaultValue: DataTypes.UUIDV4,
        primaryKey: true
    },
    externalId: {
        type: DataTypes.STRING, // Conversation ID from platform
        allowNull: false
    },
    platformType: {
        type: DataTypes.ENUM('facebook', 'instagram', 'whatsapp'),
        allowNull: false
    },
    participantId: {
        type: DataTypes.STRING,
        allowNull: false
    },
    participantName: {
        type: DataTypes.STRING,
        allowNull: true
    },
    lastMessageAt: {
        type: DataTypes.DATE,
        allowNull: true
    },
    lastMessageSnippet: {
        type: DataTypes.TEXT,
        allowNull: true
    },
    unreadCount: {
        type: DataTypes.INTEGER,
        defaultValue: 0
    },
    assignedToId: {
        type: DataTypes.UUID, // Agent assigned to this conversation
        allowNull: true
    },
    platformId: {
        type: DataTypes.UUID,
        allowNull: false
    },
    tenantId: {
        type: DataTypes.UUID,
        allowNull: true
    }
}, {
    tableName: 'conversations',
    timestamps: true
});

module.exports = Conversation;
