# 06 — Módulo de Admisiones

URL: `http://SERVER_IP:3000/admisiones`  
Archivo: `public/admisiones/index.html`

---

## ¿Qué hace este módulo?

El personal de admisiones (2–3 personas) usa este módulo para:
1. Ver la lista de pacientes en espera ordenada por prioridad.
2. Llamar a un paciente para que se acerque a su módulo.
3. Copiar los datos del paciente al portapapeles en formato especial para pegar en Biofile (`OrdenesServiciosSaludOcupacional.aspx`).
4. Confirmar que el paciente fue admisionado (ingresado a Biofile).
5. Ajustar prioridades si recepción no lo hizo.

---

## Pantalla de admisiones — Layout

```
┌──────────────────────────────────────────────────────────────────┐
│  ADMISIONES — Módulo 2          [Reloj]            [Config]      │
├──────────────────────────────────────────────────────────────────┤
│                                                                  │
│  COLA EN ESPERA (12)                                             │
│  ┌────────────────────────────────────────────────────────────┐  │
│  │ [ALTA] PEDRO RAMIREZ          07:15   [Llamar] [Ver datos] │  │
│  │ [ALTA] ANA GONZALEZ           07:22   [Llamar] [Ver datos] │  │
│  │ [MEDIA] LUIS MARTINEZ         07:45   [Llamar] [Ver datos] │  │
│  │ [NORM] SOFIA PEREZ            08:01   [Llamar] [Ver datos] │  │
│  │ ...                                                        │  │
│  └────────────────────────────────────────────────────────────┘  │
│                                                                  │
│  EN PROCESO — Módulo 2                                           │
│  ┌────────────────────────────────────────────────────────────┐  │
│  │ Llamando: PEDRO RAMIREZ (desde 08:32)                      │  │
│  │           [✓ Fue admisionado]  [✗ No vino]                │  │
│  └────────────────────────────────────────────────────────────┘  │
└──────────────────────────────────────────────────────────────────┘
```

---

## Panel de datos del paciente (modal al hacer clic en "Ver datos")

Aparece un modal con:
- Nombre completo
- Número de cédula
- Fecha de nacimiento
- Ciudad de nacimiento
- Hora de llegada al turnero
- Prioridad (modificable)
- Botón: **"📋 Copiar datos para Biofile"**

### Función de pegado especial

Cuando el personal hace clic en "Copiar datos para Biofile":
1. El sistema construye el string Tab-separado en el orden exacto de los campos de `OrdenesServiciosSaludOcupacional.aspx` (por tabindex):

```javascript
function construirStringPegado(paciente) {
    // Orden según tabindex de OrdenesServiciosSaludOcupacional.aspx:
    // tabindex=1: TxtNumeroIdentificacion
    // tabindex=2: TxtCiudadNacimiento
    // tabindex=3: TxtFechaNacimiento (formato dd/MM/yyyy)
    // tabindex=4: TxtPrimerApellido
    // tabindex=5: TxtSegundoApellido
    // tabindex=6: TxtPrimerNombre
    // tabindex=7: TxtSegundoNombre
    const campos = [
        paciente.numero_identificacion,
        paciente.ciudad_nacimiento || '',
        paciente.fecha_nacimiento || '',   // debe estar en formato dd/MM/yyyy
        paciente.primer_apellido || '',
        paciente.segundo_apellido || '',
        paciente.primer_nombre || '',
        paciente.segundo_nombre || ''
    ];
    return campos.join('\t');
}
```

2. Se copia al portapapeles con `navigator.clipboard.writeText(tabString)`.
3. El personal hace clic en el campo `TxtNumeroIdentificacion` de Biofile y pega (`Ctrl+V`).
4. Los Tabs rellenan automáticamente los siguientes campos en Biofile.

**Nota:** El formato de fecha debe ser `dd/MM/yyyy` (Ej: `15/03/1990`). Si el scanner entrega otro formato, convertirlo en el backend.

---

## HTML del módulo

