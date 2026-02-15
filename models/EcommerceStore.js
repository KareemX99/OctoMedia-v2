// E-Commerce Store Model
const { DataTypes } = require('sequelize');

module.exports = (sequelize) => {
    const EcommerceStore = sequelize.define('EcommerceStore', {
        id: {
            type: DataTypes.INTEGER,
            primaryKey: true,
            autoIncrement: true
        },
        userId: {
            type: DataTypes.UUID,
            allowNull: false,
            references: {
                model: 'users',
                key: 'id'
            }
        },
        platform: {
            type: DataTypes.ENUM('shopify', 'woocommerce', 'salla', 'zid', 'easyorder', 'custom'),
            allowNull: false
        },
        storeName: {
            type: DataTypes.STRING,
            allowNull: true
        },
        storeUrl: {
            type: DataTypes.STRING,
            allowNull: false
        },
        // Encrypted credentials
        apiKey: {
            type: DataTypes.TEXT,
            allowNull: true
        },
        apiSecret: {
            type: DataTypes.TEXT,
            allowNull: true
        },
        accessToken: {
            type: DataTypes.TEXT,
            allowNull: true
        },
        // Additional config as JSON
        config: {
            type: DataTypes.JSON,
            defaultValue: {}
        },
        isActive: {
            type: DataTypes.BOOLEAN,
            defaultValue: true
        },
        lastSync: {
            type: DataTypes.DATE,
            allowNull: true
        },
        syncStatus: {
            type: DataTypes.ENUM('idle', 'syncing', 'error'),
            defaultValue: 'idle'
        },
        webhookSecret: {
            type: DataTypes.STRING,
            allowNull: true
        },
        webhookToken: {
            type: DataTypes.STRING,
            allowNull: true,
            unique: true,
            comment: 'Unique token for webhook URL per store'
        }
    }, {
        tableName: 'ecommerce_stores',
        timestamps: true
    });

    return EcommerceStore;
};
