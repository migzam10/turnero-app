# 10 — Módulo Administrativo

URL: `http://SERVER_IP:3000/admin`  
Archivo: `public/admin/index.html`

---

## ¿Qué hace este módulo?

Panel de gestión para el administrador del sistema. Tiene cinco secciones navegables mediante tabs:

| Tab | Contenido |
|---|---|
| **Dashboard** | KPIs del día en tiempo real: totales, promedios, estado actual |
| **Pacientes** | Lista completa del día con timeline por paciente |
| **Reportes** | Análisis de tiempos T1→T5 filtrable por fecha, exportable |
| **Configuración** | Parámetros del sistema (módulos, intervalos, retención) |
| **Terminales** | Gestión de terminales conectados |

---

## Nuevos endpoints en `routes/api.admin.js`

Agregar estos al archivo existente (que ya tiene `/config`, `/terminales`, `/reporte-tiempos`, `/eventos-log`).

```javascript
const { query } = require('../database/db');

// ─────────────────────────────────────────────────────────────
// GET /api/admin/resumen-dia?fecha=2026-06-08
// KPIs para el Dashboard
// ─────────────────────────────────────────────────────────────
router.get('/resumen-dia', async (req, res) => {
    const fecha = req.query.fecha || new Date().toISOString().split('T')[0];
    try {
        const { rows: cola } = await query(
            `SELECT
                COUNT(*)                                                          AS total_registrados,
                COUNT(*) FILTER (WHERE estado_admision = 'admisionado')           AS total_admisionados,
                COUNT(*) FILTER (WHERE estado_admision = 'esperando')             AS en_espera,
                COUNT(*) FILTER (WHERE estado_admision = 'llamando_admision')     AS siendo_llamados,
                COUNT(*) FILTER (WHERE prioridad = 'alta')                        AS prioridad_alta,
                ROUND(AVG(EXTRACT(EPOCH FROM (hora_admision - hora_llegada))/60)
                      FILTER (WHERE hora_admision IS NOT NULL))                   AS avg_min_espera_admision
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
        return res.status(500).json({ error: 'db_error', mensaje: err.message });
    }
});

