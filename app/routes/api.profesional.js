const { Router } = require('express');
const { pool, query } = require('../database/db');
const { validarTerminalId } = require('../middleware/validar');
const { emitUpdatePatients } = require('../sockets/notify');
const { registrarEvento } = require('../utils/audit');

const router = Router();

// Valida que la fecha sea un día calendario real en formato YYYY-MM-DD.
const FECHA_RE = /^\d{4}-\d{2}-\d{2}$/;
function fechaValida(f) {
    if (typeof f !== 'string' || !FECHA_RE.test(f)) return false;
    const d = new Date(`${f}T00:00:00Z`);
    return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === f;
}

// GET /api/profesional/asignaciones?profesional=KENDY+ZABALETA[&fecha=YYYY-MM-DD]
// Sin fecha → día actual; con fecha pasada → historial de ese día. En ambos casos
// se devuelven también los finalizados (la vista en vivo los muestra al final, en
// la sección "Atendidos hoy"); el orden fino de esa sección lo hace el frontend.
router.get('/asignaciones', validarTerminalId, async (req, res) => {
    const { profesional, fecha } = req.query;
    if (!profesional) {
        return res.status(400).json({ error: 'Query param profesional requerido' });
    }
    if (fecha !== undefined && !fechaValida(fecha)) {
        return res.status(400).json({ error: 'fecha_invalida', detalle: 'Formato esperado YYYY-MM-DD' });
    }
    const fechaParam = fecha || null; // null → COALESCE cae a CURRENT_DATE
    try {
        const { rows } = await query(
            `SELECT
                ap.id, ap.numero_identificacion,
                COALESCE(
                    pc.primer_nombre || ' ' || COALESCE(pc.segundo_nombre || ' ','') ||
                    pc.primer_apellido || COALESCE(' ' || pc.segundo_apellido,''),
                    ap.nombre_paciente,
                    ap.numero_identificacion
                ) AS nombre_completo,
                COALESCE(pc.prioridad, 'normal') AS prioridad,
                ap.area, ap.columna_header, ap.estado, ap.consultorio_profesional,
                pc.hora_llegada AS hora_llegada_fisica,
                ap.hora_llegada_biofile,
                ap.hora_llamado, ap.hora_en_atencion, ap.hora_finalizado,
                EXISTS (
                    SELECT 1 FROM asignaciones_profesionales otro
                    WHERE otro.numero_identificacion = ap.numero_identificacion
                      AND otro.fecha = COALESCE($2::date, CURRENT_DATE)
                      AND otro.nombre_profesional <> $1
                      AND otro.estado IN ('llamando','en_atencion')
                ) AS bloqueado,
                (SELECT COALESCE(otro.consultorio_profesional, otro.nombre_profesional)
                 FROM asignaciones_profesionales otro
                 WHERE otro.numero_identificacion = ap.numero_identificacion
                   AND otro.fecha = COALESCE($2::date, CURRENT_DATE)
                   AND otro.nombre_profesional <> $1
                   AND otro.estado IN ('llamando','en_atencion')
                 ORDER BY otro.consultorio_profesional IS NULL,
                          CASE otro.estado WHEN 'en_atencion' THEN 1 ELSE 2 END
                 LIMIT 1) AS bloqueado_por
             FROM asignaciones_profesionales ap
             LEFT JOIN pacientes_cola pc ON pc.id = ap.paciente_cola_id
             WHERE ap.fecha = COALESCE($2::date, CURRENT_DATE)
               AND ap.nombre_profesional = $1
               AND ap.activo = true
             ORDER BY
                 CASE ap.estado WHEN 'en_atencion' THEN 1 WHEN 'llamando' THEN 2
                                WHEN 'finalizado' THEN 4 ELSE 3 END,
                 CASE COALESCE(pc.prioridad,'normal') WHEN 'alta' THEN 1 WHEN 'media' THEN 2 ELSE 3 END,
                 ap.hora_llegada_biofile`,
            [profesional, fechaParam]
        );
        return res.json(rows);
    } catch (err) {
        console.error('[profesional/asignaciones]', err);
        return res.status(500).json({ error: 'db_error' });
    }
});

// GET /api/profesional/listado-profesionales
router.get('/listado-profesionales', async (req, res) => {
    try {
        const { rows } = await query(
            `SELECT DISTINCT nombre_profesional FROM asignaciones_profesionales
             WHERE fecha = CURRENT_DATE AND activo = true ORDER BY nombre_profesional`
        );
        return res.json(rows.map(r => r.nombre_profesional));
    } catch (err) {
        console.error('[profesional/listado-profesionales]', err);
        return res.status(500).json({ error: 'db_error' });
    }
});

