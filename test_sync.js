const { sequelize } = require('./config/database');

async function test() {
    try {
        await sequelize.authenticate();
        console.log('AUTH OK');
        
        const [results] = await sequelize.query('SELECT current_database(), current_user, version()');
        console.log('DB Info:', JSON.stringify(results));
        
        const [tables] = await sequelize.query("SELECT tablename FROM pg_tables WHERE schemaname='public'");
        console.log('Tables:', JSON.stringify(tables));
        
        // Test a simple sync
        console.log('\nTesting User.sync...');
        const User = require('./models/User');
        await User.sync({ alter: true });
        console.log('User sync OK!');
        
    } catch(e) {
        console.error('ERROR:', e.message);
    } finally {
        await sequelize.close();
    }
}

test();
