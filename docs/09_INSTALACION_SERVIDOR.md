# 09 — Instalación y Arranque en Windows Server 2019 (producción nativa)

> Última actualización: 2026-07-05
>
> Guía detallada de la instalación **nativa** (sin Docker) decidida para producción.
> Resumen rápido en `DEPLOY.md` (raíz del repo). El desarrollo diario se hace en Mac
> con Docker Compose (ver la sección "Desarrollo" de `DEPLOY.md`).

---

## Requisitos del servidor

- Windows Server 2019 con **IP fija** en la LAN (ej: `192.168.1.100`).
- Acceso a Internet solo para la instalación (después funciona 100% en LAN; la única
  excepción es la primera carga de las librerías CDN del panel Admin — Chart.js y
  SheetJS — que el navegador cachea).
- Firewall: permitir el **puerto 3000** (o el configurado) en la red local.

---

## Paso 1 — Instalar PostgreSQL 16

1. Descargar el instalador oficial: `https://www.postgresql.org/download/windows/`.
2. Instalar con puerto por defecto (5432). Anotar la contraseña del usuario `postgres`.
   PostgreSQL queda corriendo como **servicio de Windows** (arranca solo).
3. Abrir **SQL Shell (psql)** y crear usuario y base de datos:

```sql
-- Conectado como postgres
CREATE USER turnero_user WITH PASSWORD 'PASSWORD_NUEVO_DE_PRODUCCION';
CREATE DATABASE turnero OWNER turnero_user;
GRANT ALL PRIVILEGES ON DATABASE turnero TO turnero_user;
\q
```

PostgreSQL escucha solo en `localhost` — **no abrirlo al exterior**.

> No hay que ejecutar `schema.sql` a mano: las migraciones son idempotentes y corren
> solas cada vez que la app arranca (`app/database/migrate.js`).

---

## Paso 2 — Instalar Node.js

1. Descargar Node.js **LTS** (`.msi`) desde `https://nodejs.org` e instalar con
   opciones por defecto.
2. Verificar: `node --version` y `npm --version`.

---

## Paso 3 — Copiar el proyecto e instalar dependencias

```powershell
# Copiar el repositorio a C:\turnero (git clone, ZIP o por red)
cd C:\turnero\app
npm install --omit=dev
```

Dependencias reales del proyecto: `express`, `socket.io`, `pg`, `dotenv`
(nada más; `nodemon` es solo de desarrollo).

---

## Paso 4 — Archivo `.env`

⚠️ En instalación nativa el `.env` va **dentro de `app\`** (junto a `server.js`),
porque la app lo busca en su directorio de trabajo. Usar `.env.example` como base:

```env
# PostgreSQL
DB_HOST=localhost
DB_PORT=5432
DB_NAME=turnero
DB_USER=turnero_user
DB_PASSWORD=PASSWORD_NUEVO_DE_PRODUCCION

# App
PORT=3000
NODE_ENV=production

# Seguridad — debe coincidir con config.js de las DOS extensiones (Sync e Injector)
EXTENSION_SECRET=CLAVE_NUEVA_ALEATORIA_DE_PRODUCCION
```

**Nunca** reutilizar las claves de desarrollo. La clave del panel Admin
(`clave_admin`) no vive en `.env`: se cambia desde **Admin → Configuración →
Parámetros del sistema** después del primer arranque.

---

## Paso 5 — Probar el arranque manual

```powershell
cd C:\turnero\app
node server.js
# [SERVER] Turnero corriendo en http://localhost:3000
```

Verificar `http://localhost:3000/health` → `{"ok":true,"db":true,...}` (503 = revisar
credenciales de BD). Detener con Ctrl+C y pasar al servicio.

---

## Paso 6 — Correr como servicio de Windows (NSSM)

1. Descargar NSSM (`https://nssm.cc`) y dejar `nssm.exe` en `C:\nssm\`.
2. Registrar el servicio:

```powershell
C:\nssm\nssm.exe install TurneroApp "C:\Program Files\nodejs\node.exe" "C:\turnero\app\server.js"
C:\nssm\nssm.exe set TurneroApp AppDirectory "C:\turnero\app"
C:\nssm\nssm.exe set TurneroApp AppStdout "C:\turnero\logs\turnero.log"
C:\nssm\nssm.exe set TurneroApp AppStderr "C:\turnero\logs\turnero-error.log"
C:\nssm\nssm.exe set TurneroApp AppRotateFiles 1
C:\nssm\nssm.exe start TurneroApp
```

El servicio arranca automáticamente con Windows. Comandos útiles:
`nssm restart TurneroApp` (tras actualizar código) · `nssm stop TurneroApp` ·
`Get-Content C:\turnero\logs\turnero.log -Tail 50 -Wait` (logs en vivo).

---

## Paso 7 — Firewall

```powershell
netsh advfirewall firewall add rule `
    name="Turnero CertiMedic" dir=in action=allow protocol=TCP localport=3000
```

