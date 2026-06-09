-- Extensión para UUID
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ── Pacientes en cola (creados por recepción al escanear la cédula) ──────────
CREATE TABLE IF NOT EXISTS pacientes_cola (
    id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    fecha                 DATE NOT NULL DEFAULT CURRENT_DATE,
    hora_llegada          TIMESTAMPTZ NOT NULL DEFAULT NOW(),          -- T1
    numero_identificacion VARCHAR(20) NOT NULL,
    tipo_identificacion   VARCHAR(10) NOT NULL DEFAULT 'CC',
    primer_nombre         VARCHAR(60) NOT NULL,
    segundo_nombre        VARCHAR(60),
    primer_apellido       VARCHAR(60) NOT NULL,
    segundo_apellido      VARCHAR(60),
    ciudad_expedicion     VARCHAR(80),
    fecha_nacimiento      DATE,
    prioridad             VARCHAR(10) NOT NULL DEFAULT 'normal'
                              CHECK (prioridad IN ('alta','media','normal')),
    estado_admision       VARCHAR(25) NOT NULL DEFAULT 'esperando'
                              CHECK (estado_admision IN ('esperando','llamando_admision','admisionado')),
    hora_llamado_admision TIMESTAMPTZ,
    modulo_admision       VARCHAR(40),
    hora_admision         TIMESTAMPTZ,                                 -- T2 (sistema)
    terminal_recepcion_id UUID,
    created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (fecha, numero_identificacion)
);

-- ── Asignaciones de profesionales (leídas de Biofile por la extensión) ───────
CREATE TABLE IF NOT EXISTS asignaciones_profesionales (
    id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    fecha                 DATE NOT NULL DEFAULT CURRENT_DATE,
    paciente_cola_id      UUID REFERENCES pacientes_cola(id) ON DELETE CASCADE,
    numero_identificacion VARCHAR(20) NOT NULL,
    nombre_profesional    VARCHAR(100) NOT NULL,
    area                  VARCHAR(100) NOT NULL,
    columna_header        VARCHAR(100) NOT NULL,
    estado                VARCHAR(20) NOT NULL DEFAULT 'pendiente'
                              CHECK (estado IN ('pendiente','llamando','en_atencion','finalizado')),
    hora_llegada_biofile  TIMESTAMPTZ,                                 -- T2 raw de Biofile
    hora_llamado          TIMESTAMPTZ,                                 -- T3
    hora_en_atencion      TIMESTAMPTZ,                                 -- T4
    hora_finalizado       TIMESTAMPTZ,                                 -- T5
    terminal_id           UUID,
    login_name_biofile    VARCHAR(100),
    created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (fecha, numero_identificacion, columna_header)
);

-- ── Log de eventos del sistema ───────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS eventos_log (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    fecha       DATE NOT NULL DEFAULT CURRENT_DATE,
    timestamp   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    tipo        VARCHAR(50) NOT NULL,
    descripcion TEXT,
    paciente_id UUID REFERENCES pacientes_cola(id) ON DELETE SET NULL,
    terminal_id UUID,
    datos       JSONB,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── Terminales conectados ────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS terminales (
    id                  UUID PRIMARY KEY,
    tipo                VARCHAR(20) NOT NULL
                            CHECK (tipo IN ('recepcion','admisiones','profesional','display')),
    consultorio_numero  VARCHAR(10),
    login_name_biofile  VARCHAR(100),
    ip_address          VARCHAR(45),
    ultimo_heartbeat    TIMESTAMPTZ,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── Configuración del sistema ────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS configuracion (
    clave       VARCHAR(60) PRIMARY KEY,
    valor       TEXT NOT NULL,
    descripcion VARCHAR(200),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO configuracion (clave, valor, descripcion) VALUES
    ('modulos_admisiones',      '["Módulo 1","Módulo 2","Módulo 3"]',
     'JSON array de nombres de módulos de admisiones'),
    ('sonido_habilitado',       'true',
     'Habilitar sonido en pantallas TV'),
    ('intervalo_extension_seg', '60',
     'Intervalo de sincronización de la extensión en segundos'),
    ('dias_retener_datos',      '7',
     'Días de retención de datos operativos'),
    ('version_db',              '1',
     'Versión del esquema de base de datos')
ON CONFLICT (clave) DO NOTHING;

-- ── Índices ──────────────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_cola_fecha          ON pacientes_cola(fecha);
CREATE INDEX IF NOT EXISTS idx_cola_identificacion ON pacientes_cola(numero_identificacion);
CREATE INDEX IF NOT EXISTS idx_cola_estado         ON pacientes_cola(estado_admision);
CREATE INDEX IF NOT EXISTS idx_asig_fecha          ON asignaciones_profesionales(fecha);
CREATE INDEX IF NOT EXISTS idx_asig_identificacion ON asignaciones_profesionales(numero_identificacion);
CREATE INDEX IF NOT EXISTS idx_asig_profesional    ON asignaciones_profesionales(nombre_profesional);
CREATE INDEX IF NOT EXISTS idx_asig_estado         ON asignaciones_profesionales(estado);
CREATE INDEX IF NOT EXISTS idx_eventos_fecha       ON eventos_log(fecha);
CREATE INDEX IF NOT EXISTS idx_eventos_tipo        ON eventos_log(tipo);

-- Columna para consultorio del profesional (agregada en v2)
ALTER TABLE asignaciones_profesionales
    ADD COLUMN IF NOT EXISTS consultorio_profesional VARCHAR(20);
