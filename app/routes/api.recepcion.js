const { Router } = require('express');
const { query } = require('../database/db');
const { validarTerminalId } = require('../middleware/validar');

const router = Router();

// GET /api/recepcion/cola
router.get('/cola', async (req, res) => {
    try {
        const { rows } = await query(
            `SELECT id, numero_identificacion,
                    primer_nombre || ' ' || COALESCE(segundo_nombre || ' ','') ||
                    primer_apellido || COALESCE(' ' || segundo_apellido,'') AS nombre_completo,
                    prioridad, estado_admision, hora_llegada, modulo_admision
             FROM pacientes_cola
             WHERE fecha = CURRENT_DATE
             ORDER BY
                 CASE prioridad WHEN 'alta' THEN 1 WHEN 'media' THEN 2 ELSE 3 END,
                 hora_llegada`
        );
        return res.json(rows);
    } catch (err) {
        console.error('[recepcion/cola]', err);
        return res.status(500).json({ error: 'db_error' });
    }
});

// POST /api/recepcion/registrar
router.post('/registrar', validarTerminalId, async (req, res) => {
    const {
        numero_identificacion, tipo_identificacion = 'CC',
        primer_nombre, segundo_nombre,
        primer_apellido, segundo_apellido,
        ciudad_expedicion, fecha_nacimiento,
        prioridad = 'normal'
    } = req.body;

    if (!numero_identificacion || !primer_nombre || !primer_apellido) {
        return res.status(400).json({
            error: 'Campos requeridos: numero_identificacion, primer_nombre, primer_apellido'
        });
    }

    try {
        const { rows } = await query(
            `INSERT INTO pacientes_cola
                (numero_identificacion, tipo_identificacion, primer_nombre, segundo_nombre,
                 primer_apellido, segundo_apellido, ciudad_expedicion, fecha_nacimiento,
                 prioridad, terminal_recepcion_id)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
             ON CONFLICT (fecha, numero_identificacion) DO NOTHING
             RETURNING *`,
            [numero_identificacion, tipo_identificacion,
             primer_nombre, segundo_nombre || null,
             primer_apellido, segundo_apellido || null,
             ciudad_expedicion || null, fecha_nacimiento || null,
             prioridad, req.terminalId]
        );

        if (rows.length === 0) {
            const { rows: existente } = await query(
                `SELECT * FROM pacientes_cola WHERE fecha = CURRENT_DATE AND numero_identificacion = $1`,
                [numero_identificacion]
            );
            return res.status(409).json({ error: 'ya_registrado', paciente: existente[0] });
        }

        const io = req.app.get('io');
        io.to('recepcion').emit('paciente:nuevo', rows[0]);
        io.to('admisiones').emit('paciente:nuevo', rows[0]);
        io.to('display').emit('paciente:nuevo', rows[0]);

        return res.status(201).json(rows[0]);
    } catch (err) {
        console.error('[recepcion/registrar]', err);
        return res.status(500).json({ error: 'db_error' });
    }
});

module.exports = router;