---

## Paso 8 — Backup diario (Task Scheduler)

El repo incluye `scripts\backup-db.ps1` (dump comprimido, retención de 30 copias,
falla si el dump sale vacío). Programar en el **Programador de tareas**:

- Desencadenador: diario (ej. 8:00 PM).
- Acción: `powershell.exe -File C:\turnero\scripts\backup-db.ps1 -Modo nativo -Destino "D:\backups\turnero"`
- Ideal que el destino sea **otro disco** o una carpeta que se copie fuera del servidor.

Restaurar: `pg_restore -U turnero_user -d turnero --clean archivo.dump`

---

## Paso 9 — Extensiones de Chrome (PCs de admisiones)

Dos extensiones, ambas se cargan sin empaquetar (`chrome://extensions` → Modo
desarrollador → "Cargar extensión sin empaquetar"):

1. **Biofile-Sync** (`extension\Biofile-Sync\`): lee la tabla de asignaciones de
   Biofile y sincroniza con el turnero.
2. **Biofile-Injector** (`extension\Biofile-Injector\`): llena los campos de Biofile
   con los datos del paciente pendiente (reemplazó al antiguo "copiar/pegar").

En **cada una**, crear su `config.js` a partir de `config.example.js` con:
- `SERVER_URL`: `http://IP_DEL_SERVIDOR:3000`
- `EXTENSION_SECRET`: el mismo del `.env` del servidor (ambas lo necesitan; el
  endpoint de pendientes también está autenticado).

La sincronización corre sola con la pestaña de `AtencionesSeguimiento.aspx` abierta.

---

## Paso 10 — Pantallas TV

El display necesita **audio desbloqueado** (política de autoplay del navegador).

| Tipo de pantalla | Configuración |
|---|---|
| **PC → HDMI** | Acceso directo: `chrome.exe --kiosk --autoplay-policy=no-user-gesture-required "http://IP_SERVIDOR:3000/display"` → entra directo, sin gestos. Desactivar suspensión de pantalla y poner el acceso en el Inicio de Windows |
| **Android TV (recomendado)** | Instalar **Fully Kiosk Browser** con la URL del display; activar *Autoplay Audio* y *Launch on Boot* |
| **Android TV (navegador simple)** | Al encender aparece el overlay "Presione OK para iniciar": un OK del control desbloquea el audio todo el día |

Si una TV queda muda o desconectada, se ve en **Admin → Terminales → Pantallas**
(🟢/🔴 en línea, 🔊/🔇 audio).

---

## Checklist de puesta en producción

- [ ] `DB_PASSWORD`, `EXTENSION_SECRET` y `ADMIN_PASSWORD` nuevos en `app\.env`.
- [ ] `EXTENSION_SECRET` replicado en el `config.js` de **ambas** extensiones.
- [ ] `clave_admin` cambiada desde Admin → Configuración (default de fábrica: `2026`).
- [ ] Servicio `TurneroApp` arriba y arrancando con Windows.
- [ ] Backup diario programado y **probado** (generar uno y abrirlo con `pg_restore --list`).
- [ ] `http://IP:3000/health` → `{"ok":true,"db":true}` desde otro PC de la LAN.
- [ ] TVs configuradas y visibles en Admin → Terminales → Pantallas con 🔊.

---

## Resumen de URLs por módulo

| Módulo | URL |
|---|---|
| Menú principal | `http://IP_SERVIDOR:3000/` |
| Recepción | `http://IP_SERVIDOR:3000/recepcion` |
| Admisiones | `http://IP_SERVIDOR:3000/admisiones` |
| Profesional | `http://IP_SERVIDOR:3000/profesional` |
| Display TVs | `http://IP_SERVIDOR:3000/display` |
| Admin | `http://IP_SERVIDOR:3000/admin` |

Crear marcadores en Chrome de cada PC con la URL correspondiente.
