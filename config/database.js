// Database Configuration - PostgreSQL
const { Sequelize } = require('sequelize');

// Remote PostgreSQL connection
const sequelize = new Sequelize('octobot_social_saas', 'postgres', 'Eng.OctoBot-DK-Kareem-DODGE.12', {
    host: '178.63.34.211',
    port: 10034,
    dialect: 'postgres',
    logging: false, // Set to console.log for debugging
    // SSL disabled for localhost connection
    dialectOptions: {},
    pool: {
        max: 5,
        min: 0,
        acquire: 30000,
        idle: 10000
    }
});

// Test connection
async function testConnection() {
    try {
        await sequelize.authenticate();
        console.log('✅ Database connected successfully!');
        return true;
    } catch (error) {
        console.error('❌ Unable to connect to database:', error.message);
        return false;
    }
}

module.exports = { sequelize, testConnection };