```html
<!DOCTYPE html>
<html lang="es">
<head>
    <meta charset="UTF-8">
    <title>Admisiones — Turnero CertiMedic</title>
    <link rel="stylesheet" href="/assets/css/main.css">
</head>
<body>
    <header>
        <h1>Admisiones — <span id="nombre-modulo">Módulo ?</span></h1>
        <div id="reloj"></div>
        <button id="btn-config" onclick="abrirConfig()">⚙</button>
    </header>

    <!-- Modal de configuración del módulo -->
    <div id="modal-config" class="modal hidden">
        <div class="modal-content">
            <h2>Configuración del terminal</h2>
            <label>Número de módulo:
                <select id="select-modulo"></select>
            </label>
            <button onclick="guardarConfig()">Guardar</button>
            <button onclick="cerrarConfig()">Cancelar</button>
        </div>
    </div>

    <main>
        <!-- Cola en espera -->
        <section id="seccion-cola">
            <h2>Cola en espera (<span id="total-espera">0</span>)</h2>
            <div id="lista-cola"></div>
        </section>

        <!-- Paciente en proceso (llamado pero no admisionado aún) -->
        <section id="seccion-en-proceso" class="hidden">
            <h2>En proceso</h2>
            <div id="panel-en-proceso">
                <div id="proc-nombre"></div>
                <div id="proc-tiempo"></div>
                <button id="btn-admisionado" class="btn-success">✓ Paciente admisionado</button>
                <button id="btn-no-vino" class="btn-warning">✗ No se presentó</button>
            </div>
        </section>
    </main>

    <!-- Modal de datos del paciente -->
    <div id="modal-paciente" class="modal hidden">
        <div class="modal-content">
            <button class="btn-close" onclick="cerrarModalPaciente()">✕</button>
            <h2 id="modal-nombre-pac"></h2>
            <div class="datos-paciente">
                <div><label>Cédula:</label> <span id="modal-cedula"></span></div>
                <div><label>Fecha nac.:</label> <span id="modal-fechanac"></span></div>
                <div><label>Ciudad nac.:</label> <span id="modal-ciudad"></span></div>
                <div><label>Llegada:</label> <span id="modal-llegada"></span></div>
            </div>
            <div class="prioridad-selector">
                <label>Prioridad:</label>
                <div class="btn-group">
                    <button class="btn-prioridad" data-valor="normal">Normal</button>
                    <button class="btn-prioridad" data-valor="media">Media</button>
                    <button class="btn-prioridad" data-valor="alta">Alta</button>
                </div>
            </div>
            <button id="btn-copiar-biofile" class="btn-primary">
                📋 Copiar datos para Biofile
            </button>
            <div id="copiado-ok" class="hidden success-msg">✓ Datos copiados al portapapeles</div>
            <button id="btn-llamar-desde-modal" class="btn-call">
                📢 Llamar paciente
            </button>
        </div>
    </div>

    <script src="/socket.io/socket.io.js"></script>
    <script src="/assets/js/admisiones.js"></script>
</body>
</html>
```

---

## `public/assets/js/admisiones.js`