// ─────────────────────────────────────────────────────────────
// GET /api/admin/pacientes?fecha=2026-06-08
// Lista completa de pacientes con asignaciones embebidas (timeline)
// ─────────────────────────────────────────────────────────────
router.get('/pacientes', async (req, res) => {
    const fecha = req.query.fecha || new Date().toISOString().split('T')[0];
    try {
        const { rows } = await query(
            `SELECT
                pc.id, pc.numero_identificacion,
                pc.primer_nombre || ' ' || COALESCE(pc.segundo_nombre,'') || ' ' ||
                    pc.primer_apellido  || ' ' || COALESCE(pc.segundo_apellido,'') AS nombre_completo,
                pc.hora_llegada,
                pc.hora_admision,
                pc.prioridad,
                pc.estado_admision,
                pc.modulo_admision,
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
        return res.status(500).json({ error: 'db_error', mensaje: err.message });
    }
});

// ─────────────────────────────────────────────────────────────
// GET /api/admin/reporte-detallado?fecha=2026-06-08
// Reporte completo T1→T5 por paciente + resumen por profesional
// ─────────────────────────────────────────────────────────────
router.get('/reporte-detallado', async (req, res) => {
    const fecha = req.query.fecha || new Date().toISOString().split('T')[0];
    try {
        // ── Timeline completa por paciente ──────────────────────────
        const { rows: timeline } = await query(
            `SELECT
                pc.numero_identificacion                                      AS cedula,
                pc.primer_nombre || ' ' || pc.primer_apellido                 AS paciente,
                pc.prioridad,
                pc.hora_llegada                                               AS t1_llegada,
                -- T2: hora de ingreso a Biofile (de la extensión)
                MIN(ap.hora_llegada_biofile)                                  AS t2_biofile_raw,
                pc.hora_admision                                              AS t2_sistema,
                -- T3: primer llamado por cualquier profesional
                MIN(ap.hora_llamado)                                          AS t3_primer_llamado,
                -- T4: primera atención efectiva
                MIN(ap.hora_en_atencion)                                      AS t4_primera_atencion,
                -- T5: última finalización
                MAX(ap.hora_finalizado)                                       AS t5_ultima_finalizacion,
                -- Tiempos calculados (minutos)
                ROUND(EXTRACT(EPOCH FROM (pc.hora_admision - pc.hora_llegada))/60)
                                                                              AS min_espera_admision,
                ROUND(EXTRACT(EPOCH FROM (MIN(ap.hora_llamado) - pc.hora_llegada))/60)
                                                                              AS min_espera_primera_atencion,
                ROUND(EXTRACT(EPOCH FROM (MAX(ap.hora_finalizado) - pc.hora_llegada))/60)
                                                                              AS min_tiempo_total_clinica,
                -- Detalle por profesional como JSON
                COALESCE(JSON_AGG(
                    JSON_BUILD_OBJECT(
                        'profesional',  ap.nombre_profesional,
                        'area',         ap.area,
                        'estado',       ap.estado,
                        't3_llamado',   ap.hora_llamado,
                        't4_atencion',  ap.hora_en_atencion,
                        't5_finalizado',ap.hora_finalizado,
                        'min_espera_llamado', CASE
                            WHEN ap.hora_llamado IS NOT NULL
                            THEN ROUND(EXTRACT(EPOCH FROM (ap.hora_llamado - pc.hora_llegada))/60)
                        END,
                        'min_atencion', CASE
                            WHEN ap.hora_finalizado IS NOT NULL AND ap.hora_en_atencion IS NOT NULL
                            THEN ROUND(EXTRACT(EPOCH FROM (ap.hora_finalizado - ap.hora_en_atencion))/60)
                        END
                    ) ORDER BY ap.created_at
                ) FILTER (WHERE ap.id IS NOT NULL), '[]')                    AS por_profesional
             FROM pacientes_cola pc
             LEFT JOIN asignaciones_profesionales ap ON ap.paciente_cola_id = pc.id
             WHERE pc.fecha = $1
             GROUP BY pc.id, pc.numero_identificacion, pc.primer_nombre,
                      pc.primer_apellido, pc.prioridad, pc.hora_llegada, pc.hora_admision
             ORDER BY pc.hora_llegada`,
            [fecha]
        );

        // ── Resumen estadístico por profesional ─────────────────────
        const { rows: porProfesional } = await query(
            `SELECT
                nombre_profesional,
                area,
                COUNT(*)                                                          AS total_asignados,
                COUNT(*) FILTER (WHERE estado = 'finalizado')                     AS finalizados,
                COUNT(*) FILTER (WHERE estado IN ('llamando','en_atencion'))      AS en_proceso,
                COUNT(*) FILTER (WHERE estado = 'pendiente')                      AS pendientes,
                -- Tiempos de atención (T4→T5)
                ROUND(AVG(EXTRACT(EPOCH FROM (hora_finalizado - hora_en_atencion))/60)
                      FILTER (WHERE estado='finalizado' AND hora_en_atencion IS NOT NULL))
                                                                                  AS avg_min_atencion,
                ROUND(MIN(EXTRACT(EPOCH FROM (hora_finalizado - hora_en_atencion))/60)
                      FILTER (WHERE estado='finalizado' AND hora_en_atencion IS NOT NULL))
                                                                                  AS min_min_atencion,
                ROUND(MAX(EXTRACT(EPOCH FROM (hora_finalizado - hora_en_atencion))/60)
                      FILTER (WHERE estado='finalizado' AND hora_en_atencion IS NOT NULL))
                                                                                  AS max_min_atencion,
                -- Tiempo de espera hasta ser llamado (T3-T1) promedio para sus pacientes
                ROUND(AVG(EXTRACT(EPOCH FROM (hora_llamado - pc.hora_llegada))/60)
                      FILTER (WHERE hora_llamado IS NOT NULL))                    AS avg_min_espera_hasta_llamado
             FROM asignaciones_profesionales ap
             LEFT JOIN pacientes_cola pc
                ON pc.numero_identificacion = ap.numero_identificacion
               AND pc.fecha = ap.fecha
             WHERE ap.fecha = $1
             GROUP BY ap.nombre_profesional, ap.area
             ORDER BY ap.nombre_profesional`,
            [fecha]
        );

        // ── KPIs generales del día ──────────────────────────────────
        const { rows: kpis } = await query(
            `SELECT
                COUNT(DISTINCT pc.id)                                             AS total_pacientes,
                COUNT(DISTINCT pc.id) FILTER (WHERE pc.estado_admision='admisionado')
                                                                                  AS admisionados,
                ROUND(AVG(EXTRACT(EPOCH FROM (pc.hora_admision - pc.hora_llegada))/60)
                      FILTER (WHERE pc.hora_admision IS NOT NULL))                AS avg_espera_admision,
                ROUND(AVG(EXTRACT(EPOCH FROM (ap.hora_finalizado - ap.hora_en_atencion))/60)
                      FILTER (WHERE ap.estado='finalizado'))                      AS avg_tiempo_atencion_general
             FROM pacientes_cola pc
             LEFT JOIN asignaciones_profesionales ap ON ap.paciente_cola_id = pc.id
             WHERE pc.fecha = $1`,
            [fecha]
        );

        return res.json({
            fecha,
            kpis: kpis[0],
            timeline,
            por_profesional: porProfesional
        });
    } catch (err) {
        console.error('[admin/reporte-detallado]', err);
        return res.status(500).json({ error: 'db_error', mensaje: err.message });
    }
});

// ─────────────────────────────────────────────────────────────
// GET /api/admin/reporte-rango?desde=2026-06-01&hasta=2026-06-08
// Reporte por rango de fechas — agrupado por día y profesional
// ─────────────────────────────────────────────────────────────
router.get('/reporte-rango', async (req, res) => {
    const { desde, hasta } = req.query;
    if (!desde || !hasta) return res.status(400).json({ error: 'Parámetros desde y hasta requeridos' });
    try {
        const { rows } = await query(
            `SELECT
                ap.fecha,
                ap.nombre_profesional,
                ap.area,
                COUNT(*) FILTER (WHERE ap.estado = 'finalizado')                  AS pacientes_atendidos,
                ROUND(AVG(EXTRACT(EPOCH FROM (ap.hora_finalizado - ap.hora_en_atencion))/60)
                      FILTER (WHERE ap.estado='finalizado' AND ap.hora_en_atencion IS NOT NULL))
                                                                                   AS avg_min_atencion,
                ROUND(AVG(EXTRACT(EPOCH FROM (pc.hora_admision - pc.hora_llegada))/60)
                      FILTER (WHERE pc.hora_admision IS NOT NULL))                 AS avg_espera_admision
             FROM asignaciones_profesionales ap
             LEFT JOIN pacientes_cola pc
                ON pc.numero_identificacion = ap.numero_identificacion
               AND pc.fecha = ap.fecha
             WHERE ap.fecha BETWEEN $1 AND $2
             GROUP BY ap.fecha, ap.nombre_profesional, ap.area
             ORDER BY ap.fecha DESC, ap.nombre_profesional`,
            [desde, hasta]
        );
        return res.json({ desde, hasta, datos: rows });
    } catch (err) {
        console.error('[admin/reporte-rango]', err);
        return res.status(500).json({ error: 'db_error', mensaje: err.message });
    }
});
```

---

## Layout HTML — Tabs

```html
<!DOCTYPE html>
<html lang="es">
<head>
    <meta charset="UTF-8">
    <title>Admin — Turnero CertiMedic</title>
    <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body { font-family: 'Segoe UI', sans-serif; background: #f0f4f8; color: #1a1a2e; font-size: 14px; }

        /* ── Header ─────────────────────────────── */
        header {
            background: #1a3a6e; color: white;
            padding: 12px 24px; display: flex;
            justify-content: space-between; align-items: center;
        }
        header h1 { font-size: 18px; }
        header .fecha-selector { display: flex; align-items: center; gap: 8px; }
        header input[type="date"] {
            padding: 5px 8px; border: none; border-radius: 4px;
            background: rgba(255,255,255,0.15); color: white; font-size: 14px;
        }
        header input[type="date"]::-webkit-calendar-picker-indicator { filter: invert(1); }

        /* ── Tabs ───────────────────────────────── */
        .tabs {
            background: white; border-bottom: 2px solid #e0e8f0;
            display: flex; padding: 0 24px; gap: 4px;
        }
        .tab-btn {
            padding: 12px 20px; border: none; background: none;
            cursor: pointer; font-size: 14px; color: #666;
            border-bottom: 3px solid transparent; margin-bottom: -2px;
            font-weight: 500; transition: all 0.15s;
        }
        .tab-btn.activo { color: #1a3a6e; border-bottom-color: #1a3a6e; }
        .tab-btn:hover { color: #1a3a6e; background: #f0f4f8; }

        /* ── Contenido ──────────────────────────── */
        main { padding: 24px; max-width: 1400px; margin: 0 auto; }
        .tab-panel { display: none; }
        .tab-panel.activo { display: block; }

        /* ── Cards KPI ──────────────────────────── */
        .kpi-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 16px; margin-bottom: 24px; }
        .kpi-card {
            background: white; border-radius: 8px; padding: 16px;
            box-shadow: 0 1px 4px rgba(0,0,0,0.08); text-align: center;
        }
        .kpi-card .valor { font-size: 36px; font-weight: bold; color: #1a3a6e; line-height: 1; }
        .kpi-card .etiqueta { font-size: 12px; color: #888; margin-top: 6px; text-transform: uppercase; letter-spacing: 0.5px; }
        .kpi-card.alerta .valor { color: #c0392b; }
        .kpi-card.ok .valor { color: #27ae60; }

        /* ── Tablas ─────────────────────────────── */
        .tabla-container { background: white; border-radius: 8px; overflow: auto; box-shadow: 0 1px 4px rgba(0,0,0,0.08); }
        table { width: 100%; border-collapse: collapse; font-size: 13px; }
        th { background: #f0f4f8; padding: 10px 12px; text-align: left; font-weight: 600; color: #444; position: sticky; top: 0; }
        td { padding: 9px 12px; border-bottom: 1px solid #f0f0f0; }
        tr:hover td { background: #fafbff; }
        tr:last-child td { border-bottom: none; }

        /* ── Badges ─────────────────────────────── */
        .badge { padding: 2px 8px; border-radius: 12px; font-size: 11px; font-weight: 600; text-transform: uppercase; }
        .badge.alta { background: #fdecea; color: #c0392b; }
        .badge.media { background: #fef9e7; color: #d68910; }
        .badge.normal { background: #eaf7f0; color: #27ae60; }
        .badge.esperando { background: #e8eaf6; color: #5c6bc0; }
        .badge.admisionado { background: #e8f5e9; color: #2e7d32; }
        .badge.llamando_admision { background: #fff3e0; color: #e65100; }

        /* ── Sección con título ──────────────────── */
        .seccion { margin-bottom: 32px; }
        .seccion-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px; }
        .seccion-titulo { font-size: 16px; font-weight: 600; color: #1a3a6e; }

        /* ── Botones ─────────────────────────────── */
        .btn { padding: 8px 16px; border-radius: 6px; border: none; cursor: pointer; font-size: 13px; font-weight: 500; }
        .btn-primary { background: #1a3a6e; color: white; }
        .btn-primary:hover { background: #122d58; }
        .btn-export { background: #27ae60; color: white; }
        .btn-export:hover { background: #1e8449; }
        .btn-sm { padding: 4px 10px; font-size: 12px; }

        /* ── Config ──────────────────────────────── */
        .config-form { background: white; border-radius: 8px; padding: 24px; box-shadow: 0 1px 4px rgba(0,0,0,0.08); }
        .config-row { display: flex; align-items: flex-start; gap: 16px; padding: 12px 0; border-bottom: 1px solid #f0f0f0; }
        .config-row:last-child { border-bottom: none; }
        .config-key { font-weight: 600; min-width: 220px; padding-top: 6px; }
        .config-desc { font-size: 12px; color: #888; margin-top: 2px; }
        .config-row input, .config-row textarea { flex: 1; padding: 6px 10px; border: 1px solid #ddd; border-radius: 4px; font-size: 13px; }

        /* ── Timeline ────────────────────────────── */
        .timeline-mini { display: flex; gap: 4px; align-items: center; font-size: 11px; }
        .tl-punto { background: #ccc; border-radius: 50%; width: 8px; height: 8px; display: inline-block; }
        .tl-punto.ok { background: #27ae60; }
        .tl-punto.parcial { background: #f39c12; }
        .tl-linea { flex: 1; height: 2px; background: #e0e0e0; }
        .tl-linea.ok { background: #27ae60; }

        /* ── Detalles expandibles ────────────────── */
        .detalle-row { background: #f8f9ff; }
        .detalle-row td { padding: 8px 16px; }
        .profesionales-lista { display: flex; flex-wrap: wrap; gap: 8px; }
        .prof-chip {
            background: white; border: 1px solid #dde4f0;
            border-radius: 6px; padding: 6px 10px; font-size: 12px;
        }
        .prof-chip .prof-nombre { font-weight: 600; color: #1a3a6e; }
        .prof-chip .prof-tiempos { color: #666; margin-top: 2px; }
    </style>
</head>
<body>
    <header>
        <h1>Administración — Turnero CertiMedic</h1>
        <div class="fecha-selector">
            <label style="color:rgba(255,255,255,0.7); font-size:13px">Fecha:</label>
            <input type="date" id="fecha-filtro">
        </div>
    </header>

    <nav class="tabs">
        <button class="tab-btn activo" onclick="cambiarTab('dashboard')">📊 Dashboard</button>
        <button class="tab-btn"        onclick="cambiarTab('pacientes')">👥 Pacientes</button>
        <button class="tab-btn"        onclick="cambiarTab('reportes')">📈 Reportes</button>
        <button class="tab-btn"        onclick="cambiarTab('configuracion')">⚙ Configuración</button>
        <button class="tab-btn"        onclick="cambiarTab('terminales')">🖥 Terminales</button>
    </nav>

    <main>

        <!-- ── TAB: DASHBOARD ──────────────────────────────────── -->
        <div id="tab-dashboard" class="tab-panel activo">
            <div class="kpi-grid" id="kpi-cola"></div>
            <div class="kpi-grid" id="kpi-atencion"></div>

            <div style="display:grid; grid-template-columns:1fr 1fr; gap:24px">
                <div class="seccion">
                    <div class="seccion-header">
                        <div class="seccion-titulo">Estado de la cola de admisiones</div>
                    </div>
                    <div class="tabla-container">
                        <table>
                            <thead><tr><th>Paciente</th><th>Llegada</th><th>Prioridad</th><th>Estado</th></tr></thead>
                            <tbody id="tabla-dashboard-cola"></tbody>
                        </table>
                    </div>
                </div>

                <div class="seccion">
                    <div class="seccion-header">
                        <div class="seccion-titulo">Estado de profesionales</div>
                    </div>
                    <div class="tabla-container">
                        <table>
                            <thead><tr><th>Profesional / Área</th><th>Pendientes</th><th>En proceso</th><th>Finalizados</th></tr></thead>
                            <tbody id="tabla-dashboard-prof"></tbody>
                        </table>
                    </div>
                </div>
            </div>
        </div>

        <!-- ── TAB: PACIENTES ──────────────────────────────────── -->
        <div id="tab-pacientes" class="tab-panel">
            <div class="seccion">
                <div class="seccion-header">
                    <div class="seccion-titulo" id="titulo-pacientes">Pacientes del día</div>
                    <button class="btn btn-export" onclick="exportarCSVPacientes()">⬇ Exportar CSV</button>
                </div>
                <div class="tabla-container">
                    <table>
                        <thead>
                            <tr>
                                <th></th>
                                <th>Cédula</th>
                                <th>Nombre</th>
                                <th>Prioridad</th>
                                <th>T1 Llegada</th>
                                <th>T2 Admisión</th>
                                <th>Estado admisión</th>
                                <th>Módulo</th>
                                <th>Asignaciones</th>
                            </tr>
                        </thead>
                        <tbody id="tabla-pacientes"></tbody>
                    </table>
                </div>
            </div>
        </div>

        <!-- ── TAB: REPORTES ───────────────────────────────────── -->
        <div id="tab-reportes" class="tab-panel">

            <!-- Selector de modo -->
            <div style="display:flex; gap:16px; margin-bottom:20px; align-items:center; flex-wrap:wrap">
                <label style="font-weight:600">Tipo de reporte:</label>
                <select id="tipo-reporte" style="padding:6px 10px; border:1px solid #ddd; border-radius:4px" onchange="cambiarTipoReporte()">
                    <option value="dia">Un día específico</option>
                    <option value="rango">Rango de fechas</option>
                </select>
                <span id="selector-rango" style="display:none; gap:8px; align-items:center">
                    <label>Desde: <input type="date" id="rango-desde" style="padding:5px 8px; border:1px solid #ddd; border-radius:4px"></label>
                    <label>Hasta: <input type="date" id="rango-hasta" style="padding:5px 8px; border:1px solid #ddd; border-radius:4px"></label>
                </span>
                <button class="btn btn-primary" onclick="cargarReporte()">Generar reporte</button>
                <button class="btn btn-export" onclick="exportarReporteCSV()">⬇ Exportar CSV</button>
            </div>

            <!-- KPIs del reporte -->
            <div class="kpi-grid" id="reporte-kpis" style="margin-bottom:24px"></div>

            <!-- Tabla por profesional -->
            <div class="seccion">
                <div class="seccion-header">
                    <div class="seccion-titulo">Resumen por profesional / área</div>
                </div>
                <div class="tabla-container">
                    <table>
                        <thead>
                            <tr>
                                <th>Profesional</th>
                                <th>Área</th>
                                <th>Asignados</th>
                                <th>Finalizados</th>
                                <th>En proceso</th>
                                <th>Pend.</th>
                                <th>⌀ min atención (T4→T5)</th>
                                <th>Min</th>
                                <th>Máx</th>
                                <th>⌀ min espera hasta llamado</th>
                            </tr>
                        </thead>
                        <tbody id="tabla-reporte-profesional"></tbody>
                    </table>
                </div>
            </div>

            <!-- Tabla detalle por paciente (solo modo día) -->
            <div class="seccion" id="seccion-timeline" style="display:none">
                <div class="seccion-header">
                    <div class="seccion-titulo">Detalle por paciente</div>
                </div>
                <div class="tabla-container">
                    <table>
                        <thead>
                            <tr>
                                <th></th>
                                <th>Cédula</th>
                                <th>Paciente</th>
                                <th>Prio.</th>
                                <th>T1 Llegada</th>
                                <th>T2 Admisión</th>
                                <th>T3 1er llamado</th>
                                <th>T5 Última salida</th>
                                <th>Min espera admisión</th>
                                <th>Min espera 1ª atención</th>
                                <th>Min total clínica</th>
                            </tr>
                        </thead>
                        <tbody id="tabla-reporte-paciente"></tbody>
                    </table>
                </div>
            </div>
        </div>

        <!-- ── TAB: CONFIGURACIÓN ──────────────────────────────── -->
        <div id="tab-configuracion" class="tab-panel">
            <div class="config-form" id="config-form">
                <p style="color:#888; margin-bottom:16px">Cargando configuración...</p>
            </div>
        </div>

        <!-- ── TAB: TERMINALES ─────────────────────────────────── -->
        <div id="tab-terminales" class="tab-panel">
            <div class="seccion">
                <div class="seccion-header">
                    <div class="seccion-titulo">Terminales registrados</div>
                    <button class="btn btn-primary btn-sm" onclick="cargarTerminales()">↺ Actualizar</button>
                </div>
                <div class="tabla-container">
                    <table>
                        <thead>
                            <tr>
                                <th>ID</th><th>Tipo</th><th>Consultorio</th>
                                <th>Login Biofile</th><th>IP</th><th>Último heartbeat</th><th>Estado</th>
                            </tr>
                        </thead>
                        <tbody id="tabla-terminales"></tbody>
                    </table>
                </div>
            </div>
        </div>

    </main>

    <script src="/socket.io/socket.io.js"></script>
    <script src="/assets/js/admin.js"></script>
</body>
</html>
```

---

## `public/assets/js/admin.js`

```javascript
// ── Fecha activa ─────────────────────────────────────────────

const inputFecha = document.getElementById('fecha-filtro');
inputFecha.value = new Date().toISOString().split('T')[0];
inputFecha.addEventListener('change', () => actualizarTabActiva());

function fechaActiva() { return inputFecha.value; }

// ── Tabs ─────────────────────────────────────────────────────

let tabActual = 'dashboard';

function cambiarTab(tab) {
    tabActual = tab;
    document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('activo'));
    document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('activo'));
    document.getElementById(`tab-${tab}`).classList.add('activo');
    document.querySelectorAll('.tab-btn').forEach(b => {
        if (b.getAttribute('onclick')?.includes(tab)) b.classList.add('activo');
    });
    actualizarTabActiva();
}

function actualizarTabActiva() {
    switch (tabActual) {
        case 'dashboard':    cargarDashboard();    break;
        case 'pacientes':    cargarPacientes();    break;
        case 'reportes':     cargarReporte();      break;
        case 'configuracion': cargarConfig();      break;
        case 'terminales':   cargarTerminales();   break;
    }
}

// ── Helpers ───────────────────────────────────────────────────

function fmt(isoStr) {
    if (!isoStr) return '—';
    return new Date(isoStr).toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit' });
}

function fmtMin(min) {
    if (min === null || min === undefined) return '—';
    const m = Math.round(min);
    if (m < 60) return `${m} min`;
    return `${Math.floor(m/60)}h ${m%60}m`;
}

function badgePrio(p) {
    return `<span class="badge ${p}">${p}</span>`;
}

function badgeEstado(e) {
    const mapa = {
        esperando: 'Esperando',
        llamando_admision: 'Siendo llamado',
        admisionado: 'Admisionado'
    };
    return `<span class="badge ${e}">${mapa[e] || e}</span>`;
}

// ── DASHBOARD ────────────────────────────────────────────────

async function cargarDashboard() {
    const [resumen, pacientes, asignaciones] = await Promise.all([
        fetch(`/api/admin/resumen-dia?fecha=${fechaActiva()}`).then(r => r.json()),
        fetch(`/api/admin/pacientes?fecha=${fechaActiva()}`).then(r => r.json()),
        fetch(`/api/admin/reporte-detallado?fecha=${fechaActiva()}`).then(r => r.json())
    ]);

    const c = resumen.cola;
    const a = resumen.asignaciones;

    // KPIs de cola
    document.getElementById('kpi-cola').innerHTML = [
        { valor: c.total_registrados, etiq: 'Pacientes registrados', cls: '' },
        { valor: c.total_admisionados, etiq: 'Admisionados', cls: 'ok' },
        { valor: c.en_espera, etiq: 'En espera admisión', cls: c.en_espera > 5 ? 'alerta' : '' },
        { valor: c.siendo_llamados, etiq: 'Siendo llamados', cls: '' },
        { valor: c.prioridad_alta, etiq: 'Prioridad alta', cls: c.prioridad_alta > 0 ? 'alerta' : '' },
        { valor: fmtMin(c.avg_min_espera_admision), etiq: '⌀ espera hasta admisión', cls: '' }
    ].map(k => `
        <div class="kpi-card ${k.cls}">
            <div class="valor">${k.valor ?? '—'}</div>
            <div class="etiqueta">${k.etiq}</div>
        </div>
    `).join('');

    // KPIs de atención
    document.getElementById('kpi-atencion').innerHTML = [
        { valor: a.profesionales_activos, etiq: 'Profesionales activos', cls: '' },
        { valor: a.pendientes,   etiq: 'Pendientes de llamar', cls: '' },
        { valor: a.llamando,     etiq: 'Llamando ahora', cls: '' },
        { valor: a.en_atencion,  etiq: 'En atención', cls: '' },
        { valor: a.finalizados,  etiq: 'Atenciones finalizadas', cls: 'ok' },
        { valor: fmtMin(resumen.kpis?.avg_tiempo_atencion_general), etiq: '⌀ tiempo de atención', cls: '' }
    ].map(k => `
        <div class="kpi-card ${k.cls}">
            <div class="valor">${k.valor ?? '—'}</div>
            <div class="etiqueta">${k.etiq}</div>
        </div>
    `).join('');

    // Cola de admisiones
    const colaPend = pacientes.filter(p => p.estado_admision !== 'admisionado');
    document.getElementById('tabla-dashboard-cola').innerHTML = colaPend.length === 0
        ? '<tr><td colspan="4" style="text-align:center;color:#aaa;padding:16px">Sin pacientes en espera</td></tr>'
        : colaPend.map(p => `
            <tr>
                <td>${p.nombre_completo.trim()}</td>
                <td>${fmt(p.hora_llegada)}</td>
                <td>${badgePrio(p.prioridad)}</td>
                <td>${badgeEstado(p.estado_admision)}</td>
            </tr>
        `).join('');

    // Estado por profesional
    const profMap = {};
    asignaciones.por_profesional.forEach(p => {
        profMap[p.nombre_profesional] = p;
    });
    document.getElementById('tabla-dashboard-prof').innerHTML =
        asignaciones.por_profesional.length === 0
        ? '<tr><td colspan="4" style="text-align:center;color:#aaa;padding:16px">Sin datos de profesionales hoy</td></tr>'
        : asignaciones.por_profesional.map(p => `
            <tr>
                <td><strong>${p.nombre_profesional}</strong><br><small style="color:#888">${p.area}</small></td>
                <td>${p.pendientes}</td>
                <td>${(parseInt(p.en_proceso) || 0)}</td>
                <td>${p.finalizados}</td>
            </tr>
        `).join('');
}

// ── PACIENTES ────────────────────────────────────────────────

let datosPacientes = [];

async function cargarPacientes() {
    datosPacientes = await fetch(`/api/admin/pacientes?fecha=${fechaActiva()}`).then(r => r.json());
    document.getElementById('titulo-pacientes').textContent =
        `Pacientes del día ${fechaActiva()} (${datosPacientes.length} registrados)`;
    renderizarTablaPacientes();
}

function renderizarTablaPacientes() {
    const tbody = document.getElementById('tabla-pacientes');
    if (datosPacientes.length === 0) {
        tbody.innerHTML = '<tr><td colspan="9" style="text-align:center;color:#aaa;padding:20px">Sin pacientes para esta fecha</td></tr>';
        return;
    }

    tbody.innerHTML = datosPacientes.map((p, i) => {
        const asig = Array.isArray(p.asignaciones) ? p.asignaciones : [];
        return `
            <tr onclick="toggleDetallePaciente(${i})" style="cursor:pointer">
                <td style="color:#aaa">▶</td>
                <td>${p.numero_identificacion}</td>
                <td><strong>${p.nombre_completo.trim()}</strong></td>
                <td>${badgePrio(p.prioridad)}</td>
                <td>${fmt(p.hora_llegada)}</td>
                <td>${p.hora_admision ? fmt(p.hora_admision) : '—'}</td>
                <td>${badgeEstado(p.estado_admision)}</td>
                <td>${p.modulo_admision || '—'}</td>
                <td><span style="font-size:12px;color:#888">${asig.length} área(s)</span></td>
            </tr>
            <tr id="detalle-pac-${i}" class="detalle-row" style="display:none">
                <td></td>
                <td colspan="8">
                    <div class="profesionales-lista">
                        ${asig.length === 0
                            ? '<span style="color:#aaa;font-size:12px">Sin asignaciones de Biofile aún</span>'
                            : asig.map(a => `
                                <div class="prof-chip">
                                    <div class="prof-nombre">${a.profesional} · ${a.area}</div>
                                    <div class="prof-tiempos">
                                        Estado: <strong>${a.estado}</strong>
                                        ${a.hora_llamado ? `· Llamado: ${fmt(a.hora_llamado)}` : ''}
                                        ${a.hora_en_atencion ? `· Atención: ${fmt(a.hora_en_atencion)}` : ''}
                                        ${a.hora_finalizado ? `· Fin: ${fmt(a.hora_finalizado)}` : ''}
                                        ${a.min_atencion !== null && a.min_atencion !== undefined
                                            ? `· <strong>${fmtMin(a.min_atencion)}</strong>` : ''}
                                    </div>
                                </div>
                            `).join('')
                        }
                    </div>
                </td>
            </tr>
        `;
    }).join('');
}

function toggleDetallePaciente(i) {
    const fila = document.getElementById(`detalle-pac-${i}`);
    fila.style.display = fila.style.display === 'none' ? 'table-row' : 'none';
}

// ── REPORTES ─────────────────────────────────────────────────

let datosReporte = null;

function cambiarTipoReporte() {
    const tipo = document.getElementById('tipo-reporte').value;
    document.getElementById('selector-rango').style.display = tipo === 'rango' ? 'flex' : 'none';
    document.getElementById('seccion-timeline').style.display = tipo === 'dia' ? 'block' : 'none';
}

async function cargarReporte() {
    const tipo = document.getElementById('tipo-reporte').value;

    if (tipo === 'dia') {
        datosReporte = await fetch(`/api/admin/reporte-detallado?fecha=${fechaActiva()}`).then(r => r.json());
        renderizarReporteDia(datosReporte);
    } else {
        const desde = document.getElementById('rango-desde').value;
        const hasta = document.getElementById('rango-hasta').value;
        if (!desde || !hasta) { alert('Complete las fechas del rango'); return; }
        datosReporte = await fetch(`/api/admin/reporte-rango?desde=${desde}&hasta=${hasta}`).then(r => r.json());
        renderizarReporteRango(datosReporte);
    }
}

function renderizarReporteDia(data) {
    const k = data.kpis;

    // KPIs
    document.getElementById('reporte-kpis').innerHTML = [
        { valor: k.total_pacientes,     etiq: 'Total pacientes' },
        { valor: k.admisionados,         etiq: 'Admisionados' },
        { valor: fmtMin(k.avg_espera_admision),        etiq: '⌀ espera hasta admisión' },
        { valor: fmtMin(k.avg_tiempo_atencion_general), etiq: '⌀ tiempo de atención general' }
    ].map(k => `
        <div class="kpi-card">
            <div class="valor">${k.valor ?? '—'}</div>
            <div class="etiqueta">${k.etiq}</div>
        </div>
    `).join('');

    // Por profesional
    document.getElementById('tabla-reporte-profesional').innerHTML =
        data.por_profesional.map(p => `
            <tr>
                <td><strong>${p.nombre_profesional}</strong></td>
                <td>${p.area}</td>
                <td>${p.total_asignados}</td>
                <td style="color:#27ae60;font-weight:600">${p.finalizados}</td>
                <td style="color:#e67e22">${p.en_proceso}</td>
                <td style="color:#888">${p.pendientes}</td>
                <td style="font-weight:600">${fmtMin(p.avg_min_atencion)}</td>
                <td style="color:#27ae60">${fmtMin(p.min_min_atencion)}</td>
                <td style="color:#c0392b">${fmtMin(p.max_min_atencion)}</td>
                <td>${fmtMin(p.avg_min_espera_hasta_llamado)}</td>
            </tr>
        `).join('') || '<tr><td colspan="10" style="text-align:center;color:#aaa;padding:16px">Sin datos</td></tr>';

    // Por paciente (timeline)
    document.getElementById('seccion-timeline').style.display = 'block';
    document.getElementById('tabla-reporte-paciente').innerHTML =
        data.timeline.map((p, i) => `
            <tr onclick="toggleDetallePacienteReporte(${i})" style="cursor:pointer">
                <td style="color:#aaa">▶</td>
                <td style="font-size:12px;color:#888">${p.cedula}</td>
                <td><strong>${p.paciente}</strong></td>
                <td>${badgePrio(p.prioridad)}</td>
                <td>${fmt(p.t1_llegada)}</td>
                <td>${p.t2_sistema ? fmt(p.t2_sistema) : '—'}</td>
                <td>${p.t3_primer_llamado ? fmt(p.t3_primer_llamado) : '—'}</td>
                <td>${p.t5_ultima_finalizacion ? fmt(p.t5_ultima_finalizacion) : '—'}</td>
                <td>${p.min_espera_admision !== null ? `<strong>${fmtMin(p.min_espera_admision)}</strong>` : '—'}</td>
                <td>${p.min_espera_primera_atencion !== null ? `<strong>${fmtMin(p.min_espera_primera_atencion)}</strong>` : '—'}</td>
                <td>${p.min_tiempo_total_clinica !== null ? `<strong>${fmtMin(p.min_tiempo_total_clinica)}</strong>` : '—'}</td>
            </tr>
            <tr id="det-rep-${i}" style="display:none" class="detalle-row">
                <td></td>
                <td colspan="10">
                    <div class="profesionales-lista">
                        ${(Array.isArray(p.por_profesional) ? p.por_profesional : []).map(a => `
                            <div class="prof-chip">
                                <div class="prof-nombre">${a.profesional} · ${a.area}</div>
                                <div class="prof-tiempos">
                                    ${a.t3_llamado ? `T3: ${fmt(a.t3_llamado)}` : ''}
                                    ${a.t4_atencion ? `T4: ${fmt(a.t4_atencion)}` : ''}
                                    ${a.t5_finalizado ? `T5: ${fmt(a.t5_finalizado)}` : ''}
                                    ${a.min_atencion !== null ? `· Consulta: <strong>${fmtMin(a.min_atencion)}</strong>` : ''}
                                    ${a.min_espera_llamado !== null ? `· Espera: ${fmtMin(a.min_espera_llamado)}` : ''}
                                </div>
                            </div>
                        `).join('')}
                    </div>
                </td>
            </tr>
        `).join('');
}

function renderizarReporteRango(data) {
    document.getElementById('reporte-kpis').innerHTML = '';
    document.getElementById('seccion-timeline').style.display = 'none';
    document.getElementById('tabla-reporte-profesional').innerHTML =
        data.datos.map(p => `
            <tr>
                <td><strong>${p.nombre_profesional}</strong></td>
                <td>${p.area}</td>
                <td colspan="3" style="color:#888;font-size:12px">${p.fecha}</td>
                <td style="color:#27ae60;font-weight:600">${p.pacientes_atendidos}</td>
                <td colspan="2" style="font-weight:600">${fmtMin(p.avg_min_atencion)}</td>
                <td colspan="2">${fmtMin(p.avg_espera_admision)}</td>
            </tr>
        `).join('') || '<tr><td colspan="10" style="text-align:center;color:#aaa;padding:16px">Sin datos</td></tr>';
}

function toggleDetallePacienteReporte(i) {
    const fila = document.getElementById(`det-rep-${i}`);
    fila.style.display = fila.style.display === 'none' ? 'table-row' : 'none';
}

// ── EXPORTAR CSV ─────────────────────────────────────────────

function exportarCSVPacientes() {
    if (!datosPacientes.length) { alert('No hay datos para exportar'); return; }
    const cabecera = ['Cedula','Nombre','Prioridad','T1_Llegada','T2_Admision','Estado_Admision','Modulo','Profesional','Area','Estado_Asignacion','T3_Llamado','T4_Atencion','T5_Finalizado','Min_Atencion'];
    const filas = [];
    datosPacientes.forEach(p => {
        const asig = Array.isArray(p.asignaciones) ? p.asignaciones : [];
        if (asig.length === 0) {
            filas.push([p.numero_identificacion, p.nombre_completo.trim(), p.prioridad,
                fmt(p.hora_llegada), fmt(p.hora_admision), p.estado_admision, p.modulo_admision||'',
                '','','','','','','']);
        } else {
            asig.forEach(a => {
                filas.push([p.numero_identificacion, p.nombre_completo.trim(), p.prioridad,
                    fmt(p.hora_llegada), fmt(p.hora_admision), p.estado_admision, p.modulo_admision||'',
                    a.profesional, a.area, a.estado,
                    fmt(a.hora_llamado), fmt(a.hora_en_atencion), fmt(a.hora_finalizado),
                    a.min_atencion ?? '']);
            });
        }
    });
    descargarCSV(`pacientes_${fechaActiva()}.csv`, [cabecera, ...filas]);
}

function exportarReporteCSV() {
    if (!datosReporte) { alert('Genere primero el reporte'); return; }
    const tipo = document.getElementById('tipo-reporte').value;

    if (tipo === 'dia' && datosReporte.timeline) {
        const cabecera = ['Cedula','Paciente','Prioridad','T1_Llegada','T2_Admision',
            'T3_1er_Llamado','T5_Ultima_Salida','Min_Espera_Admision',
            'Min_Espera_1a_Atencion','Min_Total_Clinica','Profesional','Area','Min_Atencion'];
        const filas = [];
        datosReporte.timeline.forEach(p => {
            const asig = Array.isArray(p.por_profesional) ? p.por_profesional : [];
            if (asig.length === 0) {
                filas.push([p.cedula, p.paciente, p.prioridad, fmt(p.t1_llegada),
                    fmt(p.t2_sistema), fmt(p.t3_primer_llamado), fmt(p.t5_ultima_finalizacion),
                    p.min_espera_admision??'', p.min_espera_primera_atencion??'', p.min_tiempo_total_clinica??'', '','','']);
            } else {
                asig.forEach(a => {
                    filas.push([p.cedula, p.paciente, p.prioridad, fmt(p.t1_llegada),
                        fmt(p.t2_sistema), fmt(p.t3_primer_llamado), fmt(p.t5_ultima_finalizacion),
                        p.min_espera_admision??'', p.min_espera_primera_atencion??'',
                        p.min_tiempo_total_clinica??'', a.profesional, a.area, a.min_atencion??'']);
                });
            }
        });
        descargarCSV(`reporte_${fechaActiva()}.csv`, [cabecera, ...filas]);
    } else if (tipo === 'rango' && datosReporte.datos) {
        const cabecera = ['Fecha','Profesional','Area','Pacientes_Atendidos','Avg_Min_Atencion','Avg_Espera_Admision'];
        const filas = datosReporte.datos.map(p => [p.fecha, p.nombre_profesional, p.area,
            p.pacientes_atendidos, p.avg_min_atencion??'', p.avg_espera_admision??'']);
        descargarCSV(`reporte_rango_${datosReporte.desde}_${datosReporte.hasta}.csv`, [cabecera, ...filas]);
    }
}

function descargarCSV(nombre, filas) {
    const contenido = filas.map(f =>
        f.map(v => `"${String(v ?? '').replace(/"/g,'""')}"`).join(',')
    ).join('\r\n');
    const blob = new Blob(['﻿' + contenido], { type: 'text/csv;charset=utf-8;' }); // BOM para Excel
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = nombre;
    document.body.appendChild(a); a.click();
    document.body.removeChild(a); URL.revokeObjectURL(url);
}

