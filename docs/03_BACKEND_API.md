# 03 — Backend: API REST y Socket.io

## `server.js` — Punto de entrada

```javascript
require('dotenv').config();
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const { migrate } = require('./database/migrate');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Rutas API
app.use('/api/recepcion',   require('./routes/api.recepcion'));
app.use('/api/admisiones',  require('./routes/api.admisiones'));
app.use('/api/profesional', require('./routes/api.profesional'));
app.use('/api/extension',   require('./routes/api.extension'));
app.use('/api/admin',       require('./routes/api.admin'));

// Rutas de páginas
const pagesDir = path.join(__dirname, 'public');
['recepcion', 'admisiones', 'profesional', 'display', 'admin'].forEach(mod => {
    app.get(`/${mod}`, (req, res) =>
        res.sendFile(path.join(pagesDir, mod, 'index.html'))
    );
});

// Socket.io
require('./sockets/events')(io);
app.set('io', io);

const PORT = process.env.PORT || 3000;

async function main() {
    await migrate();
    server.listen(PORT, '0.0.0.0', () => {
        console.log(`Turnero corriendo en puerto ${PORT}`);
    });
}

main().catch(err => {
    console.error('Error al arrancar:', err);
    process.exit(1);
});
```

---

## `middleware/validar.js`

```javascript
function validarTerminalId(req, res, next) {
    if (!req.headers['x-terminal-id']) {
        return res.status(400).json({ error: 'Falta X-Terminal-Id' });
    }
    next();
}

function validarExtensionSecret(req, res, next) {
    if (req.headers['x-extension-secret'] !== process.env.EXTENSION_SECRET) {
        return res.status(401).json({ error: 'Unauthorized' });
    }
    next();
}

module.exports = { validarTerminalId, validarExtensionSecret };
```

---

## `routes/api.recepcion.js`

