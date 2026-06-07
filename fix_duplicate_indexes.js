const pg = require('pg');

async function fixConstraintsBatch() {
    const client = new pg.Client({
        host: '178.63.34.211',
        port: 10034,
        database: 'octobot_social_saas',
        user: 'postgres',
        password: 'Eng.OctoBot-DK-Kareem-DODGE.12',
        statement_timeout: 300000 // 5 min timeout
    });

    await client.connect();
    console.log('Connected to DB');

    // Drop ALL constraints except the original one in a SINGLE query
    console.log('Dropping all duplicate constraints in one batch...');
    console.time('batch-drop');

    const result = await client.query(`
        DO $$
        DECLARE
            r RECORD;
            counter INT := 0;
        BEGIN
            FOR r IN
                SELECT conname FROM pg_constraint
                WHERE conrelid = 'users'::regclass
                AND contype = 'u'
                AND conname LIKE 'users_email_key%'
                AND conname != 'users_email_key'
            LOOP
                EXECUTE format('ALTER TABLE users DROP CONSTRAINT %I', r.conname);
                counter := counter + 1;
                IF counter % 1000 = 0 THEN
                    RAISE NOTICE 'Dropped % constraints...', counter;
                END IF;
            END LOOP;
            RAISE NOTICE 'Total dropped: %', counter;
        END $$;
    `);

    console.timeEnd('batch-drop');
    console.log('Batch drop completed!');

    // Verify
    const check = await client.query(`
        SELECT COUNT(*) as cnt FROM pg_constraint
        WHERE conrelid = 'users'::regclass
        AND conname LIKE 'users_email_key%'
    `);
    console.log('Remaining email constraints:', check.rows[0].cnt);

    // Test login query speed
    console.log('\nTesting login query speed...');
    console.time('login-query');
    const loginResult = await client.query(
        `SELECT id, email, name, role FROM users WHERE email = $1 LIMIT 1`,
        ['test@test.com']
    );
    console.timeEnd('login-query');
    console.log('Query result rows:', loginResult.rows.length);

    await client.end();
    process.exit(0);
}

fixConstraintsBatch().catch(e => { console.error('Error:', e.message); process.exit(1); });
