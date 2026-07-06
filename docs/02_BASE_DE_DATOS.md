# 02 — Base de Datos (PostgreSQL)

> Última actualización: 2026-07-05
>
> **Fuente de verdad: `app/database/schema.sql`.** Este documento describe el esquema
> y sus reglas; ante cualquier diferencia, manda el archivo SQL.

Motor: **PostgreSQL 16** · Driver: `pg` (node-postgres) · Pool: `pg.Pool` (máx. 10)

Detalle clave del pool (`app/database/db.js`): cada conexión fija
`options: '-c timezone=America/Bogota'`, lo que garantiza que `CURRENT_DATE` sea el
día real en Bogotá (sin corrimiento después de las 7 PM) y que los timestamps "naive"
de Biofile se interpreten como hora local. El proceso Node también fija
`process.env.TZ = 'America/Bogota'` en `server.js`.

---

## Modelo de migraciones

`app/database/migrate.js` ejecuta **todo** `schema.sql` en cada arranque del servidor.
El esquema es 100% idempotente: `CREATE TABLE IF NOT EXISTS`, `ADD COLUMN IF NOT
EXISTS`, y los CHECK que evolucionan se recrean con `DROP CONSTRAINT IF EXISTS` +
`ADD CONSTRAINT`. **Actualizar el esquema = actualizar el código y reiniciar el
proceso** (en Docker: `docker compose restart app`).

---

## Tablas

### 1. `pacientes_cola` — pacientes registrados por recepción

Columnas principales: identificación (número/tipo, nombres, apellidos, ciudad de
expedición, fecha de nacimiento, sexo M/F), `prioridad` (`alta|media|normal`),
`terminal_recepcion_id` (UUID), y `UNIQUE (fecha, numero_identificacion)` (un registro
por cédula por día).

**Máquina de estados de admisión (flujo de 2 tiempos):**

```
esperando → llamando_admision → admisionando → admisionado
                    ↺ (devolver: vuelve a esperando)
```

**Tiempos:**

| Columna | Momento | Quién la escribe |
|---|---|---|
| `hora_llegada` (T1) | Escaneo en recepción | Registro |
| `hora_llamado_admision` (T2a) | Botón **Admisionando** — inicio real del trámite | Admisiones |
| `hora_admision` (T2) | Cierre de la admisión | **Biofile es autoritativo**: el sync de la extensión la sobrescribe con `MIN(hora_llegada_biofile)` de sus asignaciones. Sin cruce (particular), queda la del botón **Finalizar** (`COALESCE`) |

Los KPIs derivan de aquí: *Espera admisión* = T2a − T1 (experiencia del paciente) y
*Registro* = T2 − T2a (demora del trámite en Biofile).

### 2. `asignaciones_profesionales` — asignaciones de Biofile (y manuales)

Un registro por `(fecha, numero_identificacion, columna_header)` — es decir, por
paciente × profesional × día. Columnas clave:

- `nombre_profesional`, `area`, `columna_header` (encabezado crudo de Biofile),
  `nombre_paciente` (para pacientes sin registro en recepción),
  `consultorio_profesional` (nombre del catálogo, se fija al Llamar).
- Estados: `pendiente → llamando → en_atencion → finalizado`, más `cancelado`.
- Tiempos: `hora_llegada_biofile` (T2 crudo del LIS), `hora_llamado` (T3),
  `hora_en_atencion` (T4), `hora_finalizado` (T5).
- **State reconciliation** con el LIS:
  - `activo` — false = dada de baja (no se borran filas).
  - `manual_override` — un humano la gestionó; el sync **no** la revive ni la cancela.
  - `origen_baja` — `'lis'` (reconciliación) | `'manual'`.
  - `origen` — `'biofile'` | `'manual'` (las manuales/particulares nunca están en el
    snapshot del LIS y la reconciliación las ignora siempre).
- `paciente_cola_id UUID REFERENCES pacientes_cola(id) ON DELETE CASCADE`.

### 3. `consultorios` — catálogo administrable (Admin → Configuración)

```sql
id UUID PK · nombre VARCHAR(60) UNIQUE · multipaciente BOOLEAN · activo BOOLEAN
```

`nombre` es el texto COMPLETO que ve el paciente en pantalla ("Consultorio 1",
"Toma de Muestras"). `multipaciente = true` permite que el profesional en ese
consultorio llame a **varios pacientes a la vez** (el guard de paciente-activo se
omite). Baja lógica con `activo = false`; sin DELETE.

### 4. `eventos_log` — auditoría

