// Fix script to add missing columns to users table
// Run this once to fix the database schema

const { sequelize } = require('./config/database');

async function fixDatabaseSchema() {
    console.log('🔧 Starting database schema fix...\n');

    try {
        // Test connection
        await sequelize.authenticate();
        console.log('✅ Database connected successfully\n');

        // Add permissions column if missing
        console.log('📝 Adding permissions column...');
        try {
            await sequelize.query(`
                ALTER TABLE users 
                ADD COLUMN IF NOT EXISTS permissions JSONB DEFAULT '{"facebook":{"view":false,"send":false,"broadcast":false,"manage":false,"allowedPages":[]},"telegram":{"view":false,"send":false,"manage":false},"whatsapp":{"view":false,"send":false,"manage":false},"instagram":{"view":false,"send":false,"manage":false}}'::jsonb;
            `);
            console.log('   ✅ permissions column added/verified');
        } catch (err) {
            if (err.message.includes('already exists')) {
                console.log('   ℹ️ permissions column already exists');
            } else {
                throw err;
            }
        }

        // Add subscriptionExpiresAt column for employee subscription tracking
        console.log('📝 Adding subscriptionExpiresAt column...');
        try {
            await sequelize.query(`
                ALTER TABLE users 
                ADD COLUMN IF NOT EXISTS "subscriptionExpiresAt" TIMESTAMP WITH TIME ZONE;
            `);
            console.log('   ✅ subscriptionExpiresAt column added/verified');
        } catch (err) {
            if (err.message.includes('already exists')) {
                console.log('   ℹ️ subscriptionExpiresAt column already exists');
            } else {
                throw err;
            }
        }

        console.log('\n🎉 Database schema fix completed successfully!');
        console.log('   You can now restart the server and create new accounts.');

        process.exit(0);
    } catch (error) {
        console.error('\n❌ Error fixing database:', error.message);
        console.error(error);
        process.exit(1);
    }
}

fixDatabaseSchema();
