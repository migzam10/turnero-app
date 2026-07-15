const { Router } = require('express');
const { query } = require('../database/db');
const { crearToken, validarAdminToken,
        loginBloqueado, registrarIntentoFallido, limpiarIntentos } = require('../middleware/adminAuth');
const { fechaHoyBogota } = require('../utils/fecha');
const { registrarEvento } = require('../utils/audit');

const router = Router();

// Claves de configuración cuyo valor nunca debe exponerse al cliente.
const CLAVES_SENSIBLES = new Set(['clave_admin']);

// Valida que la fecha sea un día calendario real en formato YYYY-MM-DD
// (mismo patrón que api.profesional.js / api.extension.js).
const FECHA_RE = /^\d{4}-\d{2}-\d{2}$/;
function fechaValida(f) {
    if (typeof f !== 'string' || !FECHA_RE.test(f)) return false;
    const d = new Date(`${f}T00:00:00Z`);
    return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === f;
}

// ── Autenticación ─────────────────────────────────────────────
// Barrera de acceso al módulo Admin. La clave se almacena en la tabla de
// configuración (clave 'clave_admin', valor por defecto '2026') y puede
// cambiarse desde la pestaña Configuración. En un login válido se entrega un
// token de sesión que el cliente debe enviar en el header Authorization.
// (Ruta pública: se define ANTES del middleware de protección.)
router.post('/login', async (req, res) => {
    const ip = req.ip;
    // Rate-limit: si la IP ya agotó los intentos, se rechaza sin tocar la BD.
    if (loginBloqueado(ip)) {
        registrarEvento({ tipo: 'admin_login_bloqueado', descripcion: 'Login admin bloqueado por intentos', datos: { ip } });
        return res.status(429).json({ error: 'demasiados_intentos' });
    }

    const { clave } = req.body || {};
    if (!clave) return res.status(400).json({ error: 'clave_requerida' });
    try {
        const { rows } = await query(
            `SELECT valor FROM configuracion WHERE clave = 'clave_admin'`
        );
        const claveValida = rows[0]?.valor || '2026';
        if (String(clave) === String(claveValida)) {
            limpiarIntentos(ip);
            registrarEvento({ tipo: 'admin_login', descripcion: 'Login admin OK', datos: { ip } });
            return res.json({ ok: true, token: crearToken() });
        }
        registrarIntentoFallido(ip);
        return res.status(401).json({ error: 'clave_incorrecta' });
    } catch (err) {
        console.error('[admin/login]', err);
        return res.status(500).json({ error: 'db_error' });
    }
});

// A partir de aquí, todos los endpoints exigen un token de sesión válido.
router.use(validarAdminToken);

// ── Configuración ─────────────────────────────────────────────

router.get('/config', async (req, res) => {
    try {
        // Se excluye display_logo (base64 grande); tiene su propio endpoint público
        // y su control dedicado en "Personalización".
        const { rows } = await query(
            `SELECT clave, valor, descripcion FROM configuracion
             WHERE clave <> 'display_logo' ORDER BY clave`
        );
        // Enmascara claves sensibles: nunca se envía el valor real al cliente.
        const segura = rows.map(r =>
            CLAVES_SENSIBLES.has(r.clave) ? { ...r, valor: '', sensible: true } : r
        );
        return res.json(segura);
    } catch (err) {
        return res.status(500).json({ error: 'db_error' });
    }
});

router.post('/config', async (req, res) => {
    const { clave, valor } = req.body;
    if (!clave || valor === undefined) return res.status(400).json({ error: 'clave y valor requeridos' });
    // No se permite vaciar una clave sensible (p.ej. dejar el admin sin contraseña).
    if (CLAVES_SENSIBLES.has(clave) && String(valor).trim() === '') {
        return res.status(400).json({ error: 'valor_vacio_no_permitido' });
    }
    try {
        await query(
            `INSERT INTO configuracion (clave, valor, updated_at) VALUES ($1, $2, NOW())
             ON CONFLICT (clave) DO UPDATE SET valor = $2, updated_at = NOW()`,
            [clave, valor]
        );
        // Notifica a todas las pantallas para que recarguen branding/parámetros en vivo.
        // Se envía solo la clave (sin el valor) para no difundir payloads grandes (logo).
        req.app.get('io').emit('config:actualizada', { clave });
        // No se registra el valor (puede ser sensible, p.ej. clave_admin): solo la clave.
        registrarEvento({ tipo: 'config_cambiada', descripcion: `Config '${clave}' actualizada`, datos: { clave } });
        return res.json({ ok: true });
    } catch (err) {
        return res.status(500).json({ error: 'db_error' });
    }
});