// GET /api/profesional/catalogo
// Nombres de profesionales vistos en los últimos 60 días, para el autocompletar al
// asignar manualmente. A diferencia de /listado-profesionales (solo HOY, queda vacío
// temprano), este sugiere el histórico reciente.
router.get('/catalogo', async (req, res) => {
    try {
        const { rows } = await query(
            `SELECT DISTINCT nombre_profesional FROM asignaciones_profesionales
             WHERE fecha >= CURRENT_DATE - INTERVAL '60 days'
               AND nombre_profesional IS NOT NULL
             ORDER BY nombre_profesional`
        );
        return res.json(rows.map(r => r.nombre_profesional));
    } catch (err) {
        console.error('[profesional/catalogo]', err);
        return res.status(500).json({ error: 'db_error' });
    }
});

// GET /api/profesional/resumen-hoy?profesional=NOMBRE
// Contador "Finalizados hoy" de la pantalla del profesional. La vista en vivo
// excluye los finalizados, por eso se cuentan aparte aquí.
router.get('/resumen-hoy', validarTerminalId, async (req, res) => {
    const { profesional } = req.query;
    if (!profesional) return res.status(400).json({ error: 'Campo profesional requerido' });
    try {
        const { rows } = await query(
            `SELECT COUNT(*)::int AS finalizados
             FROM asignaciones_profesionales
             WHERE nombre_profesional = $1 AND fecha = CURRENT_DATE
               AND activo = true AND estado = 'finalizado'`,
            [profesional]
        );
        return res.json({ finalizados: rows[0].finalizados });
    } catch (err) {
        console.error('[profesional/resumen-hoy]', err);
        return res.status(500).json({ error: 'db_error' });
    }
});

// GET /api/profesional/consultorios
// Catálogo de consultorios activos para el setup de la pantalla del profesional.
// Solo lectura, sin validarTerminalId (igual que /listado-profesionales).
router.get('/consultorios', async (req, res) => {
    try {
        const { rows } = await query(
            `SELECT id, nombre, multipaciente FROM consultorios
             WHERE activo = true ORDER BY nombre`
        );
        return res.json(rows);
    } catch (err) {
        console.error('[profesional/consultorios]', err);
        return res.status(500).json({ error: 'db_error' });
    }
});

