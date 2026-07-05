const { Router } = require('express');
const { pool, query } = require('../database/db');
const { validarExtensionSecret } = require('../middleware/validar');
const { emitUpdatePatients } = require('../sockets/notify');
const { registrarEvento } = require('../utils/audit');

const router = Router();

router.use(validarExtensionSecret);

// GET /api/extension/pendientes — protegido: el popup de la extensión debe enviar
// el header X-Extension-Secret (expone cédulas, nombres y fechas de nacimiento).
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
    const { loginName, terminalId, pacientes, snapshotCompleto } = req.body;
    if (!loginName || !Array.isArray(pacientes)) {
        return res.status(400).json({ error: 'loginName y pacientes[] requeridos' });
    }

    const resultados = { nuevos: 0, actualizados: 0, autocreados: 0, reconciliados: 0, errores: 0 };

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
                     -- Blindaje contra resurrección: si un humano la gestionó (manual_override)
                     -- la sincronización respeta su estado; si la dio de baja la reconciliación
                     -- (cancelado por LIS) y el paciente reaparece, se reactiva como pendiente.
                     activo = CASE WHEN asignaciones_profesionales.manual_override
                                   THEN asignaciones_profesionales.activo ELSE true END,
                     estado = CASE WHEN asignaciones_profesionales.manual_override
                                   THEN asignaciones_profesionales.estado
                                   WHEN asignaciones_profesionales.estado = 'cancelado' THEN 'pendiente'
                                   ELSE asignaciones_profesionales.estado END,
                     updated_at = NOW()
                 RETURNING (xmax = 0) AS es_nuevo`,
                [fechaParam, pacienteColaId, numeroIdentificacion, nombrePaciente || null, nombreProfesional,
                 area, columnaHeader, horaLlegadaBiofile || null, terminalId || null, loginName]
            );

            // Regla de negocio: cuando hay cruce con Biofile, hora_admision del paciente
            // ES la hora del LIS (sobrescritura destructiva). Se toma el MIN de las horas
            // de Biofile de todas sus asignaciones (estable si tiene varias). Sin cruce
            // (particular/manual) min_bio es NULL y no se toca nada. IS DISTINCT FROM
            // evita reescribir en cada sync cuando el valor ya coincide.
            await client.query(
                `UPDATE pacientes_cola pc
                 SET hora_admision = sub.min_bio, updated_at = NOW()
                 FROM (SELECT MIN(hora_llegada_biofile) AS min_bio
                       FROM asignaciones_profesionales
                       WHERE paciente_cola_id = $1 AND hora_llegada_biofile IS NOT NULL) sub
                 WHERE pc.id = $1 AND sub.min_bio IS NOT NULL
                   AND pc.hora_admision IS DISTINCT FROM sub.min_bio`,
                [pacienteColaId]
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

    // ── State Reconciliation ──────────────────────────────────────────────────
    // Solo se reconcilia cuando el cliente garantiza que `pacientes` es el snapshot
    // COMPLETO del LIS para ese login. Con snapshot parcial (o vacío) jamás se da de
    // baja nada, para no borrar en masa por un fallo de scraping (modo seguro).
    if (snapshotCompleto === true && pacientes.length > 0) {
        // Agrupa las claves entrantes por fecha efectiva (COALESCE(fecha, CURRENT_DATE)).
        // Las fechas ausentes/ inválidas comparten un grupo cuyo scope cae a CURRENT_DATE.
        const grupos = new Map(); // key -> { fechaParam, claves:Set }
        for (const p of pacientes) {
            if (!p.numeroIdentificacion || !p.nombreProfesional || !p.columnaHeader) continue;
            const fechaParam = fechaValida(p.fecha) ? p.fecha : null;
            const key = fechaParam === null ? '__hoy__' : fechaParam;
            if (!grupos.has(key)) grupos.set(key, { fechaParam, claves: new Set() });
            grupos.get(key).claves.add(`${p.numeroIdentificacion}|${p.columnaHeader}`);
        }

        for (const { fechaParam, claves } of grupos.values()) {
            const rc = await pool.connect();
            try {
                await rc.query('BEGIN');
                // Bloquea el scope (fecha, login) para evitar carreras con upserts concurrentes.
                const { rows: existentes } = await rc.query(
                    `SELECT id, numero_identificacion, columna_header, estado, manual_override
                     FROM asignaciones_profesionales
                     WHERE fecha = COALESCE($1::date, CURRENT_DATE)
                       AND login_name_biofile = $2
                       AND activo = true
                       AND origen = 'biofile'
                     FOR UPDATE`,
                    [fechaParam, loginName]
                );
                for (const row of existentes) {
                    const clave = `${row.numero_identificacion}|${row.columna_header}`;
                    if (claves.has(clave)) continue;                       // sigue en el LIS
                    if (['llamando', 'en_atencion', 'finalizado'].includes(row.estado)) continue; // en curso
                    if (row.manual_override) continue;                     // gestionado por un humano
                    await rc.query(
                        `UPDATE asignaciones_profesionales
                         SET activo = false, estado = 'cancelado',
                             origen_baja = 'lis', updated_at = NOW()
                         WHERE id = $1`,
                        [row.id]
                    );
                    resultados.reconciliados++;
                }
                await rc.query('COMMIT');
            } catch (err) {
                await rc.query('ROLLBACK').catch(() => {});
                console.error('[extension/sync] reconciliación error:', err.message);
            } finally {
                rc.release();
            }
        }
    }

    // PASO 5 — Reactividad: en cuanto entra un payload exitoso notificamos a las vistas
    // que renderizan el estado global (admin y profesional) para que recarguen sin
    // intervención humana; extension:sync se mantiene para el profesional.
    const io = req.app.get('io');
    if (io) {
        emitUpdatePatients(io);
        if (resultados.nuevos > 0) {
            io.to(`profesional:${loginName}`).emit('extension:sync', { loginName, resultados });
        }
    }

    if (resultados.reconciliados > 0) {
        registrarEvento({
            tipo: 'sync_reconciliacion',
            descripcion: `Reconciliación: ${resultados.reconciliados} bajas (login ${loginName})`,
            terminalId, datos: { loginName, reconciliados: resultados.reconciliados }
        });
    }

    return res.json({ ok: true, ...resultados });
});

// GET /api/extension/heartbeat
router.get('/heartbeat', (req, res) => {
    res.json({ ok: true, ts: new Date().toISOString() });
});

module.exports = router;
