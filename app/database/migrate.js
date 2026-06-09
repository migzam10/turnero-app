const fs = require('fs');
const path = require('path');
const { pool } = require('./db');

async function migrate() {
    const schemaPath = path.join(__dirname, 'schema.sql');
    const sql = fs.readFileSync(schemaPath, 'utf8');
    const client = await pool.connect();
    try {
        await client.query(sql);
        console.log('[DB] Migración ejecutada correctamente');
    } catch (err) {
        console.error('[DB] Error en migración:', err.message);
        throw err;
    } finally {
        client.release();
    }
}

module.exports = { migrate };
