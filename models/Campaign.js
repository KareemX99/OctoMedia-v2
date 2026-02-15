// Campaign Model - نموذج الحملات للإرسال الجماعي
const { DataTypes } = require('sequelize');

module.exports = (sequelize) => {
    const Campaign = sequelize.define('Campaign', {
        id: {
            type: DataTypes.UUID,
            defaultValue: DataTypes.UUIDV4,
            primaryKey: true
        },
        userId: {
            type: DataTypes.STRING,
            allowNull: false
        },
        pageId: {
            type: DataTypes.STRING,
            allowNull: false
        },
        pageName: {
            type: DataTypes.STRING,
            allowNull: true
        },
        messageTemplate: {
            type: DataTypes.TEXT,
            allowNull: false
        },
        messageTag: {
            type: DataTypes.STRING,
            defaultValue: 'CONFIRMED_EVENT_UPDATE'
        },
        delay: {
            type: DataTypes.INTEGER,
            defaultValue: 3000 // milliseconds
        },
        status: {
            type: DataTypes.ENUM('pending', 'running', 'paused', 'completed', 'cancelled', 'failed'),
            defaultValue: 'pending'
        },
        // Progress tracking
        totalRecipients: {
            type: DataTypes.INTEGER,
            defaultValue: 0
        },
        sentCount: {
            type: DataTypes.INTEGER,
            defaultValue: 0
        },
        failedCount: {
            type: DataTypes.INTEGER,
            defaultValue: 0
        },
        currentIndex: {
            type: DataTypes.INTEGER,
            defaultValue: 0
        },
        // Recipients list (JSON array)
        recipients: {
            type: DataTypes.TEXT,
            allowNull: false,
            get() {
                const value = this.getDataValue('recipients');
                return value ? JSON.parse(value) : [];
            },
            set(value) {
                this.setDataValue('recipients', JSON.stringify(value));
            }
        },
        // Failed recipients list (JSON array)
        failedList: {
            type: DataTypes.TEXT,
            defaultValue: '[]',
            get() {
                const value = this.getDataValue('failedList');
                return value ? JSON.parse(value) : [];
            },
            set(value) {
                this.setDataValue('failedList', JSON.stringify(value));
            }
        },
        // Media files (JSON array of file paths)
        mediaFiles: {
            type: DataTypes.TEXT,
            defaultValue: '[]',
            get() {
                const value = this.getDataValue('mediaFiles');
                return value ? JSON.parse(value) : [];
            },
            set(value) {
                this.setDataValue('mediaFiles', JSON.stringify(value));
            }
        },
        // Remote image URLs (JSON array of URLs from e-commerce products)
        imageUrls: {
            type: DataTypes.TEXT,
            defaultValue: '[]',
            get() {
                const value = this.getDataValue('imageUrls');
                return value ? JSON.parse(value) : [];
            },
            set(value) {
                this.setDataValue('imageUrls', JSON.stringify(value));
            }
        },
        lastMessage: {
            type: DataTypes.TEXT,
            allowNull: true
        },
        startedAt: {
            type: DataTypes.DATE,
            allowNull: true
        },
        completedAt: {
            type: DataTypes.DATE,
            allowNull: true
        },
        error: {
            type: DataTypes.TEXT,
            allowNull: true
        }
    }, {
        tableName: 'campaigns',
        timestamps: true
    });

    return Campaign;
};
