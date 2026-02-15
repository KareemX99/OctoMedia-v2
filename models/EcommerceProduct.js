// E-Commerce Product Model
const { DataTypes } = require('sequelize');

module.exports = (sequelize) => {
    const EcommerceProduct = sequelize.define('EcommerceProduct', {
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
            comment: 'Product ID from the external platform'
        },
        name: {
            type: DataTypes.STRING,
            allowNull: false
        },
        description: {
            type: DataTypes.TEXT,
            allowNull: true
        },
        price: {
            type: DataTypes.DECIMAL(10, 2),
            allowNull: false
        },
        comparePrice: {
            type: DataTypes.DECIMAL(10, 2),
            allowNull: true,
            comment: 'Original price before discount'
        },
        currency: {
            type: DataTypes.STRING(3),
            defaultValue: 'EGP'
        },
        images: {
            type: DataTypes.JSON,
            defaultValue: [],
            comment: 'Array of image URLs'
        },
        variants: {
            type: DataTypes.JSON,
            defaultValue: [],
            comment: 'Product variants (size, color, etc.)'
        },
        inventory: {
            type: DataTypes.INTEGER,
            defaultValue: 0
        },
        sku: {
            type: DataTypes.STRING,
            allowNull: true
        },
        status: {
            type: DataTypes.ENUM('active', 'draft', 'archived'),
            defaultValue: 'active'
        },
        category: {
            type: DataTypes.STRING,
            allowNull: true
        },
        tags: {
            type: DataTypes.JSON,
            defaultValue: []
        },
        syncedAt: {
            type: DataTypes.DATE,
            defaultValue: DataTypes.NOW
        }
    }, {
        tableName: 'ecommerce_products',
        timestamps: true,
        indexes: [
            { fields: ['storeId'] },
            { fields: ['externalId'] },
            { fields: ['storeId', 'externalId'], unique: true }
        ]
    });

    return EcommerceProduct;
};
