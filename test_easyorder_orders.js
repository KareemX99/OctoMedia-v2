// Test EasyOrder orders endpoints
const axios = require('axios');
const { Sequelize } = require('sequelize');
const crypto = require('crypto');

const ENCRYPTION_KEY = crypto.scryptSync(process.env.ENCRYPTION_KEY || 'dk-octobot-secret-key', 'salt', 32);

function decryptCredential(encrypted) {
    if (!encrypted) return null;
    try {
        if (encrypted.includes(':')) {
            const [ivHex, encryptedData] = encrypted.split(':');
            const iv = Buffer.from(ivHex, 'hex');
            const decipher = crypto.createDecipheriv('aes-256-cbc', ENCRYPTION_KEY, iv);
            let decrypted = decipher.update(encryptedData, 'hex', 'utf8');
            decrypted += decipher.final('utf8');
            return decrypted;
        }
        return encrypted;
    } catch (e) { return null; }
}

const sequelize = new Sequelize('octobot_social_saas', 'postgres', 'Eng.OctoBot-DK-Kareem-DODGE.12', {
    host: '178.63.34.211', port: 10034, dialect: 'postgres', logging: false
});

async function testOrderEndpoints() {
    try {
        const [stores] = await sequelize.query(`SELECT "apiKey" FROM ecommerce_stores WHERE id = 7`);
        const API_KEY = decryptCredential(stores[0].apiKey);
        console.log('Using API key:', API_KEY.substring(0, 8) + '...\n');

        const baseUrl = 'https://api.easy-orders.net/api/v1';
        const headers = { 'Api-Key': API_KEY, 'Accept': 'application/json' };

        // Test different order endpoints
        const endpoints = [
            '/external-apps/orders',
            '/external-apps/orders?per_page=5',
            '/external-apps/store/orders',
            '/external-apps/my-orders',
            '/external-apps/sales',
            '/external-apps/store',
            '/external-apps/store/stats',
            '/external-apps/statistics',
            '/external-apps/dashboard',
        ];

        for (const endpoint of endpoints) {
            try {
                const response = await axios.get(`${baseUrl}${endpoint}`, { headers, timeout: 5000 });
                console.log(`✅ ${endpoint} -> ${response.status}`);
                console.log('   Keys:', Object.keys(response.data));
                if (response.data?.data && Array.isArray(response.data.data)) {
                    console.log('   Items:', response.data.data.length);
                    if (response.data.data.length > 0) {
                        console.log('   First item keys:', Object.keys(response.data.data[0]));
                    }
                }
                console.log('');
            } catch (err) {
                console.log(`❌ ${endpoint} -> ${err.response?.status || err.message}`);
                if (err.response?.data?.message) {
                    console.log(`   Message: ${err.response.data.message}`);
                }
            }
        }

    } catch (err) {
        console.error('Error:', err.message);
    } finally {
        await sequelize.close();
    }
}

testOrderEndpoints();
