// Quick Database Connection Test
const { testConnection } = require('./config/database');

async function test() {
    console.log('🔍 Testing database connection...');
    const result = await testConnection();

    if (result) {
        console.log('✅ Database connection successful!');
        process.exit(0);
    } else {
        console.log('❌ Database connection failed!');
        process.exit(1);
    }
}

test();