```javascript
const express = require('express');
const router = express.Router();
const { query } = require('../database/db');
const { v4: uuidv4 } = require('uuid');

// POST /api/recepcion/registrar
router.post('/registrar', async (req, res) => {
    const {
        numero_identificacion, primer_apellido, segundo_apellido,
        primer_nombre, segundo_nombre, fecha_nacimiento,
        ciudad_nacimiento, genero, prioridad = 'normal', terminal_recepcion
    } = req.body;

    if (!numero_identificacion || !primer_apellido || !primer_nombre) {
        return res.status(400).json({ error: 'Faltan campos requeridos' });
    }

    try {
        const { rows } = await query(
            `INSERT INTO pacientes_cola (
                id, numero_identificacion, primer_apellido, segundo_apellido,
                primer_nombre, segundo_nombre, fecha_nacimiento, ciudad_nacimiento,
                genero, prioridad, terminal_recepcion
            ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
            ON CONFLICT (fecha, numero_identificacion) DO NOTHING
            RETURNING *`,
            [
                uuidv4(), numero_identificacion, primer_apellido, segundo_apellido,
                primer_nombre, segundo_nombre, fecha_nacimiento, ciudad_nacimiento,
                genero, prioridad, terminal_recepcion
            ]
        );

        if (rows.length === 0) {
            // Ya existía — devolver el registro existente
            const existente = await query(
                'SELECT * FROM pacientes_cola WHERE fecha = CURRENT_DATE AND numero_identificacion = $1',
                [numero_identificacion]
            );
            return res.status(409).json({
                error: 'duplicate',
                mensaje: 'Este paciente ya fue registrado hoy',
                paciente: existente.rows[0]
            });
        }

        const paciente = rows[0];

        // Registrar en log
        await query(
            `INSERT INTO eventos_log (id, tipo_evento, paciente_cedula, paciente_nombre,
             prioridad, terminal_id) VALUES ($1,$2,$3,$4,$5,$6)`,
            [uuidv4(), 'paciente_registrado', numero_identificacion,
             `${primer_nombre} ${primer_apellido}`, prioridad, terminal_recepcion]
        );

        // Notificar en tiempo real
        const io = req.app.get('io');
        io.to('admisiones').to('recepcion').emit('cola_actualizada');

        return res.status(201).json({ id: paciente.id, mensaje: 'Paciente registrado', paciente });

    } catch (err) {
        console.error('[recepcion/registrar]', err);
        return res.status(500).json({ error: 'db_error', mensaje: err.message });
    }
});

// PATCH /api/recepcion/prioridad/:id
router.patch('/prioridad/:id', async (req, res) => {
    const { prioridad } = req.body;
    if (!['normal', 'media', 'alta'].includes(prioridad)) {
        return res.status(400).json({ error: 'Prioridad inválida' });
    }

    try {
        const { rowCount } = await query(
            `UPDATE pacientes_cola
             SET prioridad = $1, updated_at = NOW()
             WHERE id = $2`,
            [prioridad, req.params.id]
        );

        if (rowCount === 0) return res.status(404).json({ error: 'No encontrado' });

        const io = req.app.get('io');
        io.to('admisiones').to('recepcion').emit('cola_actualizada');

        return res.json({ mensaje: 'Prioridad actualizada' });

    } catch (err) {
        console.error('[recepcion/prioridad]', err);
        return res.status(500).json({ error: 'db_error', mensaje: err.message });
    }
});

// GET /api/recepcion/cola
router.get('/cola', async (req, res) => {
    try {
        const { rows } = await query(
            `SELECT id,
                    primer_nombre || ' ' || primer_apellido AS nombre_completo,
                    numero_identificacion,
                    hora_llegada, prioridad, estado_admision
             FROM pacientes_cola
             WHERE fecha = CURRENT_DATE
             ORDER BY
                CASE prioridad WHEN 'alta' THEN 1 WHEN 'media' THEN 2 ELSE 3 END,
                hora_llegada ASC`
        );
        return res.json(rows);
    } catch (err) {
        console.error('[recepcion/cola]', err);
        return res.status(500).json({ error: 'db_error', mensaje: err.message });
    }
});

module.exports = router;
```

---

## `routes/api.admisiones.js`

```javascript
const express = require('express');
const router = express.Router();
const { query } = require('../database/db');
const { v4: uuidv4 } = require('uuid');

// GET /api/admisiones/cola
// Datos completos necesarios para el módulo de admisiones (incluyendo campos de pegado)
router.get('/cola', async (req, res) => {
    try {
        const { rows } = await query(
            `SELECT id, numero_identificacion,
                    primer_apellido, segundo_apellido,
                    primer_nombre, segundo_nombre,
                    fecha_nacimiento, ciudad_nacimiento, genero,
                    hora_llegada, prioridad, estado_admision,
                    hora_llamado_admision, hora_admision, modulo_admision
             FROM pacientes_cola
             WHERE fecha = CURRENT_DATE
             ORDER BY
                CASE prioridad WHEN 'alta' THEN 1 WHEN 'media' THEN 2 ELSE 3 END,
                hora_llegada ASC`
        );
        return res.json(rows);
    } catch (err) {
        console.error('[admisiones/cola]', err);
        return res.status(500).json({ error: 'db_error', mensaje: err.message });
    }
});

// POST /api/admisiones/llamar/:id
router.post('/llamar/:id', async (req, res) => {
    const { modulo, terminal_id } = req.body;

    try {
        const { rows, rowCount } = await query(
            `UPDATE pacientes_cola
             SET estado_admision = 'llamando_admision',
                 hora_llamado_admision = NOW(),
                 modulo_admision = $1,
                 updated_at = NOW()
             WHERE id = $2 AND estado_admision = 'esperando'
             RETURNING *`,
            [modulo, req.params.id]
        );

        if (rowCount === 0) return res.status(409).json({ error: 'Estado inválido para llamar' });

        const p = rows[0];

        await query(
            `INSERT INTO eventos_log (id, tipo_evento, paciente_cedula, paciente_nombre,
             modulo_admision, terminal_id) VALUES ($1,$2,$3,$4,$5,$6)`,
            [uuidv4(), 'paciente_llamado_admision', p.numero_identificacion,
             `${p.primer_nombre} ${p.primer_apellido}`, modulo, terminal_id]
        );

        const io = req.app.get('io');
        io.to('display').emit('display_evento', {
            tipo: 'admision_llamando',
            paciente_nombre: `${p.primer_nombre} ${p.primer_apellido}`,
            modulo,
            consultorio: null,
            profesional: null,
            timestamp: new Date().toISOString()
        });
        io.to('admisiones').to('recepcion').emit('cola_actualizada');

        return res.json({ mensaje: 'ok' });

    } catch (err) {
        console.error('[admisiones/llamar]', err);
        return res.status(500).json({ error: 'db_error', mensaje: err.message });
    }
});

// POST /api/admisiones/admisionar/:id
router.post('/admisionar/:id', async (req, res) => {
    const { terminal_id } = req.body;

    try {
        const { rows, rowCount } = await query(
            `UPDATE pacientes_cola
             SET estado_admision = 'admisionado',
                 hora_admision = NOW(),
                 updated_at = NOW()
             WHERE id = $1 AND estado_admision = 'llamando_admision'
             RETURNING *`,
            [req.params.id]
        );

        if (rowCount === 0) return res.status(409).json({ error: 'Estado inválido para admisionar' });

        const p = rows[0];

        // Vincular con asignacion_profesionales si existe (match por cédula + fecha)
        await query(
            `UPDATE asignaciones_profesionales
             SET paciente_cola_id = $1, updated_at = NOW()
             WHERE numero_identificacion = $2
               AND fecha = CURRENT_DATE
               AND paciente_cola_id IS NULL`,
            [p.id, p.numero_identificacion]
        );

        await query(
            `INSERT INTO eventos_log (id, tipo_evento, paciente_cedula, paciente_nombre,
             modulo_admision, terminal_id) VALUES ($1,$2,$3,$4,$5,$6)`,
            [uuidv4(), 'paciente_admisionado', p.numero_identificacion,
             `${p.primer_nombre} ${p.primer_apellido}`, p.modulo_admision, terminal_id]
        );

        const io = req.app.get('io');
        io.to('display').emit('display_evento', {
            tipo: 'admision_en_atencion',
            paciente_nombre: `${p.primer_nombre} ${p.primer_apellido}`,
            modulo: p.modulo_admision,
            timestamp: new Date().toISOString()
        });
        io.to('admisiones').to('recepcion').emit('cola_actualizada');

        return res.json({ mensaje: 'ok' });

    } catch (err) {
        console.error('[admisiones/admisionar]', err);
        return res.status(500).json({ error: 'db_error', mensaje: err.message });
    }
});

// GET /api/admisiones/datos-pegado/:id
// Devuelve el string Tab-separado en el orden exacto de los tabindex de Biofile
router.get('/datos-pegado/:id', async (req, res) => {
    try {
        const { rows } = await query(
            `SELECT numero_identificacion, ciudad_nacimiento, fecha_nacimiento,
                    primer_apellido, segundo_apellido, primer_nombre, segundo_nombre
             FROM pacientes_cola WHERE id = $1`,
            [req.params.id]
        );

        if (rows.length === 0) return res.status(404).json({ error: 'No encontrado' });

        const p = rows[0];
        // Orden tabindex: 1=cedula, 2=ciudad, 3=fecha_nac, 4=apellido1, 5=apellido2, 6=nombre1, 7=nombre2
        const tab_string = [
            p.numero_identificacion,
            p.ciudad_nacimiento   || '',
            p.fecha_nacimiento    || '',
            p.primer_apellido,
            p.segundo_apellido    || '',
            p.primer_nombre,
            p.segundo_nombre      || ''
        ].join('\t');

        return res.json({ tab_string, campos: p });

    } catch (err) {
        console.error('[admisiones/datos-pegado]', err);
        return res.status(500).json({ error: 'db_error', mensaje: err.message });
    }
});

// POST /api/admisiones/devolver/:id
// El paciente no se presentó al ser llamado — regresa a estado 'esperando'
// Body: { "modulo": "Módulo 2" }
router.post('/devolver/:id', async (req, res) => {
    const { modulo } = req.body;
    try {
        const { rowCount } = await query(
            `UPDATE pacientes_cola
             SET estado_admision = 'esperando',
                 hora_llamado_admision = NULL,
                 modulo_admision = NULL,
                 updated_at = NOW()
             WHERE id = $1 AND estado_admision = 'llamando_admision'`,
            [req.params.id]
        );
        if (rowCount === 0) return res.status(409).json({ error: 'Estado inválido para devolver' });

        const io = req.app.get('io');
        io.to('admisiones').to('recepcion').emit('cola_actualizada');
        io.to('display').emit('display_evento', {
            tipo: 'admision_cancelado',
            paciente_nombre: null,
            modulo: modulo || null
        });
        return res.json({ mensaje: 'ok' });
    } catch (err) {
        console.error('[admisiones/devolver]', err);
        return res.status(500).json({ error: 'db_error', mensaje: err.message });
    }
});

// PATCH /api/admisiones/prioridad/:id  (mismo contrato que recepcion/prioridad)
router.patch('/prioridad/:id', async (req, res) => {
    const { prioridad } = req.body;
    if (!['normal', 'media', 'alta'].includes(prioridad)) {
        return res.status(400).json({ error: 'Prioridad inválida' });
    }

    try {
        const { rowCount } = await query(
            `UPDATE pacientes_cola SET prioridad = $1, updated_at = NOW() WHERE id = $2`,
            [prioridad, req.params.id]
        );

        if (rowCount === 0) return res.status(404).json({ error: 'No encontrado' });

        req.app.get('io').to('admisiones').to('recepcion').emit('cola_actualizada');
        return res.json({ mensaje: 'Prioridad actualizada' });

    } catch (err) {
        console.error('[admisiones/prioridad]', err);
        return res.status(500).json({ error: 'db_error', mensaje: err.message });
    }
});

module.exports = router;
```

---

## `routes/api.profesional.js`

```javascript
const express = require('express');
const router = express.Router();
const { query } = require('../database/db');
const { v4: uuidv4 } = require('uuid');

// GET /api/profesional/asignaciones?profesional=KENDY+ZABALETA
// Devuelve asignaciones del profesional incluyendo si el paciente está bloqueado
// por otro profesional (llamando o en_atencion). Campos extra: bloqueado, bloqueado_por.
router.get('/asignaciones', async (req, res) => {
    const { profesional } = req.query;
    if (!profesional) return res.status(400).json({ error: 'Falta profesional' });

    try {
        const { rows } = await query(
            `SELECT ap.id, ap.nombre_paciente, ap.numero_identificacion,
                    ap.area, ap.hora_llegada_biofile, ap.estado,
                    ap.hora_llamado, ap.hora_en_atencion, ap.hora_finalizado,
                    ap.consultorio_numero,
                    pc.hora_llegada AS hora_llegada_turnero,
                    pc.prioridad,
                    -- Detectar si OTRO profesional tiene al paciente activo (bloqueado)
                    EXISTS (
                        SELECT 1 FROM asignaciones_profesionales otro
                        WHERE otro.numero_identificacion = ap.numero_identificacion
                          AND otro.fecha = CURRENT_DATE
                          AND otro.nombre_profesional <> $1
                          AND otro.estado IN ('llamando', 'en_atencion')
                    ) AS bloqueado,
                    (
                        SELECT otro.area FROM asignaciones_profesionales otro
                        WHERE otro.numero_identificacion = ap.numero_identificacion
                          AND otro.fecha = CURRENT_DATE
                          AND otro.nombre_profesional <> $1
                          AND otro.estado IN ('llamando', 'en_atencion')
                        LIMIT 1
                    ) AS bloqueado_por
             FROM asignaciones_profesionales ap
             LEFT JOIN pacientes_cola pc
                ON pc.numero_identificacion = ap.numero_identificacion
               AND pc.fecha = CURRENT_DATE
             WHERE ap.nombre_profesional = $1
               AND ap.fecha = CURRENT_DATE
             ORDER BY
                CASE COALESCE(pc.prioridad, 'normal')
                    WHEN 'alta' THEN 1 WHEN 'media' THEN 2 ELSE 3 END,
                ap.created_at ASC`,
            [profesional]
        );
        return res.json(rows);

    } catch (err) {
        console.error('[profesional/asignaciones]', err);
        return res.status(500).json({ error: 'db_error', mensaje: err.message });
    }
});

// POST /api/profesional/estado/:asignacionId
router.post('/estado/:asignacionId', async (req, res) => {
    const { estado, consultorio_numero, terminal_id, profesional_nombre } = req.body;
    const estadosValidos = ['llamando', 'en_atencion', 'finalizado'];

    if (!estadosValidos.includes(estado)) {
        return res.status(400).json({ error: 'Estado inválido' });
    }

    // Cada estado actualiza un timestamp distinto
    const camposTimestamp = {
        llamando:     'hora_llamado',
        en_atencion:  'hora_en_atencion',
        finalizado:   'hora_finalizado'
    };
    const campoTs = camposTimestamp[estado];

    try {
        const { rows, rowCount } = await query(
            `UPDATE asignaciones_profesionales
             SET estado = $1,
                 ${campoTs} = NOW(),
                 consultorio_numero = COALESCE($2, consultorio_numero),
                 terminal_profesional = $3,
                 updated_at = NOW()
             WHERE id = $4
             RETURNING *, nombre_paciente, numero_identificacion, area`,
            [estado, consultorio_numero, terminal_id, req.params.asignacionId]
        );

        if (rowCount === 0) return res.status(404).json({ error: 'No encontrado' });

        const asig = rows[0];

        // Tipo de evento para el log
        const tiposLog = {
            llamando:    'profesional_llamando',
            en_atencion: 'profesional_en_atencion',
            finalizado:  'profesional_finalizado'
        };
        await query(
            `INSERT INTO eventos_log (id, tipo_evento, paciente_cedula, paciente_nombre,
             profesional_nombre, area, consultorio_numero, terminal_id)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
            [uuidv4(), tiposLog[estado], asig.numero_identificacion, asig.nombre_paciente,
             profesional_nombre, asig.area, asig.consultorio_numero, terminal_id]
        );

        const io = req.app.get('io');

        // Notificar al display TV según el estado
        if (estado === 'llamando') {
            io.to('display').emit('display_evento', {
                tipo: 'profesional_llamando',
                paciente_nombre: asig.nombre_paciente,
                consultorio: asig.consultorio_numero,
                profesional: profesional_nombre,
                modulo: null,
                timestamp: new Date().toISOString()
            });
        } else if (estado === 'en_atencion') {
            io.to('display').emit('display_evento', {
                tipo: 'profesional_en_atencion',
                paciente_nombre: asig.nombre_paciente,
                consultorio: asig.consultorio_numero,
                timestamp: new Date().toISOString()
            });
        }

        // Notificar al módulo del profesional
        io.to(`profesional:${profesional_nombre}`).emit('asignaciones_actualizadas');

        return res.json({ mensaje: 'ok' });

    } catch (err) {
        console.error('[profesional/estado]', err);
        return res.status(500).json({ error: 'db_error', mensaje: err.message });
    }
});

