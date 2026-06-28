# 09 — Instalación y Arranque en Windows Server 2019

---

## Requisitos del servidor

- Windows Server 2019 (ya disponible)
- Acceso a Internet para instalar dependencias (o hacerlo offline con paquetes pre-descargados)
- La red local debe tener asignada una **IP fija** al servidor (ej: `192.168.10.200`)
- Firewall debe permitir el **puerto 3000** (o el que se configure) en la red local

---

## Paso 1 — Instalar Node.js

1. Descargar Node.js 20 LTS desde `https://nodejs.org` (archivo `.msi` para Windows).
2. Ejecutar el instalador con todas las opciones por defecto.
3. Verificar instalación:
   ```powershell
   node --version   # Debe mostrar v20.x.x
   npm --version    # Debe mostrar 10.x.x
   ```

---

## Paso 2 — Crear el proyecto

```powershell
# Crear directorio del proyecto
mkdir C:\turnero-certimedic
cd C:\turnero-certimedic

# Inicializar npm
npm init -y
```

---

## Paso 3 — Instalar PostgreSQL 16

1. Descargar el instalador de PostgreSQL 16 para Windows desde `https://www.postgresql.org/download/windows/`.
2. Ejecutar el instalador. Usar el puerto por defecto (5432) y anotar la contraseña del usuario `postgres`.
3. Al finalizar, abrir **SQL Shell (psql)** y crear el usuario y la base de datos del turnero:

```sql
-- Conectado como postgres
CREATE USER turnero_user WITH PASSWORD 'CambiarPorPasswordSeguro';
CREATE DATABASE turnero OWNER turnero_user;
GRANT ALL PRIVILEGES ON DATABASE turnero TO turnero_user;
\q
```

4. Verificar que PostgreSQL está escuchando en el puerto 5432:
```powershell
netstat -ano | findstr 5432
```

PostgreSQL corre solo en `localhost` — **no es necesario abrirlo al exterior**.

---

## Paso 4 — Instalar dependencias Node.js

```powershell
npm install express socket.io pg uuid dotenv node-cron
```

Descripción:
- `express`: Framework HTTP
- `socket.io`: WebSockets tiempo real
- `pg`: Driver de PostgreSQL para Node.js (node-postgres)
- `uuid`: Generación de UUIDs
- `dotenv`: Variables de entorno desde `.env`
- `node-cron`: Tarea programada para limpieza de datos históricos

---

## Paso 5 — Estructura de archivos

Crear la siguiente estructura en `C:\turnero-certimedic\`:

```
C:\turnero-certimedic\
├── server.js
├── .env
├── package.json
├── database\
│   ├── schema.sql
│   └── db.js
├── routes\
│   ├── api.recepcion.js
│   ├── api.admisiones.js
│   ├── api.profesional.js
│   ├── api.extension.js
│   └── api.admin.js
├── sockets\
│   └── events.js
└── public\
    ├── recepcion\
    │   └── index.html
    ├── admisiones\
    │   └── index.html
    ├── profesional\
    │   └── index.html
    ├── display\
    │   └── index.html
    ├── admin\
    │   └── index.html
    └── assets\
        ├── css\
        │   └── main.css
        └── js\
            ├── recepcion.js
            ├── admisiones.js
            ├── profesional.js
            └── display.js
```

---

## Paso 6 — Archivo `.env`

```env
PORT=3000
NODE_ENV=production
EXTENSION_SECRET=CambiarEstaPorUnaClaveSegura123!

# PostgreSQL
DB_HOST=localhost
DB_PORT=5432
DB_NAME=turnero
DB_USER=turnero_user
DB_PASSWORD=CambiarPorPasswordSeguro
```

**Importante:** El `EXTENSION_SECRET` debe ser el mismo valor que se coloca en el código de la extensión (`background.js`). Cambiarlo por una cadena aleatoria y segura antes de desplegar.

---

## Paso 7 — Configurar el Firewall de Windows

```powershell
# Abrir el puerto 3000 para la red local
netsh advfirewall firewall add rule `
    name="Turnero CertiMedic" `
    dir=in `
    action=allow `
    protocol=TCP `
    localport=3000
```

---

## Paso 8 — Instalar PM2 (para que el servidor corra como servicio)

