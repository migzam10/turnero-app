# 01 — Arquitectura y Stack Tecnológico

> Última actualización: 2026-07-05

## Stack

| Capa | Tecnología | Razón |
|---|---|---|
| Backend / API | Node.js 20 LTS + Express 4 | Corre en Windows Server 2019 sin Docker, Socket.io en el mismo proceso, un solo runtime para todo |
| Tiempo real | Socket.io 4 | WebSockets bidireccionales; más maduro y con más casos de uso en producción que FastAPI WS |
| Base de datos | **PostgreSQL 16** | Integridad referencial estricta, funciones de agregación para reportes de tiempos (T1→T5), soporte de concurrencia con múltiples terminales escribiendo simultáneamente |
| ORM / Query | `pg` (node-postgres) | Driver nativo de PostgreSQL para Node.js, sin overhead de ORM |
| Frontend (web) | HTML5 + CSS3 + Vanilla JS + Socket.io client | Sin framework, sin paso de build, fácil de desplegar y modificar. El panel Admin usa Chart.js y SheetJS por CDN (con degradación elegante si no cargan) |
| Extensiones | Chrome/Edge Manifest V3 — **dos**: Biofile-Sync (lee la tabla de asignaciones) y Biofile-Injector (llena los campos de ingreso) | Leen/llenan el DOM de Biofile sin modificar el software |
| Sonido en TVs | Web Audio API | Sin dependencias externas; overlay de activación + vigilante contra la política de autoplay |
| Entornos | Desarrollo: Mac con Docker Compose · Producción: Windows Server 2019 **nativo** (PostgreSQL y Node como servicios) | Ver `DEPLOY.md` y `docs/09_INSTALACION_SERVIDOR.md` |

### Por qué PostgreSQL y no SQLite

SQLite fue considerado por simplicidad (archivo único, sin servidor), pero el proyecto tiene tres requisitos que lo descartan:

1. **Reportes de tiempos:** El módulo de auditoría calcula diferencias entre `T1` (llegada), `T2` (admisión), `T3` (llamado por profesional), `T4` (en atención), `T5` (finalizado) — a través de múltiples tablas y múltiples profesionales por paciente. PostgreSQL tiene `INTERVAL`, `EXTRACT`, `AGE()` y ventanas analíticas (`OVER PARTITION BY`) que hacen estas consultas directas. En SQLite requieren `strftime()` con conversiones manuales y son propensas a error.

2. **Escrituras concurrentes:** La extensión envía sync cada 60s + 3 terminales de admisiones + N profesionales cambiando estados simultáneamente. SQLite serializa todas las escrituras con un lock de archivo — bajo carga concurrente genera errores `SQLITE_BUSY` o latencias altas.

3. **Integridad referencial:** Las tablas tienen `REFERENCES` entre ellas. SQLite requiere activar `PRAGMA foreign_keys = ON` en cada conexión (se desactiva por defecto) y no enforcea constraints de la misma forma que PostgreSQL.

### Por qué Node.js y no FastAPI (Python)

El chat original recomendó FastAPI. Node.js es igualmente válido para este caso porque:
- Socket.io es la librería de WebSockets más madura del ecosistema web y corre nativo en Node.js.
- El equipo no necesita mantener dos entornos (Python + Node.js) si todo es JavaScript.
- Para FastAPI se necesitaría Docker o instalar Python + pip en Windows Server, agregando complejidad operativa.
- La diferencia de rendimiento entre FastAPI async y Node.js + Socket.io es irrelevante para el volumen de una clínica.

Si el equipo tiene experiencia en Python/FastAPI, el cambio es viable — la arquitectura y el schema son los mismos; solo cambia el lenguaje del backend.

## Componentes del sistema

