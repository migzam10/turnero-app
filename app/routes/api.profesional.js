const { Router } = require('express');
const { query } = require('../database/db');
const { validarTerminalId } = require('../middleware/validar');

const router = Router();

// GET /api/profesional/asignaciones?profesional=KENDY
router.get('/asignaciones', validarTerminalId, async (req, res) => {
    const { profesional } = req.query;
    if (!profesional) {
        return res.status(400).json({ error: 'Query param profesional requerido' });
    }
    try {
        const { rows } = await query(
            `SELECT
                ap.id, ap.numero_identificacion,
                pc.primer_nombre || ' ' || COALESCE(pc.segundo_nombre || ' ','') ||
                pc.primer_apellido || COALESCE(' ' || pc.segundo_apellido,'') AS nombre_completo,
                pc.prioridad,
                ap.area, ap.columna_header, ap.estado,
                ap.hora_llegada_biofile, ap.hora_llamado,
                ap.hora_en_atencion, ap.hora_finalizado,
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
             ORDER BY ap.created_at`,
            [profesional]
        );
        return res.json(rows);
    } catch (err) {
        console.error('[profesional/asignaciones]', err);
        return res.status(500).json({ error: 'db_error' });
    }
});

// POST /api/profesional/llamar/:id
router.post('/llamar/:id', validarTerminalId, async (req, res) => {
    const { profesional } = req.body;
    if (!profesional) return res.status(400).json({ error: 'Campo profesional requerido' });
    try {
        const { rows, rowCount } = await query(
            `UPDATE asignaciones_profesionales
             SET estado = 'llamando', hora_llamado = NOW(), updated_at = NOW()
             WHERE id = $1 AND estado = 'pendiente'
             RETURNING *`,
            [req.params.id]
        );
        if (rowCount === 0) return res.status(409).json({ error: 'estado_invalido' });

        const io = req.app.get('io');
        io.to(`profesional:${profesional}`).emit('asignacion:llamando', rows[0]);
        io.to('display').emit('asignacion:llamando', rows[0]);

        return res.json(rows[0]);
    } catch (err) {
        console.error('[profesional/llamar]', err);
        return res.status(500).json({ error: 'db_error' });
    }
});

// POST /api/profesional/en-atencion/:id
router.post('/en-atencion/:id', validarTerminalId, async (req, res) => {
    const { profesional } = req.body;
    try {
        const { rows, rowCount } = await query(
            `UPDATE asignaciones_profesionales
             SET estado = 'en_atencion', hora_en_atencion = NOW(), updated_at = NOW()
             WHERE id = $1 AND estado = 'llamando'
             RETURNING *`,
            [req.params.id]
        );
        if (rowCount === 0) return res.status(409).json({ error: 'estado_invalido' });

        const io = req.app.get('io');
        if (profesional) io.to(`profesional:${profesional}`).emit('asignacion:en_atencion', rows[0]);
        io.to('display').emit('asignacion:en_atencion', rows[0]);

        return res.json(rows[0]);
    } catch (err) {
        console.error('[profesional/en-atencion]', err);
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
