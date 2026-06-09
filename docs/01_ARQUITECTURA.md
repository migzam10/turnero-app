# 01 — Arquitectura y Stack Tecnológico

## Stack

| Capa | Tecnología | Razón |
|---|---|---|
| Backend / API | Node.js 20 LTS + Express 4 | Corre en Windows Server 2019 sin Docker, Socket.io en el mismo proceso, un solo runtime para todo |
| Tiempo real | Socket.io 4 | WebSockets bidireccionales; más maduro y con más casos de uso en producción que FastAPI WS |
| Base de datos | **PostgreSQL 16** | Integridad referencial estricta, funciones de agregación para reportes de tiempos (T1→T5), soporte de concurrencia con múltiples terminales escribiendo simultáneamente |
| ORM / Query | `pg` (node-postgres) | Driver nativo de PostgreSQL para Node.js, sin overhead de ORM |
| Frontend (web) | HTML5 + CSS3 + Vanilla JS + Socket.io client | Sin framework, sin paso de build, fácil de desplegar y modificar |
| Extensión | Chrome/Edge Manifest V3 | Lee DOM de Biofile sin modificarlo |
| Sonido en TVs | Web Audio API | Sin dependencias externas |

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
turnero-server/
├── server.js              ← Punto de entrada principal
├── .env                   ← Variables de entorno (puerto, DB, etc.)
├── package.json
├── database/
│   ├── schema.sql         ← Definición de tablas (PostgreSQL)
│   ├── db.js              ← Pool de conexiones (node-postgres)
│   └── migrate.js         ← Script para crear tablas al arrancar
├── routes/
│   ├── api.recepcion.js   ← Endpoints del módulo recepción
│   ├── api.admisiones.js  ← Endpoints del módulo admisiones
│   ├── api.profesional.js ← Endpoints del módulo profesional
│   ├── api.extension.js   ← Endpoint que recibe datos de la extensión
│   └── api.admin.js       ← Endpoints de configuración
├── sockets/
│   └── events.js          ← Todos los eventos de Socket.io
├── public/
│   ├── recepcion/
│   │   └── index.html
│   ├── admisiones/
│   │   └── index.html
│   ├── profesional/
│   │   └── index.html
│   ├── display/
│   │   └── index.html
│   ├── admin/
│   │   └── index.html
│   └── assets/
│       ├── css/
│       ├── js/
│       └── sounds/        ← beep.mp3, chime.mp3
└── extension/
    ├── manifest.json
    ├── background.js      ← Service worker (alarma periódica)
    ├── content.js         ← Script inyectado en AtencionesSeguimiento.aspx
    └── popup.html         ← (solo estado/config de la extensión)
```

## Flujo de datos en tiempo real (Socket.io)

### Sala: `admisiones`
- Todos los PC de admisiones se suscriben a `socket.join('admisiones')`.
- Cuando llega nueva data de extensión (o nuevo paciente registrado en recepción): servidor emite `cola_actualizada` → todos los PCs de admisiones actualizan su lista.

### Sala: `profesional:{loginName}`
- Cada PC de profesional se suscribe a su propia sala: `socket.join('profesional:KENDY ZABALETA')`.
- Cuando la extensión manda nuevas asignaciones para KENDY: servidor emite `asignaciones_actualizadas` solo a esa sala.

### Sala: `display`
- Todos los displays (TVs) se suscriben a `socket.join('display')`.
- Cuando cualquier profesional o admisiones cambia el estado de un paciente (llamando/en_atencion/finalizado): servidor emite `display_evento` → todas las TVs actualizan simultáneamente.

### Sala: `admin`
- Panel de administración recibe eventos de diagnóstico y configuración.

## Configuración de terminales

El terminal se identifica por un `terminalId` que se genera y guarda en `localStorage` la primera vez que abre cualquier módulo. Este ID se envía en cada conexión de Socket.io y en cada petición REST como header `X-Terminal-Id`.

El módulo de profesional adicionalmente guarda en `localStorage`:
- `consultorioNumero` → número/nombre del consultorio físico
- `loginNameBiofile` → nombre del profesional (si no tiene extensión, se ingresa manualmente una vez)

## Configuración de las TVs

**Opción recomendada (más económica y simple):**
- 1 PC dedicado conectado a un **splitter HDMI 1×3** (o 1×4).
- El splitter envía la misma señal a los 3 TVs simultáneamente.
- El PC tiene Chrome/Edge en modo kiosco abriendo `http://localhost:3000/display` (la URL es local porque el servidor está en el mismo Windows Server).
- Configurar Chrome en modo kiosco: `chrome.exe --kiosk http://localhost:3000/display`

**Opción alternativa (TVs con red):**
- Si los TVs tienen puerto ethernet o WiFi (Smart TVs), cada TV abre `http://SERVER_IP:3000/display` en su browser nativo.
- Si no son Smart TVs: conectar un Chromecast, Fire Stick, o mini PC por HDMI a cada TV.

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

Al arrancar el servidor por primera vez (`node server.js`), el script `database/migrate.js` se ejecuta automáticamente y:
1. Se conecta a PostgreSQL con las credenciales del `.env`.
2. Ejecuta `schema.sql` para crear todas las tablas (`CREATE TABLE IF NOT EXISTS`).
3. Inserta datos iniciales si no existen: 3 módulos de admisiones, configuración básica.

## Arranque en Windows Server 2019

Usar `pm2` para que el servidor corra como servicio de Windows y reinicie automáticamente:

```powershell
npm install -g pm2
pm2 start server.js --name turnero
pm2 startup
pm2 save
```

Esto garantiza que el servidor se reinicie al encender el servidor o si el proceso falla.
