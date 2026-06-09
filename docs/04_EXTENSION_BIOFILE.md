# 04 — Extensión de Navegador (Chrome/Edge Manifest V3)

## Propósito

La extensión se instala en los PCs donde está abierto Biofile (PC de admisiones principalmente).  
Su **única función** es:
1. Detectar cuándo hay una pestaña abierta con `AtencionesSeguimiento.aspx`.
2. Leer `#LoginName` y la tabla `#TbCitasAsignadas` de esa página.
3. Enviar los datos al servidor local del turnero cada 60 segundos.

**No almacena credenciales. No escribe nada en Biofile. Solo lee.**

---

## URL objetivo

```
https://ipscertimedic.biofile.com.co/Factura/AtencionesSeguimiento.aspx
```

---

## Estructura de archivos

```
extension/
├── manifest.json
├── background.js       ← Service worker (alarma periódica)
├── content.js          ← Script inyectado en la página de Biofile
├── popup.html          ← UI mínima (estado + botón manual de sync)
├── popup.js
└── icons/
    ├── icon16.png
    ├── icon48.png
    └── icon128.png
```

---

## `manifest.json`

```json
{
    "manifest_version": 3,
    "name": "Turnero CertiMedic",
    "version": "1.0.0",
    "description": "Sincroniza las asignaciones de Biofile con el sistema de turnero.",
    "icons": {
        "16": "icons/icon16.png",
        "48": "icons/icon48.png",
        "128": "icons/icon128.png"
    },
    "action": {
        "default_popup": "popup.html",
        "default_icon": "icons/icon48.png"
    },
    "background": {
        "service_worker": "background.js"
    },
    "content_scripts": [
        {
            "matches": ["https://ipscertimedic.biofile.com.co/Factura/AtencionesSeguimiento.aspx*"],
            "js": ["content.js"],
            "run_at": "document_idle"
        }
    ],
    "permissions": [
        "alarms",
        "storage",
        "tabs"
    ],
    "host_permissions": [
        "https://ipscertimedic.biofile.com.co/*"
    ],
    "externally_connectable": {
        "matches": ["http://localhost:*/*", "http://127.0.0.1:*/*"]
    }
}
```

---

## `background.js` — Service Worker

```javascript
// URL del servidor del turnero (configurable desde popup)
const TURNERO_URL_DEFAULT = 'http://localhost:3000';
const EXTENSION_SECRET = 'CLAVE_SECRETA_PARA_VALIDAR_EXTENSION'; // Debe coincidir con .env del servidor

// Al instalar la extensión, crear la alarma periódica
chrome.runtime.onInstalled.addListener(() => {
    chrome.alarms.create('sync_biofile', { periodInMinutes: 1 }); // cada 60 segundos
    console.log('[Turnero] Extensión instalada. Alarma de sync creada.');
});

// Cada vez que suena la alarma, disparar extracción
chrome.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name === 'sync_biofile') {
        extraerYEnviar();
    }
});

// También sincronizar cuando el service worker arranca
extraerYEnviar();

async function extraerYEnviar() {
    // 1. Buscar la pestaña con AtencionesSeguimiento abierta
    const tabs = await chrome.tabs.query({
        url: 'https://ipscertimedic.biofile.com.co/Factura/AtencionesSeguimiento.aspx*'
    });

    if (tabs.length === 0) {
        console.log('[Turnero] No hay pestaña de AtencionesSeguimiento abierta.');
        await chrome.storage.local.set({ ultimo_estado: 'Sin pestaña abierta', ultimo_sync: null });
        return;
    }

    const tab = tabs[0];

    try {
        // 2. Inyectar el script de extracción en esa pestaña
        const [resultado] = await chrome.scripting.executeScript({
            target: { tabId: tab.id },
            func: extraerDatosDesdeDOM
        });

        if (!resultado || !resultado.result) {
            console.error('[Turnero] No se obtuvo resultado del script de extracción.');
            return;
        }

        const { error, data, loginName, fecha } = resultado.result;

        if (error) {
            console.error('[Turnero] Error en DOM:', error);
            await chrome.storage.local.set({ ultimo_estado: 'Error: ' + error });
            return;
        }

        // 3. Obtener configuración guardada
        const config = await chrome.storage.local.get(['turnero_url', 'terminal_id']);
        const turneroUrl = config.turnero_url || TURNERO_URL_DEFAULT;
        const terminalId = config.terminal_id || generarTerminalId();

        // 4. Enviar al servidor
        const response = await fetch(`${turneroUrl}/api/extension/sync`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-Extension-Secret': EXTENSION_SECRET,
                'X-Terminal-Id': terminalId
            },
            body: JSON.stringify({
                login_name: loginName,
                fecha: fecha,
                terminal_id: terminalId,
                pacientes: data
            })
        });

        if (response.ok) {
            const result = await response.json();
            const ahora = new Date().toLocaleTimeString('es-CO');
            await chrome.storage.local.set({
                ultimo_estado: `OK — ${result.procesados} pacientes (${ahora})`,
                ultimo_sync: new Date().toISOString(),
                ultimo_login_name: loginName
            });
            console.log(`[Turnero] Sync OK: ${result.procesados} pacientes de ${loginName}`);
        } else {
            console.error('[Turnero] Error HTTP:', response.status);
            await chrome.storage.local.set({ ultimo_estado: `Error HTTP ${response.status}` });
        }

    } catch (err) {
        console.error('[Turnero] Error de red:', err.message);
        await chrome.storage.local.set({ ultimo_estado: 'Error de red: ' + err.message });
    }
}

function generarTerminalId() {
    const id = 'ext-' + Math.random().toString(36).substr(2, 9);
    chrome.storage.local.set({ terminal_id: id });
    return id;
}

// Mensaje desde popup para sync manual
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (msg.action === 'sync_manual') {
        extraerYEnviar().then(() => sendResponse({ ok: true }));
        return true; // indica respuesta asíncrona
    }
});
```

