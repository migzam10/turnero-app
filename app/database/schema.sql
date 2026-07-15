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
    ('cantidad_modulos_admisiones', '3',
     'Cantidad de módulos de admisiones disponibles para asignar a una terminal'),
    ('clave_admin',             '2026',
     'Clave alfanumérica de acceso al módulo de Administración'),
    ('sonido_habilitado',       'true',
     'Habilitar sonido en pantallas TV'),
    ('intervalo_extension_seg', '60',
     'Intervalo de sincronización de la extensión en segundos'),
    ('titulo_sufijo',           'Turnero',
     'Texto personalizado que acompaña el nombre de cada módulo en el título'),
    ('display_logo',            '',
     'Logo del Display en formato data URL (vacío = ícono por defecto)'),
    ('duracion_anuncio_seg',    '8',
     'Segundos que dura cada anuncio en la pantalla TV (4-30)'),
    ('voz_habilitada',          'false',
     'Anuncio por voz (TTS) en las pantallas TV'),
    ('voz_plantilla',           'Turno para {nombre}. Diríjase a {destino}.',
     'Frase del anuncio por voz; tokens {nombre} y {destino}'),
    ('version_db',              '1',
     'Versión del esquema de base de datos')
ON CONFLICT (clave) DO NOTHING;

-- Limpieza del parámetro legacy: los módulos pasaron de un array JSON
-- ('modulos_admisiones') a una cantidad numérica ('cantidad_modulos_admisiones').
-- Esta sentencia es idempotente y elimina el registro obsoleto en instalaciones previas.
DELETE FROM configuracion WHERE clave = 'modulos_admisiones';

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

-- Columna para consultorio del profesional (v2)
ALTER TABLE asignaciones_profesionales
    ADD COLUMN IF NOT EXISTS consultorio_profesional VARCHAR(20);

-- Nombre del paciente desde Biofile (v3) — necesario cuando no hay registro en pacientes_cola
ALTER TABLE asignaciones_profesionales
    ADD COLUMN IF NOT EXISTS nombre_paciente VARCHAR(150);

-- Sexo del paciente (v4) — capturado en el formulario de recepción (M/F)
ALTER TABLE pacientes_cola
    ADD COLUMN IF NOT EXISTS sexo VARCHAR(1) CHECK (sexo IN ('M','F'));

-- ── State Reconciliation (v5) ────────────────────────────────────────────────
-- Soporta dar de baja asignaciones que ya no existen en Biofile/LIS y gestionar
-- bajas/reasignaciones manuales con override persistente, sin borrar filas.
--   activo          → la asignación sigue vigente (false = dada de baja).
--   manual_override → un humano la gestionó; la sincronización NO debe revivirla.
--   origen_baja     → quién la dio de baja: 'lis' (reconciliación) | 'manual'.
ALTER TABLE asignaciones_profesionales
    ADD COLUMN IF NOT EXISTS activo BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE asignaciones_profesionales
    ADD COLUMN IF NOT EXISTS manual_override BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE asignaciones_profesionales
    ADD COLUMN IF NOT EXISTS origen_baja VARCHAR(20);

-- Origen de la asignación: 'biofile' (creada por la extensión/LIS) | 'manual'
-- (creada dentro de la app para un paciente particular). Las 'manual' nunca están
-- en el snapshot de Biofile, por lo que la reconciliación debe ignorarlas siempre.
ALTER TABLE asignaciones_profesionales
    ADD COLUMN IF NOT EXISTS origen VARCHAR(20) NOT NULL DEFAULT 'biofile';
ALTER TABLE asignaciones_profesionales
    DROP CONSTRAINT IF EXISTS asignaciones_profesionales_origen_check;
ALTER TABLE asignaciones_profesionales
    ADD CONSTRAINT asignaciones_profesionales_origen_check
    CHECK (origen IN ('biofile','manual'));

-- Ampliar el CHECK de `estado` para incluir 'cancelado'. Un CHECK inline no se
-- puede modificar in-place: se elimina por su nombre autogenerado y se recrea.
-- DROP IF EXISTS + ADD es idempotente al re-ejecutar el schema completo.
ALTER TABLE asignaciones_profesionales
    DROP CONSTRAINT IF EXISTS asignaciones_profesionales_estado_check;
ALTER TABLE asignaciones_profesionales
    ADD CONSTRAINT asignaciones_profesionales_estado_check
    CHECK (estado IN ('pendiente','llamando','en_atencion','finalizado','cancelado'));

-- Índice parcial para el scope de reconciliación (fecha + login, solo activos).
CREATE INDEX IF NOT EXISTS idx_asig_login_fecha
    ON asignaciones_profesionales(fecha, login_name_biofile) WHERE activo = true;

-- Flujo de admisiones de 2 tiempos: se añade el estado intermedio 'admisionando'
-- (Admisionando → Finalizar), espejo del flujo de profesionales. El CHECK inline
-- original se elimina por su nombre autogenerado y se recrea (idempotente).
ALTER TABLE pacientes_cola
    DROP CONSTRAINT IF EXISTS pacientes_cola_estado_admision_check;
