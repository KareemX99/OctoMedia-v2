const {sequelize} = require('./config/database');

console.time('login-query');
sequelize.query(
    `SELECT id, email, password, name, role, permissions, "isActive", "isVerified", "isWorkingToday", "subscriptionExpiresAt" FROM users WHERE email = $1 LIMIT 1`,
    { bind: ['test@test.com'] }
).then(r => {
    console.timeEnd('login-query');
    console.log('Result rows:', r[0].length);
    if (r[0].length > 0) console.log('User found:', r[0][0].email);
    else console.log('No user found');
    process.exit(0);
}).catch(e => {
    console.timeEnd('login-query');
    console.log('ERROR:', e.message);
    process.exit(1);
});
