// WhatsApp Session Model - Stores session data in PostgreSQL
const { DataTypes } = require('sequelize');

module.exports = (sequelize) => {
    const WhatsAppSession = sequelize.define('WhatsAppSession', {
        id: {
            type: DataTypes.UUID,
            defaultValue: DataTypes.UUIDV4,
            primaryKey: true
        },
        userId: {
            type: DataTypes.UUID,
            allowNull: false,
            unique: true,
            comment: 'FK to User — one session per user'
        },
        clientId: {
            type: DataTypes.STRING,
            allowNull: false,
            comment: 'Unique identifier for this WA client instance (used by LocalAuth)'
        },
        sessionData: {
            type: DataTypes.JSONB,
            allowNull: true,
            defaultValue: null,
            comment: 'Serialized session credentials from whatsapp-web.js'
        },
        isActive: {
            type: DataTypes.BOOLEAN,
            defaultValue: true,
            comment: 'Whether to auto-reconnect this session on server startup'
        },
        phoneNumber: {
            type: DataTypes.STRING,
            allowNull: true,
            comment: 'The connected WhatsApp phone number'
        },
        lastConnected: {
            type: DataTypes.DATE,
            allowNull: true,
            comment: 'Timestamp of last successful connection'
        },
        disconnectReason: {
            type: DataTypes.STRING,
            allowNull: true,
            comment: 'Reason for last disconnection (if any)'
        }
    }, {
        tableName: 'WhatsAppSessions',
        timestamps: true,
        indexes: [
            { unique: true, fields: ['userId'] },
            { fields: ['isActive'] },
            { fields: ['clientId'] }
        ]
    });

    return WhatsAppSession;
};