```javascript
const TERMINAL_ID = obtenerOCrearTerminalId();
const socket = io({ auth: { terminalId: TERMINAL_ID } });

let moduloActual = localStorage.getItem('admisiones_modulo') || null;
let pacienteEnProceso = null;
let pacienteModalActual = null;

// ── Socket ────────────────────────────────────────────────────

socket.on('connect', () => {
    socket.emit('join', { tipo: 'admisiones', terminalId: TERMINAL_ID });
});

socket.on('cola_actualizada', () => {
    cargarCola();
});

// ── Inicialización ────────────────────────────────────────────

async function init() {
    if (!moduloActual) {
        await cargarModulosYMostrarConfig();
    } else {
        document.getElementById('nombre-modulo').textContent = moduloActual;
    }
    cargarCola();
    actualizarReloj();
    setInterval(actualizarReloj, 1000);
    // Fallback: recargar cola cada 30s aunque no llegue socket event
    setInterval(cargarCola, 30000);
}

// ── Configuración del módulo ──────────────────────────────────

async function abrirConfig() {
    await cargarModulosYMostrarConfig();
}

async function cargarModulosYMostrarConfig() {
    const resp = await fetch('/api/admin/config', {
        headers: { 'X-Terminal-Id': TERMINAL_ID }
    });
    const config = await resp.json();
    const modulos = JSON.parse(config.modulos_admisiones || '["Módulo 1","Módulo 2","Módulo 3"]');

    const select = document.getElementById('select-modulo');
    select.innerHTML = modulos.map(m =>
        `<option value="${m}" ${m === moduloActual ? 'selected' : ''}>${m}</option>`
    ).join('');

    document.getElementById('modal-config').classList.remove('hidden');
}

function guardarConfig() {
    moduloActual = document.getElementById('select-modulo').value;
    localStorage.setItem('admisiones_modulo', moduloActual);
    document.getElementById('nombre-modulo').textContent = moduloActual;
    cerrarConfig();
}

function cerrarConfig() {
    document.getElementById('modal-config').classList.add('hidden');
}

// ── Cola de pacientes ─────────────────────────────────────────

async function cargarCola() {
    const resp = await fetch('/api/admisiones/cola', {
        headers: { 'X-Terminal-Id': TERMINAL_ID }
    });
    const pacientes = await resp.json();

    const enEspera = pacientes.filter(p => p.estado_admision === 'esperando');
    document.getElementById('total-espera').textContent = enEspera.length;

    const lista = document.getElementById('lista-cola');
    lista.innerHTML = enEspera.map(p => `
        <div class="paciente-row prioridad-${p.prioridad}" data-id="${p.id}">
            <span class="badge-prioridad ${p.prioridad}">${p.prioridad.toUpperCase()}</span>
            <span class="nombre-paciente">${p.primer_nombre} ${p.segundo_nombre || ''} ${p.primer_apellido}</span>
            <span class="hora-llegada">${formatHora(p.hora_llegada)}</span>
            <div class="acciones">
                <button class="btn-ver" onclick="abrirModalPaciente('${p.id}')">📋 Ver datos</button>
                <button class="btn-llamar-direct" onclick="llamarPaciente('${p.id}')">📢 Llamar</button>
            </div>
        </div>
    `).join('') || '<p class="vacio">No hay pacientes en espera</p>';
}

// ── Modal de paciente ─────────────────────────────────────────

async function abrirModalPaciente(pacienteId) {
    const resp = await fetch('/api/admisiones/cola', {
        headers: { 'X-Terminal-Id': TERMINAL_ID }
    });
    const pacientes = await resp.json();
    const paciente = pacientes.find(p => p.id === pacienteId);
    if (!paciente) return;

    pacienteModalActual = paciente;

    document.getElementById('modal-nombre-pac').textContent =
        `${paciente.primer_nombre} ${paciente.segundo_nombre || ''} ${paciente.primer_apellido} ${paciente.segundo_apellido || ''}`.trim();
    document.getElementById('modal-cedula').textContent = paciente.numero_identificacion;
    document.getElementById('modal-fechanac').textContent = paciente.fecha_nacimiento || '—';
    document.getElementById('modal-ciudad').textContent = paciente.ciudad_nacimiento || '—';
    document.getElementById('modal-llegada').textContent = formatHora(paciente.hora_llegada);

    document.querySelectorAll('.btn-prioridad').forEach(b => {
        b.classList.toggle('activo', b.dataset.valor === paciente.prioridad);
    });

    document.getElementById('copiado-ok').classList.add('hidden');
    document.getElementById('modal-paciente').classList.remove('hidden');
}

function cerrarModalPaciente() {
    document.getElementById('modal-paciente').classList.add('hidden');
    pacienteModalActual = null;
}

// Copiar datos para Biofile
document.getElementById('btn-copiar-biofile').addEventListener('click', async () => {
    if (!pacienteModalActual) return;

    const resp = await fetch(`/api/admisiones/datos-pegado/${pacienteModalActual.id}`, {
        headers: { 'X-Terminal-Id': TERMINAL_ID }
    });
    const datos = await resp.json();

    await navigator.clipboard.writeText(datos.tab_string);
    document.getElementById('copiado-ok').classList.remove('hidden');
    setTimeout(() => document.getElementById('copiado-ok').classList.add('hidden'), 3000);
});

// Llamar desde el modal
document.getElementById('btn-llamar-desde-modal').addEventListener('click', async () => {
    if (!pacienteModalActual) return;
    await llamarPaciente(pacienteModalActual.id);
    cerrarModalPaciente();
});

// Selector de prioridad en el modal
document.querySelectorAll('.btn-prioridad').forEach(btn => {
    btn.addEventListener('click', async () => {
        if (!pacienteModalActual) return;
        await fetch(`/api/admisiones/prioridad/${pacienteModalActual.id}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json', 'X-Terminal-Id': TERMINAL_ID },
            body: JSON.stringify({ prioridad: btn.dataset.valor })
        });
        document.querySelectorAll('.btn-prioridad').forEach(b => b.classList.remove('activo'));
        btn.classList.add('activo');
        pacienteModalActual.prioridad = btn.dataset.valor;
    });
});

// ── Llamar paciente ───────────────────────────────────────────

