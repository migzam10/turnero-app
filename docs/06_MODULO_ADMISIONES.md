# 06 — Módulo de Admisiones

> Última actualización: 2026-07-05
>
> **Fuente de verdad: `app/public/admisiones/index.html`** (autocontenido).
> URL: `http://SERVIDOR:3000/admisiones`.

## ¿Qué hace este módulo?

El personal de admisiones (Módulo 1..N, cantidad configurable desde Admin) llama a
los pacientes de la cola y gestiona el trámite de ingreso a Biofile en un **flujo de
DOS TIEMPOS** que mide el tiempo real de cada etapa. El antiguo botón "Copiar datos
para Biofile" **ya no existe**: el llenado de Biofile lo hace la extensión
**Biofile-Injector** (ver `04_EXTENSION_BIOFILE.md`).

## Setup

Al abrir por primera vez, un overlay pide elegir el **módulo** (Módulo 1..N, según
`cantidad_modulos_admisiones`). Queda en localStorage; el badge del header permite
cambiarlo. "Salir" limpia el módulo y vuelve al menú.

## El flujo de dos tiempos

```
esperando ──Llamar──► llamando_admision ──Admisionando──► admisionando ──Finalizar──► admisionado
                     (suena en las TVs)   (T2a: inicia el      (T2: cierra; la hora
                      Sonar · Cancelar     trámite; sale        de Biofile manda si
                                           del display)         hay cruce)
```

| Botón | Cuándo aparece | Qué hace |
|---|---|---|
| **Llamar** | esperando | Estado `llamando_admision` + módulo; el paciente suena y aparece en las TVs. Bloqueado si este módulo ya tiene un paciente en proceso |
| **Sonar** | llamando | Repite la alerta en las TVs (retoma el centro) |
| **Cancelar** | llamando | Devuelve a `esperando` (conserva su turno por hora de llegada); desaparece de las TVs al instante |
| **Admisionando** | llamando | **Tiempo 1**: registra `hora_llamado_admision` (el paciente llegó al módulo, empieza el trámite) y lo quita del display. La fila no se mueve |
| **Finalizar** | admisionando | **Tiempo 2**: cierra la admisión. `hora_admision = COALESCE(hora Biofile, ahora)` — si la extensión ya cruzó al paciente, la hora de Biofile manda; si no, un sync posterior la corrige |
| **Ver datos** | siempre | Modal con datos completos + cambio de prioridad + Llamar |
| **Asignar a profesional** | esperando / en proceso propio | Para **particulares** que no pasan por Biofile: crea la asignación manual (`origen='manual'`, protegida de la reconciliación). Si el nombre digitado no está en el catálogo histórico, pide confirmación (evita typos que el profesional real nunca vería) |

## Reglas de la cola

- **Un paciente en proceso por módulo**: mientras haya uno en llamando/admisionando
  de ESTE módulo, "Llamar" queda deshabilitado.
- **Pacientes de OTROS módulos**: visibles en tarjeta atenuada con badge
  "En Módulo X" y solo "Ver datos" (información sin riesgo de doble llamado).
- Orden: prioridad (alta→media→normal) y hora de llegada.
- **Tiempo de espera** visible en cada tarjeta ("espera X min"): naranja ≥30 min,
  rojo ≥60 min (se refresca cada minuto).
- **Búsqueda** por nombre o cédula (filtra la vista, no el contador).
- Los errores se muestran como **toasts** (abajo a la derecha), no como popups.
- Franja ámbar de reconexión si se cae el socket.

## Tiempo real

Escucha: `paciente:nuevo/prioridad/eliminado`, `admision:llamando/completada/devuelto`,
`asignacion:manual` → recarga. Header `X-Terminal-Id` (UUID persistido) en todo.

## Endpoints que usa

`GET /api/admisiones/cola` · `POST /api/admisiones/llamar/:id` ·
`POST /api/admisiones/admisionando/:id` · `POST /api/admisiones/finalizar/:id` ·
`POST /api/admisiones/devolver/:id` · `POST /api/admisiones/asignar-profesional/:id`
· `GET /api/admisiones/config-modulos` · `PATCH /api/recepcion/:id/prioridad`

## Por qué existen los dos tiempos

`hora_llamado_admision` (T2a) separa la **espera del paciente** (llegada → lo
atienden) de la **demora del trámite** (atención → registro en Biofile). Son los dos
KPIs del panel Admin: *Espera admisión* y *Registro*. Antes, un solo timestamp
mezclaba ambos y el caso típico (paciente atendido a las 10:35 pero registrado en
Biofile a las 10:55) era invisible.