// ── CONFIGURACIÓN ────────────────────────────────────────────

let configActual = [];

async function cargarConfig() {
    configActual = await fetch('/api/admin/config').then(r => r.json());
    const descripciones = {
        modulos_admisiones:      { label: 'Módulos de admisiones', desc: 'JSON array de nombres. Ej: ["Módulo 1","Módulo 2","Módulo 3"]' },
        sonido_habilitado:       { label: 'Sonido en TVs', desc: '"true" o "false"' },
        intervalo_extension_seg: { label: 'Intervalo extensión (segundos)', desc: 'Cada cuántos segundos la extensión sincroniza con Biofile' },
        version_db:              { label: 'Versión del esquema DB', desc: 'Solo lectura' }
    };

    document.getElementById('config-form').innerHTML = `
        <h3 style="margin-bottom:16px;color:#1a3a6e">Parámetros del sistema</h3>
        ${configActual.map(c => {
            const info = descripciones[c.clave] || { label: c.clave, desc: c.descripcion || '' };
            const readonly = c.clave === 'version_db';
            return `
                <div class="config-row">
                    <div class="config-key">
                        ${info.label}
                        <div class="config-desc">${info.desc}</div>
                    </div>
                    <input type="text" id="cfg-${c.clave}" value="${c.valor}" ${readonly ? 'readonly style="background:#f5f5f5;color:#888"' : ''}>
                    ${!readonly ? `<button class="btn btn-primary btn-sm" onclick="guardarConfig('${c.clave}')">Guardar</button>` : ''}
                </div>
            `;
        }).join('')}
        <div style="margin-top:20px;padding-top:16px;border-top:1px solid #eee">
            <h4 style="margin-bottom:12px;color:#1a3a6e">Gestión de módulos de admisiones</h4>
            <p style="font-size:13px;color:#666;margin-bottom:8px">
                Edite el campo <strong>Módulos de admisiones</strong> arriba con el JSON array y haga clic en Guardar.<br>
                Ejemplo: <code>["Módulo 1","Módulo 2","Módulo 3"]</code>
            </p>
        </div>
    `;
}

