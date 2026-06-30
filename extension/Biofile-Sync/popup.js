const $ = id => document.getElementById(id);

function mostrarMsg(texto, esError = false) {
    const el = $('msg');
    el.textContent = texto;
    el.className = 'msg' + (esError ? ' err' : '');
    if (texto) setTimeout(() => { el.textContent = ''; el.className = 'msg'; }, 3000);
}

function formatearHora(ts) {
    if (!ts) return 'Sin sincronizaciones aún';
    const d = new Date(ts);
    return `Último sync: ${d.toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}`;
}

chrome.storage.local.get(['lastSync'], (data) => {
    if (!data.lastSync) return;
    const s = data.lastSync;
    $('s-new').textContent = s.nuevos      ?? '—';
    $('s-upd').textContent = s.actualizados ?? '—';
    $('s-err').textContent = s.errores     ?? '—';
    $('last-sync').textContent = formatearHora(s.ts);

    const badge = $('badge');
    if (s.errores > 0 && s.nuevos === 0 && s.actualizados === 0) {
        badge.textContent = 'Error'; badge.className = 'badge err';
    } else {
        badge.textContent = 'OK'; badge.className = 'badge ok';
    }
});

$('btn-sync').addEventListener('click', () => {
    mostrarMsg('Sincronizando...');
    chrome.runtime.sendMessage({ tipo: 'SYNC_AHORA' }, (resp) => {
        if (chrome.runtime.lastError) return mostrarMsg('Error al contactar background', true);
        if (!resp) return mostrarMsg('Sin respuesta', true);
        if (resp.error) return mostrarMsg(resp.error, true);
        $('s-new').textContent = resp.nuevos      ?? 0;
        $('s-upd').textContent = resp.actualizados ?? 0;
        $('s-err').textContent = resp.errores     ?? 0;
        $('last-sync').textContent = formatearHora(Date.now());
        $('badge').textContent = 'OK'; $('badge').className = 'badge ok';
        mostrarMsg(`${resp.nuevos} nuevos, ${resp.actualizados} actualizados`);
    });
});