// GET /api/profesional/listado-profesionales
// Lista de profesionales con asignaciones hoy (para el selector del módulo)
router.get('/listado-profesionales', async (req, res) => {
    try {
        const { rows } = await query(
            `SELECT DISTINCT nombre_profesional, area
             FROM asignaciones_profesionales
             WHERE fecha = CURRENT_DATE
             ORDER BY nombre_profesional`
        );
        return res.json(rows);
    } catch (err) {
        console.error('[profesional/listado]', err);
        return res.status(500).json({ error: 'db_error', mensaje: err.message });
    }
});

module.exports = router;
```

---

## `routes/api.extension.js`

```javascript
const express = require('express');
const router = express.Router();
const { query } = require('../database/db');
const { validarExtensionSecret } = require('../middleware/validar');
const { v4: uuidv4 } = require('uuid');

// POST /api/extension/sync
router.post('/sync', validarExtensionSecret, async (req, res) => {
    const { login_name, fecha, terminal_id, pacientes } = req.body;

    if (!Array.isArray(pacientes)) {
        return res.status(400).json({ error: 'pacientes debe ser un array' });
    }

    let nuevos = 0;
    let procesados = 0;

    try {
        for (const p of pacientes) {
            const { columna_header, nombre_profesional, area,
                    nombre_paciente, numero_identificacion, hora_llegada_biofile } = p;

            // ON CONFLICT: si ya existe (mismo día + cédula + columna), solo actualiza
            // hora_llegada_biofile si cambió. No sobreescribe estados de atención.
            const { rows } = await query(
                `INSERT INTO asignaciones_profesionales (
                    id, numero_identificacion, nombre_paciente, nombre_profesional,
                    area, columna_header, hora_llegada_biofile, terminal_profesional
                ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
                ON CONFLICT (fecha, numero_identificacion, columna_header)
                DO UPDATE SET
                    hora_llegada_biofile = EXCLUDED.hora_llegada_biofile,
                    updated_at = NOW()
                RETURNING (xmax = 0) AS es_nuevo`,
                [
                    uuidv4(), numero_identificacion, nombre_paciente, nombre_profesional,
                    area, columna_header, hora_llegada_biofile, terminal_id
                ]
            );

            procesados++;
            if (rows[0]?.es_nuevo) nuevos++;
        }

        // Log del sync
        await query(
            `INSERT INTO eventos_log (id, tipo_evento, profesional_nombre, terminal_id, datos_extra)
             VALUES ($1,$2,$3,$4,$5)`,
            [uuidv4(), 'extension_sync', login_name, terminal_id,
             JSON.stringify({ procesados, nuevos, fecha })]
        );

        // Notificar a todos los módulos de profesionales
        const io = req.app.get('io');
        io.to('admisiones').emit('cola_actualizada');
        // Notificar por sala específica de cada profesional que tuvo cambios
        const profesionalesUnicos = [...new Set(pacientes.map(p => p.nombre_profesional))];
        profesionalesUnicos.forEach(nombre => {
            io.to(`profesional:${nombre}`).emit('asignaciones_actualizadas');
        });

        return res.json({ procesados, nuevos, mensaje: 'ok' });

    } catch (err) {
        console.error('[extension/sync]', err);
        return res.status(500).json({ error: 'db_error', mensaje: err.message });
    }
});

