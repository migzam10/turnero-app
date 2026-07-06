# 10 — Módulo Administrativo

> Última actualización: 2026-07-05
>
> **Fuente de verdad: `app/public/admin/index.html`** (autocontenido; Chart.js y
> SheetJS por CDN con degradación elegante). URL: `http://SERVIDOR:3000/admin`.

## Acceso

Pantalla de login con **clave** (parámetro `clave_admin`, default de fábrica `2026`
— cambiarla en producción). El backend entrega un token de sesión (8 h, en memoria:
un reinicio del servidor cierra las sesiones) y aplica **rate-limit** de 5 intentos
fallidos por IP cada 15 minutos. Logins y bloqueos quedan auditados.

## Pestañas

| Tab | Contenido |
|---|---|
| **Dashboard** | Estado del día en tiempo real |
| **Pacientes** | Lista completa del día con sus asignaciones (CSV) |
| **Reportes** | Reporte completo por rango de fechas + exportación Excel |
| **Gráficas** | Embudo, flujo por hora, por profesional (Chart.js) |
| **Configuración** | Personalización → Consultorios → Parámetros → Eventos |
| **Terminales** | Terminales conectadas + monitoreo de Pantallas (TVs) |

El panel se registra como terminal tipo `admin` (UUID + heartbeat) y se refresca en
vivo con `UPDATE_PATIENTS` (debounced).

---

## Dashboard

- **KPIs de cola**: registrados, admisionados, en espera, siendo llamados, prioridad
  alta, y los dos KPIs de tiempo **partidos**:
  - **Espera admisión (min)** — llegada → Admisionando (experiencia del paciente).
  - **Registro Biofile (min)** — Admisionando → hora de admisión (demora del trámite).
- **KPIs de asignaciones**: pendientes, llamando, en atención, finalizados,
  profesionales activos, particulares, cancelados LIS/manual.
- **Cola pendiente** (próximos 15) y **tabla por profesional** (asignados, en
  proceso, finalizados, cancelados, prom. de atención).
- Selector de fecha para ver días anteriores.

## Pacientes

Lista completa del día: horas de llegada/admisión, prioridad, estado, módulo y las
asignaciones de cada paciente (profesional, área, estado, T3–T5, minutos de
atención). Exportable a **CSV**.

## Reportes

- **Rango de fechas** (hasta 31 días; un solo día = comportamiento clásico). La vista
  completa aparece para CUALQUIER rango:
  1. **KPI cards**: total, admisionados, espera admisión, registro, prom. atención,
     particulares, bajas LIS/manual — agregados sobre el rango.
  2. **Por profesional**: 12 columnas (asignados, atendidos, en proceso, pendientes,
     cancelados por origen, particulares, prom./mín./máx. de atención).
  3. **Timeline T1→T5 por paciente**: llegada, admisión, primer llamado, primera
     atención, última finalización, espera adm., registro, minutos totales — con
     columna **Fecha** cuando el rango es multi-día.
  4. **Reporte por admisión** (una fila por asignación): origen Biofile/Particular,
     estado (bajas atenuadas con su origen), horas admisionado/llamado/finalizado,
     minutos de atención.
  5. En rangos multi-día: **Resumen por profesional por día** al final.
- **Exportación Excel** (botón "Excel", SheetJS): UN archivo
  `reporte_desde_hasta.xlsx` con hojas **Resumen · Por profesional · Timeline T1T5 ·
  Por admisión** (+ **Por día** en rangos). Sin internet para el CDN, el botón avisa
  (el CSV vive solo en la pestaña Pacientes).

## Gráficas

Por fecha: **Embudo del pipeline** (registrados → admisionados → llamados → en
atención → finalizados, semántica "alcanzó la etapa"), **Flujo por hora** (llegadas
vs atenciones, 0–23 h) y **Finalizados por profesional**. Si el CDN de Chart.js no
carga, muestra un aviso en lugar de romper.

## Configuración (orden de secciones)

1. **Personalización de pantallas** — título (`titulo_sufijo`) y logo del display
   (data-URL); los cambios se propagan en vivo (`config:actualizada`).
2. **Consultorios** — CRUD del catálogo: crear (nombre completo tal como se verá en
   pantalla, ≤60 chars, único), **Multipaciente** (permite llamar a varios a la vez),
   Renombrar, Activar/Desactivar (baja lógica; sin eliminar). Los cambios llegan en
   vivo a las pantallas de profesionales.
3. **Parámetros del sistema** — clave-valor editable: `cantidad_modulos_admisiones`,
   `clave_admin` (enmascarada), `sonido_habilitado`, `duracion_anuncio_seg` (4–30),
   `intervalo_extension_seg`, etc.
4. **Eventos (auditoría)** — visor de `eventos_log`: filtro por fecha y por tipo
   (client-side), tabla Hora · Tipo · Descripción, límite 200.

## Terminales

- **Terminales conectados**: todas las terminales registradas (tipo, consultorio,
  login Biofile, último heartbeat).
- **Pantallas (Displays TV)**: cada display con **🟢 En línea / 🔴 Sin conexión**
  (heartbeat < 90 s) y **🔊 OK / 🔇 BLOQUEADO** (estado real del audio reportado por
  la TV). Auto-refresco cada 15 s mientras la pestaña está activa. Es la forma de
  detectar una TV muda o caída sin ir hasta la sala.

---

## Endpoints que consume

`POST /api/admin/login` · `GET/POST /api/admin/config` · `GET /api/admin/dashboard` ·
`GET /api/admin/resumen-dia` · `GET /api/admin/pacientes` ·
`GET /api/admin/reporte-detallado?desde&hasta` · `GET /api/admin/reporte-rango` ·
`GET /api/admin/graficas` · `GET/POST/PATCH /api/admin/consultorios` ·
`GET /api/admin/terminales` · `GET /api/admin/pantallas` ·
`GET /api/admin/eventos-log`

Todos con `Authorization: Bearer <token>`; un 401 devuelve al login.