---

## `content.js` — Script en página de Biofile

Esta función se ejecuta **en el contexto de la página de Biofile**. No puede acceder a variables del background.

```javascript
// Función que se serializa y se ejecuta en el contexto de la página web
// (No puede referenciar variables externas — todo debe estar autocontenido)
function extraerDatosDesdeDOM() {
    // 1. Verificar que la tabla existe
    const tabla = document.getElementById('TbCitasAsignadas');
    if (!tabla) {
        // Intentar forzar la búsqueda si la tabla está vacía
        const btnBuscar = document.getElementById('B_BH_TdBuscar');
        if (btnBuscar) {
            btnBuscar.click();
        }
        return { error: 'Tabla no encontrada. Se intentó forzar búsqueda.' };
    }

    // 2. Leer el LoginName
    const loginNameEl = document.getElementById('LoginName');
    const loginName = loginNameEl ? loginNameEl.innerText.trim().toUpperCase() : 'DESCONOCIDO';

    // 3. Leer la fecha del campo TxFecha (formato DD/MM/YYYY)
    const fechaEl = document.getElementById('TxFecha');
    const fecha = fechaEl ? fechaEl.value : new Date().toLocaleDateString('es-CO');

    // 4. Leer los headers de la tabla (columnas = profesionales)
    const headers = Array.from(tabla.querySelectorAll('thead th')).map(th => th.innerText.trim());
    // headers[0] suele ser 'N°', el resto son 'NOMBRE PROFESIONAL(AREA)'

    // 5. Leer filas de datos
    const pacientes = [];
    const filas = tabla.querySelectorAll('tbody tr');

    filas.forEach(fila => {
        const celdas = fila.querySelectorAll('td');

        celdas.forEach((celda, colIndex) => {
            // Saltar columna 0 (número de fila) y celdas vacías
            if (colIndex === 0 || celda.innerText.trim() === '') return;

            // Cada celda tiene múltiples líneas:
            // Línea 0: Nombre del paciente (ej: "JUAN PABLO GARCIA MARTINEZ")
            // Línea 1: Número de cédula (ej: "1043131936")
            // Línea siguiente con "Llegada:": hora de llegada en Biofile
            const lineas = celda.innerText
                .split('\n')
                .map(l => l.trim())
                .filter(l => l !== '');

            if (lineas.length < 2) return; // celda sin datos válidos

            const nombrePaciente = lineas[0];
            const numeroCedula = lineas[1].replace(/[^0-9]/g, ''); // solo dígitos

            const lineaLlegada = lineas.find(l => l.toLowerCase().startsWith('llegada:'));
            const horaLlegada = lineaLlegada
                ? lineaLlegada.replace(/llegada:/i, '').trim()
                : null;

            // Parsear el header de la columna: "KENDY ZABALETA(OPTOMETRIA)"
            const headerColumna = headers[colIndex] || `Columna${colIndex}`;
            const matchHeader = headerColumna.match(/^(.+?)\((.+?)\)$/);
            const nombreProfesional = matchHeader ? matchHeader[1].trim() : headerColumna;
            const area = matchHeader ? matchHeader[2].trim() : 'Sin área';

            pacientes.push({
                columna_header: headerColumna,
                nombre_profesional: nombreProfesional,
                area: area,
                nombre_paciente: nombrePaciente,
                numero_identificacion: numeroCedula,
                hora_llegada_biofile: horaLlegada
            });
        });
    });

    return { data: pacientes, loginName, fecha };
}
```

**IMPORTANTE:** La función `extraerDatosDesdeDOM` se pasa como argumento a `chrome.scripting.executeScript({ func: extraerDatosDesdeDOM })`. Chromium serializa la función y la ejecuta en el contexto de la página. Por esta razón, no puede cerrar sobre (closure) variables del service worker. Todo debe estar autocontenido dentro de la función.

---