// POST /api/profesional/llamar/:id
router.post('/llamar/:id', validarTerminalId, async (req, res) => {
    const { profesional, consultorio } = req.body;
    if (!profesional) return res.status(400).json({ error: 'Campo profesional requerido' });
    try {
        // Toda la decisión (multipaciente + UPDATE con guards + diagnóstico) se
        // serializa con un advisory lock transaccional: bajo READ COMMITTED el
        // NOT EXISTS embebido NO evita el write-skew (dos requests paralelos ven
        // cada uno la otra fila aún 'pendiente'). El tráfico es bajísimo, así que
        // un lock GLOBAL de la operación es correcto y elimina toda la sutileza.
        const client = await pool.connect();
        let fila = null, error409 = null;
        try {
            await client.query('BEGIN');
            // El lock se libera solo al COMMIT/ROLLBACK. Tras adquirirlo, cada
            // statement toma snapshot nuevo y ve lo ya commiteado por el ganador.
            await client.query(`SELECT pg_advisory_xact_lock(hashtext('profesional:llamar'))`);

            // (a) Consultorio multipaciente: permite varios pacientes activos a la
            // vez → se omite el guard de paciente activo. Nombre fuera del catálogo
            // (texto legacy) → false.
            let esMultipaciente = false;
            if (consultorio) {
                const { rows: cons } = await client.query(
                    `SELECT multipaciente FROM consultorios WHERE nombre = $1 AND activo = true`,
                    [consultorio]
                );
                esMultipaciente = cons[0]?.multipaciente === true;
            }

            // (b) UPDATE atómico con los guards embebidos: solo transiciona si la
            // fila sigue 'pendiente', el profesional no tiene otro paciente activo
            // (salvo multipaciente, $3) y el paciente no está tomado por OTRO.
            const { rows, rowCount } = await client.query(
                `UPDATE asignaciones_profesionales ap
                 SET estado = 'llamando', hora_llamado = NOW(),
                     consultorio_profesional = $2, updated_at = NOW()
                 WHERE ap.id = $1 AND ap.estado = 'pendiente'
                   AND ($3::boolean OR NOT EXISTS (
                       SELECT 1 FROM asignaciones_profesionales a2
                       WHERE a2.nombre_profesional = $4 AND a2.fecha = CURRENT_DATE
                         AND a2.activo = true AND a2.estado IN ('llamando','en_atencion')))
                   AND NOT EXISTS (
                       SELECT 1 FROM asignaciones_profesionales a3
                       WHERE a3.numero_identificacion = ap.numero_identificacion
                         AND a3.fecha = CURRENT_DATE AND a3.activo = true
                         AND a3.nombre_profesional <> $4
                         AND a3.estado IN ('llamando','en_atencion'))
                 RETURNING *`,
                [req.params.id, consultorio || null, esMultipaciente, profesional]
            );

            // (c) rowCount 0: el UPDATE no aplicó por algún guard. Se diagnostica
            // con los mismos SELECTs (ahora solo para elegir qué 409 devolver).
            if (rowCount === 0) {
                if (!esMultipaciente) {
                    const { rows: activos } = await client.query(
                        `SELECT 1 FROM asignaciones_profesionales
                         WHERE nombre_profesional = $1 AND fecha = CURRENT_DATE
                           AND activo = true
                           AND estado IN ('llamando','en_atencion') LIMIT 1`,
                        [profesional]
                    );
                    if (activos.length > 0) error409 = 'ya_tiene_paciente_activo';
                }

                if (!error409) {
                    const { rows: bloqueado } = await client.query(
                        `SELECT 1 FROM asignaciones_profesionales ap2
                         WHERE ap2.numero_identificacion = (
                             SELECT numero_identificacion FROM asignaciones_profesionales WHERE id = $1
                         )
                         AND ap2.fecha = CURRENT_DATE
                         AND ap2.activo = true
                         AND ap2.nombre_profesional <> $2
                         AND ap2.estado IN ('llamando','en_atencion') LIMIT 1`,
                        [req.params.id, profesional]
                    );
                    error409 = bloqueado.length > 0 ? 'paciente_bloqueado' : 'estado_invalido';
                }
            } else {
                fila = rows[0];
            }

            await client.query('COMMIT');
        } catch (err) {
            await client.query('ROLLBACK').catch(() => {});
            throw err; // lo captura el try/catch externo → 500 db_error
        } finally {
            client.release();
        }

        if (error409) return res.status(409).json({ error: error409 });

        // Obtener nombre del paciente para el display
        const { rows: conNombre } = await query(
            `SELECT COALESCE(
                    pc.primer_nombre || ' ' || COALESCE(pc.segundo_nombre || ' ','') ||
                    pc.primer_apellido || COALESCE(' ' || pc.segundo_apellido,''),
                    ap.nombre_paciente, ap.numero_identificacion) AS nombre_paciente
             FROM asignaciones_profesionales ap
             LEFT JOIN pacientes_cola pc ON pc.id = ap.paciente_cola_id
             WHERE ap.id = $1`,
            [req.params.id]
        );

        const payload = { ...fila, nombre_paciente: conNombre[0]?.nombre_paciente, consultorio };

        const io = req.app.get('io');
        io.to(`profesional:${profesional}`).emit('asignacion:llamando', payload);
        io.to('display').emit('asignacion:llamando', payload);
        emitUpdatePatients(io);

        registrarEvento({
            tipo: 'prof_llamado',
            descripcion: `${profesional} llamó a ${payload.nombre_paciente} (${consultorio || fila.area || 'sin consultorio'})`,
            pacienteId: fila.paciente_cola_id, terminalId: req.terminalId,
            datos: { profesional, consultorio: consultorio || null }
        });

        return res.json(payload);
    } catch (err) {
        console.error('[profesional/llamar]', err);
        return res.status(500).json({ error: 'db_error' });
    }
});