```
┌─────────────────────────────────────────────────────────────┐
│                    Windows Server 2019                       │
│                                                             │
│  ┌──────────────────────────────────────────────────────┐   │
│  │           Servidor Turnero (Node.js)                 │   │
│  │                                                      │   │
│  │  /api/*        → REST endpoints                      │   │
│  │  Socket.io     → Tiempo real (cola, llamados, TV)    │   │
│  │  /public/*     → Archivos estáticos (HTML/CSS/JS)   │   │
│  │  PostgreSQL DB → puerto 5432 (mismo servidor)         │   │
│  └──────────────────────────────────────────────────────┘   │
│           Puerto 3000 (configurable en .env)                │
└─────────────────────────────────────────────────────────────┘
         ↑  Red local (LAN)  ↓
┌─────────────────────────────────────────────────────────────┐
│  Terminales en la red                                        │
│                                                             │
│  PC Recepción    → http://SERVER_IP:3000/recepcion          │
│  PC Admisiones   → http://SERVER_IP:3000/admisiones         │
│                    + Extensión Chrome/Edge instalada        │
│                    + Biofile abierto en otra pestaña        │
│  PC Profesional  → http://SERVER_IP:3000/profesional        │
│  PC/TV Display   → http://SERVER_IP:3000/display            │
│  Admin           → http://SERVER_IP:3000/admin              │
└─────────────────────────────────────────────────────────────┘
```

## Estructura de carpetas del proyecto

```
turnero-app/
├── docker-compose.yml       ← Entorno de desarrollo (Mac): db + app
├── .env                     ← Variables de entorno (gitignored; ver .env.example)
├── DEPLOY.md                ← Guía rápida de despliegue (detalle en docs/09)
├── scripts/
│   ├── backup-db.sh         ← Backup diario (dev Mac / Linux)
│   └── backup-db.ps1        ← Backup diario (Windows Server, Task Scheduler)
├── app/
│   ├── server.js            ← Punto de entrada (Express + Socket.io + migración)
│   ├── package.json
│   ├── database/
│   │   ├── schema.sql       ← Definición de tablas + migraciones idempotentes
│   │   ├── db.js            ← Pool de conexiones (timezone America/Bogota por sesión)
│   │   └── migrate.js       ← Ejecuta schema.sql en cada arranque
│   ├── middleware/
│   │   ├── adminAuth.js     ← Tokens de sesión admin + rate-limit del login
│   │   └── validar.js       ← X-Terminal-Id y X-Extension-Secret
│   ├── routes/
│   │   ├── api.recepcion.js   ← Registro, edición, prioridad, eliminación
│   │   ├── api.admisiones.js  ← Llamado en 2 tiempos, asignación manual
│   │   ├── api.profesional.js ← Llamado (advisory lock, multipaciente), estados
│   │   ├── api.extension.js   ← Sync de Biofile + reconciliación
│   │   ├── api.admin.js       ← Login, config, consultorios, reportes, auditoría
│   │   ├── api.config.js      ← Config pública (branding, sonido, duración)
│   │   └── api.display.js     ← Estado de llamados activos (recuperación de TVs)
│   ├── sockets/
│   │   ├── events.js        ← join/heartbeat + relés de "sonar"
│   │   └── notify.js        ← UPDATE_PATIENTS a las salas admin+profesional
│   ├── utils/
│   │   ├── audit.js         ← registrarEvento() → eventos_log (fire-and-forget)
│   │   └── fecha.js         ← fechaHoyBogota()
│   └── public/
│       ├── index.html       ← Menú principal de módulos
│       ├── branding.js      ← Título/logo personalizables en vivo
│       ├── recepcion/ · admisiones/ · profesional/ · display/ · admin/
│       └── (cada módulo es un index.html autocontenido, sin build)
└── extension/
    ├── Biofile-Sync/        ← Lee TbCitasAsignadas y sincroniza (config.js gitignored)
    └── Biofile-Injector/    ← Llena el formulario de ingreso con los pendientes
```

## Flujo de datos en tiempo real (Socket.io)

Cada terminal hace `join` con su tipo (`recepcion` | `admisiones` | `profesional` |
`display` | `admin`) y un `terminalId` UUID persistido en localStorage (se registra en
la tabla `terminales`; los profesionales además entran a `profesional:{NOMBRE}`).

