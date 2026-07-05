# Despliegue — Turnero CertiMedic

Node/Express + PostgreSQL 16 + Socket.io. Las migraciones (`app/database/schema.sql`)
son idempotentes y corren solas al arrancar la app (`app/database/migrate.js`).

---

## Desarrollo (Mac)

```bash
cp .env.example .env          # completar credenciales locales
docker compose up -d          # levanta db (turnero_db) + app (turnero_app)
```

- Las migraciones se ejecutan al iniciar/reiniciar la app; para forzar una nueva
  corrida tras editar el schema: `docker compose restart app`.
- Si editas `.env`, el contenedor no relee las variables con un simple restart:
  `docker compose up -d --force-recreate app`.
- Salud: `curl http://localhost:3000/health` → `{ ok: true, db: true }`.

---

## Producción (Windows Server 2019)

Dos opciones. **Se recomienda la instalación nativa**: el soporte de contenedores
Linux en WS2019 (Docker Desktop/WSL2) es limitado y frágil para producción.

### Opción recomendada — nativa

1. **PostgreSQL 16**: instalador oficial (corre como servicio de Windows). Crear la BD
   y el usuario `turnero_user` con una contraseña NUEVA (no la de desarrollo).
2. **Node.js LTS**: instalador oficial.
3. **App como servicio con NSSM**:
   ```
   nssm install TurneroApp "C:\Program Files\nodejs\node.exe" "C:\ruta\turnero\app\server.js"
   nssm set TurneroApp AppDirectory "C:\ruta\turnero\app"
   nssm start TurneroApp
   ```
4. **`.env`** (en la raíz del proyecto, junto a `.env.example`):
   - `NODE_ENV=production`
   - `DB_HOST=localhost`
   - `DB_PASSWORD`, `EXTENSION_SECRET`, `ADMIN_PASSWORD` → claves NUEVAS.
5. **Backup diario**: programar en Task Scheduler
   ```
   pwsh -File C:\ruta\turnero\scripts\backup-db.ps1 -Modo nativo
   ```

### Opción Docker (no recomendada en WS2019)

Requiere Docker Desktop/WSL2. Si se usa, agregar rotación de logs en
`docker-compose.yml` a **ambos** servicios (`db` y `app`):

```yaml
    logging:
      driver: json-file
      options:
        max-size: "10m"
        max-file: "3"
```

Backup en Task Scheduler con el modo por defecto:
`pwsh -File C:\ruta\turnero\scripts\backup-db.ps1` (usa el contenedor `turnero_db`).

---

## Checklist de producción

- [ ] Cambiar `EXTENSION_SECRET` (backend `.env` **y** `config.js` de las extensiones).
- [ ] Cambiar `DB_PASSWORD` y `ADMIN_PASSWORD` en `.env`.
- [ ] Cambiar la `clave_admin` desde el panel **Admin > Configuración** (no queda en `.env`).
- [ ] Programar el backup diario (`backup-db.ps1`) en Task Scheduler.
- [ ] Verificar `/health` → 200 tras el arranque.

---

## TVs (pantallas de sala)

- **PC / HDMI**: Chrome en modo kiosco con autoplay de audio habilitado:
  ```
  chrome --kiosk --autoplay-policy=no-user-gesture-required http://SERVIDOR:3000/display
  ```
- **Android TV**: **Fully Kiosk Browser** — habilitar *autoplay audio* y *launch on boot*.

> El display necesita el audio desbloqueado para los timbres; sin el flag de autoplay
> (o sin la interacción inicial) el navegador silencia el sonido.
