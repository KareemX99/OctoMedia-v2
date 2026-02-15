const { DataTypes } = require('sequelize');

module.exports = (sequelize) => {
    const TeamActivity = sequelize.define('TeamActivity', {
        id: {
            type: DataTypes.UUID,
            defaultValue: DataTypes.UUIDV4,
            primaryKey: true
        },
        userId: {
            type: DataTypes.STRING,
            allowNull: false,
            comment: 'معرف الموظف'
        },
        userName: {
            type: DataTypes.STRING,
            allowNull: false,
            comment: 'اسم الموظف'
        },
        actionType: {
            type: DataTypes.ENUM('message_sent', 'message_received', 'conversation_opened', 'conversation_closed'),
            allowNull: false,
            comment: 'نوع الإجراء'
        },
        platform: {
            type: DataTypes.ENUM('facebook', 'instagram', 'telegram', 'whatsapp'),
            allowNull: false,
            comment: 'المنصة'
        },
        conversationId: {
            type: DataTypes.STRING,
            allowNull: true,
            comment: 'معرف المحادثة'
        },
        responseTime: {
            type: DataTypes.INTEGER,
            allowNull: true,
            comment: 'وقت الرد بالثواني'
        },
        messageLength: {
            type: DataTypes.INTEGER,
            allowNull: true,
            comment: 'طول الرسالة بالأحرف'
        },
        metadata: {
            type: DataTypes.JSON,
            allowNull: true,
            defaultValue: {},
            comment: 'بيانات إضافية'
        }
    }, {
        tableName: 'team_activities',
        timestamps: true,
        indexes: [
            { fields: ['userId'] },
            { fields: ['platform'] },
            { fields: ['actionType'] },
            { fields: ['createdAt'] }
        ]
    });

    return TeamActivity;
};
