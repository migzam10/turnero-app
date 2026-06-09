// Configuración — debe coincidir con EXTENSION_SECRET en .env del servidor
const CONFIG = {
    SERVER_URL: 'http://TU_IP_SERVIDOR:3000',
    EXTENSION_SECRET: 'cambiar_este_secreto_en_produccion',
    INTERVALO_MIN: 1  // chrome.alarms mínimo 1 minuto
};

chrome.runtime.onInstalled.addListener(() => {
    chrome.alarms.create('sync', { periodInMinutes: CONFIG.INTERVALO_MIN });
    console.log('[BG] Alarma de sincronización creada');
});

chrome.alarms.onAlarm.addListener(async (alarm) => {
    if (alarm.name !== 'sync') return;

    // Solicitar datos al content script de la pestaña activa de Biofile
    const tabs = await chrome.tabs.query({ url: '*://ipscertimedic.biofile.com.co/*AtencionesSeguimiento*' });
    if (tabs.length === 0) return;

    chrome.tabs.sendMessage(tabs[0].id, { tipo: 'SOLICITAR_DATOS' }, async (respuesta) => {
        if (chrome.runtime.lastError || !respuesta) return;
        if (!respuesta.pacientes || respuesta.pacientes.length === 0) return;

        try {
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
            console.log('[BG] Sync OK:', data);
        } catch (err) {
            console.error('[BG] Error al sincronizar:', err.message);
        }
    });
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