// POST /api/profesional/en-atencion/:id
router.post('/en-atencion/:id', validarTerminalId, async (req, res) => {
    const { profesional, consultorio } = req.body;
    try {
        const { rows, rowCount } = await query(
            `UPDATE asignaciones_profesionales
             SET estado = 'en_atencion', hora_en_atencion = NOW(),
                 consultorio_profesional = COALESCE($2, consultorio_profesional), updated_at = NOW()
             WHERE id = $1 AND estado = 'llamando'
             RETURNING *`,
            [req.params.id, consultorio || null]
        );
        if (rowCount === 0) return res.status(409).json({ error: 'estado_invalido' });

        const { rows: conNombre } = await query(
            `SELECT COALESCE(
                    pc.primer_nombre || ' ' || COALESCE(pc.segundo_nombre || ' ','') ||
                    pc.primer_apellido || COALESCE(' ' || pc.segundo_apellido,''),
                    ap.nombre_paciente, ap.numero_identificacion) AS nombre_paciente
             FROM asignaciones_profesionales ap
             LEFT JOIN pacientes_cola pc ON pc.id = ap.paciente_cola_id
             WHERE ap.id = $1`,
            [req.params.id]
        );

        const payload = { ...rows[0], nombre_paciente: conNombre[0]?.nombre_paciente };

        const io = req.app.get('io');
        if (profesional) io.to(`profesional:${profesional}`).emit('asignacion:en_atencion', payload);
        io.to('display').emit('asignacion:en_atencion', payload);
        emitUpdatePatients(io);

        registrarEvento({
            tipo: 'prof_en_atencion',
            descripcion: `${payload.nombre_paciente} en atención con ${rows[0].nombre_profesional}`,
            pacienteId: rows[0].paciente_cola_id, terminalId: req.terminalId,
            datos: { profesional: rows[0].nombre_profesional }
        });

        return res.json(payload);
    } catch (err) {
        console.error('[profesional/en-atencion]', err);
        return res.status(500).json({ error: 'db_error' });
    }
});

// POST /api/profesional/cancelar-llamado/:id
router.post('/cancelar-llamado/:id', validarTerminalId, async (req, res) => {
    const { profesional } = req.body;
    try {
        const { rows, rowCount } = await query(
            `UPDATE asignaciones_profesionales
             SET estado = 'pendiente', hora_llamado = NULL, updated_at = NOW()
             WHERE id = $1 AND estado = 'llamando'
             RETURNING *`,
            [req.params.id]
        );
        if (rowCount === 0) return res.status(409).json({ error: 'estado_invalido' });

        const io = req.app.get('io');
        if (profesional) io.to(`profesional:${profesional}`).emit('asignacion:cancelado', rows[0]);
        io.to('display').emit('asignacion:cancelado', rows[0]);
        emitUpdatePatients(io);

        registrarEvento({
            tipo: 'prof_llamado_cancelado',
            descripcion: `${rows[0].nombre_profesional} canceló el llamado de ${rows[0].nombre_paciente || rows[0].numero_identificacion}`,
            pacienteId: rows[0].paciente_cola_id, terminalId: req.terminalId,
            datos: { profesional: rows[0].nombre_profesional }
        });

        return res.json(rows[0]);
    } catch (err) {
        console.error('[profesional/cancelar-llamado]', err);
        return res.status(500).json({ error: 'db_error' });
    }
});

// POST /api/profesional/finalizar/:id
router.post('/finalizar/:id', validarTerminalId, async (req, res) => {
    const { profesional } = req.body;
    try {
        const { rows, rowCount } = await query(
            `UPDATE asignaciones_profesionales
             SET estado = 'finalizado', hora_finalizado = NOW(), updated_at = NOW()
             WHERE id = $1 AND estado = 'en_atencion'
             RETURNING *`,
            [req.params.id]
        );
        if (rowCount === 0) return res.status(409).json({ error: 'estado_invalido' });

        // Cierra el INGRESO si ya no quedan exámenes activos por atender y la admisión
        // está hecha: esta última finalización es su "fecha de terminación". Si más tarde
        // llega un examen extra (sync o admisiones) el ingreso se reabre y la fecha avanza.
        await query(
            `UPDATE pacientes_cola pc SET cerrado = true, updated_at = NOW()
             WHERE pc.id = $1 AND pc.estado_admision = 'admisionado'
               AND NOT EXISTS (
                   SELECT 1 FROM asignaciones_profesionales a
                   WHERE a.paciente_cola_id = pc.id AND a.activo = true
                     AND a.estado IN ('pendiente','llamando','en_atencion'))`,
            [rows[0].paciente_cola_id]
        );

        const io = req.app.get('io');
        if (profesional) io.to(`profesional:${profesional}`).emit('asignacion:finalizado', rows[0]);
        io.to('display').emit('asignacion:finalizado', rows[0]);
        emitUpdatePatients(io);

        registrarEvento({
            tipo: 'prof_finalizado',
            descripcion: `${rows[0].nombre_profesional} finalizó a ${rows[0].nombre_paciente || rows[0].numero_identificacion}`,
            pacienteId: rows[0].paciente_cola_id, terminalId: req.terminalId,
            datos: { profesional: rows[0].nombre_profesional }
        });

        return res.json(rows[0]);
    } catch (err) {
        console.error('[profesional/finalizar]', err);
        return res.status(500).json({ error: 'db_error' });
    }
});