// ── Terminales ────────────────────────────────────────────────

router.get('/terminales', async (req, res) => {
    try {
        const { rows } = await query(
            `SELECT id, tipo, consultorio_numero, login_name_biofile, ip_address, ultimo_heartbeat
             FROM terminales ORDER BY tipo, ultimo_heartbeat DESC NULLS LAST`
        );
        return res.json(rows);
    } catch (err) {
        return res.status(500).json({ error: 'db_error' });
    }
});

// ── Monitoreo de pantallas (displays) ─────────────────────────
// Estado en línea (heartbeat < 90s) y audio desbloqueado de cada terminal display.
router.get('/pantallas', async (req, res) => {
    try {
        const { rows } = await query(
            `SELECT id, ultimo_heartbeat, audio_ok,
                    (ultimo_heartbeat IS NOT NULL
                     AND ultimo_heartbeat > NOW() - INTERVAL '90 seconds') AS en_linea
             FROM terminales
             WHERE tipo = 'display'
             ORDER BY ultimo_heartbeat DESC NULLS LAST`
        );
        return res.json(rows);
    } catch (err) {
        console.error('[admin/pantallas]', err);
        return res.status(500).json({ error: 'db_error' });
    }
});

// ── Catálogo de consultorios ──────────────────────────────────
// CRUD administrado desde Admin. Baja lógica (activo=false) vía PATCH; sin DELETE.
// `nombre` es texto COMPLETO que ve el paciente; `multipaciente` permite llamar a
// varios pacientes a la vez desde ese consultorio.

router.get('/consultorios', async (req, res) => {
    try {
        const { rows } = await query(
            `SELECT id, nombre, multipaciente, activo, created_at, updated_at
             FROM consultorios ORDER BY nombre`
        );
        return res.json(rows);
    } catch (err) {
        console.error('[admin/consultorios:list]', err);
        return res.status(500).json({ error: 'db_error' });
    }
});

router.post('/consultorios', async (req, res) => {
    const { nombre, multipaciente } = req.body;
    const nombreLimpio = String(nombre || '').trim();
    if (!nombreLimpio || nombreLimpio.length > 60) {
        return res.status(400).json({ error: 'nombre_requerido' });
    }
    const multi = multipaciente === true;
    try {
        const { rows } = await query(
            `INSERT INTO consultorios (nombre, multipaciente)
             VALUES ($1, $2)
             RETURNING id, nombre, multipaciente, activo, created_at, updated_at`,
            [nombreLimpio, multi]
        );
        const io = req.app.get('io');
        if (io) io.emit('consultorios:actualizados', { ts: Date.now() });
        return res.status(201).json(rows[0]);
    } catch (err) {
        if (err.code === '23505') return res.status(409).json({ error: 'nombre_duplicado' });
        console.error('[admin/consultorios:create]', err);
        return res.status(500).json({ error: 'db_error' });
    }
});

router.patch('/consultorios/:id', async (req, res) => {
    // SET dinámico seguro: solo se tocan los campos presentes en el body, siempre
    // con placeholders (nunca concatenación de valores).
    const { nombre, multipaciente, activo } = req.body;
    const sets = [];
    const params = [];
    let i = 1;

    if (nombre !== undefined) {
        const nombreLimpio = String(nombre || '').trim();
        if (!nombreLimpio || nombreLimpio.length > 60) {
            return res.status(400).json({ error: 'nombre_requerido' });
        }
        sets.push(`nombre = $${i++}`); params.push(nombreLimpio);
    }
    if (multipaciente !== undefined) { sets.push(`multipaciente = $${i++}`); params.push(multipaciente === true); }
    if (activo !== undefined) { sets.push(`activo = $${i++}`); params.push(activo === true); }

    if (sets.length === 0) return res.status(400).json({ error: 'sin_cambios' });
    sets.push(`updated_at = NOW()`);
    params.push(req.params.id);

    try {
        const { rows, rowCount } = await query(
            `UPDATE consultorios SET ${sets.join(', ')}
             WHERE id = $${i}
             RETURNING id, nombre, multipaciente, activo, created_at, updated_at`,
            params
        );
        if (rowCount === 0) return res.status(404).json({ error: 'consultorio_no_encontrado' });
        const io = req.app.get('io');
        if (io) io.emit('consultorios:actualizados', { ts: Date.now() });
        return res.json(rows[0]);
    } catch (err) {
        if (err.code === '23505') return res.status(409).json({ error: 'nombre_duplicado' });
        console.error('[admin/consultorios:update]', err);
        return res.status(500).json({ error: 'db_error' });
    }
});

