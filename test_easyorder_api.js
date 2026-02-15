// Direct test script to see EasyOrder API response structure
const axios = require('axios');
const { Sequelize } = require('sequelize');
const crypto = require('crypto');

// Encryption key (SAME as used in ecommerce.js - line 11)
const ENCRYPTION_KEY = crypto.scryptSync(process.env.ENCRYPTION_KEY || 'dk-octobot-secret-key', 'salt', 32);

// Decrypt credentials
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
        } else {
            return encrypted;
        }
    } catch (e) {
        console.error('Decryption error:', e.message);
        return null;
    }
}

// Connect to database
const sequelize = new Sequelize('octobot_social_saas', 'postgres', 'Eng.OctoBot-DK-Kareem-DODGE.12', {
    host: '178.63.34.211',
    port: 10034,
    dialect: 'postgres',
    logging: false
});

async function testEasyOrderAPI() {
    try {
        // Get API key from store 7
        const [stores] = await sequelize.query(`
            SELECT "apiKey", "accessToken" FROM ecommerce_stores WHERE id = 7
        `);

        if (!stores.length) {
            console.log('No store found');
            return;
        }

        const encryptedKey = stores[0].apiKey || stores[0].accessToken;
        const API_KEY = decryptCredential(encryptedKey);

        if (!API_KEY) {
            console.log('Failed to decrypt API key');
            return;
        }

        console.log('Testing EasyOrder API with decrypted key:', API_KEY.substring(0, 8) + '... (length:', API_KEY.length, ')');

        const response = await axios.get('https://api.easy-orders.net/api/v1/external-apps/products', {
            headers: {
                'Api-Key': API_KEY,
                'Accept': 'application/json',
                'Content-Type': 'application/json'
            },
            params: {
                per_page: 2
            }
        });

        console.log('\n=== API Response Status:', response.status);
        console.log('=== Response Keys:', Object.keys(response.data));

        const products = response.data?.data || response.data?.products || [];

        if (products.length > 0) {
            console.log('\n=== FIRST PRODUCT STRUCTURE ===');
            console.log('Keys:', Object.keys(products[0]));
            console.log('\n=== Image-related fields ===');
            console.log('images:', products[0].images);
            console.log('image:', products[0].image);
            console.log('thumb:', products[0].thumb);
            console.log('thumbnail:', products[0].thumbnail);
            console.log('photo:', products[0].photo);
            console.log('photos:', products[0].photos);
            console.log('media:', products[0].media);
            console.log('picture:', products[0].picture);
            console.log('pictures:', products[0].pictures);
            console.log('\n=== FULL PRODUCT JSON ===');
            console.log(JSON.stringify(products[0], null, 2));
        } else {
            console.log('No products returned!');
            console.log('Full response:', JSON.stringify(response.data, null, 2));
        }

    } catch (error) {
        console.error('Error:', error.message);
        if (error.response) {
            console.error('Status:', error.response.status);
            console.error('Data:', JSON.stringify(error.response.data, null, 2));
        }
    } finally {
        await sequelize.close();
    }
}

testEasyOrderAPI();