// POST /api/profesional/reasignar/:id
// Reasigna manualmente la asignación a otro profesional. Solo sobre filas
// 'pendiente' o 'cancelado' (nunca en curso). Marca manual_override para que la
// sincronización del LIS no la revierta.
router.post('/reasignar/:id', validarTerminalId, async (req, res) => {
    const { profesional, nuevo_profesional } = req.body;
    if (!nuevo_profesional || !String(nuevo_profesional).trim()) {
        return res.status(400).json({ error: 'nuevo_profesional requerido' });
    }
    const nuevo = String(nuevo_profesional).trim().toUpperCase();
    try {
        const { rows, rowCount } = await query(
            `UPDATE asignaciones_profesionales
             SET nombre_profesional = $2, columna_header = $2, estado = 'pendiente',
                 activo = true, manual_override = true, origen_baja = NULL, updated_at = NOW()
             WHERE id = $1 AND estado IN ('pendiente','cancelado')
             RETURNING *`,
            [req.params.id, nuevo]
        );
        if (rowCount === 0) return res.status(409).json({ error: 'estado_invalido' });

        const io = req.app.get('io');
        const viejo = profesional || rows[0].nombre_profesional;
        io.to(`profesional:${viejo}`).emit('asignacion:reasignado', rows[0]);
        io.to(`profesional:${nuevo}`).emit('asignacion:reasignado', rows[0]);
        io.to('display').emit('asignacion:reasignado', rows[0]);
        emitUpdatePatients(io);

        registrarEvento({
            tipo: 'prof_reasignado',
            descripcion: `Asignación de ${rows[0].nombre_paciente || rows[0].numero_identificacion}: ${viejo} → ${nuevo}`,
            pacienteId: rows[0].paciente_cola_id, terminalId: req.terminalId,
            datos: { de: viejo, a: nuevo }
        });

        return res.json(rows[0]);
    } catch (err) {
        // UNIQUE (fecha, numero_identificacion, columna_header): el paciente ya tiene
        // una asignación con ese profesional destino.
        if (err.code === '23505') return res.status(409).json({ error: 'destino_duplicado' });
        console.error('[profesional/reasignar]', err);
        return res.status(500).json({ error: 'db_error' });
    }
});

// POST /api/profesional/cancelar-asignacion/:id
// Da de baja MANUAL una asignación (distinto de cancelar-llamado, que solo revierte
// un 'llamando' a 'pendiente'). Solo sobre 'pendiente'/'cancelado'. El override
// impide que la sincronización del LIS la reviva.
router.post('/cancelar-asignacion/:id', validarTerminalId, async (req, res) => {
    const { profesional } = req.body;
    try {
        const { rows, rowCount } = await query(
            `UPDATE asignaciones_profesionales
             SET activo = false, estado = 'cancelado', manual_override = true,
                 origen_baja = 'manual', updated_at = NOW()
             WHERE id = $1 AND estado IN ('pendiente','cancelado')
             RETURNING *`,
            [req.params.id]
        );
        if (rowCount === 0) return res.status(409).json({ error: 'estado_invalido' });

        const io = req.app.get('io');
        const prof = profesional || rows[0].nombre_profesional;
        io.to(`profesional:${prof}`).emit('asignacion:cancelado_manual', rows[0]);
        io.to('display').emit('asignacion:cancelado_manual', rows[0]);
        emitUpdatePatients(io);

        registrarEvento({
            tipo: 'asignacion_cancelada',
            descripcion: `Baja manual de ${rows[0].nombre_paciente || rows[0].numero_identificacion} con ${prof}`,
            pacienteId: rows[0].paciente_cola_id, terminalId: req.terminalId,
            datos: { profesional: prof }
        });

        return res.json(rows[0]);
    } catch (err) {
        console.error('[profesional/cancelar-asignacion]', err);
        return res.status(500).json({ error: 'db_error' });
    }
});

module.exports = router;