// ── Dashboard — resumen del día ───────────────────────────────

router.get('/resumen-dia', async (req, res) => {
    const fecha = req.query.fecha || fechaHoyBogota();
    try {
        const { rows: cola } = await query(
            `SELECT
                COUNT(*)                                                       AS total_registrados,
                COUNT(*) FILTER (WHERE estado_admision = 'admisionado')        AS total_admisionados,
                COUNT(*) FILTER (WHERE estado_admision = 'esperando')          AS en_espera,
                COUNT(*) FILTER (WHERE estado_admision = 'llamando_admision')  AS siendo_llamados,
                COUNT(*) FILTER (WHERE prioridad = 'alta')                     AS prioridad_alta,
                ROUND(AVG(EXTRACT(EPOCH FROM (hora_llamado_admision - hora_llegada))/60)
                      FILTER (WHERE hora_llamado_admision IS NOT NULL))        AS avg_min_espera_admision,
                ROUND(AVG(EXTRACT(EPOCH FROM (hora_admision - hora_llamado_admision))/60)
                      FILTER (WHERE hora_admision IS NOT NULL AND hora_llamado_admision IS NOT NULL
                              AND hora_admision >= hora_llamado_admision)) AS avg_min_registro
             FROM pacientes_cola WHERE fecha = $1`,
            [fecha]
        );
        const { rows: asig } = await query(
            `SELECT
                COUNT(*) FILTER (WHERE estado = 'pendiente' AND activo)   AS pendientes,
                COUNT(*) FILTER (WHERE estado = 'llamando' AND activo)    AS llamando,
                COUNT(*) FILTER (WHERE estado = 'en_atencion' AND activo) AS en_atencion,
                COUNT(*) FILTER (WHERE estado = 'finalizado' AND activo)  AS finalizados,
                COUNT(DISTINCT nombre_profesional) FILTER (WHERE activo)  AS profesionales_activos,
                COUNT(*) FILTER (WHERE estado = 'cancelado' AND origen_baja = 'lis')    AS cancelados_lis,
                COUNT(*) FILTER (WHERE estado = 'cancelado' AND origen_baja = 'manual') AS cancelados_manual,
                COUNT(*) FILTER (WHERE origen = 'manual' AND activo)      AS particulares
             FROM asignaciones_profesionales WHERE fecha = $1`,
            [fecha]
        );
        return res.json({ fecha, cola: cola[0], asignaciones: asig[0] });
    } catch (err) {
        console.error('[admin/resumen-dia]', err);
        return res.status(500).json({ error: 'db_error' });
    }
});

