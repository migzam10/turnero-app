# 02 — Base de Datos (PostgreSQL)

Motor: **PostgreSQL 16**  
Driver Node.js: `pg` (node-postgres)  
Pool de conexiones: `pg.Pool` (reutiliza conexiones entre requests)

---

## Esquema completo (`database/schema.sql`)

```sql
-- ============================================================
-- Tabla 1: pacientes_cola
-- Pacientes registrados por recepción (escaneando la cédula).
-- ============================================================
CREATE TABLE IF NOT EXISTS pacientes_cola (
    id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    fecha                   DATE NOT NULL DEFAULT CURRENT_DATE,
    numero_identificacion   VARCHAR(50) NOT NULL,
    primer_apellido         VARCHAR(100) NOT NULL,
    segundo_apellido        VARCHAR(100),
    primer_nombre           VARCHAR(100) NOT NULL,
    segundo_nombre          VARCHAR(100),
    fecha_nacimiento        VARCHAR(20),            -- 'DD/MM/YYYY' como viene del escáner
    ciudad_nacimiento       VARCHAR(150),
    genero                  CHAR(1),                -- 'M' o 'F'
    hora_llegada            TIMESTAMPTZ NOT NULL DEFAULT NOW(),  -- T1
    prioridad               VARCHAR(10) NOT NULL DEFAULT 'normal'
                                CHECK (prioridad IN ('normal','media','alta')),
    estado_admision         VARCHAR(25) NOT NULL DEFAULT 'esperando'
                                CHECK (estado_admision IN ('esperando','llamando_admision','admisionado')),
    hora_llamado_admision   TIMESTAMPTZ,
    hora_admision           TIMESTAMPTZ,            -- T2: cuando fue ingresado a Biofile
    modulo_admision         VARCHAR(50),
    terminal_recepcion      VARCHAR(100),
    notas                   TEXT,
    created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (fecha, numero_identificacion)
);

CREATE INDEX IF NOT EXISTS idx_cola_fecha        ON pacientes_cola(fecha);
CREATE INDEX IF NOT EXISTS idx_cola_cedula       ON pacientes_cola(numero_identificacion);
CREATE INDEX IF NOT EXISTS idx_cola_estado       ON pacientes_cola(estado_admision);


-- ============================================================
-- Tabla 2: asignaciones_profesionales
-- Asignaciones que llegan desde Biofile vía extensión.
-- Un registro por (paciente × profesional) por día.
-- ============================================================
CREATE TABLE IF NOT EXISTS asignaciones_profesionales (
    id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    fecha                   DATE NOT NULL DEFAULT CURRENT_DATE,
    numero_identificacion   VARCHAR(50) NOT NULL,
    nombre_paciente         VARCHAR(200) NOT NULL,
    nombre_profesional      VARCHAR(150) NOT NULL,
    area                    VARCHAR(100) NOT NULL,
    columna_header          VARCHAR(200) NOT NULL,  -- 'KENDY ZABALETA(OPTOMETRIA)' raw de Biofile
    hora_llegada_biofile    VARCHAR(50),            -- 'Jun 5 2026 7:08AM' — referencia visual
    estado                  VARCHAR(20) NOT NULL DEFAULT 'pendiente'
                                CHECK (estado IN ('pendiente','llamando','en_atencion','finalizado')),
    consultorio_numero      VARCHAR(50),
    hora_llamado            TIMESTAMPTZ,            -- T3: profesional presiona "Llamar"
    hora_en_atencion        TIMESTAMPTZ,            -- T4: profesional presiona "En Atención"
    hora_finalizado         TIMESTAMPTZ,            -- T5: profesional presiona "Finalizado"
    paciente_cola_id        UUID REFERENCES pacientes_cola(id) ON DELETE SET NULL,
    terminal_profesional    VARCHAR(100),
    created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (fecha, numero_identificacion, columna_header)
);

CREATE INDEX IF NOT EXISTS idx_asig_fecha        ON asignaciones_profesionales(fecha);
CREATE INDEX IF NOT EXISTS idx_asig_cedula       ON asignaciones_profesionales(numero_identificacion);
CREATE INDEX IF NOT EXISTS idx_asig_profesional  ON asignaciones_profesionales(nombre_profesional, fecha);
CREATE INDEX IF NOT EXISTS idx_asig_estado       ON asignaciones_profesionales(estado);


-- ============================================================
-- Tabla 3: eventos_log
-- Log inmutable de todos los cambios de estado.
-- Nunca se actualiza ni elimina (fuente de verdad para reportes).
-- ============================================================
CREATE TABLE IF NOT EXISTS eventos_log (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    timestamp           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    tipo_evento         VARCHAR(50) NOT NULL,
    paciente_cedula     VARCHAR(50),
    paciente_nombre     VARCHAR(200),
    profesional_nombre  VARCHAR(150),
    area                VARCHAR(100),
    modulo_admision     VARCHAR(50),
    consultorio_numero  VARCHAR(50),
    prioridad           VARCHAR(10),
    terminal_id         VARCHAR(100),
    datos_extra         JSONB
);

-- Tipos de evento:
-- 'paciente_registrado'       → recepción escanea la cédula
-- 'prioridad_cambiada'        → cambio de prioridad (quién y a qué valor)
-- 'paciente_llamado_admision' → admisiones llama al paciente
-- 'paciente_admisionado'      → confirmado en Biofile
-- 'asignacion_recibida'       → extensión envía nueva asignación de Biofile
-- 'profesional_llamando'      → profesional presiona Llamar  (T3)
-- 'profesional_en_atencion'   → profesional presiona En Atención (T4)
-- 'profesional_finalizado'    → profesional presiona Finalizado (T5)
-- 'extension_sync'            → heartbeat de la extensión

CREATE INDEX IF NOT EXISTS idx_log_timestamp ON eventos_log(timestamp);
CREATE INDEX IF NOT EXISTS idx_log_tipo      ON eventos_log(tipo_evento);
CREATE INDEX IF NOT EXISTS idx_log_cedula    ON eventos_log(paciente_cedula);


-- ============================================================
-- Tabla 4: terminales
-- Registro de terminales conectados.
-- ============================================================
CREATE TABLE IF NOT EXISTS terminales (
    id                  VARCHAR(100) PRIMARY KEY,   -- UUID generado en el browser
    nombre_descriptivo  VARCHAR(150),
    tipo                VARCHAR(20) NOT NULL
                            CHECK (tipo IN ('recepcion','admisiones','profesional','display')),
    consultorio_numero  VARCHAR(50),
    login_name_biofile  VARCHAR(150),
    ip_address          VARCHAR(45),
    ultimo_heartbeat    TIMESTAMPTZ,
    activo              BOOLEAN NOT NULL DEFAULT TRUE,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);


-- ============================================================
-- Tabla 5: configuracion
-- Parámetros del sistema (clave-valor).
-- ============================================================
CREATE TABLE IF NOT EXISTS configuracion (
    clave       VARCHAR(100) PRIMARY KEY,
    valor       TEXT NOT NULL,
    descripcion TEXT,
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO configuracion (clave, valor, descripcion) VALUES
    ('modulos_admisiones',      '["Módulo 1","Módulo 2","Módulo 3"]',
                                 'Lista de módulos de admisiones (JSON array)'),
    ('sonido_habilitado',       'true',
                                 'Habilitar sonido en las pantallas de TV'),
    ('intervalo_extension_seg', '60',
                                 'Cada cuántos segundos la extensión sincroniza con Biofile'),
    ('dias_retener_datos',      '7',
                                 'Días que se conservan datos operativos'),
    ('version_db',              '1',
                                 'Versión del esquema')
ON CONFLICT (clave) DO NOTHING;
```