```powershell
npm install -g pm2
npm install -g pm2-windows-startup

# Arrancar el servidor
pm2 start C:\turnero-certimedic\server.js --name turnero

# Configurar PM2 para que inicie con Windows
pm2-startup install
pm2 save
```

Después de esto, el servidor se iniciará automáticamente cuando Windows arranque.

---

## Paso 9 — Verificar que el servidor funciona

```powershell
# Ver logs en tiempo real
pm2 logs turnero

# Estado del proceso
pm2 status

# En el navegador del mismo servidor:
# http://localhost:3000/recepcion   → Debe cargar la vista de recepción
# http://localhost:3000/display     → Debe cargar la pantalla de TVs
```

Desde otro PC en la misma red:
```
http://192.168.1.100:3000/admisiones
```
(Reemplazar `192.168.1.100` con la IP real del servidor.)

---

## Paso 10 — Configurar el PC de las TVs

1. Instalar Chrome o Edge en el PC conectado a las TVs.
2. Crear un acceso directo en el Escritorio con el comando:
   ```
   "C:\Program Files\Google\Chrome\Application\chrome.exe" --kiosk --no-first-run "http://localhost:3000/display"
   ```
   (Si el PC de TVs es el mismo servidor, usar `localhost`. Si es otro PC, usar la IP.)
3. Desactivar el salvapantallas: Configuración → Sistema → Pantalla → Suspensión = Nunca.
4. Configurar para que Chrome abra automáticamente al inicio de Windows (Task Scheduler o Inicio de Windows).

---

## Paso 11 — Instalar la extensión en cada PC de admisiones

1. Copiar la carpeta `extension\` al PC de admisiones (por red, USB, etc.).
2. Abrir Chrome/Edge → Extensiones (`chrome://extensions`) → Activar Modo Desarrollador.
3. "Cargar extensión sin empaquetar" → Seleccionar la carpeta `extension\`.
4. Hacer clic en el ícono de la extensión → Configurar URL del servidor: `http://192.168.1.100:3000`.
5. Abrir Biofile en otra pestaña y navegar a `AtencionesSeguimiento.aspx`.
6. La extensión sincronizará automáticamente cada 60 segundos.

---

## Comandos útiles de mantenimiento

```powershell
# Ver logs del servidor
pm2 logs turnero --lines 100

# Reiniciar el servidor (después de actualizar código)
pm2 restart turnero

# Detener el servidor
pm2 stop turnero

# Hacer backup de la base de datos PostgreSQL
# Requiere que pg_dump esté en el PATH (se instala con PostgreSQL)
pg_dump -U turnero_user -F c turnero > C:\backups\turnero_%date:~-4,4%%date:~-7,2%%date:~-10,2%.dump

# Restaurar desde backup
pg_restore -U turnero_user -d turnero C:\backups\turnero_20260608.dump

# Conectarse a la base de datos para inspeccionar directamente
# Usar pgAdmin (instalado con PostgreSQL) o ejecutar:
psql -U turnero_user -d turnero
```

---

## Limpieza automática de datos históricos

La limpieza automática ya está incluida en `database/db.js` (ver plan `02_BASE_DE_DATOS.md`). Se activa automáticamente con el servidor.

La implementación usa `node-cron` + PostgreSQL:

```javascript
// Corre cada día a las 2:00 AM
// El historial de pacientes y asignaciones se conserva de forma indefinida
// Eventos de log: retiene siempre 30 días
```

---

## Red local — IP recomendada

Asignar una IP estática al servidor Windows en el router o directamente en la configuración de red de Windows:
- IP: `192.168.1.100` (o la que corresponda a la red de CertiMedic)
- Máscara: `255.255.255.0`
- Gateway: `192.168.1.1` (o el del router)
- DNS: `8.8.8.8`

Así todos los terminales siempre acceden a la misma IP y no hay problemas si el servidor se reinicia.

---

## Resumen de URLs por módulo

| Módulo | URL |
|---|---|
| Recepción | `http://192.168.1.100:3000/recepcion` |
| Admisiones | `http://192.168.1.100:3000/admisiones` |
| Profesional | `http://192.168.1.100:3000/profesional` |
| Display TVs | `http://192.168.1.100:3000/display` |
| Admin | `http://192.168.1.100:3000/admin` |

Crear marcadores (favoritos) en Chrome de cada PC con la URL correspondiente, y configurar Chrome para que abra automáticamente en ese marcador.