async function llamarPaciente(pacienteId) {
    if (!moduloActual) {
        alert('Primero configure el módulo de admisiones (ícono ⚙)');
        return;
    }

    const resp = await fetch(`/api/admisiones/llamar/${pacienteId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Terminal-Id': TERMINAL_ID },
        body: JSON.stringify({ modulo: moduloActual, terminal_id: TERMINAL_ID })
    });

    if (!resp.ok) return;

    const colaResp = await fetch('/api/admisiones/cola', { headers: { 'X-Terminal-Id': TERMINAL_ID } });
    const pacientes = await colaResp.json();
    pacienteEnProceso = pacientes.find(p => p.id === pacienteId);

    mostrarPanelEnProceso();
    cargarCola();
}

function mostrarPanelEnProceso() {
    if (!pacienteEnProceso) return;
    document.getElementById('seccion-en-proceso').classList.remove('hidden');
    document.getElementById('proc-nombre').textContent =
        `${pacienteEnProceso.primer_nombre} ${pacienteEnProceso.primer_apellido}`;
    document.getElementById('proc-tiempo').textContent =
        `Llamado a las ${formatHora(new Date().toISOString())}`;
}

// Confirmar que fue admisionado (ingresado en Biofile)
document.getElementById('btn-admisionado').addEventListener('click', async () => {
    if (!pacienteEnProceso) return;
    await fetch(`/api/admisiones/admisionar/${pacienteEnProceso.id}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Terminal-Id': TERMINAL_ID },
        body: JSON.stringify({ terminal_id: TERMINAL_ID })
    });
    pacienteEnProceso = null;
    document.getElementById('seccion-en-proceso').classList.add('hidden');
    cargarCola();
});

// No se presentó — devolver a la cola (o quitar si corresponde)
document.getElementById('btn-no-vino').addEventListener('click', async () => {
    if (!pacienteEnProceso) return;
    // Devolver a estado 'esperando' pero mantenerlo en la cola
    await fetch(`/api/admisiones/prioridad/${pacienteEnProceso.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', 'X-Terminal-Id': TERMINAL_ID },
        body: JSON.stringify({ prioridad: pacienteEnProceso.prioridad })
    });
    // Resetear estado admision a 'esperando'
    await fetch(`/api/admisiones/devolver/${pacienteEnProceso.id}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Terminal-Id': TERMINAL_ID }
    });
    pacienteEnProceso = null;
    document.getElementById('seccion-en-proceso').classList.add('hidden');
    cargarCola();
});

// ── Helpers ───────────────────────────────────────────────────

function formatHora(isoString) {
    if (!isoString) return '—';
    return new Date(isoString).toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit' });
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

## Notas adicionales

### Endpoint adicional necesario: `POST /api/admisiones/devolver/:id`

Cuando el paciente no se presentó al ser llamado, este endpoint lo regresa al estado `esperando`:

```javascript
// En api.admisiones.js
router.post('/devolver/:id', async (req, res) => {
    const { modulo } = req.body;
    try {
        const { rowCount } = await query(
            `UPDATE pacientes_cola
             SET estado_admision = 'esperando',
                 hora_llamado_admision = NULL,
                 modulo_admision = NULL,
                 updated_at = NOW()
             WHERE id = $1 AND estado_admision = 'llamando_admision'`,
            [req.params.id]
        );
        if (rowCount === 0) return res.status(409).json({ error: 'Estado inválido para devolver' });

        const io = req.app.get('io');
        io.to('admisiones').to('recepcion').emit('cola_actualizada');
        io.to('display').emit('display_evento', {
            tipo: 'admision_cancelado',
            paciente_nombre: null,
            modulo: modulo || null
        });
        res.json({ mensaje: 'ok' });
    } catch (err) {
        console.error('[admisiones/devolver]', err);
        res.status(500).json({ error: 'db_error', mensaje: err.message });
    }
});
```

### Seguridad del portapapeles

`navigator.clipboard.writeText()` requiere que la página esté en un **contexto seguro** (HTTPS o localhost). Si el servidor corre en la red local sin HTTPS, el portapapeles puede no funcionar en algunos navegadores. Solución: usar un `document.execCommand('copy')` como fallback sobre un textarea temporal.

```javascript
// Fallback para clipboard sin HTTPS
function copiarAlPortapapeles(texto) {
    if (navigator.clipboard) {
        return navigator.clipboard.writeText(texto);
    }
    // Fallback
    const textarea = document.createElement('textarea');
    textarea.value = texto;
    textarea.style.position = 'fixed';
    textarea.style.opacity = '0';
    document.body.appendChild(textarea);
    textarea.focus();
    textarea.select();
    document.execCommand('copy');
    document.body.removeChild(textarea);
    return Promise.resolve();
}
```

### Múltiples terminales de admisiones

Si dos personas de admisiones llaman al mismo paciente simultáneamente, el segundo `llamar` debe retornar un error (o un aviso) porque el estado ya cambió a `llamando_admision`. El servidor debe verificar el estado antes de actualizar.
