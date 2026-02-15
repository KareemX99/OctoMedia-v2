const { DataTypes } = require('sequelize');

module.exports = (sequelize) => {
    const DailyStats = sequelize.define('DailyStats', {
        id: {
            type: DataTypes.INTEGER,
            primaryKey: true,
            autoIncrement: true
        },
        pageId: {
            type: DataTypes.STRING,
            allowNull: false
        },
        date: {
            type: DataTypes.DATEONLY,
            allowNull: false
            // Format: YYYY-MM-DD
        },
        reactions: {
            type: DataTypes.INTEGER,
            defaultValue: 0
        },
        comments: {
            type: DataTypes.INTEGER,
            defaultValue: 0
        },
        shares: {
            type: DataTypes.INTEGER,
            defaultValue: 0
        },
        messages: {
            type: DataTypes.INTEGER,
            defaultValue: 0
        },
        messaging_connections: {
            type: DataTypes.INTEGER,
            defaultValue: 0
        }
    }, {
        indexes: [
            {
                unique: true,
                fields: ['pageId', 'date']
            }
        ]
    });

    return DailyStats;
};
