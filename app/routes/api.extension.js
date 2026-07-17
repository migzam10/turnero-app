const { Router } = require('express');
const { pool, query } = require('../database/db');
const { validarExtensionSecret } = require('../middleware/validar');
const { emitUpdatePatients } = require('../sockets/notify');
const { registrarEvento } = require('../utils/audit');
const { normalizarIdentificacion } = require('../utils/identificacion');
const { canonizar } = require('../utils/nombreProfesional');
const { resolverProfesional } = require('../services/profesionales');

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
    const { loginName, terminalId, pacientes: pacientesCrudos, snapshotCompleto } = req.body;
    if (!loginName || !Array.isArray(pacientesCrudos)) {
        return res.status(400).json({ error: 'loginName y pacientes[] requeridos' });
    }

    // El backend canoniza el nombre del profesional; NO confía en que la extensión lo haya
    // hecho. La extensión corre en el Chrome de cada PC y se actualiza por separado: si la
    // identidad dependiera de ella, una PC con una versión vieja crearía profesionales
    // fantasma. Se hace UNA vez aquí, en el borde, porque el mismo valor lo consumen dos
    // caminos —el upsert y la reconciliación— y `columna_header` es a la vez la llave del
    // ON CONFLICT y la del delta. Canonizar en uno solo haría que la reconciliación no
    // reconociera las filas que el upsert acaba de escribir y las cancelara como stale.
    const pacientes = pacientesCrudos.map(p => ({
        ...p,
        nombreProfesional: canonizar(p.nombreProfesional),
        columnaHeader: canonizar(p.columnaHeader),
        nombreProfesionalCrudo: p.nombreProfesional,   // se conserva para el display
    }));

    const resultados = { nuevos: 0, actualizados: 0, autocreados: 0, reconciliados: 0, errores: 0,
                         profesionalesNuevos: 0 };

    for (const p of pacientes) {
        const { numeroIdentificacion: cedulaCruda, ordenServicio, nombrePaciente, nombreProfesional, area, columnaHeader, horaLlegadaBiofile, fecha, nombreProfesionalCrudo } = p;
        if (!cedulaCruda || !nombreProfesional || !columnaHeader) {
            resultados.errores++;
            continue;
        }
        // Canoniza la cédula (sin ceros a la izquierda) para que empate con lo que guarda
        // recepción: su lector rellena con ceros hasta 10 dígitos y Biofile no los usa.
        const numeroIdentificacion = normalizarIdentificacion(cedulaCruda);
        const fechaParam = fechaValida(fecha) ? fecha : null;
        const osParam = (ordenServicio != null && String(ordenServicio).trim() !== '')
            ? String(ordenServicio).trim() : null;

        const client = await pool.connect();
        try {
            await client.query('BEGIN');

            // Resuelve el INGRESO (llaveado por OS). Cada OS de Biofile es una orden
            // independiente; la resolución decide entre reabrir la misma OS, sellar el
            // registro de recepción, o crear un ingreso nuevo.
            let pacienteColaId = null;
            let ingresoCerrado = false;

            if (osParam) {
                // (1) ¿Ya existe el ingreso de ESA OS? → usarlo (misma orden → posible reapertura).
                const { rows: osRows } = await client.query(
                    `SELECT id, cerrado FROM pacientes_cola
                     WHERE fecha = COALESCE($1::date, CURRENT_DATE)
                       AND numero_identificacion = $2 AND orden_servicio = $3`,
                    [fechaParam, numeroIdentificacion, osParam]
                );
                if (osRows[0]) {
                    pacienteColaId = osRows[0].id;
                    ingresoCerrado = osRows[0].cerrado === true;
                } else {
                    // (2) ¿Hay un registro de recepción ABIERTO sin OS? → sellarlo con esta OS.
                    // El `AND orden_servicio IS NULL` externo evita pisar un sellado concurrente.
                    const { rows: shellRows } = await client.query(
                        `UPDATE pacientes_cola SET orden_servicio = $3, updated_at = NOW()
                         WHERE id = (
                             SELECT id FROM pacientes_cola
                             WHERE fecha = COALESCE($1::date, CURRENT_DATE)
                               AND numero_identificacion = $2
                               AND orden_servicio IS NULL AND NOT cerrado
                             ORDER BY created_at ASC LIMIT 1)
                           AND orden_servicio IS NULL
                         RETURNING id`,
                        [fechaParam, numeroIdentificacion, osParam]
                    );
                    if (shellRows[0]) pacienteColaId = shellRows[0].id;
                }
            } else {
                // Sin OS (extensión previa / fila atípica): fallback al ingreso abierto más reciente.
                const { rows: colaRows } = await client.query(
                    `SELECT id, cerrado FROM pacientes_cola
                     WHERE fecha = COALESCE($1::date, CURRENT_DATE) AND numero_identificacion = $2
                     ORDER BY cerrado ASC, created_at DESC LIMIT 1`,
                    [fechaParam, numeroIdentificacion]
                );
                if (colaRows[0]) {
                    pacienteColaId = colaRows[0].id;
                    ingresoCerrado = colaRows[0].cerrado === true;
                }
            }

            if (!pacienteColaId) {
                // (3) Ingreso nuevo (con OS si la hay). OS nueva ⇒ ingreso separado aunque
                // sea el mismo profesional. El ON CONFLICT cubre la carrera de dos syncs
                // creando la misma OS a la vez (solo aplica cuando hay OS).
                const { primerNombre, primerApellido } = dividirNombre(nombrePaciente);
                const conflicto = osParam
                    ? `ON CONFLICT (fecha, numero_identificacion, orden_servicio) WHERE orden_servicio IS NOT NULL
                       DO UPDATE SET updated_at = NOW()`
                    : '';
                const { rows: nuevoCola } = await client.query(
                    `INSERT INTO pacientes_cola
                        (fecha, numero_identificacion, tipo_identificacion, orden_servicio,
                         primer_nombre, primer_apellido, prioridad,
                         estado_admision, modulo_admision, hora_llegada, hora_admision)
                     VALUES (COALESCE($1::date, CURRENT_DATE), $2, 'CC', $6,
                             $3, $4, 'normal',
                             'admisionado', 'auto_biofile',
                             COALESCE($5::timestamptz, NOW()), COALESCE($5::timestamptz, NOW()))
                     ${conflicto}
                     RETURNING id`,
                    [fechaParam, numeroIdentificacion, primerNombre, primerApellido, horaLlegadaBiofile || null, osParam]
                );
                pacienteColaId = nuevoCola[0].id;
                ingresoCerrado = false;
                resultados.autocreados++;
            }

            // Aprovisiona/refresca al profesional ANTES de la asignación, dentro de la misma
            // transacción: la FK exige que la fila exista, y si algo falla se deshace todo
            // junto en vez de dejar un profesional a medio crear.
            const { id: profesionalId, esNuevo: profesionalNuevo } =
                await resolverProfesional(client, nombreProfesionalCrudo || nombreProfesional);

            const { rows } = await client.query(
                `INSERT INTO asignaciones_profesionales
                    (fecha, paciente_cola_id, numero_identificacion, nombre_paciente, nombre_profesional,
                     area, columna_header, hora_llegada_biofile, terminal_id, login_name_biofile,
                     profesional_id)
                 VALUES (COALESCE($1::date, CURRENT_DATE), $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
                 ON CONFLICT (paciente_cola_id, columna_header)
                 DO UPDATE SET
                     profesional_id  = COALESCE(EXCLUDED.profesional_id, asignaciones_profesionales.profesional_id),
                     nombre_paciente = COALESCE(EXCLUDED.nombre_paciente, asignaciones_profesionales.nombre_paciente),
                     hora_llegada_biofile = EXCLUDED.hora_llegada_biofile,
                     -- El sello del login se refresca al del último escaneo. Antes quedaba
                     -- congelado desde el INSERT: si la fila la creó otra PC/usuario de Biofile
                     -- (multi-sesión) nunca coincidía con el login que reconciliaba y quedaba
                     -- huérfana. Ahora la reconciliación ya no depende del login (scope por fecha).
                     login_name_biofile = EXCLUDED.login_name_biofile,
                     -- Blindaje contra resurrección: si un humano la gestionó (manual_override)
                     -- la sincronización respeta su estado; si la dio de baja la reconciliación
                     -- (cancelado por LIS) y el paciente reaparece, se reactiva como pendiente.
                     activo = CASE WHEN asignaciones_profesionales.manual_override
                                   THEN asignaciones_profesionales.activo ELSE true END,
                     estado = CASE WHEN asignaciones_profesionales.manual_override
                                   THEN asignaciones_profesionales.estado
                                   WHEN asignaciones_profesionales.estado = 'cancelado' THEN 'pendiente'
                                   ELSE asignaciones_profesionales.estado END,
                     -- Al reactivar una fila que la reconciliación había dado de baja, se
                     -- limpia origen_baja (si no, queda 'lis' pegado en una fila ya activa).
                     -- Con manual_override se respeta lo que puso la persona.
                     origen_baja = CASE WHEN asignaciones_profesionales.manual_override
                                        THEN asignaciones_profesionales.origen_baja ELSE NULL END,
                     updated_at = NOW()
                 RETURNING (xmax = 0) AS es_nuevo, estado`,
                [fechaParam, pacienteColaId, numeroIdentificacion, nombrePaciente || null, nombreProfesional,
                 area, columnaHeader, horaLlegadaBiofile || null, terminalId || null, loginName,
                 profesionalId]
            );

            // Reapertura (#1): si el ingreso estaba cerrado y ahora entra un examen ACTIVO
            // (pendiente/llamando/en_atencion) —típicamente un examen extra agregado a la
            // orden ya cerrada—, se reabre la atención. Un re-sync de un examen ya finalizado
            // conserva 'finalizado' y NO reabre, así que las órdenes cerradas no reviven solas.
            if (ingresoCerrado && ['pendiente', 'llamando', 'en_atencion'].includes(rows[0]?.estado)) {
                await client.query(
                    `UPDATE pacientes_cola SET cerrado = false, updated_at = NOW() WHERE id = $1`,
                    [pacienteColaId]
                );
                ingresoCerrado = false;
            }

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
            // Después del COMMIT, igual que los contadores de arriba: si la transacción
            // hubiera hecho rollback el profesional no existiría, y contarlo aquí evita
            // avisarle al panel de alguien que nunca se creó.
            if (profesionalNuevo) resultados.profesionalesNuevos++;

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
    // COMPLETO del tablero de Biofile (global, todos los profesionales). Con snapshot
    // parcial (o vacío) jamás se da de baja nada, para no borrar en masa por un fallo de
    // scraping (modo seguro). El scope de la baja es por fecha (ver query más abajo).
    if (snapshotCompleto === true && pacientes.length > 0) {
        // Agrupa las claves entrantes por fecha efectiva (COALESCE(fecha, CURRENT_DATE)).
        // Las fechas ausentes/ inválidas comparten un grupo cuyo scope cae a CURRENT_DATE.
        // La clave de reconciliación incluye la OS (misma que usa el dedup de la extensión):
        // así el mismo profesional en dos OS distintas se reconcilia por separado y no se
        // cancela/omite cruzado entre órdenes. Sin OS cae a la cédula (compat extensión vieja).
        const claveDe = (os, columna, cedula) =>
            `${(os != null && String(os).trim() !== '') ? String(os).trim() : cedula}|${columna}`;
        const grupos = new Map(); // key -> { fechaParam, claves:Set }
        for (const p of pacientes) {
            if (!p.numeroIdentificacion || !p.nombreProfesional || !p.columnaHeader) continue;
            const fechaParam = fechaValida(p.fecha) ? p.fecha : null;
            const key = fechaParam === null ? '__hoy__' : fechaParam;
            if (!grupos.has(key)) grupos.set(key, { fechaParam, claves: new Set() });
            // Misma canonización que en el upsert: si no hay OS la clave cae a la cédula,
            // y debe ser la forma sin ceros para empatar con lo guardado.
            grupos.get(key).claves.add(
                claveDe(p.ordenServicio, p.columnaHeader, normalizarIdentificacion(p.numeroIdentificacion)));
        }

        for (const { fechaParam, claves } of grupos.values()) {
            const rc = await pool.connect();
            try {
                await rc.query('BEGIN');
                // Scope SOLO por fecha (ya NO por login_name_biofile). PacientesSeguimiento es
                // un tablero global: un snapshot completo de cualquier sesión de Biofile ve a
                // TODOS los profesionales, así que es autoritativo para toda la fecha. Filtrar
                // por login fragmentaba la limpieza cuando la extensión corría en 2 PC con
                // usuarios distintos: la fila creada por un usuario nunca la reconciliaba el
                // otro y quedaba pegada. FOR UPDATE bloquea el scope contra carreras.
                const { rows: existentes } = await rc.query(
                    `SELECT ap.id, ap.numero_identificacion, ap.columna_header, ap.estado,
                            ap.manual_override, pc.orden_servicio
                     FROM asignaciones_profesionales ap
                     JOIN pacientes_cola pc ON pc.id = ap.paciente_cola_id
                     WHERE ap.fecha = COALESCE($1::date, CURRENT_DATE)
                       AND ap.activo = true
                       AND ap.origen = 'biofile'
                     FOR UPDATE OF ap`,
                    [fechaParam]
                );
                for (const row of existentes) {
                    const clave = claveDe(row.orden_servicio, row.columna_header, row.numero_identificacion);
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
        // Biofile estrenó un profesional: el panel lo muestra sin que nadie recargue.
        if (resultados.profesionalesNuevos > 0) {
            io.emit('profesionales:actualizados', { ts: Date.now() });
        }
    }

    if (resultados.profesionalesNuevos > 0) {
        registrarEvento({
            tipo: 'profesional_descubierto',
            descripcion: `Sync descubrió ${resultados.profesionalesNuevos} profesional(es) nuevo(s) en Biofile`,
            terminalId, datos: { loginName, nuevos: resultados.profesionalesNuevos }
        });
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
