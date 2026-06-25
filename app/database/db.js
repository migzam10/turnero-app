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
    // Fija la zona horaria de sesión en el startup de CADA conexión (atómico,
    // sin condición de carrera y sin hardcodear el nombre de la BD). Asegura que:
    //   - CURRENT_DATE / fecha DEFAULT CURRENT_DATE usen el día real en Bogotá
    //     (evita el corrimiento de día después de las 7:00 PM hora local).
    //   - Los timestamps "naive" de Biofile (p.ej. "Jun 25 2026 7:11AM") insertados
    //     en columnas TIMESTAMPTZ se interpreten como hora de Bogotá y no como UTC.
    // Nota: NOW() en columnas TIMESTAMPTZ ya guarda el instante absoluto correcto;
    // no requiere conversión adicional.
    options: '-c timezone=America/Bogota',
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
