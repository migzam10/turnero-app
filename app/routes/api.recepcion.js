const { Router } = require('express');
const { query } = require('../database/db');
const { validarTerminalId } = require('../middleware/validar');
const { emitUpdatePatients } = require('../sockets/notify');
const { registrarEvento } = require('../utils/audit');
const { normalizarIdentificacion } = require('../utils/identificacion');

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

// GET /api/recepcion/:id — registro completo de un paciente (para precargar el
// formulario de edición). Se define después de /cola para no colisionar.
router.get('/:id', async (req, res) => {
    try {
        const { rows, rowCount } = await query(
            `SELECT id, numero_identificacion, tipo_identificacion,
                    primer_nombre, segundo_nombre, primer_apellido, segundo_apellido,
                    ciudad_expedicion, sexo, prioridad, estado_admision,
                    TO_CHAR(fecha_nacimiento, 'DD/MM/YYYY') AS fecha_nacimiento
             FROM pacientes_cola
             WHERE id = $1 AND fecha = CURRENT_DATE`,
            [req.params.id]
        );
        if (rowCount === 0) return res.status(404).json({ error: 'paciente_no_encontrado' });
        return res.json(rows[0]);
    } catch (err) {
        console.error('[recepcion/get-id]', err);
        return res.status(500).json({ error: 'db_error' });
    }
});

// POST /api/recepcion/registrar
router.post('/registrar', validarTerminalId, async (req, res) => {
    const {
        numero_identificacion, tipo_identificacion = 'CC',
        primer_nombre, segundo_nombre,
        primer_apellido, segundo_apellido,
        ciudad_expedicion, fecha_nacimiento, sexo,
        prioridad = 'normal'
    } = req.body;

    if (!numero_identificacion || !primer_nombre || !primer_apellido) {
        return res.status(400).json({
            error: 'Campos requeridos: numero_identificacion, primer_nombre, primer_apellido'
        });
    }

    // Normalizar sexo: solo se acepta 'M' o 'F'; cualquier otro valor se guarda como NULL.
    const sexoNorm = ['M', 'F'].includes((sexo || '').toUpperCase()) ? sexo.toUpperCase() : null;

    // El lector rellena con ceros a la izquierda hasta 10 dígitos y Biofile no los usa:
    // se guarda la forma canónica para que el cruce del sync encuentre al paciente.
    const cedula = normalizarIdentificacion(numero_identificacion);

    try {
        // Validar UUID del terminal antes de insertar
        const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
        const terminalUUID = UUID_RE.test(req.terminalId) ? req.terminalId : null;

        const fechaParam = fecha_nacimiento || '';

        // Sin ON CONFLICT: cada registro es un INGRESO nuevo. El índice parcial
        // uq_cola_shell_abierto garantiza a lo sumo un registro de recepción ABIERTO y sin
        // OS por (fecha, cédula); si ya hay uno lanza 23505 y se responde 409. Si la
        // atención previa quedó cerrada, la fila entra como un ingreso separado.
        const { rows } = await query(
            `INSERT INTO pacientes_cola
                (numero_identificacion, tipo_identificacion, primer_nombre, segundo_nombre,
                 primer_apellido, segundo_apellido, ciudad_expedicion, fecha_nacimiento,
                 sexo, prioridad, terminal_recepcion_id)
             VALUES ($1,$2,$3,$4,$5,$6,$7,
                     CASE
                         WHEN $8 = '' THEN NULL
                         WHEN $8 ~ '^\\d{4}-\\d{2}-\\d{2}$' THEN $8::DATE
                         ELSE TO_DATE($8, 'DD/MM/YYYY')
                     END,
                     $9,$10,$11)
             RETURNING *`,
            [cedula, tipo_identificacion,
             primer_nombre.toUpperCase(), segundo_nombre ? segundo_nombre.toUpperCase() : null,
             primer_apellido.toUpperCase(), segundo_apellido ? segundo_apellido.toUpperCase() : null,
             ciudad_expedicion ? ciudad_expedicion.toUpperCase() : null,
             fechaParam, sexoNorm, prioridad, terminalUUID]
        );

        const io = req.app.get('io');
        io.to('recepcion').emit('paciente:nuevo', rows[0]);
        io.to('admisiones').emit('paciente:nuevo', rows[0]);
        emitUpdatePatients(io);

        registrarEvento({
            tipo: 'paciente_registrado',
            descripcion: `Registrado ${rows[0].primer_nombre} ${rows[0].primer_apellido} (CC ${rows[0].numero_identificacion})`,
            pacienteId: rows[0].id, terminalId: req.terminalId,
            datos: { numero_identificacion: rows[0].numero_identificacion, prioridad: rows[0].prioridad }
        });

        return res.status(201).json(rows[0]);
    } catch (err) {
        // 23505 en uq_cola_shell_abierto = ya hay un registro de recepción abierto y aún
        // SIN vincular a una OS de Biofile. No se duplica; cuando ese registro se vincula
        // a su OS (o se cierra), recepción puede volver a listar al paciente.
        if (err.code === '23505') {
            const { rows: existente } = await query(
                `SELECT * FROM pacientes_cola
                 WHERE fecha = CURRENT_DATE AND numero_identificacion = $1
                   AND orden_servicio IS NULL AND NOT cerrado`,
                [cedula]
            );
            return res.status(409).json({ error: 'ya_registrado', paciente: existente[0] });
        }
        console.error('[recepcion/registrar]', err);
        return res.status(500).json({ error: 'db_error' });
    }
});

