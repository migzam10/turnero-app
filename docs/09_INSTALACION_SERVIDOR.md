# 09 — Instalación (guía única y completa)

> Última actualización: 2026-07-08
>
> Guía de punta a punta: **desarrollo con Docker**, **producción en Windows Server**
> (nativo, con NSSM), **voz por TTS** (edición Plus), **extensiones de Chrome** y
> **pantallas TV**. Esta es la única guía de instalación del proyecto.

Las migraciones (`app/database/schema.sql`) son **idempotentes** y corren solas al
arrancar la app (`app/database/migrate.js`): nunca hay que ejecutar SQL a mano.

---

## Parte 0 — Panorama: qué se instala y dónde

| Pieza | Dónde va | Cómo |
|---|---|---|
| **Servidor** (app Node + PostgreSQL) | 1 servidor/PC en la LAN | Docker (dev) o nativo Windows (prod) |
| **Extensión Biofile** | En cada PC de **admisiones** que abre Biofile | Cargar sin empaquetar, o forzada por política (ver Parte D) |
| **Pantallas TV** | Cada TV de sala | Navegador apuntando a `/display` (ver Parte E) |
| **Voz TTS** (opcional, edición Plus) | En el servidor | Motor de voz + config (ver Parte C) |

El servidor sirve TODO por HTTP en el puerto **3000**. Los demás equipos solo abren
una URL en el navegador. Todo funciona en la LAN, sin internet (salvo la instalación).

---

## Parte A — Desarrollo (Docker · Mac/Linux)

```bash
cp .env.example .env          # completar credenciales locales
docker compose up -d          # levanta db (turnero_db) + app (turnero_app)
```

- El `.env` de desarrollo va en la **raíz del repo** (lo lee `docker-compose.yml`).
- Las migraciones corren al iniciar/reiniciar la app. Tras editar el schema:
  `docker compose restart app`.
- Si editas `.env`, un `restart` no relee las variables: `docker compose up -d --force-recreate app`.
- Salud: `curl http://localhost:3000/health` → `{ ok: true, db: true }`.
- La imagen base es `node:20-slim` (Debian/glibc) y trae `espeak-ng`, así que la voz
  TTS funciona en dev sin pasos extra (motor `espeak`; ver Parte C para la voz buena).

---

## Parte B — Producción (Windows Server 2019 · nativo)

Se usa instalación **nativa** (no Docker): el soporte de contenedores Linux en WS2019 es
frágil para producción. La app corre como **servicio de Windows con NSSM**.

### Requisitos
- Windows Server 2019 con **IP fija** en la LAN (ej: `192.168.1.100`).
- Internet solo durante la instalación (después, 100% LAN).
- Firewall: permitir el **puerto 3000**.

### Paso 1 — PostgreSQL 16
1. Instalador oficial: `https://www.postgresql.org/download/windows/` (puerto 5432,
   anotar la contraseña de `postgres`). Queda como servicio de Windows (arranca solo).
2. En **SQL Shell (psql)** crear usuario y base:
   ```sql
   CREATE USER turnero_user WITH PASSWORD 'PASSWORD_NUEVO_DE_PRODUCCION';
   CREATE DATABASE turnero OWNER turnero_user;
   GRANT ALL PRIVILEGES ON DATABASE turnero TO turnero_user;
   \q
   ```
   PostgreSQL escucha solo en `localhost` — **no abrirlo al exterior**.

### Paso 2 — Node.js
Instalar Node.js **LTS** (`.msi`) desde `https://nodejs.org`. Verificar:
`node --version` y `npm --version`.

### Paso 3 — Copiar el proyecto e instalar dependencias
```powershell
# Copiar el repo a C:\turnero (git clone, ZIP o por red)
cd C:\turnero\app
npm install --omit=dev
```
Dependencias reales: `express`, `socket.io`, `pg`, `dotenv`.

