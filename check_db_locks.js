const { Sequelize } = require('sequelize');
const s = new Sequelize('octobot_social_saas', 'postgres', 'Eng.OctoBot-DK-Kareem-DODGE.12', {
    host: '178.63.34.211',
    port: 10034,
    dialect: 'postgres',
    logging: false
});

async function check() {
    try {
        await s.authenticate();
        console.log('DB Connected');

        // Check active queries
        const [active] = await s.query(`
            SELECT pid, state, query, wait_event_type, wait_event,
                   now() - query_start as duration
            FROM pg_stat_activity
            WHERE state != 'idle' AND pid != pg_backend_pid()
            ORDER BY query_start
        `);
        console.log('\n=== Active Queries ===');
        console.log(JSON.stringify(active, null, 2));

        // Check locks
        const [locks] = await s.query(`
            SELECT blocked_locks.pid AS blocked_pid,
                   blocking_locks.pid AS blocking_pid,
                   blocked_activity.query AS blocked_query
            FROM pg_catalog.pg_locks blocked_locks
            JOIN pg_catalog.pg_stat_activity blocked_activity
                ON blocked_activity.pid = blocked_locks.pid
            JOIN pg_catalog.pg_locks blocking_locks
                ON blocking_locks.locktype = blocked_locks.locktype
                AND blocking_locks.relation = blocked_locks.relation
                AND blocking_locks.pid != blocked_locks.pid
            WHERE NOT blocked_locks.granted
        `);
        console.log('\n=== Blocked Queries ===');
        console.log(JSON.stringify(locks, null, 2));

        process.exit(0);
    } catch (e) {
        console.error('Error:', e.message);
        process.exit(1);
    }
}
check();
