// Instagram Service - Using Instagram Graph API
// Instagram DMs are accessed via the Facebook Page that's linked to the Instagram Business account

const axios = require('axios');

const FB_GRAPH_URL = 'https://graph.facebook.com/v19.0';

class InstagramService {

    // Get Instagram account linked to a Facebook page
    async getInstagramAccount(pageId, pageToken) {
        try {
            const response = await axios.get(`${FB_GRAPH_URL}/${pageId}`, {
                params: {
                    access_token: pageToken,
                    fields: 'instagram_business_account'
                }
            });

            return response.data.instagram_business_account?.id || null;
        } catch (error) {
            console.error('Error getting Instagram account:', error.response?.data || error.message);
            return null;
        }
    }

    // Get Instagram account info
    async getInstagramInfo(igAccountId, pageToken) {
        try {
            const response = await axios.get(`${FB_GRAPH_URL}/${igAccountId}`, {
                params: {
                    access_token: pageToken,
                    fields: 'id,username,name,profile_picture_url,followers_count'
                }
            });

            return response.data;
        } catch (error) {
            console.error('Error getting Instagram info:', error.response?.data || error.message);
            return null;
        }
    }

    // Get Instagram conversations (DMs)
    async getConversations(igAccountId, pageToken, limit = 100, after = null) {
        try {
            const params = {
                access_token: pageToken,
                platform: 'instagram',
                fields: 'id,updated_time,participants,messages{id,created_time,from,to,message}',
                limit
            };

            if (after) {
                params.after = after;
            }

            const response = await axios.get(`${FB_GRAPH_URL}/${igAccountId}/conversations`, { params });

            return {
                conversations: response.data.data || [],
                paging: response.data.paging
            };
        } catch (error) {
            console.error('Error getting Instagram conversations:', error.response?.data || error.message);
            return { conversations: [], paging: null };
        }
    }

    // Get messages in a conversation
    async getMessages(conversationId, pageToken, limit = 50) {
        try {
            const response = await axios.get(`${FB_GRAPH_URL}/${conversationId}/messages`, {
                params: {
                    access_token: pageToken,
                    fields: 'id,created_time,from,to,message,attachments',
                    limit
                }
            });

            return response.data.data || [];
        } catch (error) {
            console.error('Error getting Instagram messages:', error.response?.data || error.message);
            return [];
        }
    }

    // Send Instagram DM
    async sendMessage(igAccountId, recipientId, message, pageToken) {
        try {
            const response = await axios.post(`${FB_GRAPH_URL}/${igAccountId}/messages`, {
                recipient: { id: recipientId },
                message: { text: message }
            }, {
                params: { access_token: pageToken }
            });

            return { success: true, messageId: response.data.message_id };
        } catch (error) {
            console.error('Error sending Instagram message:', error.response?.data || error.message);
            return {
                success: false,
                error: error.response?.data?.error?.message || error.message
            };
        }
    }
}

module.exports = new InstagramService();
