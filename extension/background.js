const CONFIG = {
    SERVER_URL: 'http://TU_IP_SERVIDOR:3000',
    EXTENSION_SECRET: 'cambiar_este_secreto_en_produccion',
    INTERVALO_MIN: 1
};

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

    const res = await fetch(`${CONFIG.SERVER_URL}/api/extension/sync`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'x-extension-secret': CONFIG.EXTENSION_SECRET
        },
        body: JSON.stringify({
            loginName: respuesta.loginName,
            terminalId: await getTerminalId(),
            pacientes: respuesta.pacientes
        })
    });

    const data = await res.json();
    chrome.storage.local.set({ lastSync: { ...data, ts: Date.now() } });
    return data;
}
