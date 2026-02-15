// Check employee permissions in database
const { User } = require('./models');

(async () => {
    try {
        const users = await User.findAll({
            attributes: ['id', 'name', 'email', 'role', 'permissions']
        });

        console.log('=== All Users Permissions ===\n');

        for (const user of users) {
            console.log(`📧 ${user.name} (${user.email})`);
            console.log(`   Role: ${user.role}`);
            console.log(`   Permissions:`, JSON.stringify(user.permissions, null, 2));
            console.log('');
        }

        process.exit(0);
    } catch (err) {
        console.error('Error:', err.message);
        process.exit(1);
    }
})();