// ── Dashboard en vivo (una sola llamada) ──────────────────────
// Alimenta el panel Admin en tiempo real con queries LIGERAS (sin JSON_AGG por
// paciente, a diferencia de /reporte-detallado). No reemplaza a /resumen-dia ni a
// /reporte-detallado: es adicional y autocontenido. Respeta el parámetro `fecha`
// (histórico); no fuerza CURRENT_DATE.
router.get('/dashboard', async (req, res) => {
    const fecha = req.query.fecha || fechaHoyBogota();
    try {
        const [cola, asig, colaPendiente, porProfesional] = await Promise.all([
            query(
                `SELECT
                    COUNT(*)                                                       AS total_registrados,
                    COUNT(*) FILTER (WHERE estado_admision = 'admisionado')        AS total_admisionados,
                    COUNT(*) FILTER (WHERE estado_admision = 'esperando')          AS en_espera,
                    COUNT(*) FILTER (WHERE estado_admision = 'llamando_admision')  AS siendo_llamados,
                    COUNT(*) FILTER (WHERE prioridad = 'alta')                     AS prioridad_alta,
                    ROUND(AVG(EXTRACT(EPOCH FROM (hora_llamado_admision - hora_llegada))/60)
                          FILTER (WHERE hora_llamado_admision IS NOT NULL))        AS avg_min_espera_admision,
                    ROUND(AVG(EXTRACT(EPOCH FROM (hora_admision - hora_llamado_admision))/60)
                          FILTER (WHERE hora_admision IS NOT NULL AND hora_llamado_admision IS NOT NULL
                                  AND hora_admision >= hora_llamado_admision)) AS avg_min_registro
                 FROM pacientes_cola WHERE fecha = $1`,
                [fecha]
            ),
            query(
                `SELECT
                    COUNT(*) FILTER (WHERE estado = 'pendiente' AND activo)   AS pendientes,
                    COUNT(*) FILTER (WHERE estado = 'llamando' AND activo)    AS llamando,
                    COUNT(*) FILTER (WHERE estado = 'en_atencion' AND activo) AS en_atencion,
                    COUNT(*) FILTER (WHERE estado = 'finalizado' AND activo)  AS finalizados,
                    COUNT(DISTINCT nombre_profesional) FILTER (WHERE activo)  AS profesionales_activos,
                    COUNT(*) FILTER (WHERE estado = 'cancelado' AND origen_baja = 'lis')    AS cancelados_lis,
                    COUNT(*) FILTER (WHERE estado = 'cancelado' AND origen_baja = 'manual') AS cancelados_manual,
                    COUNT(*) FILTER (WHERE origen = 'manual' AND activo)      AS particulares
                 FROM asignaciones_profesionales WHERE fecha = $1`,
                [fecha]
            ),
            query(
                `SELECT numero_identificacion,
                        primer_nombre || ' ' || COALESCE(segundo_nombre || ' ','') ||
                        primer_apellido || COALESCE(' ' || segundo_apellido,'') AS nombre_completo,
                        hora_llegada, prioridad, estado_admision
                 FROM pacientes_cola
                 WHERE fecha = $1 AND estado_admision <> 'admisionado'
                 ORDER BY
                     CASE prioridad WHEN 'alta' THEN 1 WHEN 'media' THEN 2 ELSE 3 END,
                     hora_llegada
                 LIMIT 15`,
                [fecha]
            ),
            query(
                `SELECT
                    ap.nombre_profesional, ap.area,
                    COUNT(*) FILTER (WHERE ap.activo)                                 AS asignados_activos,
                    COUNT(*) FILTER (WHERE ap.estado IN ('llamando','en_atencion') AND ap.activo) AS en_proceso,
                    COUNT(*) FILTER (WHERE ap.estado = 'finalizado' AND ap.activo)    AS finalizados,
                    COUNT(*) FILTER (WHERE ap.estado = 'cancelado')                   AS cancelados,
                    ROUND(AVG(EXTRACT(EPOCH FROM (ap.hora_finalizado - ap.hora_en_atencion))/60)
                          FILTER (WHERE ap.estado='finalizado' AND ap.activo AND ap.hora_en_atencion IS NOT NULL))
                                                                                      AS avg_min_atencion
                 FROM asignaciones_profesionales ap
                 WHERE ap.fecha = $1
                 GROUP BY ap.nombre_profesional, ap.area
                 ORDER BY ap.nombre_profesional`,
                [fecha]
            ),
        ]);

        return res.json({
            fecha,
            cola: cola.rows[0],
            asignaciones: asig.rows[0],
            cola_pendiente: colaPendiente.rows,
            por_profesional: porProfesional.rows,
        });
    } catch (err) {
        console.error('[admin/dashboard]', err);
        return res.status(500).json({ error: 'db_error' });
    }
});