| Sala | Eventos que recibe |
|---|---|
| `recepcion` | `paciente:nuevo`, `paciente:actualizado`, `paciente:prioridad`, `paciente:eliminado`, `admision:completada` |
| `admisiones` | los anteriores + `admision:llamando`, `admision:devuelto`, `asignacion:manual` |
| `profesional:{NOMBRE}` | `asignacion:llamando/en_atencion/finalizado/cancelado/reasignado/cancelado_manual/manual`, `extension:sync` |
| `display` | `admision:llamando/completada/devuelto`, `asignacion:*`, `display:sonar`, `admision:sonar` |
| `admin` + `profesional` | `UPDATE_PATIENTS` (tick genérico de "recargar", centralizado en `sockets/notify.js` — el panel Admin refresca el dashboard y los profesionales sus bloqueos cruzados) |
| todas | `config:actualizada` (branding/parámetros en vivo), `consultorios:actualizados` |

Los clientes envían `heartbeat` cada 30 s (el display incluye `audioOk` para el
monitoreo de pantallas) y los relés `display:sonar` / `admision:sonar` reenvían el
timbre a las TVs.

## Configuración de terminales

El terminal se identifica por un `terminalId` que se genera y guarda en `localStorage` la primera vez que abre cualquier módulo. Este ID se envía en cada conexión de Socket.io y en cada petición REST como header `X-Terminal-Id`.

El módulo de profesional adicionalmente guarda en `localStorage`:
- `profesional_nombre` → nombre del profesional (con sugerencias del histórico; debe coincidir con Biofile)
- `profesional_consultorio` → consultorio elegido del **catálogo administrable** (tabla `consultorios`)
- `profesional_consultorio_multi` → si el consultorio es multipaciente (se revalida contra el catálogo al arrancar)

El módulo de admisiones guarda `modulo_admisiones` (Módulo 1..N, cantidad configurable desde Admin).

## Configuración de las TVs

Las pantallas están dispersas en varias salas; cada una carga el display por su cuenta
(los timbres suenan sincronizados porque todos reciben el mismo broadcast socket):

- **PC → HDMI (o splitter):** Chrome en kiosco con autoplay habilitado:
  `chrome.exe --kiosk --autoplay-policy=no-user-gesture-required http://SERVER_IP:3000/display`
- **Android TV cableada (recomendado):** Fully Kiosk Browser con *Autoplay Audio* y
  *Launch on Boot*; o el navegador de fábrica (un OK del control activa el audio en el
  overlay de arranque).
- El estado de cada pantalla (en línea / audio) se monitorea desde
  **Admin → Terminales → Pantallas**. Detalle completo en `docs/08_PANTALLA_TV.md`.

## Variables de entorno (.env)

```env
PORT=3000
NODE_ENV=production
EXTENSION_SECRET=CambiarPorClaveSegura123!

# PostgreSQL
DB_HOST=localhost
DB_PORT=5432
DB_NAME=turnero
DB_USER=turnero_user
DB_PASSWORD=CambiarPorPasswordSeguro
```

## Configuración automática al inicio

En **cada** arranque del servidor (`node server.js`), `database/migrate.js` ejecuta
`schema.sql` completo: los `CREATE TABLE IF NOT EXISTS` y los `ALTER`/`DROP CONSTRAINT
IF EXISTS` son idempotentes, así que actualizar el esquema = actualizar el código y
reiniciar el proceso. También siembra la configuración inicial (`ON CONFLICT DO
NOTHING`): cantidad de módulos de admisiones, clave del admin, sonido, duración del
anuncio, título, etc.

## Arranque en Windows Server 2019

En producción la app corre como **servicio de Windows con NSSM** (reinicio automático
al encender el servidor o si el proceso falla). Pasos completos, firewall, backups por
Task Scheduler y checklist en `docs/09_INSTALACION_SERVIDOR.md`.
