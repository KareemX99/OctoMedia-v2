const { DataTypes } = require('sequelize');

module.exports = (sequelize) => {
    const TeamMessage = sequelize.define('TeamMessage', {
        id: {
            type: DataTypes.UUID,
            defaultValue: DataTypes.UUIDV4,
            primaryKey: true
        },
        senderId: {
            type: DataTypes.UUID,
            allowNull: false
        },
        senderName: {
            type: DataTypes.STRING,
            allowNull: false
        },
        receiverId: {
            type: DataTypes.UUID,
            allowNull: true // null للدردشة الجماعية
        },
        isGroupMessage: {
            type: DataTypes.BOOLEAN,
            defaultValue: true // true = دردشة جماعية للفريق
        },
        message: {
            type: DataTypes.TEXT,
            allowNull: false
        },
        // ربط محادثة عميل (Linked Conversation)
        attachment: {
            type: DataTypes.JSONB,
            allowNull: true
            // { type: 'image'|'file', url: '...', name: '...' }
        },
        linkedConversation: {
            type: DataTypes.JSONB,
            allowNull: true,
            // { platform: 'facebook'|'instagram', conversationId, customerName, pageId, lastMessage }
        },
        isRead: {
            type: DataTypes.BOOLEAN,
            defaultValue: false
        },
        readBy: {
            type: DataTypes.ARRAY(DataTypes.UUID),
            defaultValue: []
        }
    }, {
        tableName: 'team_messages',
        timestamps: true
    });

    return TeamMessage;
};
