const { Router } = require('express');
const { query } = require('../database/db');
const { validarTerminalId } = require('../middleware/validar');

const router = Router();

// GET /api/profesional/asignaciones?profesional=KENDY+ZABALETA
router.get('/asignaciones', validarTerminalId, async (req, res) => {
    const { profesional } = req.query;
    if (!profesional) {
        return res.status(400).json({ error: 'Query param profesional requerido' });
    }
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
                      AND otro.fecha = CURRENT_DATE
                      AND otro.nombre_profesional <> $1
                      AND otro.estado IN ('llamando','en_atencion')
                ) AS bloqueado,
                (SELECT otro.area FROM asignaciones_profesionales otro
                 WHERE otro.numero_identificacion = ap.numero_identificacion
                   AND otro.fecha = CURRENT_DATE
                   AND otro.nombre_profesional <> $1
                   AND otro.estado IN ('llamando','en_atencion')
                 LIMIT 1) AS bloqueado_por
             FROM asignaciones_profesionales ap
             LEFT JOIN pacientes_cola pc
                ON pc.numero_identificacion = ap.numero_identificacion
               AND pc.fecha = CURRENT_DATE
             WHERE ap.fecha = CURRENT_DATE
               AND ap.nombre_profesional = $1
               AND ap.estado <> 'finalizado'
             ORDER BY
                 CASE ap.estado WHEN 'en_atencion' THEN 1 WHEN 'llamando' THEN 2 ELSE 3 END,
                 CASE COALESCE(pc.prioridad,'normal') WHEN 'alta' THEN 1 WHEN 'media' THEN 2 ELSE 3 END,
                 ap.hora_llegada_biofile`,
            [profesional]
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
             WHERE fecha = CURRENT_DATE ORDER BY nombre_profesional`
        );
        return res.json(rows.map(r => r.nombre_profesional));
    } catch (err) {
        console.error('[profesional/listado-profesionales]', err);
        return res.status(500).json({ error: 'db_error' });
    }
});

// POST /api/profesional/llamar/:id
router.post('/llamar/:id', validarTerminalId, async (req, res) => {
    const { profesional, consultorio } = req.body;
    if (!profesional) return res.status(400).json({ error: 'Campo profesional requerido' });
    try {
        // Bug #6: bloquear si el profesional ya tiene un paciente activo
        const { rows: activos } = await query(
            `SELECT 1 FROM asignaciones_profesionales
             WHERE nombre_profesional = $1 AND fecha = CURRENT_DATE
               AND estado IN ('llamando','en_atencion') LIMIT 1`,
            [profesional]
        );
        if (activos.length > 0) return res.status(409).json({ error: 'ya_tiene_paciente_activo' });

        // Bug #7: bloquear si el paciente ya está siendo atendido por otro profesional
        const { rows: bloqueado } = await query(
            `SELECT 1 FROM asignaciones_profesionales ap2
             WHERE ap2.numero_identificacion = (
                 SELECT numero_identificacion FROM asignaciones_profesionales WHERE id = $1
             )
             AND ap2.fecha = CURRENT_DATE
             AND ap2.nombre_profesional <> $2
             AND ap2.estado IN ('llamando','en_atencion') LIMIT 1`,
            [req.params.id, profesional]
        );
        if (bloqueado.length > 0) return res.status(409).json({ error: 'paciente_bloqueado' });

        const { rows, rowCount } = await query(
            `UPDATE asignaciones_profesionales
             SET estado = 'llamando', hora_llamado = NOW(),
                 consultorio_profesional = $2, updated_at = NOW()
             WHERE id = $1 AND estado = 'pendiente'
             RETURNING *`,
            [req.params.id, consultorio || null]
        );
        if (rowCount === 0) return res.status(409).json({ error: 'estado_invalido' });

        // Obtener nombre del paciente para el display
        const { rows: conNombre } = await query(
            `SELECT COALESCE(pc.primer_nombre || ' ' || pc.primer_apellido, ap.nombre_paciente, ap.numero_identificacion) AS nombre_paciente
             FROM asignaciones_profesionales ap
             LEFT JOIN pacientes_cola pc ON pc.numero_identificacion = ap.numero_identificacion AND pc.fecha = ap.fecha
             WHERE ap.id = $1`,
            [req.params.id]
        );

        const payload = { ...rows[0], nombre_paciente: conNombre[0]?.nombre_paciente, consultorio };

        const io = req.app.get('io');
        io.to(`profesional:${profesional}`).emit('asignacion:llamando', payload);
        io.to('display').emit('asignacion:llamando', payload);

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
            `SELECT COALESCE(pc.primer_nombre || ' ' || pc.primer_apellido, ap.nombre_paciente, ap.numero_identificacion) AS nombre_paciente
             FROM asignaciones_profesionales ap
             LEFT JOIN pacientes_cola pc ON pc.numero_identificacion = ap.numero_identificacion AND pc.fecha = ap.fecha
             WHERE ap.id = $1`,
            [req.params.id]
        );

        const payload = { ...rows[0], nombre_paciente: conNombre[0]?.nombre_paciente };

        const io = req.app.get('io');
        if (profesional) io.to(`profesional:${profesional}`).emit('asignacion:en_atencion', payload);
        io.to('display').emit('asignacion:en_atencion', payload);

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

        const io = req.app.get('io');
        if (profesional) io.to(`profesional:${profesional}`).emit('asignacion:finalizado', rows[0]);
        io.to('display').emit('asignacion:finalizado', rows[0]);

        return res.json(rows[0]);
    } catch (err) {
        console.error('[profesional/finalizar]', err);
        return res.status(500).json({ error: 'db_error' });
    }
});

module.exports = router;
