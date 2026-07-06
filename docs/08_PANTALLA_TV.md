# 08 — Pantalla de Display (TVs)

> Última actualización: 2026-07-05
>
> **Fuente de verdad: `app/public/display/index.html`** (autocontenido).
> URL: `http://SERVIDOR:3000/display`. Corre en PCs por HDMI y en Android TVs con
> navegador, dispersas en varias salas — todas reciben los mismos eventos y suenan
> a la vez.

## Layout

```
┌──────────────────────────────────────────────────────────────────────┐
│  LOGO / TÍTULO                                    RELOJ  ●  (header) │
├────────────────┬──────────────────────────────────┬─────────────────┤
│  CONSULTORIOS  │            CENTRO                │   ADMISIONES    │
│  (llamando)    │   Anuncio del llamado actual:    │   (llamando)    │
│  Toma de       │      badge Admisiones/           │   Módulo 1      │
│  Muestras      │        Consultorio               │   ANA GARCÍA    │
│  LUZ MELANIA   │      «Pasar a»                   │                 │
│  CABARCAS…     │   NOMBRE DEL PACIENTE (grande)   │                 │
│  (nombre       │   Destino (2rem)                 │                 │
│  completo,     │   ── barra de progreso ──        │                 │
│  con wrap)     │   [chips: siguientes en cola]    │                 │
└────────────────┴──────────────────────────────────┴─────────────────┘
```

Laterales de 340 px; títulos de columna 1rem; el nombre del paciente se muestra
**completo** (salto de línea, sin "…"). El nombre del consultorio es el del catálogo
tal cual ("Consultorio 1", "Toma de Muestras"). Un consultorio **multipaciente**
puede tener varias tarjetas a la vez (el estado se indexa por asignación, no por
profesional). **Nunca** se muestra la cédula.

## Cola de anuncios (centro)

- Cada llamado entra a una **cola secuencial**: ocupa el centro durante
  `duracion_anuncio_seg` (configurable en Admin, 4–30 s, default 8; aplica en vivo)
  con **doble timbre**: al aparecer y ~1,5 s antes de desaparecer.
- Si varios llaman a la vez, nadie se pierde: los siguientes esperan su turno y se
  ven como chips abajo. Las columnas laterales sí se actualizan al instante.
- **Sonar** (desde Admisiones o desde un Profesional) interrumpe y retoma el centro
  con ese paciente; el anuncio interrumpido vuelve al frente de la cola. Las tarjetas
  laterales del profesional pulsan con animación.
- Cancelaciones/devoluciones retiran al paciente del centro y de la cola al instante
  (sin timbres huérfanos: el segundo timbre se cancela con el anuncio).

## Audio garantizado (política de autoplay)

1. **Overlay de activación** al cargar: "Presione OK en el control o toque la
   pantalla para iniciar". El primer gesto desbloquea el audio, suena un beep de
   confirmación, y pide pantalla completa + Wake Lock (la TV no se duerme). Si el
   navegador ya permite autoplay (Chrome kiosco con
   `--autoplay-policy=no-user-gesture-required`, Fully Kiosk), el overlay no aparece.
2. **Vigilante** cada 5 s: si el audio vuelve a bloquearse, aparece un banner rojo
   imposible de ignorar ("🔇 SONIDO DESACTIVADO — presione OK…").
3. **Monitoreo remoto**: la TV manda `heartbeat` cada 30 s con `audioOk`; en
   **Admin → Terminales → Pantallas** se ve cada display 🟢/🔴 (en línea) y 🔊/🔇.
4. `sonido_habilitado = false` en Admin silencia los timbres intencionalmente
   (sin overlay ni banner).

## Recuperación de estado

Al cargar la página y en **cada reconexión** del socket, el display consulta
`GET /api/display/activos` y reconstruye columnas y anuncios pendientes (con guard
anti-duplicados). Un F5, un corte de luz o un reinicio del servidor no dejan la
pantalla en un estado fantasma.

## Interacción

Pensada para cero interacción. No hay botón "Salir" visible (los pacientes no deben
poder sacarla): **triple-click en el logo** vuelve al menú (mantenimiento).

## Eventos socket que escucha

`admision:llamando/completada/devuelto` · `admision:sonar` ·
`asignacion:llamando/en_atencion/cancelado/finalizado` · `display:sonar` ·
`config:actualizada` (branding, sonido y duración en vivo).

## Configuración física de las TVs

| Tipo | Configuración |
|---|---|
| PC → HDMI (o splitter) | `chrome.exe --kiosk --autoplay-policy=no-user-gesture-required http://SERVIDOR:3000/display` + suspensión de pantalla desactivada |
| Android TV (recomendado) | **Fully Kiosk Browser**: URL del display + *Autoplay Audio* + *Launch on Boot* |
| Android TV (navegador simple) | Al encender: un OK del control en el overlay y queda activa todo el día |

Detalle de instalación en `docs/09_INSTALACION_SERVIDOR.md`.