module.exports = router;
```

**Nota sobre `(xmax = 0) AS es_nuevo`:** En PostgreSQL, `xmax = 0` en el resultado de un `INSERT ... ON CONFLICT DO UPDATE` indica que la fila fue insertada (nueva) y no actualizada. Es la forma idiomática de distinguir inserts de updates en un upsert.

---

## `routes/api.admin.js`

```javascript
const express = require('express');
const router = express.Router();
const { query } = require('../database/db');

// GET /api/admin/config
router.get('/config', async (req, res) => {
    try {
        const { rows } = await query('SELECT * FROM configuracion ORDER BY clave');
        return res.json(rows);
    } catch (err) {
        return res.status(500).json({ error: 'db_error', mensaje: err.message });
    }
});

// POST /api/admin/config
// Body: { "clave": "modulos_admisiones", "valor": "[\"Módulo 1\",\"Módulo 2\"]" }
router.post('/config', async (req, res) => {
    const { clave, valor } = req.body;
    try {
        await query(
            `INSERT INTO configuracion (clave, valor, updated_at)
             VALUES ($1, $2, NOW())
             ON CONFLICT (clave) DO UPDATE SET valor = $2, updated_at = NOW()`,
            [clave, valor]
        );
        return res.json({ mensaje: 'ok' });
    } catch (err) {
        return res.status(500).json({ error: 'db_error', mensaje: err.message });
    }
});

