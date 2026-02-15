// User Model
const { DataTypes } = require('sequelize');
const { sequelize } = require('../config/database');
const bcrypt = require('bcryptjs');

const User = sequelize.define('User', {
    id: {
        type: DataTypes.UUID,
        defaultValue: DataTypes.UUIDV4,
        primaryKey: true
    },
    email: {
        type: DataTypes.STRING,
        allowNull: false,
        unique: true,
        validate: {
            isEmail: true
        }
    },
    password: {
        type: DataTypes.STRING,
        allowNull: false
    },
    name: {
        type: DataTypes.STRING,
        allowNull: false
    },
    role: {
        type: DataTypes.ENUM('admin', 'supervisor', 'agent'),
        defaultValue: 'agent'
    },
    permissions: {
        type: DataTypes.JSON,
        defaultValue: {
            facebook: { view: false, send: false, broadcast: false, manage: false, allowedPages: [] },
            telegram: { view: false, send: false, manage: false },
            whatsapp: { view: false, send: false, manage: false },
            instagram: { view: false, send: false, manage: false }
        }
    },
    isActive: {
        type: DataTypes.BOOLEAN,
        defaultValue: true
    },
    isWorkingToday: {
        type: DataTypes.BOOLEAN,
        defaultValue: false
    },
    isVerified: {
        type: DataTypes.BOOLEAN,
        defaultValue: false
    },
    verificationCode: {
        type: DataTypes.STRING,
        allowNull: true
    },
    verificationExpires: {
        type: DataTypes.DATE,
        allowNull: true
    },
    resetToken: {
        type: DataTypes.STRING,
        allowNull: true
    },
    resetTokenExpires: {
        type: DataTypes.DATE,
        allowNull: true
    },
    tenantId: {
        type: DataTypes.UUID,
        allowNull: true
    },
    subscriptionExpiresAt: {
        type: DataTypes.DATE,
        allowNull: true
    }
}, {
    tableName: 'users',
    timestamps: true,
    hooks: {
        beforeCreate: async (user) => {
            if (user.password) {
                user.password = await bcrypt.hash(user.password, 10);
            }
        },
        beforeUpdate: async (user) => {
            if (user.changed('password')) {
                user.password = await bcrypt.hash(user.password, 10);
            }
        }
    }
});

// Instance method to check password
User.prototype.validatePassword = async function (password) {
    return bcrypt.compare(password, this.password);
};

module.exports = User;
