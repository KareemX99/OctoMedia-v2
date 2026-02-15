// Platform Model - Stores connected social media platforms
const { DataTypes } = require('sequelize');
const { sequelize } = require('../config/database');

const Platform = sequelize.define('Platform', {
    id: {
        type: DataTypes.UUID,
        defaultValue: DataTypes.UUIDV4,
        primaryKey: true
    },
    userId: {
        type: DataTypes.UUID,
        allowNull: false,
        references: {
            model: 'users',
            key: 'id'
        }
    },
    type: {
        type: DataTypes.ENUM('instagram', 'facebook', 'whatsapp', 'messenger'),
        allowNull: false
    },
    name: {
        type: DataTypes.STRING,
        allowNull: false
    },
    platformId: {
        type: DataTypes.STRING,
        allowNull: true
    },
    accessToken: {
        type: DataTypes.TEXT,
        allowNull: true
    },
    refreshToken: {
        type: DataTypes.TEXT,
        allowNull: true
    },
    tokenExpiry: {
        type: DataTypes.DATE,
        allowNull: true
    },
    metadata: {
        type: DataTypes.JSON,
        defaultValue: {}
    },
    isActive: {
        type: DataTypes.BOOLEAN,
        defaultValue: true
    }
}, {
    tableName: 'Platforms',
    timestamps: true
});

module.exports = Platform;