// GET /api/admin/terminales
router.get('/terminales', async (req, res) => {
    try {
        const { rows } = await query(
            `SELECT * FROM terminales ORDER BY tipo, nombre_descriptivo`
        );
        return res.json(rows);
    } catch (err) {
        return res.status(500).json({ error: 'db_error', mensaje: err.message });
    }
});

// GET /api/admin/reporte-tiempos?fecha=2026-06-08
router.get('/reporte-tiempos', async (req, res) => {
    const fecha = req.query.fecha || new Date().toISOString().split('T')[0];

    try {
        // Espera por paciente (T1→T2, T1→T3)
        const { rows: porPaciente } = await query(
            `SELECT
                pc.numero_identificacion,
                pc.primer_nombre || ' ' || pc.primer_apellido AS paciente,
                pc.hora_llegada AS t1,
                pc.hora_admision AS t2,
                MIN(ap.hora_llamado) AS t3,
                ROUND(EXTRACT(EPOCH FROM (pc.hora_admision - pc.hora_llegada)) / 60) AS min_espera_admision,
                ROUND(EXTRACT(EPOCH FROM (MIN(ap.hora_llamado) - pc.hora_llegada)) / 60) AS min_espera_total
             FROM pacientes_cola pc
             LEFT JOIN asignaciones_profesionales ap ON ap.paciente_cola_id = pc.id
             WHERE pc.fecha = $1
             GROUP BY pc.id, pc.numero_identificacion, pc.primer_nombre,
                      pc.primer_apellido, pc.hora_llegada, pc.hora_admision
             ORDER BY pc.hora_llegada`,
            [fecha]
        );

        // Resumen por profesional (T4→T5)
        const { rows: porProfesional } = await query(
            `SELECT
                nombre_profesional, area,
                COUNT(*) AS atendidos,
                ROUND(AVG(EXTRACT(EPOCH FROM (hora_finalizado - hora_en_atencion)) / 60)) AS avg_min_atencion
             FROM asignaciones_profesionales
             WHERE fecha = $1
               AND estado = 'finalizado'
               AND hora_en_atencion IS NOT NULL
               AND hora_finalizado IS NOT NULL
             GROUP BY nombre_profesional, area
             ORDER BY nombre_profesional`,
            [fecha]
        );

        return res.json({ fecha, por_paciente: porPaciente, por_profesional: porProfesional });

    } catch (err) {
        console.error('[admin/reporte-tiempos]', err);
        return res.status(500).json({ error: 'db_error', mensaje: err.message });
    }
});

