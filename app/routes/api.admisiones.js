const { Router } = require('express');
const { query } = require('../database/db');
const { validarTerminalId } = require('../middleware/validar');
const { emitUpdatePatients } = require('../sockets/notify');
const { registrarEvento } = require('../utils/audit');

const router = Router();

// Nombre legible del paciente a partir de la fila de pacientes_cola (para audit).
const nombrePac = (r) => `${r.primer_nombre || ''} ${r.primer_apellido || ''}`.trim() || r.numero_identificacion;

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
               AND estado_admision IN ('esperando','llamando_admision','admisionando')
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
        emitUpdatePatients(io);

        registrarEvento({
            tipo: 'admision_llamado',
            descripcion: `${nombrePac(rows[0])} llamado a ${rows[0].modulo_admision}`,
            pacienteId: rows[0].id, terminalId: req.terminalId,
            datos: { modulo: rows[0].modulo_admision }
        });

        return res.json(rows[0]);
    } catch (err) {
        console.error('[admisiones/llamar]', err);
        return res.status(500).json({ error: 'db_error' });
    }
});

// POST /api/admisiones/admisionando/:id
// Tiempo 1 del flujo de 2 pasos: el paciente pasa a estar en proceso de admisión.
// Aquí sí se marca hora_llamado_admision (el momento real en que se le atiende) y
// se emite admision:completada para RETIRARLO DEL DISPLAY, aunque el proceso siga
// abierto en el módulo hasta Finalizar. Guard: solo desde 'llamando_admision'.
router.post('/admisionando/:id', validarTerminalId, async (req, res) => {
    try {
        const { rows, rowCount } = await query(
            `UPDATE pacientes_cola
             SET estado_admision = 'admisionando',
                 hora_llamado_admision = NOW(),
                 updated_at = NOW()
             WHERE id = $1 AND fecha = CURRENT_DATE AND estado_admision = 'llamando_admision'
             RETURNING *`,
            [req.params.id]
        );
        if (rowCount === 0) return res.status(409).json({ error: 'estado_invalido' });

        const io = req.app.get('io');
        // Reusa admision:completada porque es el evento que el display ya escucha
        // para quitar al paciente de la pantalla.
        io.to('admisiones').emit('admision:completada', rows[0]);
        io.to('display').emit('admision:completada', rows[0]);
        emitUpdatePatients(io);

        registrarEvento({
            tipo: 'admision_admisionando',
            descripcion: `${nombrePac(rows[0])} en admisión (${rows[0].modulo_admision})`,
            pacienteId: rows[0].id, terminalId: req.terminalId,
            datos: { modulo: rows[0].modulo_admision }
        });

        return res.json(rows[0]);
    } catch (err) {
        console.error('[admisiones/admisionando]', err);
        return res.status(500).json({ error: 'db_error' });
    }
});

// POST /api/admisiones/finalizar/:id
// Tiempo 2 del flujo: cierra la admisión. hora_admision se respeta si Biofile ya la
// sobrescribió durante el sync (COALESCE); si aún no hubo cruce se pone NOW() y un
// sync posterior la reemplazará por la hora de Biofile. Guard: solo desde
// 'admisionando'. Ya no hace falta quitar del display (se hizo en Admisionando).
router.post('/finalizar/:id', validarTerminalId, async (req, res) => {
    try {
        const { rows, rowCount } = await query(
            `UPDATE pacientes_cola
             SET estado_admision = 'admisionado',
                 hora_admision = COALESCE(hora_admision, NOW()),
                 updated_at = NOW()
             WHERE id = $1 AND fecha = CURRENT_DATE AND estado_admision = 'admisionando'
             RETURNING *`,
            [req.params.id]
        );
        if (rowCount === 0) return res.status(409).json({ error: 'estado_invalido' });

        const io = req.app.get('io');
        io.to('admisiones').emit('admision:completada', rows[0]);
        io.to('recepcion').emit('admision:completada', rows[0]);
        io.to('display').emit('admision:completada', rows[0]);
        emitUpdatePatients(io);

        registrarEvento({
            tipo: 'admision_finalizada',
            descripcion: `Admisión de ${nombrePac(rows[0])} finalizada`,
            pacienteId: rows[0].id, terminalId: req.terminalId,
            datos: { modulo: rows[0].modulo_admision }
        });

        return res.json(rows[0]);
    } catch (err) {
        console.error('[admisiones/finalizar]', err);
        return res.status(500).json({ error: 'db_error' });
    }
});

