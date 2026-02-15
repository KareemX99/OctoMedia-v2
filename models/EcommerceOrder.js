// E-Commerce Order Model
const { DataTypes } = require('sequelize');

module.exports = (sequelize) => {
    const EcommerceOrder = sequelize.define('EcommerceOrder', {
        id: {
            type: DataTypes.INTEGER,
            primaryKey: true,
            autoIncrement: true
        },
        storeId: {
            type: DataTypes.INTEGER,
            allowNull: false,
            references: {
                model: 'ecommerce_stores',
                key: 'id'
            }
        },
        externalId: {
            type: DataTypes.STRING,
            allowNull: false,
            comment: 'Order ID from the external platform'
        },
        orderNumber: {
            type: DataTypes.STRING,
            allowNull: true,
            comment: 'Human-readable order number'
        },
        // Customer Info
        customerName: {
            type: DataTypes.STRING,
            allowNull: true
        },
        customerEmail: {
            type: DataTypes.STRING,
            allowNull: true
        },
        customerPhone: {
            type: DataTypes.STRING,
            allowNull: true
        },
        // Link to Facebook customer
        facebookPsid: {
            type: DataTypes.STRING,
            allowNull: true,
            comment: 'Facebook Page-Scoped ID for customer linking'
        },
        // Order Details
        items: {
            type: DataTypes.JSON,
            defaultValue: [],
            comment: 'Array of order items'
        },
        subtotal: {
            type: DataTypes.DECIMAL(10, 2),
            allowNull: true
        },
        discount: {
            type: DataTypes.DECIMAL(10, 2),
            defaultValue: 0
        },
        shipping: {
            type: DataTypes.DECIMAL(10, 2),
            defaultValue: 0
        },
        tax: {
            type: DataTypes.DECIMAL(10, 2),
            defaultValue: 0
        },
        totalPrice: {
            type: DataTypes.DECIMAL(10, 2),
            allowNull: false
        },
        currency: {
            type: DataTypes.STRING(3),
            defaultValue: 'EGP'
        },
        // Status
        status: {
            type: DataTypes.ENUM('pending', 'processing', 'shipped', 'delivered', 'completed', 'cancelled', 'refunded'),
            defaultValue: 'pending'
        },
        paymentStatus: {
            type: DataTypes.ENUM('pending', 'paid', 'failed', 'refunded'),
            defaultValue: 'pending'
        },
        paymentMethod: {
            type: DataTypes.STRING,
            allowNull: true
        },
        // Shipping
        shippingAddress: {
            type: DataTypes.JSON,
            defaultValue: {},
            comment: 'Full shipping address object'
        },
        shippingMethod: {
            type: DataTypes.STRING,
            allowNull: true
        },
        trackingNumber: {
            type: DataTypes.STRING,
            allowNull: true
        },
        // Notes
        notes: {
            type: DataTypes.TEXT,
            allowNull: true
        },
        // Timestamps from external platform
        externalCreatedAt: {
            type: DataTypes.DATE,
            allowNull: true
        },
        syncedAt: {
            type: DataTypes.DATE,
            defaultValue: DataTypes.NOW
        }
    }, {
        tableName: 'ecommerce_orders',
        timestamps: true,
        indexes: [
            { fields: ['storeId'] },
            { fields: ['externalId'] },
            { fields: ['storeId', 'externalId'], unique: true },
            { fields: ['facebookPsid'] },
            { fields: ['status'] },
            { fields: ['customerEmail'] },
            { fields: ['customerPhone'] },
            { fields: ['externalCreatedAt'] }
        ]
    });

    return EcommerceOrder;
};
