const { Router } = require('express');
const { pool } = require('../database/db');
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

// Biofile envía el nombre completo como un único string, pero pacientes_cola
// exige primer_nombre y primer_apellido (NOT NULL). Divide de forma robusta:
// primera palabra -> primer_nombre, resto -> primer_apellido.
// Casos borde:
//   - string vacío/nulo: primer_nombre = 'N/D', primer_apellido = '' (vacío seguro).
//   - una sola palabra: va a primer_nombre, primer_apellido = '' (vacío seguro).
//   - espacios redundantes: se normalizan antes de dividir.
function dividirNombre(nombre) {
    const limpio = String(nombre || '').trim().replace(/\s+/g, ' ');
    if (!limpio) return { primerNombre: 'N/D', primerApellido: '' };
    const partes = limpio.split(' ');
    return { primerNombre: partes[0], primerApellido: partes.slice(1).join(' ') };
}

// POST /api/extension/sync
router.post('/sync', async (req, res) => {
    const { loginName, terminalId, pacientes } = req.body;
    if (!loginName || !Array.isArray(pacientes)) {
        return res.status(400).json({ error: 'loginName y pacientes[] requeridos' });
    }

    const resultados = { nuevos: 0, actualizados: 0, autocreados: 0, errores: 0 };

    for (const p of pacientes) {
        const { numeroIdentificacion, nombrePaciente, nombreProfesional, area, columnaHeader, horaLlegadaBiofile, fecha } = p;
        if (!numeroIdentificacion || !nombreProfesional || !columnaHeader) {
            resultados.errores++;
            continue;
        }
        // Fecha del paciente derivada de Biofile; si falta o es inválida, cae a CURRENT_DATE.
        const fechaParam = fechaValida(fecha) ? fecha : null;

        // Cada paciente se procesa en su propia transacción: la auto-creación en
        // pacientes_cola y el UPSERT de la asignación deben quedar o ambos o ninguno.
        const client = await pool.connect();
        try {
            await client.query('BEGIN');

            // 1. Búsqueda: ¿existe ya el paciente en la cola del día?
            const { rows: colaRows } = await client.query(
                `SELECT id FROM pacientes_cola
                 WHERE fecha = COALESCE($1::date, CURRENT_DATE) AND numero_identificacion = $2`,
                [fechaParam, numeroIdentificacion]
            );
            let pacienteColaId = colaRows[0]?.id || null;

            // 2. Fallback: si el paciente no pasó por Recepción, se auto-crea para
            //    no perder la trazabilidad de T1 (llegada) y T2 (admisión).
            //    hora_llegada y hora_admision toman el timestamp de Biofile; si éste
            //    falta, cae a NOW() para respetar el NOT NULL de hora_llegada.
            //    El ON CONFLICT cubre la carrera con una inserción concurrente.
            if (!pacienteColaId) {
                const { primerNombre, primerApellido } = dividirNombre(nombrePaciente);
                const { rows: nuevoCola } = await client.query(
                    `INSERT INTO pacientes_cola
                        (fecha, numero_identificacion, tipo_identificacion,
                         primer_nombre, primer_apellido, prioridad,
                         estado_admision, modulo_admision, hora_llegada, hora_admision)
                     VALUES (COALESCE($1::date, CURRENT_DATE), $2, 'CC',
                             $3, $4, 'normal',
                             'admisionado', 'auto_biofile',
                             COALESCE($5::timestamptz, NOW()), COALESCE($5::timestamptz, NOW()))
                     ON CONFLICT (fecha, numero_identificacion)
                     DO UPDATE SET updated_at = NOW()
                     RETURNING id`,
                    [fechaParam, numeroIdentificacion, primerNombre, primerApellido, horaLlegadaBiofile || null]
                );
                pacienteColaId = nuevoCola[0].id;
                resultados.autocreados++;
            }

            // 3. UPSERT de la asignación, ya con paciente_cola_id garantizado.
            //    Si una asignación previa quedó huérfana (sin cola), se vincula aquí.
            const { rows } = await client.query(
                `INSERT INTO asignaciones_profesionales
                    (fecha, paciente_cola_id, numero_identificacion, nombre_paciente, nombre_profesional,
                     area, columna_header, hora_llegada_biofile, terminal_id, login_name_biofile)
                 VALUES (COALESCE($1::date, CURRENT_DATE), $2, $3, $4, $5, $6, $7, $8, $9, $10)
                 ON CONFLICT (fecha, numero_identificacion, columna_header)
                 DO UPDATE SET
                     paciente_cola_id = COALESCE(asignaciones_profesionales.paciente_cola_id, EXCLUDED.paciente_cola_id),
                     nombre_paciente = COALESCE(EXCLUDED.nombre_paciente, asignaciones_profesionales.nombre_paciente),
                     hora_llegada_biofile = EXCLUDED.hora_llegada_biofile,
                     updated_at = NOW()
                 RETURNING (xmax = 0) AS es_nuevo`,
                [fechaParam, pacienteColaId, numeroIdentificacion, nombrePaciente || null, nombreProfesional,
                 area, columnaHeader, horaLlegadaBiofile || null, terminalId || null, loginName]
            );

            await client.query('COMMIT');

            if (rows[0]?.es_nuevo) resultados.nuevos++;
            else resultados.actualizados++;

        } catch (err) {
            await client.query('ROLLBACK').catch(() => {});
            console.error('[extension/sync] error:', numeroIdentificacion, err.message);
            resultados.errores++;
        } finally {
            client.release();
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
