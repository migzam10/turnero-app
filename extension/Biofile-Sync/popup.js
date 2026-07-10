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

// Refleja el modo del último sync: snapshot autoritativo (el backend reconcilia stale)
// vs. modo seguro (extracción dudosa, solo upsert, no se da de baja nada).
function mostrarSnapshot(snapshotCompleto) {
    const el = $('snapshot');
    if (snapshotCompleto === undefined || snapshotCompleto === null) { el.innerHTML = ''; return; }
    el.innerHTML = snapshotCompleto
        ? '<span class="tag full">Snapshot completo</span>'
        : '<span class="tag safe">Modo seguro (sin reconciliar)</span>';
}

// Pinta el estado del ÚLTIMO intento (éxito o fallo) con el servidor usado. Manda sobre el
// badge: un "OK" viejo guardado no debe tapar que ahora el servidor es inalcanzable o el
// secret no corresponde. Sin esto parecía "seguir sincronizando" cuando en realidad fallaba.
function renderAttempt(a) {
    const el = $('attempt');
    if (!el || !a) return;
    const hora = new Date(a.ts).toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    if (a.ok) {
        el.style.color = '#43a047';
        el.textContent = `✓ ${hora} · ${a.url}`;
    } else {
        el.style.color = '#e53935';
        el.textContent = `✗ ${hora} · ${a.url} · ${a.error || 'falló'}`;
        const badge = $('badge');
        badge.textContent = 'Error'; badge.className = 'badge err';
    }
}

chrome.storage.local.get(['lastSync', 'lastAttempt'], (data) => {
    const s = data.lastSync;
    if (s) {
        $('s-new').textContent  = s.nuevos        ?? '—';
        $('s-upd').textContent  = s.actualizados  ?? '—';
        $('s-baja').textContent = s.reconciliados ?? '—';
        $('s-err').textContent  = s.errores       ?? '—';
        mostrarSnapshot(s.snapshotCompleto);
        $('last-sync').textContent = formatearHora(s.ts);

        const badge = $('badge');
        if (s.errores > 0 && s.nuevos === 0 && s.actualizados === 0) {
            badge.textContent = 'Error'; badge.className = 'badge err';
        } else {
            badge.textContent = 'OK'; badge.className = 'badge ok';
        }
    }
    // El último intento manda sobre el badge (se pinta después de las stats a propósito).
    renderAttempt(data.lastAttempt);
});

// Mini-panel de conexión (engranaje del header): override de Servidor/Secret sobre config.js.
initConfigUI();

$('btn-sync').addEventListener('click', () => {
    mostrarMsg('Sincronizando...');
    chrome.runtime.sendMessage({ tipo: 'SYNC_AHORA' }, (resp) => {
        // Refresca SIEMPRE el estado real del intento (va primero: sobrevive a los early-return).
        chrome.storage.local.get(['lastAttempt'], (d) => renderAttempt(d.lastAttempt));
        if (chrome.runtime.lastError) return mostrarMsg('Error al contactar background', true);
        if (!resp) return mostrarMsg('Sin respuesta', true);
        if (resp.error) return mostrarMsg(resp.error, true);
        $('s-new').textContent  = resp.nuevos        ?? 0;
        $('s-upd').textContent  = resp.actualizados  ?? 0;
        $('s-baja').textContent = resp.reconciliados ?? 0;
        $('s-err').textContent  = resp.errores       ?? 0;
        mostrarSnapshot(resp.snapshotCompleto);
        $('last-sync').textContent = formatearHora(resp.ts || Date.now());
        $('badge').textContent = 'OK'; $('badge').className = 'badge ok';
        mostrarMsg(`${resp.nuevos} nuevos, ${resp.actualizados} actualizados, ${resp.reconciliados ?? 0} de baja`);
    });
});