// ── Datos para gráficas del Admin (una sola llamada) ──────────
// Solo lectura, por fecha. Alimenta 3 gráficas: embudo del pipeline, flujo por hora
// y barras por profesional. Respeta el parámetro `fecha` (histórico); no fuerza
// CURRENT_DATE. Es adicional: no toca /dashboard ni /reporte-detallado.
router.get('/graficas', async (req, res) => {
    const fecha = req.query.fecha || fechaHoyBogota();
    try {
        // Embudo: semántica "alcanzó la etapa" (timestamps IS NOT NULL), NO snapshot.
        // Se cuentan pacientes DISTINTOS en las etapas de profesional para que las
        // etapas sean coherentes entre sí.
        const embudoPromise = query(
            `SELECT
                (SELECT COUNT(*) FROM pacientes_cola WHERE fecha = $1)                       AS registrados,
                (SELECT COUNT(*) FROM pacientes_cola
                    WHERE fecha = $1 AND hora_admision IS NOT NULL)                          AS admisionados,
                (SELECT COUNT(DISTINCT numero_identificacion) FROM asignaciones_profesionales
                    WHERE fecha = $1 AND activo AND hora_llamado IS NOT NULL)                AS llamados,
                (SELECT COUNT(DISTINCT numero_identificacion) FROM asignaciones_profesionales
                    WHERE fecha = $1 AND activo AND hora_en_atencion IS NOT NULL)            AS en_atencion,
                (SELECT COUNT(DISTINCT numero_identificacion) FROM asignaciones_profesionales
                    WHERE fecha = $1 AND activo AND estado = 'finalizado'
                      AND hora_finalizado IS NOT NULL)                                       AS finalizados`,
            [fecha]
        );

        // Flujo horario: serie fija de 24 horas (0-23) sin huecos, vía generate_series
        // LEFT JOIN a las agregaciones por hora de llegada y de atención.
        const flujoPromise = query(
            `SELECT h.hora,
                    COALESCE(l.llegadas, 0)   AS llegadas,
                    COALESCE(a.atenciones, 0) AS atenciones
             FROM generate_series(0, 23) AS h(hora)
             LEFT JOIN (
                 SELECT EXTRACT(HOUR FROM hora_llegada)::int AS hora, COUNT(*) AS llegadas
                 FROM pacientes_cola
                 WHERE fecha = $1 AND hora_llegada IS NOT NULL
                 GROUP BY 1
             ) l ON l.hora = h.hora
             LEFT JOIN (
                 SELECT EXTRACT(HOUR FROM hora_en_atencion)::int AS hora, COUNT(*) AS atenciones
                 FROM asignaciones_profesionales
                 WHERE fecha = $1 AND activo AND hora_en_atencion IS NOT NULL
                 GROUP BY 1
             ) a ON a.hora = h.hora
             ORDER BY h.hora`,
            [fecha]
        );

        const porProfesionalPromise = query(
            `SELECT
                ap.nombre_profesional, ap.area,
                COUNT(*) FILTER (WHERE ap.estado = 'finalizado' AND ap.activo)     AS finalizados,
                ROUND(AVG(EXTRACT(EPOCH FROM (ap.hora_finalizado - ap.hora_en_atencion))/60)
                      FILTER (WHERE ap.estado='finalizado' AND ap.activo AND ap.hora_en_atencion IS NOT NULL))
                                                                                   AS avg_min_atencion
             FROM asignaciones_profesionales ap
             WHERE ap.fecha = $1
             GROUP BY ap.nombre_profesional, ap.area
             ORDER BY finalizados DESC`,
            [fecha]
        );

        const [embudo, flujo, porProfesional] = await Promise.all([
            embudoPromise, flujoPromise, porProfesionalPromise,
        ]);

        return res.json({
            fecha,
            embudo: embudo.rows[0],
            flujo_horario: flujo.rows,
            por_profesional: porProfesional.rows,
        });
    } catch (err) {
        console.error('[admin/graficas]', err);
        return res.status(500).json({ error: 'db_error' });
    }
});

// ── Lista de pacientes del día ────────────────────────────────

router.get('/pacientes', async (req, res) => {
    const fecha = req.query.fecha || fechaHoyBogota();
    try {
        const { rows } = await query(
            `SELECT
                pc.id, pc.numero_identificacion,
                pc.primer_nombre || ' ' || COALESCE(pc.segundo_nombre || ' ','') ||
                pc.primer_apellido || COALESCE(' ' || pc.segundo_apellido,'') AS nombre_completo,
                pc.hora_llegada, pc.hora_admision,
                pc.prioridad, pc.estado_admision, pc.modulo_admision,
                COALESCE(
                    JSON_AGG(
                        JSON_BUILD_OBJECT(
                            'profesional',      ap.nombre_profesional,
                            'area',             ap.area,
                            'estado',           ap.estado,
                            'hora_llegada_bio', ap.hora_llegada_biofile,
                            'hora_llamado',     ap.hora_llamado,
                            'hora_en_atencion', ap.hora_en_atencion,
                            'hora_finalizado',  ap.hora_finalizado,
                            'min_atencion', CASE
                                WHEN ap.hora_finalizado IS NOT NULL AND ap.hora_en_atencion IS NOT NULL
                                THEN ROUND(EXTRACT(EPOCH FROM (ap.hora_finalizado - ap.hora_en_atencion))/60)
                            END
                        ) ORDER BY ap.created_at
                    ) FILTER (WHERE ap.id IS NOT NULL),
                '[]') AS asignaciones
             FROM pacientes_cola pc
             LEFT JOIN asignaciones_profesionales ap ON ap.paciente_cola_id = pc.id
             WHERE pc.fecha = $1
             GROUP BY pc.id
             ORDER BY pc.hora_llegada`,
            [fecha]
        );
        return res.json(rows);
    } catch (err) {
        console.error('[admin/pacientes]', err);
        return res.status(500).json({ error: 'db_error' });
    }
});