### Paso 4 — Archivo `.env`
⚠️ En instalación nativa el `.env` va **dentro de `app\`** (junto a `server.js`), porque
la app lo busca en su directorio de trabajo (NSSM fija `AppDirectory=C:\turnero\app`).
Base en `.env.example`:
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

# Seguridad — debe coincidir con el config.js de las DOS extensiones
EXTENSION_SECRET=CLAVE_NUEVA_ALEATORIA_DE_PRODUCCION

# Edición (licencia): basica = solo sonido | plus = sonido + voz TTS.
# Si se omite, se asume 'basica'. Para vender la voz, poner 'plus' y ver Parte C.
EDICION=basica
```
**Nunca** reutilizar las claves de desarrollo. La clave del panel Admin (`clave_admin`)
NO va en `.env`: se cambia desde **Admin → Configuración** tras el primer arranque
(default de fábrica: `2026`).

### Paso 5 — Probar el arranque manual
```powershell
cd C:\turnero\app
node server.js
```
Verificar `http://localhost:3000/health` → `{"ok":true,"db":true}` (503 = revisar
credenciales de BD). Detener con Ctrl+C y pasar al servicio.

### Paso 6 — Servicio de Windows (NSSM)
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
   Arranca automáticamente con Windows. Útiles: `nssm restart TurneroApp` (tras
   actualizar código) · `nssm stop TurneroApp` ·
   `Get-Content C:\turnero\logs\turnero.log -Tail 50 -Wait` (logs en vivo).

### Paso 7 — Firewall
```powershell
netsh advfirewall firewall add rule name="Turnero 3000" dir=in action=allow protocol=TCP localport=3000
```

### Paso 8 — Backup diario (Task Scheduler)
El repo incluye `scripts\backup-db.ps1` (dump comprimido, retiene 30 copias, falla si el
dump sale vacío). Programar en el Programador de tareas:
- Desencadenador: diario (ej. 8:00 PM).
- Acción: `powershell.exe -File C:\turnero\scripts\backup-db.ps1 -Modo nativo -Destino "D:\backups\turnero"`
- Ideal que el destino sea **otro disco** o se copie fuera del servidor.

Restaurar: `pg_restore -U turnero_user -d turnero --clean archivo.dump`

---

## Parte C — Voz por TTS (edición Plus · opcional)

El sistema puede **anunciar el nombre por voz** además del timbre. El servidor genera el
WAV del nombre (`GET /api/tts?texto=…`), lo cachea en `vendor/tts-cache/`, y la TV solo lo
reproduce (así suena igual en cualquier pantalla). En **Admin → Configuración → Parámetros
del sistema** se enciende con el interruptor `voz_habilitada` (botón **Probar** para
escucharla) y la frase se define en `voz_plantilla` (tokens `{nombre}` y `{destino}`).

> **Edición básica** (`EDICION=basica`) = solo timbre → no configurar nada de esta parte;
> los parámetros de voz ni aparecen en Admin.
> **Edición Plus** (`EDICION=plus` en el `.env`) = timbre + voz → configurar el motor abajo.
> Sin `EDICION=plus`, `/api/tts` responde 403 aunque piper esté instalado (candado de licencia).

**Motor de voz** (variable `TTS_ENGINE`), intercambiable:

| Motor | Uso | Notas |
|---|---|---|
| `espeak` | Dev/Docker | Voz robótica, sin descargas (ya viene en la imagen) |
| `piper` | **Recomendado** (Docker y Windows) | Voz neuronal; requiere bajar binario + modelo |
| `sapi` | Windows sin descargas | Voces del SO (`VOZ_SAPI=Microsoft Sabina Desktop`) |

**Instalar piper** (misma voz en Docker y Windows):
- Windows: `powershell .\scripts\setup-tts.ps1`
- Docker/Linux: `docker compose exec app bash scripts/setup-tts.sh`

Sin argumentos baja el binario + el modelo por defecto `es_ES-sharvard-medium` (voz
femenina = `PIPER_SPEAKER=1`). Para elegir otra voz en español, pasa su id como argumento
(`... setup-tts.ps1 es_AR-daniela-high`); `... setup-tts.ps1 list` muestra el catálogo
(España/México/Argentina). El script imprime las rutas para el `.env`:
```env
EDICION=plus              # imprescindible: habilita la voz (candado de licencia)
TTS_ENGINE=piper
PIPER_BIN=.../vendor/tts/piper/piper
PIPER_MODEL=.../vendor/tts/models/es_ES-sharvard-medium.onnx
PIPER_SPEAKER=1            # SOLO para sharvard (tiene 2 voces); quitar en las demás
PIPER_LENGTH_SCALE=1.25    # ritmo (mayor = más lento)
PIPER_SENTENCE_SILENCE=0.4
```
`vendor/tts/` y `vendor/tts-cache/` están en `.gitignore` (cada entorno corre su setup).

