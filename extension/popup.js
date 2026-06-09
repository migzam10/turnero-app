const $ = id => document.getElementById(id);

function mostrarMsg(texto, esError = false) {
    const el = $('msg');
    el.textContent = texto;
    el.className = 'msg' + (esError ? ' err' : '');
    if (texto) setTimeout(() => { el.textContent = ''; el.className = 'msg'; }, 3000);
}

function formatearFecha(ts) {
    if (!ts) return 'Sin sincronizaciones aún';
    const d = new Date(ts);
    return `Último sync: ${d.toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}`;
}

chrome.storage.local.get(['serverUrl', 'extensionSecret', 'lastSync'], (data) => {
    if (data.serverUrl)       $('server-url').value = data.serverUrl;
    if (data.extensionSecret) $('secret').value = data.extensionSecret;

    if (data.lastSync) {
        const s = data.lastSync;
        $('s-new').textContent = s.nuevos   ?? '—';
        $('s-upd').textContent = s.actualizados ?? '—';
        $('s-err').textContent = s.errores  ?? '—';
        $('last-sync').textContent = formatearFecha(s.ts);

        const badge = $('badge');
        if (s.errores > 0 && s.nuevos === 0 && s.actualizados === 0) {
            badge.textContent = 'Error'; badge.className = 'badge err';
        } else {
            badge.textContent = 'OK'; badge.className = 'badge ok';
        }
    }
});

$('btn-save').addEventListener('click', () => {
    const serverUrl = $('server-url').value.trim().replace(/\/$/, '');
    const extensionSecret = $('secret').value.trim();
    if (!serverUrl) return mostrarMsg('Ingresá la URL del servidor', true);
    if (!extensionSecret) return mostrarMsg('Ingresá el secret', true);
    chrome.storage.local.set({ serverUrl, extensionSecret }, () => {
        mostrarMsg('Configuración guardada');
    });
});

$('btn-sync').addEventListener('click', () => {
    mostrarMsg('Sincronizando...');
    chrome.runtime.sendMessage({ tipo: 'SYNC_AHORA' }, (resp) => {
        if (chrome.runtime.lastError) return mostrarMsg('Error al comunicarse con el background', true);
        if (!resp) return mostrarMsg('Sin respuesta del background', true);
        if (resp.error) return mostrarMsg(resp.error, true);
        mostrarMsg(`Sync OK — ${resp.nuevos} nuevos, ${resp.actualizados} actualizados`);
    });
});
