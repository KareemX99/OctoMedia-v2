// Database Connection Test with Detailed Error
const { Sequelize } = require('sequelize');

const sequelize = new Sequelize('octobot_social_saas', 'postgres', 'Eng.OctoBot-DK-Kareem-DODGE.12', {
    host: 'localhost',
    port: 10034,
    dialect: 'postgres',
    logging: console.log, // Enable logging
    dialectOptions: {},
    pool: {
        max: 5,
        min: 0,
        acquire: 30000,
        idle: 10000
    }
});

async function test() {
    console.log('🔍 Testing database connection...');
    console.log('Host: localhost');
    console.log('Port: 10034');
    console.log('Database: octobot_social_saas');
    console.log('User: postgres');

    try {
        await sequelize.authenticate();
        console.log('✅ Database connection successful!');
        process.exit(0);
    } catch (error) {
        console.error('❌ Connection failed with error:');
        console.error('Error name:', error.name);
        console.error('Error message:', error.message);
        console.error('Error code:', error.code);
        console.error('Full error:', error);
        process.exit(1);
    }
}

test();