// GET /api/admin/eventos-log?fecha=2026-06-08&limit=100
router.get('/eventos-log', async (req, res) => {
    const fecha = req.query.fecha || new Date().toISOString().split('T')[0];
    const limit = Math.min(parseInt(req.query.limit || '100'), 500);

    try {
        const { rows } = await query(
            `SELECT * FROM eventos_log
             WHERE timestamp::date = $1
             ORDER BY timestamp DESC
             LIMIT $2`,
            [fecha, limit]
        );
        return res.json(rows);
    } catch (err) {
        return res.status(500).json({ error: 'db_error', mensaje: err.message });
    }
});

module.exports = router;
```

---

## `sockets/events.js`

```javascript
const { query } = require('../database/db');
const { v4: uuidv4 } = require('uuid');

module.exports = function(io) {

    io.on('connection', (socket) => {
        socket.on('join', ({ tipo, profesionalNombre, terminalId }) => {
            socket.join(tipo); // 'recepcion', 'admisiones', 'display', 'admin'
            if (tipo === 'profesional' && profesionalNombre) {
                socket.join(`profesional:${profesionalNombre}`);
            }
            socket.terminalId = terminalId;
            socket.tipo = tipo;

            // Registrar o actualizar heartbeat del terminal
            if (terminalId) {
                query(
                    `INSERT INTO terminales (id, tipo, ultimo_heartbeat)
                     VALUES ($1, $2, NOW())
                     ON CONFLICT (id) DO UPDATE
                     SET tipo = $2, ultimo_heartbeat = NOW(), activo = TRUE`,
                    [terminalId, tipo]
                ).catch(err => console.error('[socket/join db]', err));
            }
        });

        socket.on('heartbeat', ({ terminalId }) => {
            if (terminalId) {
                query(
                    `UPDATE terminales SET ultimo_heartbeat = NOW() WHERE id = $1`,
                    [terminalId]
                ).catch(() => {});
            }
        });

        socket.on('disconnect', () => {
            if (socket.terminalId) {
                query(
                    `UPDATE terminales SET activo = FALSE WHERE id = $1`,
                    [socket.terminalId]
                ).catch(() => {});
            }
        });
    });
};
```

---

## Eventos Socket.io — referencia rápida

| Evento | Sala destino | Cuándo |
|---|---|---|
| `cola_actualizada` | `admisiones`, `recepcion` | Nuevo paciente, cambio de prioridad, cambio de estado admisión, sync de extensión |
| `asignaciones_actualizadas` | `profesional:{nombre}` | Extensión sync, cambio de estado de una asignación |
| `display_evento` | `display` | Cualquier llamado (admisión o profesional) |

### Formato de `display_evento`

```json
{
    "tipo": "admision_llamando",
    "paciente_nombre": "JUAN GARCIA",
    "modulo": "Módulo 2",
    "consultorio": null,
    "profesional": null,
    "timestamp": "2026-06-08T14:22:00.000Z"
}
```

Tipos posibles:
- `admision_llamando` — TV centro: "JUAN GARCIA — Módulo 2"
- `admision_en_atencion` — paciente pasa al bloque del módulo en TV
- `profesional_llamando` — TV centro: "JUAN GARCIA — Consultorio 5"
- `profesional_en_atencion` — paciente sale del centro de TV

---

## Manejo de errores

Todos los handlers hacen `try/catch`. En caso de error:
- Error de DB: `500` con `{ "error": "db_error", "mensaje": "..." }`
- Violación de `UNIQUE` en PostgreSQL: el código de error es `'23505'` — se puede detectar con `err.code === '23505'` para devolver `409` en vez de `500`.
- Recurso no encontrado (`rowCount === 0`): `404`.
- Parámetro inválido: `400`.
