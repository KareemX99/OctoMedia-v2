// Database Configuration - PostgreSQL
const { Sequelize } = require('sequelize');

// Remote PostgreSQL connection
const sequelize = new Sequelize('octobot_social_saas', 'postgres', 'Eng.OctoBot-DK-Kareem-DODGE.12', {
    host: 'localhost',
    port: 10034,
    dialect: 'postgres',
    logging: false,
    // SSL disabled - remote PostgreSQL server does not support SSL
    dialectOptions: {},
    pool: {
        max: 15,
        min: 0,
        acquire: 60000,
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
