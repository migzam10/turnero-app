# 07 — Módulo de Profesionales

URL: `http://SERVER_IP:3000/profesional`  
Archivo: `public/profesional/index.html`

---

## ¿Qué hace este módulo?

Cada profesional (médico, optómetra, laboratorio, fonoaudiología, psicología, etc.) tiene este módulo abierto en su PC durante la jornada.

El módulo muestra únicamente los pacientes asignados a ese profesional (según la columna correspondiente en Biofile). Permite:
1. Ver su lista de pacientes con prioridad y hora de llegada.
2. Llamar a un paciente (aparece en las TVs con sonido).
3. Marcar como "En Atención" (desaparece de las TVs).
4. Marcar como "Finalizado" (libera el paciente para otros profesionales).

---

## Configuración del terminal (una sola vez)

La primera vez que el profesional abre el módulo, se muestra una pantalla de configuración:

1. **Número de consultorio:** Campo de texto donde escribe el número/nombre físico del consultorio (Ej: "Consultorio 5", "Optometría 2"). Este valor se guarda en `localStorage` y se muestra en las TVs cuando se llama a un paciente.

2. **Nombre del profesional:** El sistema debe saber quién es el profesional para filtrar sus pacientes. Opciones:
   - **Opción A (recomendada):** El profesional escribe su nombre tal como aparece en Biofile (Ej: `KENDY ZABALETA`). Una vez guardado, no vuelve a pedirlo a menos que quiera cambiarlo.
   - **Opción B:** El módulo muestra un dropdown con todos los profesionales que tienen asignaciones hoy (obtenidos de `/api/profesional/listado-profesionales`). El profesional selecciona el suyo.

**El consultorio puede cambiarse** desde el ícono de configuración (⚙) en cualquier momento sin necesidad de recargar la página.

---

## Layout del módulo

```
┌──────────────────────────────────────────────────────────────────┐
│  KENDY ZABALETA — OPTOMETRÍA           Consultorio 5   [⚙] [🕐]  │
├──────────────────────────────────────────────────────────────────┤
│                                                                  │
│  MIS PACIENTES (4)                                               │
│  ┌────────────────────────────────────────────────────────────┐  │
│  │ [●ALTA] ANA GARCIA          07:15    [📢 LLAMAR]           │  │
│  │ [●MEDIA] JUAN MARTINEZ      07:45    [📢 LLAMAR]           │  │
│  │ [○NORM] SOFIA PEREZ         08:10    [📢 LLAMAR]           │  │
│  │                                                            │  │
│  │ ────── EN PROCESO ──────                                   │  │
│  │ [🔴 LLAMANDO] PEDRO RODRIGUEZ   08:32                      │  │
│  │    [✓ En Atención]  [✗ Cancelar llamado]                   │  │
│  │                                                            │  │
│  │ [🟡 EN ATENCIÓN] CARLOS DIAZ    08:20                      │  │
│  │    [✓ Finalizado]                                          │  │
│  └────────────────────────────────────────────────────────────┘  │
└──────────────────────────────────────────────────────────────────┘
```

---

## HTML del módulo

```html
<!DOCTYPE html>
<html lang="es">
<head>
    <meta charset="UTF-8">
    <title>Profesional — Turnero CertiMedic</title>
    <link rel="stylesheet" href="/assets/css/main.css">
</head>
<body>
    <!-- Pantalla de configuración inicial (se oculta cuando ya está configurado) -->
    <div id="pantalla-config" class="pantalla-config">
        <div class="config-card">
            <h1>Configuración del terminal</h1>
            <p>Esta configuración se guarda en este dispositivo y no necesita repetirse.</p>

            <label>Mi nombre en Biofile:
                <div class="input-with-hint">
                    <input type="text" id="input-nombre-prof"
                        placeholder="Ej: KENDY ZABALETA"
                        autocomplete="off">
                    <div id="sugerencias-nombre" class="sugerencias hidden"></div>
                </div>
                <small>Escriba su nombre exactamente como aparece en Biofile</small>
            </label>

            <label style="margin-top:16px">Número / nombre del consultorio:
                <input type="text" id="input-consultorio"
                    placeholder="Ej: Consultorio 5 o Optometría 2"
                    autocomplete="off">
            </label>

            <button id="btn-guardar-config" class="btn-primary" style="margin-top:20px">
                Guardar y comenzar
            </button>
        </div>
    </div>

    <!-- Pantalla principal (oculta hasta que esté configurado) -->
    <div id="pantalla-principal" class="hidden">
        <header>
            <div>
                <h1 id="header-nombre"></h1>
                <span id="header-area" class="area-badge"></span>
            </div>
            <div class="header-right">
                <span id="header-consultorio"></span>
                <div id="reloj"></div>
                <button onclick="abrirConfig()" title="Configuración">⚙</button>
            </div>
        </header>

        <main>
            <div class="sync-status" id="sync-status">
                Esperando datos de Biofile...
            </div>

            <div id="lista-pacientes"></div>
        </main>
    </div>

    <!-- Modal de configuración (para cambiar consultorio en cualquier momento) -->
    <div id="modal-config" class="modal hidden">
        <div class="modal-content">
            <h2>Cambiar configuración</h2>
            <label>Consultorio:
                <input type="text" id="modal-consultorio">
            </label>
            <label>Nombre en Biofile:
                <input type="text" id="modal-nombre-prof">
            </label>
            <button onclick="guardarConfigModal()" class="btn-primary">Guardar</button>
            <button onclick="cerrarConfig()">Cancelar</button>
        </div>
    </div>

    <script src="/socket.io/socket.io.js"></script>
    <script src="/assets/js/profesional.js"></script>
</body>
</html>
```

