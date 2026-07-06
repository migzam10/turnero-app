# 07 — Módulo de Profesionales

> Última actualización: 2026-07-05
>
> **Fuente de verdad: `app/public/profesional/index.html`** (autocontenido).
> URL: `http://SERVIDOR:3000/profesional`.

## ¿Qué hace este módulo?

Cada profesional (médico, optometría, laboratorio, fonoaudiología, psicología…) ve
**solo sus pacientes asignados** (la columna con su nombre en Biofile, más las
asignaciones manuales de particulares) y controla su ciclo:
`pendiente → llamando → en_atencion → finalizado`.

## Setup (una sola vez)

Overlay inicial con dos campos, guardados en localStorage:

1. **Nombre en Biofile** — con autocompletar del **histórico de 60 días** (hay
   sugerencias desde primera hora, aunque Biofile no haya sincronizado hoy). Debe
   coincidir EXACTAMENTE con el nombre de la columna en Biofile.
2. **Consultorio** — `<select>` del **catálogo administrable** (Admin →
   Configuración → Consultorios). Si el consultorio es **multipaciente** se muestra
   el badge `MULTI` en el header. Si el catálogo está vacío, el módulo pide crear
   consultorios en Admin. Si el consultorio guardado se renombra/desactiva, el setup
   se reabre solo.

## La lista y sus reglas

- Secciones: **En atención** → **Llamando** → **Pendientes** (los finalizados de HOY
  no se listan; el contador "Finalizados hoy" es real, vía endpoint dedicado).
- Contadores: Pendientes / Llamando / En atención / Finalizados hoy.
- **Regla de un-paciente-a-la-vez**: con un paciente activo (llamando/en atención),
  los demás "Llamar" se bloquean… **salvo que el consultorio sea multipaciente**
  (toma de muestras, laboratorio, psicología): ahí puede llamar a varios a la vez.
  El backend garantiza la regla con un advisory lock (dos clics simultáneos no se
  cuelan).
- **Bloqueo entre profesionales**: si OTRO profesional tiene al paciente en
  llamando/en atención, la tarjeta se atenúa con el aviso "En atención con X" y
  Llamar se deshabilita (409 `paciente_bloqueado` si se fuerza).
- Timer "X min en atención" en los pacientes activos.
- **Aviso de paciente nuevo**: beep suave + "● " en el título de la pestaña cuando
  aparece un pendiente que no estaba.
- **Historial**: el filtro de fecha permite ver días anteriores (incluye
  finalizados); botón "Hoy" para volver.
- Franja ámbar de reconexión si se cae el socket.

## Botones por estado

| Estado | Botones |
|---|---|
| pendiente | **Llamar** (+ Cancelar/Reasignar si Modo gestión) |
| llamando | **Sonar** (repite el timbre y retoma el centro de las TVs) · **En Atención** · **Cancelar** (vuelve a pendiente) |
| en_atencion | **Finalizar** |

## Modo gestión (clave de admin)

El botón "Ajustes" pide la clave del panel Admin y habilita, sobre pendientes:
- **Cancelar** (baja manual: `activo=false`, protegida de la reconciliación del LIS).
- **Reasignar** a otro profesional — modal con lista clicable y filtro (profesionales
  del día, excluyéndose a sí mismo), con confirmación.
El modo NO se persiste: cada recarga arranca desactivado.

## Tiempo real

Escucha `asignacion:*` (llamando/en_atencion/finalizado/cancelado/reasignado/
cancelado_manual/manual), `extension:sync` (invalida el cache del autocompletar) y
`UPDATE_PATIENTS` (refresca bloqueos cruzados al instante). Header `X-Terminal-Id`
(UUID persistido) en todas las peticiones.

## Endpoints que usa

`GET /api/profesional/asignaciones?profesional=…[&fecha=…]` ·
`GET /api/profesional/consultorios` · `GET /api/profesional/catalogo` ·
`GET /api/profesional/listado-profesionales` · `GET /api/profesional/resumen-hoy` ·
`POST /api/profesional/llamar|en-atencion|finalizar|cancelar-llamado|reasignar|
cancelar-asignacion/:id`
