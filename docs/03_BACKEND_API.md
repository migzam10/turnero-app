# 03 — Backend: API REST y Socket.io

> Última actualización: 2026-07-05
>
> **Fuente de verdad: `app/routes/*.js`, `app/sockets/*.js`, `app/middleware/*.js`.**
> Referencia de todos los endpoints y eventos reales. Los detalles de cada query
> viven en el código.

## Generalidades

- `server.js` fija `TZ=America/Bogota`, carga `.env` (dotenv), monta las 7 rutas,
  sirve `public/` estático y corre la migración antes de escuchar.
- CORS abierto para la LAN y las extensiones; `express.json` con límite de 5 MB
  (logo del display en data-URL).
- `GET /health` → `{ok, db:true}` con `SELECT 1`; **503** si la BD no responde.
- Errores: `500 {error:'db_error'}`; conflictos de estado/duplicados → `409` con
  código específico; validaciones → `400`.

### Autenticación por tipo de consumidor

| Consumidor | Mecanismo |
|---|---|
| Módulos operativos (recepción/admisiones/profesional) | Header `X-Terminal-Id` (UUID persistido en el navegador; middleware `validarTerminalId`) |
| Extensiones | Header `X-Extension-Secret` (== `.env`; TODO `/api/extension/*` lo exige, incluido `/pendientes`) |
| Panel Admin | `POST /api/admin/login` con la clave (`clave_admin` en BD) → token Bearer en memoria (8 h). **Rate-limit**: 5 intentos fallidos por IP en 15 min → 429 |
| Display / config pública | Sin auth (solo lectura, sin datos sensibles) |

### Auditoría transversal

`app/utils/audit.js` → `registrarEvento()` inserta en `eventos_log` (fire-and-forget,
nunca bloquea la respuesta). Instrumentado en ~19 operaciones (ver lista de tipos en
`02_BASE_DE_DATOS.md`).

### Notificación genérica

`app/sockets/notify.js` → `emitUpdatePatients(io)` emite `UPDATE_PATIENTS` **solo** a
las salas `admin` y `profesional` (dashboard en vivo y bloqueos cruzados). Las demás
pantallas usan sus eventos específicos.

---

## `/api/recepcion` (X-Terminal-Id)

| Endpoint | Descripción |
|---|---|
| `GET /cola` | Cola del día (orden: prioridad, hora de llegada) — sin auth |
| `GET /:id` | Registro completo para precargar la edición |
| `POST /registrar` | Alta del paciente (MAYÚSCULAS, fecha `DD/MM/AAAA` o ISO, sexo M/F, prioridad). 409 `ya_registrado` si la cédula ya existe hoy |
| `PUT /:id` | Edición — solo en estado `esperando` (409 `no_editable` / `cedula_duplicada`) |
| `PATCH /:id/prioridad` | `alta|media|normal` |
| `DELETE /:id` | Eliminación de registro erróneo — solo `esperando` (409 `no_eliminable`), auditada (`paciente_eliminado` con datos en JSONB), emite `paciente:eliminado` |

Emits: `paciente:nuevo` (recepcion+admisiones — ya NO al display),
`paciente:actualizado`, `paciente:prioridad`, `paciente:eliminado`.

## `/api/admisiones` (X-Terminal-Id)

| Endpoint | Descripción |
|---|---|
| `GET /cola` | Pacientes en `esperando|llamando_admision|admisionando` con su módulo |
| `POST /llamar/:id` | `esperando → llamando_admision` + módulo; emite `admision:llamando` (TVs) |
| `POST /admisionando/:id` | **Tiempo 1**: `llamando → admisionando`, fija `hora_llamado_admision`, emite `admision:completada` (retira del display) |
| `POST /finalizar/:id` | **Tiempo 2**: `admisionando → admisionado`, `hora_admision = COALESCE(existente, NOW())` — respeta la hora de Biofile si el sync ya la puso |
| `POST /devolver/:id` | `llamando → esperando` (limpia módulo/hora; el payload lleva `modulo_anterior` para que el display lo retire) |
| `POST /asignar-profesional/:id` | Asignación **manual** (particulares): `origen='manual'`, `manual_override=true` (la reconciliación jamás la toca). 409 `ya_asignado` si ya existe activa |
| `GET /config-modulos` | `["Módulo 1"..N]` según `cantidad_modulos_admisiones` (tope 50) |

Todos los guards son `UPDATE ... WHERE estado='X'`; `rowCount=0` → 409
`estado_invalido`. (El antiguo `GET /datos-pegado/:id` fue **eliminado** — lo
reemplazó la extensión Injector.)

## `/api/profesional` (X-Terminal-Id salvo los GET públicos)