## `popup.html` y `popup.js`

El popup muestra el estado de la última sincronización y permite configurar la URL del servidor.

```html
<!DOCTYPE html>
<html>
<head>
    <meta charset="utf-8">
    <style>
        body { width: 300px; font-family: system-ui, sans-serif; padding: 12px; margin: 0; font-size: 13px; }
        h3 { margin: 0 0 8px; font-size: 14px; color: #0056b3; }
        .estado { background: #f0f4ff; border-radius: 6px; padding: 8px; margin-bottom: 10px; }
        .estado .label { color: #666; font-size: 11px; margin-bottom: 2px; }
        .estado .valor { font-weight: bold; color: #222; }
        label { display: block; margin-top: 8px; color: #555; font-size: 11px; }
        input[type="text"] { width: 100%; box-sizing: border-box; padding: 5px; border: 1px solid #ccc; border-radius: 4px; margin-top: 3px; }
        button { margin-top: 10px; width: 100%; padding: 8px; background: #0056b3; color: white; border: none; border-radius: 4px; cursor: pointer; font-weight: bold; }
        button:hover { background: #004494; }
        .btn-secondary { background: #eee; color: #333; margin-top: 5px; }
        .btn-secondary:hover { background: #ddd; }
        .ok { color: #2a7a2a; }
        .error { color: #c0392b; }
    </style>
</head>
<body>
    <h3>Turnero CertiMedic</h3>
    <div class="estado">
        <div class="label">Último sync:</div>
        <div class="valor" id="ultimo-estado">Cargando...</div>
        <div class="label" style="margin-top:4px;">Profesional detectado:</div>
        <div class="valor" id="login-name">—</div>
    </div>
    <label>URL del servidor Turnero:
        <input type="text" id="url-servidor" placeholder="http://192.168.1.100:3000">
    </label>
    <button id="btn-guardar">Guardar configuración</button>
    <button id="btn-sync" class="btn-secondary">Sincronizar ahora</button>
    <script src="popup.js"></script>
</body>
</html>
```

```javascript
// popup.js
document.addEventListener('DOMContentLoaded', async () => {
    const config = await chrome.storage.local.get(['turnero_url', 'ultimo_estado', 'ultimo_login_name']);
    document.getElementById('url-servidor').value = config.turnero_url || 'http://localhost:3000';
    document.getElementById('ultimo-estado').textContent = config.ultimo_estado || 'Sin datos';
    document.getElementById('login-name').textContent = config.ultimo_login_name || '—';

    document.getElementById('btn-guardar').addEventListener('click', async () => {
        const url = document.getElementById('url-servidor').value.trim();
        await chrome.storage.local.set({ turnero_url: url });
        document.getElementById('btn-guardar').textContent = '✓ Guardado';
        setTimeout(() => { document.getElementById('btn-guardar').textContent = 'Guardar configuración'; }, 1500);
    });

    document.getElementById('btn-sync').addEventListener('click', async () => {
        document.getElementById('btn-sync').textContent = 'Sincronizando...';
        await chrome.runtime.sendMessage({ action: 'sync_manual' });
        const estado = await chrome.storage.local.get('ultimo_estado');
        document.getElementById('ultimo-estado').textContent = estado.ultimo_estado || '—';
        document.getElementById('btn-sync').textContent = 'Sincronizar ahora';
    });
});
```

---

## Instalación en cada PC

1. Abrir Chrome o Edge.
2. Ir a `chrome://extensions` (o `edge://extensions`).
3. Activar **"Modo desarrollador"** (toggle en la esquina superior derecha).
4. Hacer clic en **"Cargar extensión sin empaquetar"**.
5. Seleccionar la carpeta `extension/` del proyecto.
6. La extensión aparece en la lista. Hacer clic en el ícono del puzzle → Turnero CertiMedic → Fijar.
7. Configurar la URL del servidor en el popup (la primera vez).

---

## Consideraciones importantes

- **La extensión SOLO funciona cuando `AtencionesSeguimiento.aspx` está abierta en una pestaña**. Debe quedar abierta en segundo plano todo el tiempo.
- Si Biofile cierra sesión, la extensión no podrá leer datos. El servidor mostrará "Sin datos del día" y los profesionales no recibirán nuevas asignaciones.
- Si la tabla está vacía al momento de leer (por ejemplo, antes de que cargue), el script hace un clic automático en el botón Buscar. Si esto falla, en el siguiente ciclo de 60 segundos volverá a intentar.
- **Autoactualización de la fecha:** La extensión lee el valor de `#TxFecha`. Si Biofile no tiene la fecha de hoy, puede ser necesario establecerla programáticamente:
  ```javascript
  const hoy = new Date().toLocaleDateString('es-CO', {day:'2-digit', month:'2-digit', year:'numeric'});
  document.getElementById('TxFecha').value = hoy;
  ```
  Incluir esto antes del clic en buscar si la fecha no es la de hoy.