Prueba rápida: `curl -s 'http://localhost:3000/api/tts?texto=Hola' -o a.wav && file a.wav`

---

## Parte D — Extensiones de Chrome (PCs de admisiones)

Dos extensiones (van en los PCs que abren Biofile, **no** en el servidor):
1. **Biofile-Sync** (`extension\Biofile-Sync\`): lee la tabla de asignaciones de Biofile
   y sincroniza con el turnero.
2. **Biofile-Injector** (`extension\Biofile-Injector\`): llena los campos de Biofile con
   los datos del paciente pendiente.

> **Funciona con cualquier IPS que use Biofile.** Las extensiones usan el comodín
> `*.biofile.com.co`, así que **no hay que cambiar el subdominio** por cliente.

En **cada una**, crear su `config.js` a partir de `config.example.js`:
- `SERVER_URL`: `http://IP_DEL_SERVIDOR:3000`
- `EXTENSION_SECRET`: el mismo del `.env` del servidor (ambas lo necesitan).

**Dos formas de instalarlas:**
- **Manual** (rápida, para probar o pocos PCs): `chrome://extensions` → Modo desarrollador
  → "Cargar extensión sin empaquetar" → elegir la carpeta de cada extensión.
- **Forzada por política de Windows** (recomendada en producción): queda fija, se reinstala
  sola y se actualiza desde el servidor. Ver la carpeta **`extension-deploy/`** y su LEEME.

La sincronización corre sola con la pestaña de `AtencionesSeguimiento.aspx` abierta.

---

## Parte E — Pantallas TV

El display necesita **audio desbloqueado** (política de autoplay del navegador).

| Tipo de pantalla | Configuración |
|---|---|
| **PC → HDMI** | Acceso directo: `chrome.exe --kiosk --autoplay-policy=no-user-gesture-required "http://IP_SERVIDOR:3000/display"` → entra directo. Desactivar suspensión de pantalla y poner el acceso en el Inicio de Windows |
| **Android TV (recomendado)** | **Fully Kiosk Browser** con la URL del display; activar *Autoplay Audio* y *Launch on Boot* |
| **Android TV (navegador simple)** | Al encender aparece "Presione OK para iniciar": un OK del control desbloquea el audio todo el día |

Si una TV queda muda o desconectada, se ve en **Admin → Terminales → Pantallas**
(🟢/🔴 en línea, 🔊/🔇 audio).

---

## Checklist de puesta en producción

- [ ] `DB_PASSWORD` y `EXTENSION_SECRET` nuevos en `app\.env`.
- [ ] `EXTENSION_SECRET` replicado en el `config.js` de **ambas** extensiones.
- [ ] `clave_admin` cambiada desde Admin → Configuración (default: `2026`).
- [ ] Nombre de la clínica puesto en Admin → Configuración (campo del título).
- [ ] Servicio `TurneroApp` arriba y arrancando con Windows.
- [ ] Backup diario programado y **probado** (`pg_restore --list` sobre un dump).
- [ ] `http://IP:3000/health` → `{"ok":true,"db":true}` desde otro PC de la LAN.
- [ ] TVs configuradas y visibles en Admin → Terminales → Pantallas con 🔊.
- [ ] (Plus) Voz TTS configurada y probada, o (Básica) sin voz.

---

## URLs por módulo

| Módulo | URL |
|---|---|
| Menú principal | `http://IP_SERVIDOR:3000/` |
| Recepción | `http://IP_SERVIDOR:3000/recepcion` |
| Admisiones | `http://IP_SERVIDOR:3000/admisiones` |
| Profesional | `http://IP_SERVIDOR:3000/profesional` |
| Display TVs | `http://IP_SERVIDOR:3000/display` |
| Admin | `http://IP_SERVIDOR:3000/admin` |

Crear marcadores en Chrome de cada PC con la URL correspondiente.
