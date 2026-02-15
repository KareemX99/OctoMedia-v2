const { sequelize } = require('./models');

async function fixSchema() {
    try {
        console.log('Connecting to database...');
        await sequelize.authenticate();
        console.log('Database connected.');

        console.log('Adding attachment column to team_messages table...');
        await sequelize.getQueryInterface().addColumn('team_messages', 'attachment', {
            type: sequelize.Sequelize.JSONB,
            allowNull: true
        });

        console.log('Schema update successful!');
    } catch (error) {
        if (error.original && error.original.code === '42701') {
            console.log('Column already exists.');
        } else {
            console.error('Schema update failed:', error);
        }
    } finally {
        await sequelize.close();
    }
}

fixSchema();
