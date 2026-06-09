const { Router } = require('express');
const { query } = require('../database/db');

const router = Router();

// ── Configuración ─────────────────────────────────────────────

router.get('/config', async (req, res) => {
    try {
        const { rows } = await query(`SELECT clave, valor, descripcion FROM configuracion ORDER BY clave`);
        return res.json(rows);
    } catch (err) {
        return res.status(500).json({ error: 'db_error' });
    }
});

router.post('/config', async (req, res) => {
    const { clave, valor } = req.body;
    if (!clave || valor === undefined) return res.status(400).json({ error: 'clave y valor requeridos' });
    try {
        await query(
            `INSERT INTO configuracion (clave, valor, updated_at) VALUES ($1, $2, NOW())
             ON CONFLICT (clave) DO UPDATE SET valor = $2, updated_at = NOW()`,
            [clave, valor]
        );
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

// ── Dashboard — resumen del día ───────────────────────────────

router.get('/resumen-dia', async (req, res) => {
    const fecha = req.query.fecha || new Date().toISOString().split('T')[0];
    try {
        const { rows: cola } = await query(
            `SELECT
                COUNT(*)                                                       AS total_registrados,
                COUNT(*) FILTER (WHERE estado_admision = 'admisionado')        AS total_admisionados,
                COUNT(*) FILTER (WHERE estado_admision = 'esperando')          AS en_espera,
                COUNT(*) FILTER (WHERE estado_admision = 'llamando_admision')  AS siendo_llamados,
                COUNT(*) FILTER (WHERE prioridad = 'alta')                     AS prioridad_alta,
                ROUND(AVG(EXTRACT(EPOCH FROM (hora_admision - hora_llegada))/60)
                      FILTER (WHERE hora_admision IS NOT NULL))                AS avg_min_espera_admision
             FROM pacientes_cola WHERE fecha = $1`,
            [fecha]
        );
        const { rows: asig } = await query(
            `SELECT
                COUNT(*) FILTER (WHERE estado = 'pendiente')   AS pendientes,
                COUNT(*) FILTER (WHERE estado = 'llamando')    AS llamando,
                COUNT(*) FILTER (WHERE estado = 'en_atencion') AS en_atencion,
                COUNT(*) FILTER (WHERE estado = 'finalizado')  AS finalizados,
                COUNT(DISTINCT nombre_profesional)             AS profesionales_activos
             FROM asignaciones_profesionales WHERE fecha = $1`,
            [fecha]
        );
        return res.json({ fecha, cola: cola[0], asignaciones: asig[0] });
    } catch (err) {
        console.error('[admin/resumen-dia]', err);
        return res.status(500).json({ error: 'db_error' });
    }
});

// ── Lista de pacientes del día ────────────────────────────────

router.get('/pacientes', async (req, res) => {
    const fecha = req.query.fecha || new Date().toISOString().split('T')[0];
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
    const fecha = req.query.fecha || new Date().toISOString().split('T')[0];
    try {
        const { rows: timeline } = await query(
            `SELECT
                pc.numero_identificacion AS cedula,
                pc.primer_nombre || ' ' || pc.primer_apellido AS paciente,
                pc.prioridad,
                pc.hora_llegada                                               AS t1_llegada,
                pc.hora_admision                                              AS t2_sistema,
                MIN(ap.hora_llamado)                                          AS t3_primer_llamado,
                MIN(ap.hora_en_atencion)                                      AS t4_primera_atencion,
                MAX(ap.hora_finalizado)                                       AS t5_ultima_finalizacion,
                ROUND(EXTRACT(EPOCH FROM (pc.hora_admision - pc.hora_llegada))/60)
                                                                              AS min_espera_admision,
                ROUND(EXTRACT(EPOCH FROM (MIN(ap.hora_llamado) - pc.hora_llegada))/60)
                                                                              AS min_espera_primera_atencion,
                ROUND(EXTRACT(EPOCH FROM (MAX(ap.hora_finalizado) - pc.hora_llegada))/60)
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
             WHERE pc.fecha = $1
             GROUP BY pc.id, pc.numero_identificacion, pc.primer_nombre,
                      pc.primer_apellido, pc.prioridad, pc.hora_llegada, pc.hora_admision
             ORDER BY pc.hora_llegada`,
            [fecha]
        );

        const { rows: porProfesional } = await query(
            `SELECT
                ap.nombre_profesional, ap.area,
                COUNT(*)                                                          AS total_asignados,
                COUNT(*) FILTER (WHERE ap.estado = 'finalizado')                  AS finalizados,
                COUNT(*) FILTER (WHERE ap.estado IN ('llamando','en_atencion'))   AS en_proceso,
                COUNT(*) FILTER (WHERE ap.estado = 'pendiente')                   AS pendientes,
                ROUND(AVG(EXTRACT(EPOCH FROM (ap.hora_finalizado - ap.hora_en_atencion))/60)
                      FILTER (WHERE ap.estado='finalizado' AND ap.hora_en_atencion IS NOT NULL))
                                                                                  AS avg_min_atencion,
                ROUND(MIN(EXTRACT(EPOCH FROM (ap.hora_finalizado - ap.hora_en_atencion))/60)
                      FILTER (WHERE ap.estado='finalizado' AND ap.hora_en_atencion IS NOT NULL))
                                                                                  AS min_min_atencion,
                ROUND(MAX(EXTRACT(EPOCH FROM (ap.hora_finalizado - ap.hora_en_atencion))/60)
                      FILTER (WHERE ap.estado='finalizado' AND ap.hora_en_atencion IS NOT NULL))
                                                                                  AS max_min_atencion,
                ROUND(AVG(EXTRACT(EPOCH FROM (ap.hora_llamado - pc.hora_llegada))/60)
                      FILTER (WHERE ap.hora_llamado IS NOT NULL))                 AS avg_min_espera_hasta_llamado
             FROM asignaciones_profesionales ap
             LEFT JOIN pacientes_cola pc
                ON pc.numero_identificacion = ap.numero_identificacion AND pc.fecha = ap.fecha
             WHERE ap.fecha = $1
             GROUP BY ap.nombre_profesional, ap.area
             ORDER BY ap.nombre_profesional`,
            [fecha]
        );

        const { rows: kpis } = await query(
            `SELECT
                COUNT(DISTINCT pc.id)                                              AS total_pacientes,
                COUNT(DISTINCT pc.id) FILTER (WHERE pc.estado_admision='admisionado') AS admisionados,
                ROUND(AVG(EXTRACT(EPOCH FROM (pc.hora_admision - pc.hora_llegada))/60)
                      FILTER (WHERE pc.hora_admision IS NOT NULL))                 AS avg_espera_admision,
                ROUND(AVG(EXTRACT(EPOCH FROM (ap.hora_finalizado - ap.hora_en_atencion))/60)
                      FILTER (WHERE ap.estado='finalizado'))                       AS avg_tiempo_atencion_general
             FROM pacientes_cola pc
             LEFT JOIN asignaciones_profesionales ap ON ap.paciente_cola_id = pc.id
             WHERE pc.fecha = $1`,
            [fecha]
        );

        return res.json({ fecha, kpis: kpis[0], timeline, por_profesional: porProfesional });
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
                COUNT(*) FILTER (WHERE ap.estado = 'finalizado')                   AS pacientes_atendidos,
                ROUND(AVG(EXTRACT(EPOCH FROM (ap.hora_finalizado - ap.hora_en_atencion))/60)
                      FILTER (WHERE ap.estado='finalizado' AND ap.hora_en_atencion IS NOT NULL))
                                                                                   AS avg_min_atencion,
                ROUND(AVG(EXTRACT(EPOCH FROM (pc.hora_admision - pc.hora_llegada))/60)
                      FILTER (WHERE pc.hora_admision IS NOT NULL))                 AS avg_espera_admision
             FROM asignaciones_profesionales ap
             LEFT JOIN pacientes_cola pc
                ON pc.numero_identificacion = ap.numero_identificacion AND pc.fecha = ap.fecha
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

// ── Estado actual del display (para reconexión) ───────────────

router.get('/estado-display', async (req, res) => {
    try {
        const { rows: consultorios } = await query(
            `SELECT ap.nombre_profesional, ap.consultorio_profesional, ap.estado,
                    COALESCE(pc.primer_nombre || ' ' || pc.primer_apellido, ap.numero_identificacion) AS nombre_paciente
             FROM asignaciones_profesionales ap
             LEFT JOIN pacientes_cola pc ON pc.numero_identificacion = ap.numero_identificacion AND pc.fecha = ap.fecha
             WHERE ap.fecha = CURRENT_DATE AND ap.estado IN ('llamando','en_atencion')
             ORDER BY ap.nombre_profesional`
        );
        const { rows: modulos } = await query(
            `SELECT modulo_admision, estado_admision,
                    primer_nombre || ' ' || primer_apellido AS nombre_paciente
             FROM pacientes_cola
             WHERE fecha = CURRENT_DATE
               AND estado_admision IN ('llamando_admision')
               AND modulo_admision IS NOT NULL
             ORDER BY hora_llamado_admision`
        );
        return res.json({ consultorios, modulos });
    } catch (err) {
        console.error('[admin/estado-display]', err);
        return res.status(500).json({ error: 'db_error' });
    }
});

// ── Log de eventos ────────────────────────────────────────────

router.get('/eventos-log', async (req, res) => {
    const fecha = req.query.fecha || new Date().toISOString().split('T')[0];
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
