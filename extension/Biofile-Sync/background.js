importScripts('config.js');

chrome.runtime.onInstalled.addListener(() => {
    chrome.alarms.create('sync', { periodInMinutes: CONFIG.INTERVALO_MIN });
});

chrome.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name === 'sync') ejecutarSync();
});

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (msg.tipo !== 'SYNC_AHORA') return;
    ejecutarSync().then(sendResponse).catch(err => sendResponse({ error: err.message }));
    return true;
});

// Se ejecuta directamente en el contexto de la página — no depende del content script
function extraerPacientes() {
    const loginName = document.querySelector('#LoginName')?.textContent.trim() || null;
    const tabla = document.querySelector('#TbCitasAsignadas');
    if (!tabla) return { loginName, pacientes: [] };

    const headers = Array.from(tabla.querySelectorAll('thead th')).map(th => th.textContent.trim());
    const pacientes = [];

    tabla.querySelectorAll('tbody tr').forEach(fila => {
        const celdas = fila.querySelectorAll('td');
        for (let i = 1; i < celdas.length; i++) {
            const celda = celdas[i];
            const texto = celda.innerHTML
                .replace(/<input[^>]*>/gi, '')
                .replace(/<br\s*\/?>/gi, '\n')
                .replace(/<[^>]+>/g, '')
                .trim();
            if (!texto) continue;

            const lineas = texto.split('\n').map(l => l.trim()).filter(l => l);
            if (lineas.length < 2) continue;

            const nombrePaciente       = lineas[0];
            const numeroIdentificacion = lineas[1];
            if (!/^\d{5,12}$/.test(numeroIdentificacion)) continue;

            const estado       = lineas[2] || '';
            const tipoAtencion = lineas[3] ? lineas[3].replace(/[\[\]]/g, '').trim() : '';
            const llegadaLinea = lineas.find(l => l.startsWith('Llegada:'));
            const horaLlegadaBiofile = llegadaLinea ? llegadaLinea.replace('Llegada:', '').trim() : null;
            const columnaHeader = headers[i] || `col_${i}`;

            pacientes.push({
                numeroIdentificacion,
                nombrePaciente,
                estado,
                tipoAtencion,
                nombreProfesional: columnaHeader,
                columnaHeader,
                horaLlegadaBiofile,
                area: 'AtencionesSeguimiento'
            });
        }
    });

    return { loginName, pacientes };
}

// Biofile date format: "Jun 9 2026  7:04AM" — hora en Colombia (UTC-5)
// NO usar new Date() + GMT-0500: V8 ignora el offset cuando el formato es "7:04AM" sin espacio.
// Parseo manual de los componentes; devuelve null si el texto no es válido.
function parsearComponentesBiofile(str) {
    if (!str) return null;
    const m = str.trim().replace(/\s+/g, ' ')
        .match(/^(\w{3})\s+(\d{1,2})\s+(\d{4})\s+(\d{1,2}):(\d{2})\s*(AM|PM)$/i);
    if (!m) return null;

    const MESES = { jan:0, feb:1, mar:2, apr:3, may:4, jun:5,
                    jul:6, aug:7, sep:8, oct:9, nov:10, dec:11 };
    const mesIdx = MESES[m[1].toLowerCase()];
    if (mesIdx === undefined) return null;

    const dia = parseInt(m[2], 10);
    const anio = parseInt(m[3], 10);
    if (dia < 1 || dia > 31) return null;

    let h = parseInt(m[4], 10);
    if (m[6].toUpperCase() === 'AM' && h === 12) h = 0;
    if (m[6].toUpperCase() === 'PM' && h !== 12) h += 12;

    return { anio, mesIdx, dia, h, min: parseInt(m[5], 10) };
}

// "Jun 25 2026 7:11AM" → "2026-06-25T12:11:00.000Z" (instante absoluto, Colombia +5 = UTC)
function parseFechaBiofile(str) {
    const c = parsearComponentesBiofile(str);
    if (!c) return null;
    // Colombia es UTC-5: hora_UTC = hora_Colombia + 5
    const utc = Date.UTC(c.anio, c.mesIdx, c.dia, c.h + 5, c.min);
    return isNaN(utc) ? null : new Date(utc).toISOString();
}

// "Jun 25 2026 7:11AM" → "2026-06-25" (fecha calendario en Colombia, tal cual la muestra Biofile)
// Se deriva de los componentes crudos, NO del timestamp UTC, para no correr el día en horas PM.
function fechaLlegadaISO(str) {
    const c = parsearComponentesBiofile(str);
    if (!c) return null;
    const mes = String(c.mesIdx + 1).padStart(2, '0');
    const dia = String(c.dia).padStart(2, '0');
    return `${c.anio}-${mes}-${dia}`;
}

async function getTerminalId() {
    return new Promise(resolve => {
        chrome.storage.local.get(['terminalId'], (result) => {
            if (result.terminalId) return resolve(result.terminalId);
            const id = crypto.randomUUID();
            chrome.storage.local.set({ terminalId: id });
            resolve(id);
        });
    });
}

async function ejecutarSync() {
    const tabs = await chrome.tabs.query({ url: '*://ipscertimedic.biofile.com.co/*AtencionesSeguimiento*' });
    if (tabs.length === 0) return { error: 'No hay pestaña de Biofile abierta en AtencionesSeguimiento' };

    let results;
    try {
        results = await chrome.scripting.executeScript({
            target: { tabId: tabs[0].id },
            func: extraerPacientes
        });
    } catch (err) {
        return { error: `No se pudo inyectar el script: ${err.message}` };
    }

    const respuesta = results[0]?.result;
    if (!respuesta) return { error: 'Sin respuesta del script' };
    if (!respuesta.pacientes?.length) return { error: `Sin pacientes en la tabla (loginName: ${respuesta.loginName || 'no encontrado'})` };

    // Normalizar cada paciente: fecha calendario (YYYY-MM-DD) y hora de llegada (ISO UTC),
    // ambas derivadas de la celda "Llegada:" de Biofile, por paciente individual.
    const pacientesNorm = respuesta.pacientes.map(p => ({
        ...p,
        fecha: fechaLlegadaISO(p.horaLlegadaBiofile),
        horaLlegadaBiofile: parseFechaBiofile(p.horaLlegadaBiofile)
    }));

    const res = await fetch(`${CONFIG.SERVER_URL}/api/extension/sync`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'x-extension-secret': CONFIG.EXTENSION_SECRET
        },
        body: JSON.stringify({
            loginName: respuesta.loginName,
            terminalId: await getTerminalId(),
            pacientes: pacientesNorm
        })
    });

    const data = await res.json();
    chrome.storage.local.set({ lastSync: { ...data, ts: Date.now() } });
    return data;
}