---

## Consultas de reportes de tiempos (por qué PostgreSQL)

Estas consultas usan funciones nativas de PostgreSQL. En SQLite serían hacks con `strftime`.

### Tiempo de espera por paciente (T1 → T3 primer llamado)

```sql
SELECT
    pc.numero_identificacion,
    pc.primer_nombre || ' ' || pc.primer_apellido AS paciente,
    pc.hora_llegada AS t1_llegada,
    pc.hora_admision AS t2_admision,
    MIN(ap.hora_llamado) AS t3_primer_llamado,
    -- Tiempo en espera antes de admisión
    EXTRACT(EPOCH FROM (pc.hora_admision - pc.hora_llegada)) / 60 AS minutos_espera_admision,
    -- Tiempo total desde llegada hasta primera atención
    EXTRACT(EPOCH FROM (MIN(ap.hora_llamado) - pc.hora_llegada)) / 60 AS minutos_espera_total
FROM pacientes_cola pc
LEFT JOIN asignaciones_profesionales ap ON ap.paciente_cola_id = pc.id
WHERE pc.fecha = $1
GROUP BY pc.id, pc.numero_identificacion, pc.primer_nombre, pc.primer_apellido,
         pc.hora_llegada, pc.hora_admision
ORDER BY pc.hora_llegada;
```

### Tiempo de atención por profesional (T4 → T5)