// POST /api/admisiones/devolver/:id
router.post('/devolver/:id', validarTerminalId, async (req, res) => {
    try {
        // Se conserva el módulo anterior (modulo_anterior) porque el UPDATE lo pone
        // en NULL; el Display lo necesita para quitar al paciente de la pantalla.
        const { rows, rowCount } = await query(
            `UPDATE pacientes_cola pc
             SET estado_admision = 'esperando',
                 hora_llamado_admision = NULL,
                 modulo_admision = NULL,
                 updated_at = NOW()
             FROM (SELECT id, modulo_admision FROM pacientes_cola WHERE id = $1) old
             WHERE pc.id = old.id AND pc.fecha = CURRENT_DATE
               AND pc.estado_admision = 'llamando_admision'
             RETURNING pc.*, old.modulo_admision AS modulo_anterior`,
            [req.params.id]
        );
        if (rowCount === 0) return res.status(409).json({ error: 'estado_invalido' });

        const io = req.app.get('io');
        io.to('admisiones').emit('admision:devuelto', rows[0]);
        io.to('display').emit('admision:devuelto', rows[0]);
        emitUpdatePatients(io);

        registrarEvento({
            tipo: 'admision_devuelta',
            descripcion: `${nombrePac(rows[0])} devuelto a espera (${rows[0].modulo_anterior})`,
            pacienteId: rows[0].id, terminalId: req.terminalId,
            datos: { modulo: rows[0].modulo_anterior }
        });

        return res.json(rows[0]);
    } catch (err) {
        console.error('[admisiones/devolver]', err);
        return res.status(500).json({ error: 'db_error' });
    }
});

// POST /api/admisiones/asignar-profesional/:id
// Asigna manualmente un paciente de la cola (que NO llegó por Biofile, p.ej. un
// "particular") a un profesional, creando una fila origen='manual' en
// asignaciones_profesionales. Marca manual_override para que la reconciliación del
// LIS jamás la cancele. :id = pacientes_cola.id (NO el id de la asignación).
router.post('/asignar-profesional/:id', validarTerminalId, async (req, res) => {
    const { nombre_profesional, area } = req.body;
    if (!nombre_profesional || !String(nombre_profesional).trim()) {
        return res.status(400).json({ error: 'nombre_profesional requerido' });
    }
    // Normaliza: mayúsculas y colapsa espacios internos.
    const profesional = String(nombre_profesional).trim().replace(/\s+/g, ' ').toUpperCase();

    try {
        const { rows: pacRows, rowCount: pacCount } = await query(
            `SELECT id, fecha, numero_identificacion,
                    primer_nombre || ' ' || primer_apellido AS nombre_paciente
             FROM pacientes_cola
             WHERE id = $1 AND fecha = CURRENT_DATE`,
            [req.params.id]
        );
        if (pacCount === 0) return res.status(404).json({ error: 'paciente_no_encontrado' });
        const pc = pacRows[0];

        const { rows, rowCount } = await query(
            `INSERT INTO asignaciones_profesionales
                (fecha, paciente_cola_id, numero_identificacion, nombre_paciente,
                 nombre_profesional, columna_header, area, estado, activo,
                 manual_override, origen, login_name_biofile, consultorio_profesional)
             VALUES ($1, $2, $3, $4, $5, $5, COALESCE(NULLIF(TRIM($6),''),'PARTICULAR'),
                     'pendiente', true, true, 'manual', NULL, NULL)
             ON CONFLICT (fecha, numero_identificacion, columna_header)
             DO UPDATE SET
                 activo = true, estado = 'pendiente', manual_override = true,
                 origen = 'manual', origen_baja = NULL,
                 updated_at = NOW()
             WHERE asignaciones_profesionales.activo = false
             RETURNING *`,
            [pc.fecha, pc.id, pc.numero_identificacion, pc.nombre_paciente,
             profesional, area || '']
        );

        // RETURNING vacío = ya existía una fila ACTIVA con ese profesional (el WHERE
        // del DO UPDATE bloqueó la reactivación): no se duplica ni se pisa.
        if (rowCount === 0) return res.status(409).json({ error: 'ya_asignado' });

        const io = req.app.get('io');
        io.to(`profesional:${profesional}`).emit('asignacion:manual', rows[0]);
        io.to('display').emit('asignacion:manual', rows[0]);
        emitUpdatePatients(io);

        registrarEvento({
            tipo: 'asignacion_manual',
            descripcion: `${pc.nombre_paciente} asignado a ${profesional}`,
            pacienteId: pc.id, terminalId: req.terminalId,
            datos: { profesional, area: area || null }
        });

        return res.status(201).json(rows[0]);
    } catch (err) {
        if (err.code === '23505') return res.status(409).json({ error: 'ya_asignado' });
        console.error('[admisiones/asignar-profesional]', err);
        return res.status(500).json({ error: 'db_error' });
    }
});

// GET /api/admisiones/config-modulos
// La cantidad de módulos es dinámica: se lee desde la configuración del módulo Admin
// (clave 'cantidad_modulos_admisiones') y se generan los nombres "Módulo 1..N".
router.get('/config-modulos', async (req, res) => {
    try {
        const { rows } = await query(
            `SELECT valor FROM configuracion WHERE clave = 'cantidad_modulos_admisiones'`
        );
        let cantidad = parseInt(rows[0]?.valor, 10);
        if (!Number.isFinite(cantidad) || cantidad < 1) cantidad = 3; // valor por defecto seguro
        cantidad = Math.min(cantidad, 50);                            // tope defensivo
        const modulos = Array.from({ length: cantidad }, (_, i) => `Módulo ${i + 1}`);
        return res.json(modulos);
    } catch (err) {
        console.error('[admisiones/config-modulos]', err);
        return res.status(500).json({ error: 'db_error' });
    }
});

module.exports = router;
