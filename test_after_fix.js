const pg = require('pg');

async function cleanRemaining() {
    const client = new pg.Client({
        host: '178.63.34.211',
        port: 10034,
        database: 'octobot_social_saas',
        user: 'postgres',
        password: 'Eng.OctoBot-DK-Kareem-DODGE.12'
    });

    await client.connect();

    // Show remaining constraints
    const res = await client.query(`
        SELECT conname FROM pg_constraint
        WHERE conrelid = 'users'::regclass
        AND contype = 'u'
        AND conname LIKE 'users_email_key%'
        ORDER BY conname
        LIMIT 10
    `);
    console.log('Remaining constraints (first 10):', res.rows.map(r => r.conname));

    // Drop all except 'users_email_key'
    await client.query(`
        DO $$
        DECLARE r RECORD; counter INT := 0;
        BEGIN
            FOR r IN SELECT conname FROM pg_constraint
                WHERE conrelid = 'users'::regclass AND contype = 'u'
                AND conname LIKE 'users_email_key%' AND conname != 'users_email_key'
            LOOP
                EXECUTE format('ALTER TABLE users DROP CONSTRAINT %I', r.conname);
                counter := counter + 1;
            END LOOP;
            RAISE NOTICE 'Dropped %', counter;
        END $$;
    `);

    // Verify
    const check = await client.query(`
        SELECT COUNT(*) as cnt FROM pg_constraint
        WHERE conrelid = 'users'::regclass AND conname LIKE 'users_email_key%'
    `);
    console.log('After cleanup - remaining:', check.rows[0].cnt);

    // Test speed again
    console.time('login-query');
    await client.query(
        `SELECT id, email, password, name, role FROM users WHERE email = $1 LIMIT 1`,
        ['test@test.com']
    );
    console.timeEnd('login-query');

    await client.end();
    process.exit(0);
}
cleanRemaining().catch(e => { console.error(e.message); process.exit(1); });