// PUT /api/recepcion/:id — actualiza los datos de un paciente ya registrado.
// Solo se permite mientras está 'esperando' (aún no llamado/admisionado), para
// evitar editar a alguien que ya está siendo procesado en Admisiones.
router.put('/:id', validarTerminalId, async (req, res) => {
    const {
        numero_identificacion, tipo_identificacion = 'CC',
        primer_nombre, segundo_nombre,
        primer_apellido, segundo_apellido,
        ciudad_expedicion, fecha_nacimiento, sexo
    } = req.body;

    if (!numero_identificacion || !primer_nombre || !primer_apellido) {
        return res.status(400).json({
            error: 'Campos requeridos: numero_identificacion, primer_nombre, primer_apellido'
        });
    }

    const sexoNorm = ['M', 'F'].includes((sexo || '').toUpperCase()) ? sexo.toUpperCase() : null;
    const fechaParam = fecha_nacimiento || '';

    try {
        const { rows, rowCount } = await query(
            `UPDATE pacientes_cola SET
                numero_identificacion = $1,
                tipo_identificacion   = $2,
                primer_nombre         = $3,
                segundo_nombre        = $4,
                primer_apellido       = $5,
                segundo_apellido      = $6,
                ciudad_expedicion     = $7,
                fecha_nacimiento      = CASE
                    WHEN $8 = '' THEN NULL
                    WHEN $8 ~ '^\\d{4}-\\d{2}-\\d{2}$' THEN $8::DATE
                    ELSE TO_DATE($8, 'DD/MM/YYYY')
                END,
                sexo                  = $9,
                updated_at            = NOW()
             WHERE id = $10 AND fecha = CURRENT_DATE AND estado_admision = 'esperando'
             RETURNING *`,
            [normalizarIdentificacion(numero_identificacion), tipo_identificacion,
             primer_nombre.toUpperCase(), segundo_nombre ? segundo_nombre.toUpperCase() : null,
             primer_apellido.toUpperCase(), segundo_apellido ? segundo_apellido.toUpperCase() : null,
             ciudad_expedicion ? ciudad_expedicion.toUpperCase() : null,
             fechaParam, sexoNorm, req.params.id]
        );

        if (rowCount === 0) {
            return res.status(409).json({ error: 'no_editable' });
        }

        const io = req.app.get('io');
        io.to('recepcion').emit('paciente:actualizado', rows[0]);
        io.to('admisiones').emit('paciente:actualizado', rows[0]);
        emitUpdatePatients(io);

        registrarEvento({
            tipo: 'paciente_editado',
            descripcion: `Editado ${rows[0].primer_nombre} ${rows[0].primer_apellido} (CC ${rows[0].numero_identificacion})`,
            pacienteId: rows[0].id, terminalId: req.terminalId
        });

        return res.json(rows[0]);
    } catch (err) {
        if (err.code === '23505') {
            return res.status(409).json({ error: 'cedula_duplicada' });
        }
        console.error('[recepcion/actualizar]', err);
        return res.status(500).json({ error: 'db_error' });
    }
});

