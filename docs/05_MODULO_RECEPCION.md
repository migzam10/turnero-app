# 05 — Módulo de Recepción

URL: `http://SERVER_IP:3000/recepcion`  
Archivo: `public/recepcion/index.html`

---

## ¿Qué hace este módulo?

El personal de recepción escanea la cédula del paciente con la **pistola lectora de códigos de barras/QR**. El módulo captura esa lectura, extrae los datos del documento de identidad colombiano, y registra al paciente en la cola del turnero con la hora real de llegada.

También permite ajustar la prioridad antes de que el paciente sea llamado por admisiones.

---

## Cómo funciona el escáner de cédulas

La pistola de escáner actúa como un **teclado virtual**: cuando escanea un código, envía los caracteres como si el usuario los hubiera escrito con el teclado. Al final del escaneo, suele enviar un carácter `Enter`.

El módulo de recepción tiene un **campo de input oculto** siempre enfocado que captura la entrada del escáner.

### Formato de salida del escáner (cédulas colombianas)

**Cédula con código de barras (Code 39 / PDF417):**  
Los datos están separados por el carácter de separación que configure el lector. El orden estándar de la cédula colombiana en el código de barras PDF417 es:

```
APELLIDO1 APELLIDO2 NOMBRES NUMERO_CEDULA FECHA_NACIMIENTO LUGAR_NACIMIENTO GENERO
```

**Cédula con QR (nueva cédula digital):**  
El QR contiene los campos en un formato de texto que puede variar. Puede ser un JSON o un string con separadores.

**IMPORTANTE para el desarrollador:** El formato exacto depende de la **configuración de la pistola lectora** que se use en CertiMedic. Antes de desarrollar el parser, el equipo debe:
1. Conectar la pistola al PC.
2. Abrir el Bloc de notas.
3. Escanear una cédula y observar exactamente qué texto aparece.
4. Con ese ejemplo real, ajustar la función `parsearEscaneo()` descrita abajo.

### Formato más común (cédulas con PDF417):

```
GARCIA MARTINEZ JUAN PABLO 1043131936 15031990 BARRANQUILLA COLOMBIA M
```
o con separadores de Tab:
```
GARCIA\tMARTINEZ\tJUAN\tPABLO\t1043131936\t15/03/1990\tBARRANQUILLA\tM
```

---

## Estructura HTML del módulo

```html
<!DOCTYPE html>
<html lang="es">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Recepción — Turnero CertiMedic</title>
    <link rel="stylesheet" href="/assets/css/main.css">
</head>
<body>
    <header>
        <h1>Recepción</h1>
        <div id="reloj"></div>
    </header>

    <!-- Input oculto que captura el escáner -->
    <input
        type="text"
        id="scanner-input"
        autocomplete="off"
        style="position:fixed; top:-100px; left:-100px; opacity:0;"
        placeholder="Escanee aquí"
    >

    <main>
        <!-- Estado del scanner -->
        <div id="scanner-estado" class="card">
            <div class="scanner-icon">📷</div>
            <p>Listo para escanear</p>
            <p class="hint">Escanee la cédula del paciente</p>
        </div>

        <!-- Vista previa de los datos escaneados (antes de guardar) -->
        <div id="preview-paciente" class="card hidden">
            <h2>Datos del paciente</h2>
            <div class="datos-grid">
                <div class="dato-item">
                    <label>Cédula:</label>
                    <span id="prev-cedula"></span>
                </div>
                <div class="dato-item">
                    <label>Nombre completo:</label>
                    <span id="prev-nombre"></span>
                </div>
                <div class="dato-item">
                    <label>Fecha nacimiento:</label>
                    <span id="prev-fechanac"></span>
                </div>
                <div class="dato-item">
                    <label>Ciudad nacimiento:</label>
                    <span id="prev-ciudad"></span>
                </div>
            </div>

            <div class="prioridad-selector">
                <label>Prioridad:</label>
                <div class="btn-group">
                    <button class="btn-prioridad activo" data-valor="normal">Normal</button>
                    <button class="btn-prioridad" data-valor="media">Media</button>
                    <button class="btn-prioridad" data-valor="alta">Alta</button>
                </div>
            </div>

            <div class="acciones">
                <button id="btn-confirmar" class="btn-primary">✓ Registrar llegada</button>
                <button id="btn-cancelar" class="btn-secondary">✗ Cancelar</button>
            </div>
        </div>

        <!-- Feedback de registro exitoso -->
        <div id="registro-ok" class="card success hidden">
            <div class="check-icon">✓</div>
            <h2 id="ok-nombre"></h2>
            <p id="ok-hora"></p>
            <p>Puede escanear el siguiente paciente</p>
        </div>

        <!-- Error de duplicado -->
        <div id="registro-duplicado" class="card warning hidden">
            <h2>⚠ Paciente ya registrado hoy</h2>
            <p id="dup-nombre"></p>
            <p id="dup-hora"></p>
            <button id="btn-dup-ok">Entendido</button>
        </div>

        <!-- Lista de pacientes del día (panel derecho) -->
        <aside id="panel-cola">
            <h3>Cola del día (<span id="total-espera">0</span>)</h3>
            <div id="lista-cola"></div>
        </aside>
    </main>

    <script src="/socket.io/socket.io.js"></script>
    <script src="/assets/js/recepcion.js"></script>
</body>
</html>
```