async function guardarConfig(clave) {
    const valor = document.getElementById(`cfg-${clave}`).value;
    const resp = await fetch('/api/admin/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ clave, valor })
    });
    if (resp.ok) {
        const el = document.getElementById(`cfg-${clave}`);
        el.style.borderColor = '#27ae60';
        setTimeout(() => el.style.borderColor = '', 2000);
    } else {
        alert('Error al guardar');
    }
}

// ── TERMINALES ───────────────────────────────────────────────

async function cargarTerminales() {
    const terminales = await fetch('/api/admin/terminales').then(r => r.json());
    const ahora = Date.now();
    const tiposLabel = { recepcion: 'Recepción', admisiones: 'Admisiones', profesional: 'Profesional', display: 'Display TV' };

    document.getElementById('tabla-terminales').innerHTML = terminales.length === 0
        ? '<tr><td colspan="7" style="text-align:center;color:#aaa;padding:20px">Sin terminales registrados</td></tr>'
        : terminales.map(t => {
            const hb = t.ultimo_heartbeat ? new Date(t.ultimo_heartbeat) : null;
            const segsAtras = hb ? Math.round((ahora - hb.getTime()) / 1000) : null;
            const activo = segsAtras !== null && segsAtras < 120;
            return `
                <tr>
                    <td style="font-size:11px;color:#888">${t.id.substring(0,16)}...</td>
                    <td><span class="badge ${t.tipo}">${tiposLabel[t.tipo] || t.tipo}</span></td>
                    <td>${t.consultorio_numero || '—'}</td>
                    <td style="font-size:12px">${t.login_name_biofile || '—'}</td>
                    <td style="font-size:12px">${t.ip_address || '—'}</td>
                    <td style="font-size:12px">${hb ? hb.toLocaleTimeString('es-CO') : '—'}</td>
                    <td>
                        <span style="color:${activo ? '#27ae60' : '#aaa'};font-weight:600">
                            ${activo ? '● Activo' : '○ Inactivo'}
                        </span>
                        ${segsAtras !== null ? `<span style="font-size:11px;color:#aaa"> hace ${segsAtras}s</span>` : ''}
                    </td>
                </tr>
            `;
        }).join('');
}