---

## `public/assets/js/profesional.js`

```javascript
const TERMINAL_ID = obtenerOCrearTerminalId();

let nombreProfesional = localStorage.getItem('prof_nombre') || null;
let consultorioNumero = localStorage.getItem('prof_consultorio') || null;

const socket = io({ auth: { terminalId: TERMINAL_ID } });

// ── Inicialización ────────────────────────────────────────────

function init() {
    if (!nombreProfesional || !consultorioNumero) {
        document.getElementById('pantalla-config').classList.remove('hidden');
        iniciarAutocompletar();
    } else {
        mostrarPantallaPrincipal();
    }
}

// ── Configuración ─────────────────────────────────────────────

async function iniciarAutocompletar() {
    const resp = await fetch('/api/profesional/listado-profesionales', {
        headers: { 'X-Terminal-Id': TERMINAL_ID }
    });
    const lista = await resp.json();

    const input = document.getElementById('input-nombre-prof');
    const sugerencias = document.getElementById('sugerencias-nombre');

    input.addEventListener('input', () => {
        const q = input.value.toUpperCase();
        if (q.length < 2) { sugerencias.classList.add('hidden'); return; }

        const filtrados = lista.filter(p => p.toUpperCase().includes(q));
        if (filtrados.length === 0) { sugerencias.classList.add('hidden'); return; }

        sugerencias.innerHTML = filtrados.map(p =>
            `<div class="sugerencia" onclick="seleccionarProfesional('${p}')">${p}</div>`
        ).join('');
        sugerencias.classList.remove('hidden');
    });
}

function seleccionarProfesional(nombre) {
    document.getElementById('input-nombre-prof').value = nombre;
    document.getElementById('sugerencias-nombre').classList.add('hidden');
}

document.getElementById('btn-guardar-config').addEventListener('click', () => {
    const nombre = document.getElementById('input-nombre-prof').value.trim().toUpperCase();
    const consultorio = document.getElementById('input-consultorio').value.trim();

    if (!nombre || !consultorio) {
        alert('Por favor complete todos los campos');
        return;
    }

    localStorage.setItem('prof_nombre', nombre);
    localStorage.setItem('prof_consultorio', consultorio);
    nombreProfesional = nombre;
    consultorioNumero = consultorio;

    document.getElementById('pantalla-config').classList.add('hidden');
    mostrarPantallaPrincipal();
});

function abrirConfig() {
    document.getElementById('modal-consultorio').value = consultorioNumero || '';
    document.getElementById('modal-nombre-prof').value = nombreProfesional || '';
    document.getElementById('modal-config').classList.remove('hidden');
}

function guardarConfigModal() {
    const consultorio = document.getElementById('modal-consultorio').value.trim();
    const nombre = document.getElementById('modal-nombre-prof').value.trim().toUpperCase();
    if (!consultorio || !nombre) return;

    consultorioNumero = consultorio;
    nombreProfesional = nombre;
    localStorage.setItem('prof_consultorio', consultorio);
    localStorage.setItem('prof_nombre', nombre);

    document.getElementById('header-consultorio').textContent = consultorioNumero;
    cerrarConfig();

    // Reconectar socket con nuevo profesional
    socket.emit('join', { tipo: 'profesional', profesionalNombre: nombreProfesional, terminalId: TERMINAL_ID });
    cargarAsignaciones();
}

function cerrarConfig() {
    document.getElementById('modal-config').classList.add('hidden');
}

// ── Pantalla principal ────────────────────────────────────────

function mostrarPantallaPrincipal() {
    document.getElementById('pantalla-principal').classList.remove('hidden');
    document.getElementById('header-nombre').textContent = nombreProfesional;
    document.getElementById('header-consultorio').textContent = consultorioNumero;

    socket.on('connect', () => {
        socket.emit('join', { tipo: 'profesional', profesionalNombre: nombreProfesional, terminalId: TERMINAL_ID });
        cargarAsignaciones();
    });

    socket.on(`asignaciones_actualizadas`, () => {
        cargarAsignaciones();
    });

    setInterval(actualizarReloj, 1000);
    actualizarReloj();
    setInterval(cargarAsignaciones, 60000); // Fallback cada 60s
}

// ── Asignaciones ──────────────────────────────────────────────

async function cargarAsignaciones() {
    const resp = await fetch(
        `/api/profesional/asignaciones?profesional=${encodeURIComponent(nombreProfesional)}`,
        { headers: { 'X-Terminal-Id': TERMINAL_ID } }
    );
    const asignaciones = await resp.json();

    if (asignaciones.length > 0 && asignaciones[0].area) {
        document.getElementById('header-area').textContent = asignaciones[0].area;
    }

    document.getElementById('sync-status').textContent =
        `${asignaciones.length} paciente(s) asignados — actualizado ${formatHora(new Date().toISOString())}`;

    renderizarAsignaciones(asignaciones);
}

function renderizarAsignaciones(asignaciones) {
    const pendientes   = asignaciones.filter(a => a.estado === 'pendiente');
    const llamando     = asignaciones.filter(a => a.estado === 'llamando');
    const enAtencion   = asignaciones.filter(a => a.estado === 'en_atencion');

    const lista = document.getElementById('lista-pacientes');
    lista.innerHTML = '';

    // Ordenar pendientes: alta → media → normal, luego por hora
    pendientes.sort((a, b) => {
        const ord = { alta: 0, media: 1, normal: 2 };
        const pa = ord[a.prioridad] ?? 2;
        const pb = ord[b.prioridad] ?? 2;
        if (pa !== pb) return pa - pb;
        return (a.hora_llegada_biofile || '').localeCompare(b.hora_llegada_biofile || '');
    });

    // Sección: en atención
    enAtencion.forEach(a => lista.appendChild(crearTarjetaPaciente(a)));

    // Sección: llamando
    llamando.forEach(a => lista.appendChild(crearTarjetaPaciente(a)));

    // Divider si hay en proceso
    if ((llamando.length + enAtencion.length) > 0 && pendientes.length > 0) {
        const sep = document.createElement('div');
        sep.className = 'separador';
        sep.textContent = '— Pendientes de llamar —';
        lista.appendChild(sep);
    }

    // Sección: pendientes
    if (pendientes.length === 0 && llamando.length === 0 && enAtencion.length === 0) {
        lista.innerHTML = '<div class="vacio">No hay pacientes asignados todavía.<br>La lista se actualiza automáticamente cuando Biofile los asigne.</div>';
        return;
    }

    pendientes.forEach(a => lista.appendChild(crearTarjetaPaciente(a)));
}

function crearTarjetaPaciente(asignacion) {
    const div = document.createElement('div');
    // Si el paciente está bloqueado por OTRO profesional, añadir clase visual
    const estaBloqueadoPorOtro = asignacion.bloqueado && asignacion.estado === 'pendiente';
    div.className = `tarjeta-paciente estado-${asignacion.estado} prioridad-${asignacion.prioridad || 'normal'} ${estaBloqueadoPorOtro ? 'bloqueado' : ''}`;

    const prioridad = asignacion.prioridad || 'normal';
    const iconEstado = { pendiente: '○', llamando: '🔴', en_atencion: '🟡', finalizado: '✓' }[asignacion.estado];
    const horaLlegada = asignacion.hora_llegada_biofile || formatHora(asignacion.hora_llegada_turnero);

    div.innerHTML = `
        <div class="tarjeta-header">
            <span class="estado-icon">${iconEstado}</span>
            <span class="nombre-paciente">${asignacion.nombre_paciente}</span>
            <span class="badge-prioridad ${prioridad}">${prioridad.toUpperCase()}</span>
            <span class="hora-llegada">${horaLlegada}</span>
        </div>

        <div class="tarjeta-acciones">
            ${asignacion.estado === 'pendiente' && !estaBloqueadoPorOtro ? `
                <button class="btn-llamar" onclick="cambiarEstado('${asignacion.id}', 'llamando')">
                    📢 Llamar
                </button>
            ` : ''}
            ${estaBloqueadoPorOtro ? `
                <span class="bloqueado-label">⏳ En atención con ${asignacion.bloqueado_por || 'otro profesional'}</span>
            ` : ''}
            ${asignacion.estado === 'llamando' ? `
                <button class="btn-en-atencion" onclick="cambiarEstado('${asignacion.id}', 'en_atencion')">
                    ✓ En Atención
                </button>
                <button class="btn-cancelar-llamado" onclick="cambiarEstado('${asignacion.id}', 'pendiente')">
                    ✗ Cancelar llamado
                </button>
            ` : ''}
            ${asignacion.estado === 'en_atencion' ? `
                <button class="btn-finalizado" onclick="cambiarEstado('${asignacion.id}', 'finalizado')">
                    ✓ Finalizado
                </button>
            ` : ''}
        </div>

        ${asignacion.hora_llamado ? `
            <div class="tiempos">
                Llamado: ${formatHora(asignacion.hora_llamado)}
                ${asignacion.hora_en_atencion ? ` — En atención: ${formatHora(asignacion.hora_en_atencion)}` : ''}
            </div>
        ` : ''}
    `;

    return div;
}

// CSS requerido para el estado bloqueado (agregar en main.css):
// .tarjeta-paciente.bloqueado { opacity: 0.5; background: #2a2a2a; }
// .tarjeta-paciente.bloqueado .nombre-paciente { color: #888; }
// .bloqueado-label { color: #f0a500; font-size: 12px; font-style: italic; }

// ── Cambiar estado ────────────────────────────────────────────

async function cambiarEstado(asignacionId, nuevoEstado) {
    const resp = await fetch(`/api/profesional/estado/${asignacionId}`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'X-Terminal-Id': TERMINAL_ID
        },
        body: JSON.stringify({
            estado: nuevoEstado,
            consultorio_numero: consultorioNumero,
            terminal_id: TERMINAL_ID,
            profesional_nombre: nombreProfesional
        })
    });

    if (resp.ok) {
        cargarAsignaciones(); // Actualizar la vista inmediatamente
    }
}

// ── Helpers ───────────────────────────────────────────────────

function formatHora(isoString) {
    if (!isoString) return '—';
    try {
        return new Date(isoString).toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit' });
    } catch {
        return isoString;
    }
}

function actualizarReloj() {
    document.getElementById('reloj').textContent =
        new Date().toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

function obtenerOCrearTerminalId() {
    let id = localStorage.getItem('turnero_terminal_id');
    if (!id) {
        id = 'term-' + Date.now() + '-' + Math.random().toString(36).substr(2, 6);
        localStorage.setItem('turnero_terminal_id', id);
    }
    return id;
}

// ── Arrancar ──────────────────────────────────────────────────
init();
```

