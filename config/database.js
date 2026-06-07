// Database Configuration - PostgreSQL
const { Sequelize } = require('sequelize');

// CRITICAL FIX: Patch the pg Client.query to block schema introspection queries
// These take 60+ seconds on the remote DB and cause deadlocks that block all operations
const pg = require('pg');
const blockedPattern = /INFORMATION_SCHEMA|PG_CATALOG\.PG_TYPE|PG_STATIO|ALTER TABLE|ADD CONSTRAINT|DROP CONSTRAINT|CREATE UNIQUE INDEX|CREATE INDEX/i;

const origClientQuery = pg.Client.prototype.query;
pg.Client.prototype.query = function(config, values, callback) {
    const sql = typeof config === 'string' ? config : (config?.text || '');
    if (blockedPattern.test(sql)) {
        const fakeResult = { rows: [], rowCount: 0, fields: [] };
        if (typeof values === 'function') return values(null, fakeResult);
        if (typeof callback === 'function') return callback(null, fakeResult);
        return Promise.resolve(fakeResult);
    }
    return origClientQuery.call(this, config, values, callback);
};

// Also patch Pool.query in case Sequelize uses it directly
const origPoolQuery = pg.Pool.prototype.query;
pg.Pool.prototype.query = function(config, values, callback) {
    const sql = typeof config === 'string' ? config : (config?.text || '');
    if (blockedPattern.test(sql)) {
        const fakeResult = { rows: [], rowCount: 0, fields: [] };
        if (typeof values === 'function') return values(null, fakeResult);
        if (typeof callback === 'function') return callback(null, fakeResult);
        return Promise.resolve(fakeResult);
    }
    return origPoolQuery.call(this, config, values, callback);
};

// Remote PostgreSQL connection
const sequelize = new Sequelize('octobot_social_saas', 'postgres', 'Eng.OctoBot-DK-Kareem-DODGE.12', {
    host: '178.63.34.211',
    port: 10034,
    dialect: 'postgres',
    logging: (msg) => {
        const upper = msg.toUpperCase();
        if (upper.includes('CREATE') || upper.includes('INDEX') || upper.includes('CONSTRAINT') || upper.includes('ALTER')) {
            console.log('[SEQ DDL]', msg.substring(0, 150));
        }
    },
    dialectOptions: {},
    pool: {
        max: 15,
        min: 0,
        acquire: 60000,
        idle: 10000
    },
    define: {
        timestamps: true
    }
});

// Test connection
async function testConnection() {
    try {
        await sequelize.authenticate();
        console.log('✅ Database connected successfully!');
        return true;
    } catch (error) {
        console.error('❌ Unable to connect to database:', error.message);
        return false;
    }
}

module.exports = { sequelize, testConnection };