// ── Inicializar ───────────────────────────────────────────────

cargarDashboard();

// Auto-refresh del dashboard cada 30 segundos
setInterval(() => {
    if (tabActual === 'dashboard') cargarDashboard();
}, 30000);
```

---

## Definición de los 5 tiempos en el reporte

| Código | Campo BD | Significado |
|---|---|---|
| **T1** | `pacientes_cola.hora_llegada` | El scanner de recepción lee la cédula. Timestamp del servidor. |
| **T2** | `pacientes_cola.hora_admision` *(nuestro sistema)* | Admisiones marca "Admisionado" en el turnero. Aproxima cuándo terminó de registrar en Biofile. |
| **T3** | `MIN(asignaciones_profesionales.hora_llamado)` | El primer profesional presiona "Llamar". |
| **T4** | `MIN(asignaciones_profesionales.hora_en_atencion)` | El primer profesional presiona "En Atención". |
| **T5** | `MAX(asignaciones_profesionales.hora_finalizado)` | El último profesional presiona "Finalizado". El paciente salió del sistema. |

### Métricas derivadas

| Métrica | Fórmula | Qué mide |
|---|---|---|
| Espera hasta admisión | T2 − T1 | Tiempo que tardó admisiones en procesar el paciente |
| Espera hasta primera atención | T3 − T1 | Tiempo total que esperó el paciente para ver su primer profesional |
| Tiempo de consulta por profesional | T5ₚ − T4ₚ (por asignación) | Duración real de cada consulta |
| Tiempo total en clínica | max(T5) − T1 | Tiempo completo de la visita del paciente |
| Espera entre profesionales | T3ₚ₊₁ − T5ₚ | Tiempo entre que un profesional termina y el siguiente lo llama |

---

## Acceso al módulo

El módulo no tiene autenticación implementada en el plan. Para la red local de CertiMedic (sin exposición a internet) es aceptable. Si se requiere restricción, agregar una contraseña simple con prompt en el HTML o un middleware Express con Basic Auth.

```javascript
// Protección básica en server.js (si se requiere)
app.use('/admin', (req, res, next) => {
    const auth = req.headers.authorization;
    if (!auth) {
        res.set('WWW-Authenticate', 'Basic realm="Admin"');
        return res.status(401).send('Acceso restringido');
    }
    const [, b64] = auth.split(' ');
    const [user, pass] = Buffer.from(b64, 'base64').toString().split(':');
    if (user === process.env.ADMIN_USER && pass === process.env.ADMIN_PASSWORD) {
        return next();
    }
    return res.status(401).send('Credenciales incorrectas');
});
// Agregar al .env: ADMIN_USER=admin  ADMIN_PASSWORD=CertiMedic2026
```
