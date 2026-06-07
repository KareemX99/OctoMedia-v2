// Check if constraints are still growing while server is running
const pg = require('pg');
const client = new pg.Client({
    host: '178.63.34.211',
    port: 10034,
    database: 'octobot_social_saas',
    user: 'postgres',
    password: 'Eng.OctoBot-DK-Kareem-DODGE.12'
});

async function check() {
    await client.connect();
    const r1 = await client.query("SELECT COUNT(*) as cnt FROM pg_constraint WHERE conrelid = 'users'::regclass AND conname LIKE 'users_email_key%'");
    console.log('Count now:', r1.rows[0].cnt);

    // Also check ALL tables for recent constraint creation
    const r2 = await client.query(`
        SELECT c.conrelid::regclass as table_name, COUNT(*) as cnt
        FROM pg_constraint c
        WHERE c.contype = 'u'
        GROUP BY c.conrelid
        HAVING COUNT(*) > 5
        ORDER BY cnt DESC
        LIMIT 10
    `);
    console.log('\nTables with many unique constraints:');
    r2.rows.forEach(r => console.log(`  ${r.table_name}: ${r.cnt}`));

    await client.end();
}
check().catch(e => { console.error(e); process.exit(1); });