---

## `public/assets/js/recepcion.js`

```javascript
// ──────────────────────────────────────────────────────────────
// CONFIGURACIÓN
// ──────────────────────────────────────────────────────────────
const TERMINAL_ID = obtenerOCrearTerminalId();
const socket = io({ auth: { terminalId: TERMINAL_ID } });

// ──────────────────────────────────────────────────────────────
// SOCKET.IO
// ──────────────────────────────────────────────────────────────
socket.on('connect', () => {
    socket.emit('join', { tipo: 'recepcion', terminalId: TERMINAL_ID });
});

socket.on('cola_actualizada', () => {
    cargarCola();
});

// ──────────────────────────────────────────────────────────────
// CAPTURA DEL ESCÁNER
// ──────────────────────────────────────────────────────────────
const scannerInput = document.getElementById('scanner-input');
let bufferScanner = '';
let timerScanner = null;

// Mantener el input del scanner siempre enfocado
document.addEventListener('click', () => scannerInput.focus());
document.addEventListener('keydown', () => scannerInput.focus());
scannerInput.focus();

scannerInput.addEventListener('input', (e) => {
    bufferScanner = scannerInput.value;
    // El escáner envía todos los caracteres muy rápido.
    // Esperar 200ms desde el último carácter para procesar.
    clearTimeout(timerScanner);
    timerScanner = setTimeout(() => {
        if (bufferScanner.trim().length > 10) {
            procesarEscaneo(bufferScanner.trim());
        }
        bufferScanner = '';
        scannerInput.value = '';
    }, 200);
});

// También capturar Enter (muchos scanners envían Enter al final)
scannerInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter' && bufferScanner.length > 10) {
        clearTimeout(timerScanner);
        procesarEscaneo(bufferScanner.trim().replace(/\n/g, ''));
        bufferScanner = '';
        scannerInput.value = '';
    }
});

// ──────────────────────────────────────────────────────────────
// PARSER DEL ESCANEO
// ──────────────────────────────────────────────────────────────
/**
 * IMPORTANTE: Este parser debe ajustarse según el output real del scanner de CertiMedic.
 * Probar con el Bloc de notas antes de implementar.
 *
 * Se asume que el scanner envía los campos separados por TAB o espacio,
 * en el orden: APELLIDO1 APELLIDO2 NOMBRE1 NOMBRE2 CEDULA FECHANAC CIUDAD GENERO
 *
 * O también puede ser que envíe como QR con JSON.
 */
function parsearEscaneo(rawText) {
    // Intentar parsear como JSON (cédulas QR nuevas)
    try {
        const datos = JSON.parse(rawText);
        if (datos.documentNumber || datos.cedula) {
            return {
                numero_identificacion: datos.documentNumber || datos.cedula,
                primer_apellido: datos.surname1 || datos.primerApellido || '',
                segundo_apellido: datos.surname2 || datos.segundoApellido || '',
                primer_nombre: datos.givenName1 || datos.primerNombre || '',
                segundo_nombre: datos.givenName2 || datos.segundoNombre || '',
                fecha_nacimiento: datos.birthDate || datos.fechaNacimiento || '',
                ciudad_nacimiento: datos.birthPlace || datos.ciudadNacimiento || '',
                genero: datos.gender || datos.genero || ''
            };
        }
    } catch (e) {
        // No es JSON, intentar formato de string
    }

    // Formato Tab-separado (configuración de pistola de barras)
    // AJUSTAR ESTE ORDEN SEGÚN EL SCANNER REAL DE CERTIMEDIC
    const campos = rawText.split('\t');
    if (campos.length >= 5) {
        return {
            primer_apellido: campos[0] || '',
            segundo_apellido: campos[1] || '',
            primer_nombre: campos[2] || '',
            segundo_nombre: campos[3] || '',
            numero_identificacion: campos[4] || '',
            fecha_nacimiento: campos[5] || '',
            ciudad_nacimiento: campos[6] || '',
            genero: campos[7] || ''
        };
    }

    // Formato espacio (último recurso)
    // AJUSTAR SEGÚN NECESIDAD
    const partes = rawText.split(' ');
    if (partes.length >= 5) {
        return {
            primer_apellido: partes[0] || '',
            segundo_apellido: partes[1] || '',
            primer_nombre: partes[2] || '',
            segundo_nombre: partes[3] || '',
            numero_identificacion: partes[4] || '',
            fecha_nacimiento: partes[5] || '',
            ciudad_nacimiento: partes.slice(6).join(' ') || '',
            genero: ''
        };
    }

    return null;
}

// ──────────────────────────────────────────────────────────────
// FLUJO PRINCIPAL
// ──────────────────────────────────────────────────────────────
let datosActuales = null;
let prioridadActual = 'normal';

function procesarEscaneo(rawText) {
    const datos = parsearEscaneo(rawText);
    if (!datos || !datos.numero_identificacion) {
        mostrarError('No se pudieron leer los datos del documento. Intente nuevamente.');
        return;
    }
    datosActuales = datos;
    mostrarPreview(datos);
}

function mostrarPreview(datos) {
    document.getElementById('scanner-estado').classList.add('hidden');
    document.getElementById('preview-paciente').classList.remove('hidden');
    document.getElementById('prev-cedula').textContent = datos.numero_identificacion;
    document.getElementById('prev-nombre').textContent =
        `${datos.primer_nombre} ${datos.segundo_nombre || ''} ${datos.primer_apellido} ${datos.segundo_apellido || ''}`.trim();
    document.getElementById('prev-fechanac').textContent = datos.fecha_nacimiento || '—';
    document.getElementById('prev-ciudad').textContent = datos.ciudad_nacimiento || '—';
}

document.getElementById('btn-confirmar').addEventListener('click', async () => {
    if (!datosActuales) return;

    try {
        const resp = await fetch('/api/recepcion/registrar', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-Terminal-Id': TERMINAL_ID
            },
            body: JSON.stringify({ ...datosActuales, prioridad: prioridadActual, terminal_recepcion: TERMINAL_ID })
        });

        const resultado = await resp.json();

        if (resp.status === 409) {
            // Paciente ya registrado hoy
            mostrarDuplicado(resultado.paciente);
            return;
        }

        if (!resp.ok) throw new Error(resultado.mensaje || 'Error del servidor');

        mostrarRegistroOk(resultado.paciente);

    } catch (err) {
        mostrarError('Error al registrar: ' + err.message);
    }
});

document.getElementById('btn-cancelar').addEventListener('click', resetearVista);

// Selector de prioridad
document.querySelectorAll('.btn-prioridad').forEach(btn => {
    btn.addEventListener('click', () => {
        document.querySelectorAll('.btn-prioridad').forEach(b => b.classList.remove('activo'));
        btn.classList.add('activo');
        prioridadActual = btn.dataset.valor;
    });
});

function mostrarRegistroOk(paciente) {
    ocultarTodo();
    document.getElementById('registro-ok').classList.remove('hidden');
    document.getElementById('ok-nombre').textContent =
        `${paciente.primer_nombre} ${paciente.primer_apellido}`;
    document.getElementById('ok-hora').textContent =
        `Hora de llegada: ${new Date(paciente.hora_llegada).toLocaleTimeString('es-CO')}`;

    setTimeout(resetearVista, 4000); // Auto-resetear después de 4 segundos
}

function mostrarDuplicado(paciente) {
    ocultarTodo();
    document.getElementById('registro-duplicado').classList.remove('hidden');
    document.getElementById('dup-nombre').textContent =
        `${paciente.primer_nombre} ${paciente.primer_apellido}`;
    document.getElementById('dup-hora').textContent =
        `Registrado a las: ${new Date(paciente.hora_llegada).toLocaleTimeString('es-CO')}`;
}

document.getElementById('btn-dup-ok').addEventListener('click', resetearVista);

function mostrarError(msg) {
    console.error(msg);
    alert(msg); // En producción reemplazar con un toast/modal más elegante
    resetearVista();
}

function ocultarTodo() {
    ['scanner-estado', 'preview-paciente', 'registro-ok', 'registro-duplicado']
        .forEach(id => document.getElementById(id).classList.add('hidden'));
}

function resetearVista() {
    ocultarTodo();
    document.getElementById('scanner-estado').classList.remove('hidden');
    datosActuales = null;
    prioridadActual = 'normal';
    document.querySelectorAll('.btn-prioridad').forEach(b => {
        b.classList.toggle('activo', b.dataset.valor === 'normal');
    });
    scannerInput.focus();
}

// ──────────────────────────────────────────────────────────────
// PANEL LATERAL: COLA DEL DÍA
// ──────────────────────────────────────────────────────────────
async function cargarCola() {
    const resp = await fetch('/api/recepcion/cola', {
        headers: { 'X-Terminal-Id': TERMINAL_ID }
    });
    const pacientes = await resp.json();

    document.getElementById('total-espera').textContent =
        pacientes.filter(p => p.estado_admision === 'esperando').length;

    const lista = document.getElementById('lista-cola');
    lista.innerHTML = pacientes.map(p => `
        <div class="paciente-item estado-${p.estado_admision} prioridad-${p.prioridad}">
            <div class="paciente-nombre">${p.primer_nombre} ${p.primer_apellido}</div>
            <div class="paciente-info">
                <span class="hora">${new Date(p.hora_llegada).toLocaleTimeString('es-CO', {hour:'2-digit',minute:'2-digit'})}</span>
                <span class="prioridad-badge ${p.prioridad}">${p.prioridad}</span>
                <span class="estado-badge">${formatearEstado(p.estado_admision)}</span>
            </div>
            ${p.estado_admision === 'esperando' ? `
                <div class="acciones-cola">
                    <button onclick="cambiarPrioridad('${p.id}', 'normal')" class="mini ${p.prioridad==='normal'?'activo':''}">N</button>
                    <button onclick="cambiarPrioridad('${p.id}', 'media')" class="mini ${p.prioridad==='media'?'activo':''}">M</button>
                    <button onclick="cambiarPrioridad('${p.id}', 'alta')" class="mini ${p.prioridad==='alta'?'activo':''}">A</button>
                </div>
            ` : ''}
        </div>
    `).join('');
}

async function cambiarPrioridad(id, prioridad) {
    await fetch(`/api/recepcion/prioridad/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', 'X-Terminal-Id': TERMINAL_ID },
        body: JSON.stringify({ prioridad })
    });
    // El socket.io emitirá cola_actualizada que recargará la lista
}

