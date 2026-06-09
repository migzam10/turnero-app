const { Router } = require('express');
const { query } = require('../database/db');
const { validarTerminalId } = require('../middleware/validar');

const router = Router();

// GET /api/admisiones/cola
router.get('/cola', validarTerminalId, async (req, res) => {
    try {
        const { rows } = await query(
            `SELECT id, numero_identificacion,
                    primer_nombre || ' ' || COALESCE(segundo_nombre || ' ','') ||
                    primer_apellido || COALESCE(' ' || segundo_apellido,'') AS nombre_completo,
                    primer_nombre, segundo_nombre, primer_apellido, segundo_apellido,
                    ciudad_expedicion, tipo_identificacion, fecha_nacimiento,
                    prioridad, estado_admision, hora_llegada, modulo_admision
             FROM pacientes_cola
             WHERE fecha = CURRENT_DATE
               AND estado_admision IN ('esperando','llamando_admision')
             ORDER BY
                 CASE prioridad WHEN 'alta' THEN 1 WHEN 'media' THEN 2 ELSE 3 END,
                 hora_llegada`
        );
        return res.json(rows);
    } catch (err) {
        console.error('[admisiones/cola]', err);
        return res.status(500).json({ error: 'db_error' });
    }
});

// POST /api/admisiones/llamar/:id
router.post('/llamar/:id', validarTerminalId, async (req, res) => {
    const { modulo } = req.body;
    if (!modulo) return res.status(400).json({ error: 'Campo modulo requerido' });

    try {
        const { rows, rowCount } = await query(
            `UPDATE pacientes_cola
             SET estado_admision = 'llamando_admision',
                 hora_llamado_admision = NOW(),
                 modulo_admision = $1,
                 updated_at = NOW()
             WHERE id = $2 AND fecha = CURRENT_DATE AND estado_admision = 'esperando'
             RETURNING *`,
            [modulo, req.params.id]
        );
        if (rowCount === 0) return res.status(409).json({ error: 'estado_invalido' });

        const io = req.app.get('io');
        io.to('admisiones').emit('admision:llamando', rows[0]);
        io.to('display').emit('admision:llamando', rows[0]);

        return res.json(rows[0]);
    } catch (err) {
        console.error('[admisiones/llamar]', err);
        return res.status(500).json({ error: 'db_error' });
    }
});

// POST /api/admisiones/admisionar/:id
router.post('/admisionar/:id', validarTerminalId, async (req, res) => {
    try {
        const { rows, rowCount } = await query(
            `UPDATE pacientes_cola
             SET estado_admision = 'admisionado',
                 hora_admision = NOW(),
                 updated_at = NOW()
             WHERE id = $1 AND fecha = CURRENT_DATE AND estado_admision = 'llamando_admision'
             RETURNING *`,
            [req.params.id]
        );
        if (rowCount === 0) return res.status(409).json({ error: 'estado_invalido' });

        const io = req.app.get('io');
        io.to('admisiones').emit('admision:completada', rows[0]);
        io.to('recepcion').emit('admision:completada', rows[0]);
        io.to('display').emit('admision:completada', rows[0]);

        return res.json(rows[0]);
    } catch (err) {
        console.error('[admisiones/admisionar]', err);
        return res.status(500).json({ error: 'db_error' });
    }
});

// POST /api/admisiones/devolver/:id
router.post('/devolver/:id', validarTerminalId, async (req, res) => {
    try {
        const { rows, rowCount } = await query(
            `UPDATE pacientes_cola
             SET estado_admision = 'esperando',
                 hora_llamado_admision = NULL,
                 modulo_admision = NULL,
                 updated_at = NOW()
             WHERE id = $1 AND fecha = CURRENT_DATE AND estado_admision = 'llamando_admision'
             RETURNING *`,
            [req.params.id]
        );
        if (rowCount === 0) return res.status(409).json({ error: 'estado_invalido' });

        const io = req.app.get('io');
        io.to('admisiones').emit('admision:devuelto', rows[0]);
        io.to('display').emit('admision:devuelto', rows[0]);

        return res.json(rows[0]);
    } catch (err) {
        console.error('[admisiones/devolver]', err);
        return res.status(500).json({ error: 'db_error' });
    }
});

// GET /api/admisiones/datos-pegado/:id
// Devuelve string Tab-separado para pegar en Biofile
router.get('/datos-pegado/:id', validarTerminalId, async (req, res) => {
    try {
        const { rows, rowCount } = await query(
            `SELECT numero_identificacion, ciudad_expedicion,
                    TO_CHAR(fecha_nacimiento, 'DD/MM/YYYY') AS fecha_nacimiento_fmt,
                    primer_apellido, segundo_apellido, primer_nombre, segundo_nombre
             FROM pacientes_cola
             WHERE id = $1 AND fecha = CURRENT_DATE`,
            [req.params.id]
        );
        if (rowCount === 0) return res.status(404).json({ error: 'paciente_no_encontrado' });

        const p = rows[0];
        const tabString = [
            p.numero_identificacion || '',
            p.ciudad_expedicion || '',
            p.fecha_nacimiento_fmt || '',
            p.primer_apellido || '',
            p.segundo_apellido || '',
            p.primer_nombre || '',
            p.segundo_nombre || ''
        ].join('\t');

        return res.json({ tabString, paciente: rows[0] });
    } catch (err) {
        console.error('[admisiones/datos-pegado]', err);
        return res.status(500).json({ error: 'db_error' });
    }
});

// GET /api/admisiones/config-modulos
router.get('/config-modulos', async (req, res) => {
    try {
        const { rows } = await query(
            `SELECT valor FROM configuracion WHERE clave = 'modulos_admisiones'`
        );
        return res.json(JSON.parse(rows[0]?.valor || '[]'));
    } catch (err) {
        console.error('[admisiones/config-modulos]', err);
        return res.status(500).json({ error: 'db_error' });
    }
});

module.exports = router;
