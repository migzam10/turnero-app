const INTERVALO_MIN = 1;

chrome.runtime.onInstalled.addListener(() => {
    chrome.alarms.create('sync', { periodInMinutes: INTERVALO_MIN });
});

chrome.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name === 'sync') ejecutarSync();
});

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (msg.tipo !== 'SYNC_AHORA') return;
    ejecutarSync().then(sendResponse).catch(err => sendResponse({ error: err.message }));
    return true;
});

async function getConfig() {
    return new Promise(resolve => {
        chrome.storage.local.get(['serverUrl', 'extensionSecret'], (data) => {
            resolve({
                serverUrl: data.serverUrl || '',
                extensionSecret: data.extensionSecret || ''
            });
        });
    });
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
    const { serverUrl, extensionSecret } = await getConfig();
    if (!serverUrl || !extensionSecret) return { error: 'Configurá la URL y el secret en el popup' };

    const tabs = await chrome.tabs.query({ url: '*://ipscertimedic.biofile.com.co/*AtencionesSeguimiento*' });
    if (tabs.length === 0) return { error: 'No hay pestaña de Biofile abierta' };

    const respuesta = await new Promise(resolve => {
        chrome.tabs.sendMessage(tabs[0].id, { tipo: 'SOLICITAR_DATOS' }, (r) => {
            resolve(chrome.runtime.lastError ? null : r);
        });
    });

    if (!respuesta || !respuesta.pacientes?.length) return { error: 'Sin pacientes en Biofile' };

    const res = await fetch(`${serverUrl}/api/extension/sync`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'x-extension-secret': extensionSecret
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
