const { Router } = require('express');
const { query } = require('../database/db');
const { validarExtensionSecret } = require('../middleware/validar');

const router = Router();

router.use(validarExtensionSecret);

// Valida que la fecha sea un día calendario real en formato YYYY-MM-DD.
// Rechaza formatos inválidos y desbordes (p.ej. 2026-02-30).
const FECHA_RE = /^\d{4}-\d{2}-\d{2}$/;
function fechaValida(f) {
    if (typeof f !== 'string' || !FECHA_RE.test(f)) return false;
    const d = new Date(`${f}T00:00:00Z`);
    return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === f;
}

// POST /api/extension/sync
router.post('/sync', async (req, res) => {
    const { loginName, terminalId, pacientes } = req.body;
    if (!loginName || !Array.isArray(pacientes)) {
        return res.status(400).json({ error: 'loginName y pacientes[] requeridos' });
    }

    const resultados = { nuevos: 0, actualizados: 0, errores: 0 };

    for (const p of pacientes) {
        const { numeroIdentificacion, nombrePaciente, nombreProfesional, area, columnaHeader, horaLlegadaBiofile, fecha } = p;
        if (!numeroIdentificacion || !nombreProfesional || !columnaHeader) {
            resultados.errores++;
            continue;
        }
        // Fecha del paciente derivada de Biofile; si falta o es inválida, cae a CURRENT_DATE.
        const fechaParam = fechaValida(fecha) ? fecha : null;
        try {
            const { rows: colaRows } = await query(
                `SELECT id FROM pacientes_cola
                 WHERE fecha = COALESCE($1::date, CURRENT_DATE) AND numero_identificacion = $2`,
                [fechaParam, numeroIdentificacion]
            );
            const pacienteColaId = colaRows[0]?.id || null;

            const { rows } = await query(
                `INSERT INTO asignaciones_profesionales
                    (fecha, paciente_cola_id, numero_identificacion, nombre_paciente, nombre_profesional,
                     area, columna_header, hora_llegada_biofile, terminal_id, login_name_biofile)
                 VALUES (COALESCE($1::date, CURRENT_DATE), $2, $3, $4, $5, $6, $7, $8, $9, $10)
                 ON CONFLICT (fecha, numero_identificacion, columna_header)
                 DO UPDATE SET
                     nombre_paciente = COALESCE(EXCLUDED.nombre_paciente, asignaciones_profesionales.nombre_paciente),
                     hora_llegada_biofile = EXCLUDED.hora_llegada_biofile,
                     updated_at = NOW()
                 RETURNING (xmax = 0) AS es_nuevo`,
                [fechaParam, pacienteColaId, numeroIdentificacion, nombrePaciente || null, nombreProfesional,
                 area, columnaHeader, horaLlegadaBiofile || null, terminalId || null, loginName]
            );

            if (rows[0]?.es_nuevo) resultados.nuevos++;
            else resultados.actualizados++;

        } catch (err) {
            console.error('[extension/sync] error:', numeroIdentificacion, err.message);
            resultados.errores++;
        }
    }

    if (resultados.nuevos > 0) {
        const io = req.app.get('io');
        io.to(`profesional:${loginName}`).emit('extension:sync', { loginName, resultados });
    }

    return res.json({ ok: true, ...resultados });
});

// GET /api/extension/heartbeat
router.get('/heartbeat', (req, res) => {
    res.json({ ok: true, ts: new Date().toISOString() });
});

module.exports = router;