// PATCH /api/recepcion/:id/prioridad
router.patch('/:id/prioridad', validarTerminalId, async (req, res) => {
    const { prioridad } = req.body;
    if (!['alta', 'media', 'normal'].includes(prioridad)) {
        return res.status(400).json({ error: 'prioridad inválida' });
    }
    try {
        // Se captura la prioridad anterior en el mismo statement (patrón self-join
        // ya usado en /devolver) para la auditoría {de, a}, sin query extra.
        const { rows, rowCount } = await query(
            `UPDATE pacientes_cola pc SET prioridad = $1, updated_at = NOW()
             FROM (SELECT id, prioridad FROM pacientes_cola WHERE id = $2) old
             WHERE pc.id = old.id AND pc.fecha = CURRENT_DATE
             RETURNING pc.*, old.prioridad AS prioridad_anterior`,
            [prioridad, req.params.id]
        );
        if (rowCount === 0) return res.status(404).json({ error: 'paciente_no_encontrado' });

        const io = req.app.get('io');
        io.to('recepcion').emit('paciente:prioridad', rows[0]);
        io.to('admisiones').emit('paciente:prioridad', rows[0]);
        emitUpdatePatients(io);

        registrarEvento({
            tipo: 'prioridad_cambiada',
            descripcion: `Prioridad de ${rows[0].primer_nombre} ${rows[0].primer_apellido} → ${prioridad}`,
            pacienteId: rows[0].id, terminalId: req.terminalId,
            datos: { de: rows[0].prioridad_anterior, a: prioridad }
        });

        return res.json(rows[0]);
    } catch (err) {
        console.error('[recepcion/prioridad]', err);
        return res.status(500).json({ error: 'db_error' });
    }
});

// DELETE /api/recepcion/:id — elimina un registro erróneo. Solo mientras está
// 'esperando' (aún no llamado/admisionado), mismo criterio que la edición. El
// evento de auditoría sobrevive al borrado (pacienteId null a propósito; los
// datos identificatorios quedan en el JSONB).
router.delete('/:id', validarTerminalId, async (req, res) => {
    try {
        // Se lee la fila antes de borrar para poder auditar nombre/cédula.
        const { rows: previa, rowCount: existe } = await query(
            `SELECT id, numero_identificacion, estado_admision,
                    primer_nombre || ' ' || primer_apellido AS nombre_completo
             FROM pacientes_cola
             WHERE id = $1 AND fecha = CURRENT_DATE`,
            [req.params.id]
        );
        if (existe === 0) return res.status(404).json({ error: 'paciente_no_encontrado' });
        if (previa[0].estado_admision !== 'esperando') {
            return res.status(409).json({ error: 'no_eliminable' });
        }

        const { rowCount } = await query(
            `DELETE FROM pacientes_cola
             WHERE id = $1 AND fecha = CURRENT_DATE AND estado_admision = 'esperando'
             RETURNING id`,
            [req.params.id]
        );
        // Carrera: cambió de estado entre el SELECT y el DELETE.
        if (rowCount === 0) return res.status(409).json({ error: 'no_eliminable' });

        const io = req.app.get('io');
        io.to('recepcion').emit('paciente:eliminado', { id: req.params.id });
        io.to('admisiones').emit('paciente:eliminado', { id: req.params.id });
        emitUpdatePatients(io);

        registrarEvento({
            tipo: 'paciente_eliminado',
            descripcion: `Eliminado ${previa[0].nombre_completo} (CC ${previa[0].numero_identificacion})`,
            pacienteId: null, terminalId: req.terminalId,
            datos: { cedula: previa[0].numero_identificacion, nombre: previa[0].nombre_completo }
        });

        return res.json({ ok: true });
    } catch (err) {
        console.error('[recepcion/eliminar]', err);
        return res.status(500).json({ error: 'db_error' });
    }
});

module.exports = router;