ALTER TABLE pacientes_cola
    ADD CONSTRAINT pacientes_cola_estado_admision_check
    CHECK (estado_admision IN ('esperando','llamando_admision','admisionando','admisionado'));

-- ── Catálogo de consultorios (v6) ────────────────────────────────────────────
-- Administrado desde el panel Admin. `nombre` es el texto COMPLETO que ve el
-- paciente en pantalla ("Consultorio 1", "Toma de Muestras"). `multipaciente`
-- permite que el profesional en ese consultorio llame a varios pacientes a la
-- vez (omite el guard ya_tiene_paciente_activo). Baja lógica con `activo`.
CREATE TABLE IF NOT EXISTS consultorios (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    nombre        VARCHAR(60) NOT NULL UNIQUE,
    multipaciente BOOLEAN NOT NULL DEFAULT false,
    activo        BOOLEAN NOT NULL DEFAULT true,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- El orden manual se eliminó: el catálogo se lista alfabéticamente por nombre.
ALTER TABLE consultorios DROP COLUMN IF EXISTS orden;

-- El nombre del catálogo puede superar los 20 chars del campo original.
ALTER TABLE asignaciones_profesionales
    ALTER COLUMN consultorio_profesional TYPE VARCHAR(60);
ALTER TABLE terminales
    ALTER COLUMN consultorio_numero TYPE VARCHAR(60);

-- ── Monitoreo de pantallas (v7) ──────────────────────────────────────────────
-- Los displays reportan en su heartbeat si el audio del navegador está
-- desbloqueado (política de autoplay). NULL = terminal que no reporta audio.
ALTER TABLE terminales
    ADD COLUMN IF NOT EXISTS audio_ok BOOLEAN;

-- El panel Admin también se registra como terminal (monitoreo unificado).
ALTER TABLE terminales DROP CONSTRAINT IF EXISTS terminales_tipo_check;
ALTER TABLE terminales ADD CONSTRAINT terminales_tipo_check
    CHECK (tipo IN ('recepcion','admisiones','profesional','display','admin'));

-- ── Multi-ingreso por paciente/día, llaveado por OS (v8) ─────────────────────
-- Un paciente puede tener VARIAS atenciones (ingresos) el mismo día. La unidad de
-- ingreso es la ORDEN DE SERVICIO (OS) de Biofile: cada OS es de una empresa (o un
-- particular) y puede haber varias a la vez. `orden_servicio` = la OS (NULL = registro
-- de recepción aún no vinculado a una OS). `cerrado` marca esa OS terminada (admisión
-- hecha + todos sus exámenes finalizados). Reabrir = volver `cerrado` a false cuando a
-- la MISMA OS le entra un examen activo (examen extra en la misma orden).
ALTER TABLE pacientes_cola
    ADD COLUMN IF NOT EXISTS cerrado BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE pacientes_cola
    ADD COLUMN IF NOT EXISTS orden_servicio VARCHAR(30);

-- Se retira el UNIQUE(fecha, cédula) que bloqueaba el segundo ingreso. Se sustituye por
-- dos índices parciales:
--   uq_cola_os          → UN ingreso por OS (permite varias OS abiertas a la vez).
--   uq_cola_shell_abierto → a lo sumo UN registro de recepción sin OS y abierto por
--                           cédula (evita duplicar el registro antes de que Biofile le
--                           asigne su OS). Al vincularse (sellar OS) o cerrarse, recepción
--                           puede volver a listar al paciente para otra visita.
-- Se elimina el índice de la iteración previa (un solo abierto por cédula), ya superado.
ALTER TABLE pacientes_cola
    DROP CONSTRAINT IF EXISTS pacientes_cola_fecha_numero_identificacion_key;
DROP INDEX IF EXISTS uq_cola_ingreso_abierto;
CREATE UNIQUE INDEX IF NOT EXISTS uq_cola_os
    ON pacientes_cola(fecha, numero_identificacion, orden_servicio)
    WHERE orden_servicio IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_cola_shell_abierto
    ON pacientes_cola(fecha, numero_identificacion)
    WHERE orden_servicio IS NULL AND NOT cerrado;

-- Las asignaciones se re-llavean al INGRESO concreto (paciente_cola_id) en lugar de
-- (fecha, cédula, columna_header): dos ingresos del mismo día dejan de colisionar y
-- cada examen pertenece a su atención. Defensa para instalaciones previas: se rellena
-- cualquier paciente_cola_id nulo enlazando por (fecha, cédula) antes de exigir NOT
-- NULL, para no bloquear el arranque.
UPDATE asignaciones_profesionales ap
   SET paciente_cola_id = pc.id
  FROM pacientes_cola pc
 WHERE ap.paciente_cola_id IS NULL
   AND pc.fecha = ap.fecha AND pc.numero_identificacion = ap.numero_identificacion;
ALTER TABLE asignaciones_profesionales
    ALTER COLUMN paciente_cola_id SET NOT NULL;
ALTER TABLE asignaciones_profesionales
    DROP CONSTRAINT IF EXISTS asignaciones_profesionales_fecha_numero_identificacion_colu_key;
CREATE UNIQUE INDEX IF NOT EXISTS uq_asig_ingreso_columna
    ON asignaciones_profesionales(paciente_cola_id, columna_header);