| Endpoint | Descripción |
|---|---|
| `GET /asignaciones?profesional=&fecha=` | Lista del profesional. Sin fecha = HOY en vivo (oculta finalizados); con fecha pasada = historial completo. Incluye flags `bloqueado`/`bloqueado_por` (paciente activo con otro profesional) |
| `GET /listado-profesionales` | Nombres con asignaciones HOY (público) |
| `GET /catalogo` | Nombres de los últimos 60 días (público — autocompletar del setup) |
| `GET /consultorios` | Catálogo activo `[{id, nombre, multipaciente}]` (público) |
| `GET /resumen-hoy?profesional=` | `{finalizados: n}` — contador real del día |
| `POST /llamar/:id` | `pendiente → llamando` + consultorio. **Serializado con `pg_advisory_xact_lock`** (inmune a dobles clics/pestañas). Si el consultorio es **multipaciente**, se omite el guard de paciente-activo. 409: `ya_tiene_paciente_activo` · `paciente_bloqueado` · `estado_invalido` |
| `POST /en-atencion/:id` | `llamando → en_atencion` |
| `POST /finalizar/:id` | `en_atencion → finalizado` |
| `POST /cancelar-llamado/:id` | `llamando → pendiente` |
| `POST /reasignar/:id` | Cambia el profesional (solo pendiente/cancelado); marca `manual_override`. 409 `destino_duplicado` |
| `POST /cancelar-asignacion/:id` | Baja manual (`activo=false`, `origen_baja='manual'`) |

Emits por estado: `asignacion:llamando/en_atencion/finalizado/cancelado/reasignado/
cancelado_manual` a `profesional:{NOMBRE}` + `display`.

## `/api/extension` (X-Extension-Secret en TODO)

| Endpoint | Descripción |
|---|---|
| `GET /pendientes` | Pacientes del día en `esperando|llamando_admision` con datos para el Injector (nombres, sexo, fecha nacimiento formateada) |
| `POST /sync` | Upsert de asignaciones por `(fecha, cédula, columna_header)` en transacción por paciente: autocrea pacientes sin recepción, **sobrescribe `hora_admision` con `MIN(hora_llegada_biofile)`** (Biofile autoritativo), respeta `manual_override`, revive canceladas-por-LIS que reaparecen. Con `snapshotCompleto:true` ejecuta la **reconciliación** (baja `origen_baja='lis'` de lo que ya no está, salvo en-curso/manual). Responde `{ok, nuevos, actualizados, autocreados, reconciliados, errores}` |
| `GET /heartbeat` | Ping de la extensión |

## `/api/admin` (Bearer token, salvo /login)

| Endpoint | Descripción |
|---|---|
| `POST /login` | Clave → `{token}`. Rate-limit 5/15min por IP (429 `demasiados_intentos`). Audita éxito y bloqueo |
| `GET/POST /config` | Parámetros clave-valor (los sensibles como `clave_admin` van enmascarados; el POST emite `config:actualizada`) |
| `GET /terminales` | Todas las terminales registradas |
| `GET /pantallas` | Solo displays: `en_linea` (heartbeat<90s) y `audio_ok` |
| `GET/POST/PATCH /consultorios` | CRUD del catálogo (nombre único ≤60, `multipaciente`, baja lógica con `activo`; sin DELETE). 409 `nombre_duplicado`. Emite `consultorios:actualizados` |
| `GET /resumen-dia?fecha=` | KPIs ligeros del día |
| `GET /dashboard?fecha=` | Dashboard en vivo: KPIs (incluye `avg_min_espera_admision` = llegada→Admisionando y `avg_min_registro` = Admisionando→Biofile), cola pendiente, por profesional |
| `GET /graficas?fecha=` | Embudo, flujo por hora, por profesional (Chart.js) |
| `GET /reporte-detallado?desde=&hasta=` | Reporte completo por **rango** (tope 31 días; compat `?fecha=`): kpis, timeline T1→T5 por paciente (con `fecha`, `t2a_admisionando`, `min_registro`), por_profesional, asignaciones. 400: `fecha_invalida`/`rango_invalido`/`rango_muy_grande` |
| `GET /reporte-rango?desde=&hasta=` | Desglose por día × profesional |
| `GET /eventos-log?fecha=&limite=` | Auditoría (máx. 500) |

## `/api/config` y `/api/display` (públicos)

| Endpoint | Descripción |
|---|---|
| `GET /api/config/publica` | `{titulo_sufijo, display_logo, sonido_habilitado, duracion_anuncio_seg (4–30)}` |
| `GET /api/display/activos` | Llamados EN CURSO (admisiones + profesionales, con `id` de asignación y `destino` con el nombre del catálogo tal cual) — recuperación de las TVs tras F5/corte |

---

## Socket.io (`app/sockets/events.js`)

- `join {tipo, profesional?, terminalId, consultorio?, audioOk?}` → entra a la sala
  de su tipo (+ `profesional:{NOMBRE}`) y upserta `terminales` **solo si el
  terminalId es UUID válido**.
- `heartbeat {terminalId, audioOk?}` → refresca `ultimo_heartbeat` (y `audio_ok` del
  display, con COALESCE).
- Relés a las TVs: `display:sonar` (profesional) y `admision:sonar` (admisiones).
- Mapa completo de salas/eventos en `01_ARQUITECTURA.md`.
