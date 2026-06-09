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

    const respuesta = await new Promise(resolve => {
        chrome.tabs.sendMessage(tabs[0].id, { tipo: 'SOLICITAR_DATOS' }, (r) => {
            resolve(chrome.runtime.lastError ? null : r);
        });
    });

    if (!respuesta) return { error: 'Content script no responde — recargá la pestaña de Biofile' };
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
