const { Sequelize } = require('sequelize');
const s = new Sequelize('octobot_social_saas', 'postgres', 'Eng.OctoBot-DK-Kareem-DODGE.12', {
    host: '178.63.34.211',
    port: 10034,
    dialect: 'postgres',
    logging: false
});

async function killAll() {
    try {
        await s.authenticate();
        console.log('Connected');

        // Kill ALL other sessions on this database
        await s.query(`
            SELECT pg_terminate_backend(pid)
            FROM pg_stat_activity
            WHERE datname = 'octobot_social_saas'
              AND pid != pg_backend_pid()
        `);
        console.log('All other sessions terminated');

        // Verify users table is accessible
        const [users] = await s.query('SELECT COUNT(*) as cnt FROM users');
        console.log('Users count:', users[0].cnt, '- DB is clean!');

        await s.close();
        process.exit(0);
    } catch (e) {
        console.error('Error:', e.message);
        process.exit(1);
    }
}
killAll();