function formatearEstado(estado) {
    return { 'esperando': 'En espera', 'llamando_admision': 'Siendo llamado', 'admisionado': 'Admisionado' }[estado] || estado;
}

// ──────────────────────────────────────────────────────────────
// RELOJ
// ──────────────────────────────────────────────────────────────
function actualizarReloj() {
    document.getElementById('reloj').textContent =
        new Date().toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}
setInterval(actualizarReloj, 1000);
actualizarReloj();

// ──────────────────────────────────────────────────────────────
// TERMINAL ID
// ──────────────────────────────────────────────────────────────
function obtenerOCrearTerminalId() {
    let id = localStorage.getItem('turnero_terminal_id');
    if (!id) {
        id = 'term-' + Date.now() + '-' + Math.random().toString(36).substr(2, 6);
        localStorage.setItem('turnero_terminal_id', id);
    }
    return id;
}

// ──────────────────────────────────────────────────────────────
// INICIALIZAR
// ──────────────────────────────────────────────────────────────
cargarCola();
```

---

## Notas de implementación

- **El reloj en el header** debe mostrar la hora actual para que el personal pueda verificar que coincide con la hora de llegada real.
- **El panel lateral** de cola se actualiza automáticamente vía Socket.io cuando hay cambios. También hay un `setInterval` de fallback cada 30 segundos para casos donde el socket falle.
- **La prioridad puede cambiarse** desde el panel lateral tanto en recepción como en admisiones. El cambio es inmediato y se refleja en todos los terminales vía Socket.io.
- **El estado de admisión no se cambia desde recepción** — eso lo hace admisiones.
