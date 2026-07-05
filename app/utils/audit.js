const { query } = require('../database/db');
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Registra un evento de auditoría. No se espera (fire-and-forget) y nunca lanza.
function registrarEvento({ tipo, descripcion, pacienteId = null, terminalId = null, datos = null }) {
    const term = terminalId && UUID_RE.test(terminalId) ? terminalId : null;
    query(
        `INSERT INTO eventos_log (tipo, descripcion, paciente_id, terminal_id, datos)
         VALUES ($1, $2, $3, $4, $5)`,
        [tipo, descripcion || null, pacienteId, term, datos ? JSON.stringify(datos) : null]
    ).catch(err => console.error('[audit]', err.message));
}
module.exports = { registrarEvento };
