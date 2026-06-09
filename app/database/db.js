const { Pool } = require('pg');

const pool = new Pool({
    host:     process.env.DB_HOST     || 'localhost',
    port:     parseInt(process.env.DB_PORT) || 5432,
    database: process.env.DB_NAME     || 'turnero',
    user:     process.env.DB_USER     || 'turnero_user',
    password: process.env.DB_PASSWORD || '',
    max: 10,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 5000,
});

pool.on('error', (err) => {
    console.error('[DB] Error inesperado en cliente idle:', err);
});

async function query(text, params) {
    const start = Date.now();
    try {
        const res = await pool.query(text, params);
        if (process.env.NODE_ENV === 'development') {
            const ms = Date.now() - start;
            if (ms > 200) console.warn(`[DB] query lenta (${ms}ms):`, text.substring(0, 80));
        }
        return res;
    } catch (err) {
        console.error('[DB] query error:', err.message, '\nSQL:', text.substring(0, 200));
        throw err;
    }
}

module.exports = { query, pool };
