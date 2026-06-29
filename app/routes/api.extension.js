const { Router } = require('express');
const { pool, query } = require('../database/db');
const { validarExtensionSecret } = require('../middleware/validar');

const router = Router();

// GET /api/extension/pendientes — sin auth para que el popup la consuma directo
router.get('/pendientes', async (req, res) => {
    try {
        const { rows } = await query(
            `SELECT id, numero_identificacion,
                    primer_nombre || ' ' || COALESCE(segundo_nombre || ' ','') ||
                    primer_apellido || COALESCE(' ' || segundo_apellido,'') AS nombre_completo,
                    primer_nombre, segundo_nombre, primer_apellido, segundo_apellido,
                    sexo,
                    TO_CHAR(fecha_nacimiento, 'DD/MM/YYYY') AS fecha_nacimiento_fmt,
                    hora_llegada
             FROM pacientes_cola
             WHERE fecha = CURRENT_DATE
               AND estado_admision IN ('esperando','llamando_admision')
             ORDER BY
                 CASE prioridad WHEN 'alta' THEN 1 WHEN 'media' THEN 2 ELSE 3 END,
                 hora_llegada`
        );
        return res.json(rows);
    } catch (err) {
        console.error('[extension/pendientes]', err);
        return res.status(500).json({ error: 'db_error' });
    }
});

router.use(validarExtensionSecret);

// Valida que la fecha sea un día calendario real en formato YYYY-MM-DD.
const FECHA_RE = /^\d{4}-\d{2}-\d{2}$/;
function fechaValida(f) {
    if (typeof f !== 'string' || !FECHA_RE.test(f)) return false;
    const d = new Date(`${f}T00:00:00Z`);
    return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === f;
}

// Divide nombre completo en primer_nombre / primer_apellido de forma robusta.
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
        const fechaParam = fechaValida(fecha) ? fecha : null;

        const client = await pool.connect();
        try {
            await client.query('BEGIN');

            const { rows: colaRows } = await client.query(
                `SELECT id FROM pacientes_cola
                 WHERE fecha = COALESCE($1::date, CURRENT_DATE) AND numero_identificacion = $2`,
                [fechaParam, numeroIdentificacion]
            );
            let pacienteColaId = colaRows[0]?.id || null;

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