```sql
id UUID PK · fecha DATE · timestamp TIMESTAMPTZ · tipo VARCHAR(50) ·
descripcion TEXT · paciente_id UUID REFERENCES pacientes_cola ON DELETE SET NULL ·
terminal_id UUID · datos JSONB
```

Se escribe vía `app/utils/audit.js` (`registrarEvento`, fire-and-forget: nunca
bloquea ni rompe la respuesta). Tipos actuales:

`paciente_registrado` · `paciente_editado` · `prioridad_cambiada` ·
`paciente_eliminado` · `admision_llamado` · `admision_admisionando` ·
`admision_finalizada` · `admision_devuelta` · `asignacion_manual` · `prof_llamado` ·
`prof_en_atencion` · `prof_finalizado` · `prof_llamado_cancelado` ·
`prof_reasignado` · `asignacion_cancelada` · `admin_login` ·
`admin_login_bloqueado` · `config_cambiada` · `sync_reconciliacion`

Se consulta desde **Admin → Configuración → Eventos** (`GET /api/admin/eventos-log`).

### 5. `terminales` — terminales conectadas

```sql
id UUID PK (generado y persistido en el navegador) ·
tipo CHECK IN ('recepcion','admisiones','profesional','display','admin') ·
consultorio_numero VARCHAR(60) · login_name_biofile · ip_address ·
audio_ok BOOLEAN · ultimo_heartbeat TIMESTAMPTZ
```

Se upserta en el `join` del socket y se refresca con `heartbeat` cada 30 s. El
display reporta `audio_ok` (¿el AudioContext está desbloqueado?) — alimenta el
monitoreo de **Admin → Terminales → Pantallas** (en línea = heartbeat < 90 s).

### 6. `configuracion` — parámetros clave-valor

| Clave | Uso |
|---|---|
| `cantidad_modulos_admisiones` | N módulos "Módulo 1..N" del setup de admisiones |
| `clave_admin` | Clave del panel Admin (default de fábrica `2026` — **cambiar**) |
| `sonido_habilitado` | Timbres del display on/off |
| `duracion_anuncio_seg` | Duración de cada anuncio en TV (clamp 4–30, default 8) |
| `intervalo_extension_seg` | Cadencia sugerida de sync de la extensión |
| `titulo_sufijo`, `display_logo` | Branding (título y logo en data-URL) |
| `version_db` | Versión del esquema |

---

## Índices

Los del `schema.sql`: por fecha/cédula/estado en ambas tablas grandes, por
profesional, por tipo/fecha de eventos, y el parcial de reconciliación
`idx_asig_login_fecha ON asignaciones_profesionales(fecha, login_name_biofile)
WHERE activo = true`.

---

## Concurrencia

- **Guards por estado**: toda transición usa `UPDATE ... WHERE estado = 'X'` y trata
  `rowCount = 0` como conflicto (409).
- **Llamado de profesional**: serializado con
  `pg_advisory_xact_lock(hashtext('profesional:llamar'))` — el `NOT EXISTS` embebido
  no basta bajo READ COMMITTED (write-skew entre filas distintas, verificado).
- **Sync de la extensión**: transacción por paciente + `FOR UPDATE` del scope
  (fecha, login) durante la reconciliación.

---

## Consultas de reportes

Las consultas reales viven en `app/routes/api.admin.js` (`/dashboard`, `/graficas`,
`/reporte-detallado` — ahora por rango `desde/hasta` con tope de 31 días — y
`/reporte-rango`). Patrón general:

```sql
-- Espera real del paciente y demora del registro (KPIs partidos)
ROUND(AVG(EXTRACT(EPOCH FROM (hora_llamado_admision - hora_llegada))/60))
    FILTER (WHERE hora_llamado_admision IS NOT NULL)              AS avg_min_espera_admision,
ROUND(AVG(EXTRACT(EPOCH FROM (hora_admision - hora_llamado_admision))/60))
    FILTER (WHERE hora_admision IS NOT NULL
        AND hora_llamado_admision IS NOT NULL)                    AS avg_min_registro
```

---

## Retención y backups

- El historial (pacientes, asignaciones, eventos) se **conserva indefinidamente**;
  no hay limpieza automática. Las tablas son livianas a escala de clínica y todos
  los reportes filtran por fecha con índice.
- Backup diario: `scripts/backup-db.sh` (Mac/Linux) o `scripts/backup-db.ps1`
  (Windows, Task Scheduler) — `pg_dump --format=custom`, retención de 30 copias.
  Restaurar: `pg_restore -U turnero_user -d turnero --clean archivo.dump`.

## Paquetes npm del backend

```bash
express · socket.io · pg · dotenv        (producción)
nodemon                                   (solo desarrollo)
```