// ── Reporte detallado T1→T5 ───────────────────────────────────

router.get('/reporte-detallado', async (req, res) => {
    // Rango [desde, hasta]. Compatibilidad: ?fecha= equivale a desde=hasta=fecha;
    // sin parámetros → hoy (Bogotá).
    let { desde, hasta } = req.query;
    if (!desde && !hasta) {
        desde = hasta = req.query.fecha || fechaHoyBogota();
    } else {
        desde = desde || hasta;
        hasta = hasta || desde;
    }
    if (!fechaValida(desde) || !fechaValida(hasta)) {
        return res.status(400).json({ error: 'fecha_invalida' });
    }
    if (desde > hasta) {
        return res.status(400).json({ error: 'rango_invalido' });
    }
    // Span inclusivo en días; tope de 31.
    const spanDias = Math.round((new Date(`${hasta}T00:00:00Z`) - new Date(`${desde}T00:00:00Z`)) / 86400000) + 1;
    if (spanDias > 31) {
        return res.status(400).json({ error: 'rango_muy_grande', max_dias: 31 });
    }

    try {
        const { rows: timeline } = await query(
            `SELECT
                pc.fecha,
                pc.numero_identificacion AS cedula,
                pc.primer_nombre || ' ' || pc.primer_apellido AS paciente,
                pc.prioridad,
                pc.hora_llegada                                               AS t1_llegada,
                pc.hora_llamado_admision                                      AS t2a_admisionando,
                pc.hora_admision                                              AS t2_sistema,
                MIN(ap.hora_llamado) FILTER (WHERE ap.activo)                 AS t3_primer_llamado,
                MIN(ap.hora_en_atencion) FILTER (WHERE ap.activo)             AS t4_primera_atencion,
                MAX(ap.hora_finalizado) FILTER (WHERE ap.activo)              AS t5_ultima_finalizacion,
                ROUND(EXTRACT(EPOCH FROM (pc.hora_llamado_admision - pc.hora_llegada))/60)
                                                                              AS min_espera_admision,
                CASE WHEN pc.hora_admision >= pc.hora_llamado_admision
                     THEN ROUND(EXTRACT(EPOCH FROM (pc.hora_admision - pc.hora_llamado_admision))/60)
                END                                                           AS min_registro,
                ROUND(EXTRACT(EPOCH FROM (MIN(ap.hora_llamado) FILTER (WHERE ap.activo) - pc.hora_llegada))/60)
                                                                              AS min_espera_primera_atencion,
                ROUND(EXTRACT(EPOCH FROM (MAX(ap.hora_finalizado) FILTER (WHERE ap.activo) - pc.hora_llegada))/60)
                                                                              AS min_tiempo_total_clinica,
                COALESCE(JSON_AGG(
                    JSON_BUILD_OBJECT(
                        'profesional',   ap.nombre_profesional,
                        'area',          ap.area,
                        'estado',        ap.estado,
                        't3_llamado',    ap.hora_llamado,
                        't4_atencion',   ap.hora_en_atencion,
                        't5_finalizado', ap.hora_finalizado,
                        'min_espera_llamado', CASE
                            WHEN ap.hora_llamado IS NOT NULL
                            THEN ROUND(EXTRACT(EPOCH FROM (ap.hora_llamado - pc.hora_llegada))/60)
                        END,
                        'min_atencion', CASE
                            WHEN ap.hora_finalizado IS NOT NULL AND ap.hora_en_atencion IS NOT NULL
                            THEN ROUND(EXTRACT(EPOCH FROM (ap.hora_finalizado - ap.hora_en_atencion))/60)
                        END
                    ) ORDER BY ap.created_at
                ) FILTER (WHERE ap.id IS NOT NULL), '[]') AS por_profesional
             FROM pacientes_cola pc
             LEFT JOIN asignaciones_profesionales ap ON ap.paciente_cola_id = pc.id
             WHERE pc.fecha BETWEEN $1 AND $2
             GROUP BY pc.id, pc.fecha, pc.numero_identificacion, pc.primer_nombre,
                      pc.primer_apellido, pc.prioridad, pc.hora_llegada,
                      pc.hora_llamado_admision, pc.hora_admision
             ORDER BY pc.fecha, pc.hora_llegada`,
            [desde, hasta]
        );

        const { rows: porProfesional } = await query(
            `SELECT
                ap.nombre_profesional, ap.area,
                COUNT(*) FILTER (WHERE ap.activo)                                 AS asignados_activos,
                COUNT(*) FILTER (WHERE ap.estado = 'finalizado' AND ap.activo)    AS finalizados,
                COUNT(*) FILTER (WHERE ap.estado IN ('llamando','en_atencion') AND ap.activo) AS en_proceso,
                COUNT(*) FILTER (WHERE ap.estado = 'pendiente' AND ap.activo)     AS pendientes,
                COUNT(*) FILTER (WHERE ap.estado = 'cancelado' AND ap.origen_baja = 'lis')    AS cancelados_lis,
                COUNT(*) FILTER (WHERE ap.estado = 'cancelado' AND ap.origen_baja = 'manual') AS cancelados_manual,
                COUNT(*) FILTER (WHERE ap.origen = 'manual' AND ap.activo)        AS particulares,
                ROUND(AVG(EXTRACT(EPOCH FROM (ap.hora_finalizado - ap.hora_en_atencion))/60)
                      FILTER (WHERE ap.estado='finalizado' AND ap.activo AND ap.hora_en_atencion IS NOT NULL))
                                                                                  AS avg_min_atencion,
                ROUND(MIN(EXTRACT(EPOCH FROM (ap.hora_finalizado - ap.hora_en_atencion))/60)
                      FILTER (WHERE ap.estado='finalizado' AND ap.activo AND ap.hora_en_atencion IS NOT NULL))
                                                                                  AS min_min_atencion,
                ROUND(MAX(EXTRACT(EPOCH FROM (ap.hora_finalizado - ap.hora_en_atencion))/60)
                      FILTER (WHERE ap.estado='finalizado' AND ap.activo AND ap.hora_en_atencion IS NOT NULL))
                                                                                  AS max_min_atencion,
                ROUND(AVG(EXTRACT(EPOCH FROM (ap.hora_llamado - pc.hora_llegada))/60)
                      FILTER (WHERE ap.hora_llamado IS NOT NULL))                 AS avg_min_espera_hasta_llamado
             FROM asignaciones_profesionales ap
             LEFT JOIN pacientes_cola pc ON pc.id = ap.paciente_cola_id
             WHERE ap.fecha BETWEEN $1 AND $2
             GROUP BY ap.nombre_profesional, ap.area
             ORDER BY ap.nombre_profesional`,
            [desde, hasta]
        );

        const { rows: kpis } = await query(
            `SELECT
                COUNT(DISTINCT pc.id)                                              AS total_pacientes,
                COUNT(DISTINCT pc.id) FILTER (WHERE pc.estado_admision='admisionado') AS admisionados,
                ROUND(AVG(EXTRACT(EPOCH FROM (pc.hora_llamado_admision - pc.hora_llegada))/60)
                      FILTER (WHERE pc.hora_llamado_admision IS NOT NULL))          AS avg_espera_admision,
                ROUND(AVG(EXTRACT(EPOCH FROM (pc.hora_admision - pc.hora_llamado_admision))/60)
                      FILTER (WHERE pc.hora_admision IS NOT NULL AND pc.hora_llamado_admision IS NOT NULL
                              AND pc.hora_admision >= pc.hora_llamado_admision)) AS avg_registro,
                ROUND(AVG(EXTRACT(EPOCH FROM (ap.hora_finalizado - ap.hora_en_atencion))/60)
                      FILTER (WHERE ap.estado='finalizado' AND ap.activo))         AS avg_tiempo_atencion_general,
                COUNT(*) FILTER (WHERE ap.origen = 'manual' AND ap.activo)         AS particulares,
                COUNT(*) FILTER (WHERE ap.estado = 'cancelado' AND ap.origen_baja = 'lis')    AS bajas_lis,
                COUNT(*) FILTER (WHERE ap.estado = 'cancelado' AND ap.origen_baja = 'manual') AS bajas_manual
             FROM pacientes_cola pc
             LEFT JOIN asignaciones_profesionales ap ON ap.paciente_cola_id = pc.id
             WHERE pc.fecha BETWEEN $1 AND $2`,
            [desde, hasta]
        );

        // Bug #12: detalle por admisión (una fila por asignación profesional)
        const { rows: asignaciones } = await query(
            `SELECT
                ap.fecha,
                ap.numero_identificacion AS cedula,
                COALESCE(pc.primer_nombre || ' ' || pc.primer_apellido, ap.nombre_paciente, ap.numero_identificacion) AS nombre,
                ap.nombre_profesional,
                ap.area,
                ap.estado,
                ap.origen,
                ap.origen_baja,
                ap.activo,
                ap.hora_llegada_biofile,
                -- Hora de admisión unificada: Biofile usa su timestamp; el particular
                -- (origen='manual') cae a la admisión del sistema (T2). Si ambos son
                -- NULL queda NULL (no cae a T1); el front muestra '—'.
                COALESCE(ap.hora_llegada_biofile, pc.hora_admision) AS hora_admisionado,
                ap.hora_llamado,
                ap.hora_en_atencion,
                ap.hora_finalizado,
                CASE
                    WHEN ap.hora_finalizado IS NOT NULL AND ap.hora_en_atencion IS NOT NULL
                    THEN ROUND(EXTRACT(EPOCH FROM (ap.hora_finalizado - ap.hora_en_atencion))/60)
                END AS min_atencion
             FROM asignaciones_profesionales ap
             LEFT JOIN pacientes_cola pc ON pc.id = ap.paciente_cola_id
             WHERE ap.fecha BETWEEN $1 AND $2
             ORDER BY ap.fecha, ap.nombre_profesional, ap.hora_llegada_biofile NULLS LAST, ap.created_at`,
            [desde, hasta]
        );

        return res.json({ desde, hasta, fecha: desde, kpis: kpis[0], timeline, por_profesional: porProfesional, asignaciones });
    } catch (err) {
        console.error('[admin/reporte-detallado]', err);
        return res.status(500).json({ error: 'db_error' });
    }
});

