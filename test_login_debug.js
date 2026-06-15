const {sequelize} = require('./config/database');

async function checkIndexes() {
    try {
        console.time('check-indexes');
        const [results] = await sequelize.query(`
            SELECT indexname, indexdef
            FROM pg_indexes
            WHERE tablename = 'users'
        `);
        console.timeEnd('check-indexes');
        console.log('Indexes on users table:');
        results.forEach(r => console.log(' -', r.indexname, ':', r.indexdef));

        // Check table size
        const [countResult] = await sequelize.query(`SELECT COUNT(*) as total FROM users`);
        console.log('\nTotal users:', countResult[0].total);

        process.exit(0);
    } catch(e) {
        console.log('ERROR:', e.message);
        process.exit(1);
    }
}
checkIndexes();