---

## Lógica de estados del profesional

```
pendiente ──[Llamar]──→ llamando ──[En Atención]──→ en_atencion ──[Finalizado]──→ finalizado
               ↑                          │
               └──[Cancelar llamado]──────┘
```

- **pendiente → llamando:** El nombre del paciente aparece en el centro de las TVs con sonido (2 beeps).
- **llamando → en_atencion:** El paciente desaparece del centro de las TVs. Aparece debajo del consultorio en la zona lateral.
- **llamando → pendiente (cancelar):** El llamado desaparece de las TVs. No hay penalización; el paciente vuelve a la lista.
- **en_atencion → finalizado:** El paciente desaparece completamente de la vista de este profesional. Queda disponible para otros profesionales (en sus listas siguen pudiendo llamarlo).

## Estado de bloqueo entre profesionales (regla fundamental)

Un paciente puede estar asignado a múltiples profesionales (médico, laboratorio, fonoaudiología, etc.), pero **solo uno puede tenerlo activo a la vez**.

### Regla:
- Cuando un profesional presiona **"Llamar"** o **"En Atención"** para un paciente → ese paciente queda **bloqueado** para todos los demás profesionales.
- Los demás profesionales ven al paciente en gris con el indicador: `"En atención con [ÁREA]"`.
- El botón "Llamar" aparece deshabilitado para ellos.
- Cuando el profesional activo presiona **"Finalizado"** → el paciente queda **disponible** para los demás (su botón "Llamar" se habilita).