// ── Reporte por rango de fechas ───────────────────────────────

router.get('/reporte-rango', async (req, res) => {
    const { desde, hasta } = req.query;
    if (!desde || !hasta) return res.status(400).json({ error: 'Parámetros desde y hasta requeridos' });
    try {
        const { rows } = await query(
            `SELECT
                ap.fecha, ap.nombre_profesional, ap.area,
                COUNT(*) FILTER (WHERE ap.estado = 'finalizado' AND ap.activo)     AS pacientes_atendidos,
                COUNT(*) FILTER (WHERE ap.estado = 'cancelado')                    AS cancelados,
                COUNT(*) FILTER (WHERE ap.origen = 'manual' AND ap.activo)         AS particulares,
                COUNT(*) FILTER (WHERE ap.activo)                                  AS asignados_activos,
                ROUND(AVG(EXTRACT(EPOCH FROM (ap.hora_finalizado - ap.hora_en_atencion))/60)
                      FILTER (WHERE ap.estado='finalizado' AND ap.activo AND ap.hora_en_atencion IS NOT NULL))
                                                                                   AS avg_min_atencion,
                ROUND(AVG(EXTRACT(EPOCH FROM (pc.hora_llamado_admision - pc.hora_llegada))/60)
                      FILTER (WHERE pc.hora_llamado_admision IS NOT NULL))          AS avg_espera_admision,
                ROUND(AVG(EXTRACT(EPOCH FROM (pc.hora_admision - pc.hora_llamado_admision))/60)
                      FILTER (WHERE pc.hora_admision IS NOT NULL AND pc.hora_llamado_admision IS NOT NULL
                              AND pc.hora_admision >= pc.hora_llamado_admision)) AS avg_registro
             FROM asignaciones_profesionales ap
             LEFT JOIN pacientes_cola pc ON pc.id = ap.paciente_cola_id
             WHERE ap.fecha BETWEEN $1 AND $2
             GROUP BY ap.fecha, ap.nombre_profesional, ap.area
             ORDER BY ap.fecha DESC, ap.nombre_profesional`,
            [desde, hasta]
        );
        return res.json({ desde, hasta, datos: rows });
    } catch (err) {
        console.error('[admin/reporte-rango]', err);
        return res.status(500).json({ error: 'db_error' });
    }
});

// ── Log de eventos ────────────────────────────────────────────

router.get('/eventos-log', async (req, res) => {
    const fecha = req.query.fecha || fechaHoyBogota();
    const limite = Math.min(parseInt(req.query.limite) || 100, 500);
    try {
        const { rows } = await query(
            `SELECT id, timestamp, tipo, descripcion, terminal_id, datos
             FROM eventos_log WHERE fecha = $1
             ORDER BY timestamp DESC LIMIT $2`,
            [fecha, limite]
        );
        return res.json(rows);
    } catch (err) {
        return res.status(500).json({ error: 'db_error' });
    }
});

module.exports = router;