```sql
SELECT
    ap.nombre_profesional,
    ap.area,
    COUNT(*) AS pacientes_atendidos,
    AVG(EXTRACT(EPOCH FROM (ap.hora_finalizado - ap.hora_en_atencion)) / 60)
        AS promedio_minutos_atencion,
    MIN(EXTRACT(EPOCH FROM (ap.hora_finalizado - ap.hora_en_atencion)) / 60)
        AS minimo_minutos,
    MAX(EXTRACT(EPOCH FROM (ap.hora_finalizado - ap.hora_en_atencion)) / 60)
        AS maximo_minutos
FROM asignaciones_profesionales ap
WHERE ap.fecha = $1
  AND ap.estado = 'finalizado'
  AND ap.hora_en_atencion IS NOT NULL
  AND ap.hora_finalizado IS NOT NULL
GROUP BY ap.nombre_profesional, ap.area
ORDER BY ap.nombre_profesional;
```

---

## `database/db.js` — Pool de conexiones

```javascript
const { Pool } = require('pg');

const pool = new Pool({
    host:     process.env.DB_HOST     || 'localhost',
    port:     parseInt(process.env.DB_PORT || '5432'),
    database: process.env.DB_NAME     || 'turnero',
    user:     process.env.DB_USER     || 'turnero_user',
    password: process.env.DB_PASSWORD,
    max: 10,               // máximo 10 conexiones concurrentes
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 2000,
});

pool.on('error', (err) => {
    console.error('[DB] Error inesperado en cliente idle:', err);
});

// Helper: ejecutar query con parámetros
async function query(text, params) {
    const start = Date.now();
    const res = await pool.query(text, params);
    const duration = Date.now() - start;
    if (duration > 1000) {
        console.warn(`[DB] Query lenta (${duration}ms): ${text}`);
    }
    return res;
}

// Helper: obtener un cliente para transacciones
async function getClient() {
    return pool.connect();
}

module.exports = { query, getClient, pool };
```

---

## `database/migrate.js` — Crear tablas al arrancar

```javascript
const fs = require('fs');
const path = require('path');
const { pool } = require('./db');

async function migrate() {
    const schema = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');
    const client = await pool.connect();
    try {
        await client.query(schema);
        console.log('[DB] Migración completada. Tablas listas.');
    } finally {
        client.release();
    }
}

module.exports = { migrate };
```

En `server.js`, llamar antes de iniciar el servidor:

```javascript
const { migrate } = require('./database/migrate');

async function main() {
    await migrate();
    server.listen(PORT, '0.0.0.0', () => {
        console.log(`Turnero corriendo en puerto ${PORT}`);
    });
}

main().catch(err => {
    console.error('Error al arrancar:', err);
    process.exit(1);
});
```

---

## Instalación de PostgreSQL en Windows Server 2019

1. Descargar el instalador desde `https://www.postgresql.org/download/windows/`.
2. Instalar con las opciones por defecto. Anotar la contraseña del usuario `postgres`.
3. Abrir SQL Shell (psql) o pgAdmin y crear la base de datos y el usuario:

```sql
-- Conectado como postgres
CREATE USER turnero_user WITH PASSWORD 'CambiarPorPasswordSeguro';
CREATE DATABASE turnero OWNER turnero_user;
GRANT ALL PRIVILEGES ON DATABASE turnero TO turnero_user;
```

4. Verificar que PostgreSQL escucha en `localhost:5432`:
```powershell
netstat -ano | findstr 5432
```

5. No es necesario abrir el puerto 5432 al exterior — solo Node.js (en el mismo servidor) se conecta a PostgreSQL.

---

## Limpieza automática de datos históricos

```javascript
const cron = require('node-cron');
const { query } = require('./database/db');

// Cada día a las 2:00 AM
cron.schedule('0 2 * * *', async () => {
    const { rows } = await query(
        "SELECT valor FROM configuracion WHERE clave = 'dias_retener_datos'"
    );
    const dias = parseInt(rows[0]?.valor || '7');

    await query(
        'DELETE FROM pacientes_cola WHERE fecha < CURRENT_DATE - $1::INTEGER',
        [dias]
    );
    await query(
        'DELETE FROM asignaciones_profesionales WHERE fecha < CURRENT_DATE - $1::INTEGER',
        [dias]
    );
    // Eventos log: retener 30 días
    await query(
        "DELETE FROM eventos_log WHERE timestamp < NOW() - INTERVAL '30 days'"
    );
    console.log(`[Cron] Limpieza completada. Eliminados datos de más de ${dias} días.`);
});
```

---

## Paquetes npm necesarios

```bash
npm install pg uuid dotenv node-cron
```

Quitar `better-sqlite3` si estaba en las dependencias anteriores.
