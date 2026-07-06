# 05 — Módulo de Recepción

> Última actualización: 2026-07-05
>
> **Fuente de verdad: `app/public/recepcion/index.html`** (módulo autocontenido, sin
> archivos JS separados). URL: `http://SERVIDOR:3000/recepcion`.

## ¿Qué hace este módulo?

Registra la llegada de los pacientes (T1 — la hora de llegada oficial del sistema),
por **escáner de cédula** o digitación manual, y administra la **cola del día**:
prioridades, edición y eliminación de registros erróneos.

## Pantalla

- **Izquierda:** formulario de datos del paciente (siempre visible). Se llena solo al
  escanear, o a mano. Incluye selector de **prioridad** (Normal por defecto, Media,
  Alta) — el paciente puede registrarse ya priorizado.
- **Derecha:** **Cola del día** con contador, **búsqueda por nombre o cédula**, y dos
  grupos: **Pendientes** (esperando/llamado) arriba y **Admisionados** en una sección
  colapsable al final (atenuados).
- Franja ámbar bajo el header si se pierde la conexión en tiempo real
  ("⚠ Sin conexión — reconectando…"); al volver, la cola se recarga sola.

## Escáner de cédulas

La pistola actúa como teclado virtual. Un input oculto mantiene el foco (sin
robárselo al formulario cuando el usuario está escribiendo) y captura la ráfaga del
lector. El parser soporta, en este orden:

1. **JSON / QR** — objetos con variantes de nombres de campo.
2. **Tab-separado** — formato típico de lectores configurados en Colombia:
   `cedula ⇥ apellido1 ⇥ apellido2 ⇥ nombre1 ⇥ nombre2 ⇥ [fecha] [ciudad]`.
3. **PDF417 crudo (RNEC)** — campos por posición de bytes (cédula en 48–57,
   apellidos, nombres, fecha `YYYYMMDD`, ciudad de expedición).
4. **Solo número** — registro incompleto: se llena la cédula y el recepcionista
   completa a mano.

El badge del formulario indica el formato detectado (`QR/JSON`, `Tab-separado`,
`PDF417`, `Número`, `MANUAL`). **El recepcionista siempre verifica los datos antes de
registrar** — el escáner no decide nada por sí solo. La fecha `aaaammdd` se convierte
a `DD/MM/AAAA` automáticamente; el sexo acepta la tecla M/F directa del lector.

## Registrar / editar / eliminar

| Acción | Regla |
|---|---|
| **Registrar** | Requiere cédula + primer nombre + primer apellido. Todo se guarda en MAYÚSCULAS. `UNIQUE (fecha, cédula)`: si ya existe hoy → aviso "ya fue registrado hoy" (409) |
| **Editar** (botón en la fila, al pasar el cursor) | Solo mientras el paciente está **esperando**; carga los datos al formulario (modo EDICIÓN — el selector de prioridad se oculta; la prioridad se cambia desde la cola). Si ya fue llamado → 409 "no editable" |
| **Eliminar** (botón rojo en la fila) | Solo mientras **esperando**, con confirmación. Borra el registro erróneo y queda **auditado** en `eventos_log` (`paciente_eliminado`, con cédula y nombre en el JSONB). Se propaga por socket a las demás pantallas |
| **Cambiar prioridad** | Clic en la fila → modal Normal/Media/Alta (también posible desde Admisiones) |

## Tiempo real

Escucha por socket: `paciente:nuevo`, `paciente:actualizado`, `paciente:prioridad`,
`paciente:eliminado` y `admision:completada` → recarga de la cola. La terminal se
identifica con un `terminal_id` UUID persistido en localStorage (header
`X-Terminal-Id` en cada petición y en el join del socket).

## Endpoints que usa

`GET /api/recepcion/cola` · `GET /api/recepcion/:id` · `POST /api/recepcion/registrar`
· `PUT /api/recepcion/:id` · `PATCH /api/recepcion/:id/prioridad` ·
`DELETE /api/recepcion/:id`

## Notas

- La cola muestra a TODOS los del día; el contador es el total (la búsqueda solo
  filtra la vista).
- Un nombre con caracteres especiales (`<`, `'`, `&`) se muestra literal en todas las
  pantallas (todo texto dinámico va escapado).
- "Salir" limpia el formulario y vuelve al menú principal.