### Cómo detecta el frontend el bloqueo:
La API (`GET /api/profesional/asignaciones`) devuelve para cada paciente los campos `bloqueado: true/false` y `bloqueado_por: "OPTOMETRÍA"`. El frontend deshabilita el botón y muestra el indicador si `bloqueado === true` y el bloqueador no es el profesional actual.

### Ejemplo:
```
Paciente: JUAN GARCIA — asignado a OPTOMETRÍA y MEDICINA GENERAL

KENDY (OPTOMETRÍA) presiona "Llamar" → JUAN queda bloqueado
DR. LOPEZ (MEDICINA GENERAL) ve: [gris] JUAN GARCIA — En atención con OPTOMETRÍA

KENDY presiona "Finalizado" → JUAN queda libre
DR. LOPEZ ve: [activo] JUAN GARCIA — [Llamar]
```

## ¿Cuándo recarga la lista automáticamente?

1. **Inmediatamente** cuando Socket.io emite `asignaciones_actualizadas` para ese profesional (viene del servidor cuando la extensión hace sync o cuando otro profesional cambia el estado de un paciente compartido).
2. **Cada 60 segundos** como fallback (en caso de que el socket se desconecte momentáneamente).
3. **Al guardar la configuración** (nuevo consultorio o nuevo nombre).
