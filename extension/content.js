// ── SOLICITAR_DATOS — usado por popup.js ───────────────────────
chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (msg.tipo !== 'SOLICITAR_DATOS') return;

    try {
        const loginName = document.querySelector('#LoginName')?.textContent.trim() || null;

        const tabla = document.querySelector('#TbCitasAsignadas');
        if (!tabla) return sendResponse({ loginName, pacientes: [] });

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

                const estado           = lineas[2] || '';
                const tipoAtencion     = lineas[3] ? lineas[3].replace(/[\[\]]/g, '').trim() : '';
                const llegadaLinea     = lineas.find(l => l.startsWith('Llegada:'));
                const horaLlegadaBiofile = llegadaLinea ? llegadaLinea.replace('Llegada:', '').trim() : null;
                const columnaHeader    = headers[i] || `col_${i}`;

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

        sendResponse({ loginName, pacientes });
    } catch (err) {
        console.error('[CONTENT] Error:', err);
        sendResponse({ pacientes: [] });
    }

    return true;
});

// ── MutationObserver: fast-path sync cuando cambia la tabla ────
let _syncTimer = null;

function triggerSync() {
    clearTimeout(_syncTimer);
    _syncTimer = setTimeout(() => {
        chrome.runtime.sendMessage({ tipo: 'SYNC_AHORA' }, () => {
            // Suprimir "no receiving end" si el service worker todavía no despertó
            void chrome.runtime.lastError;
        });
    }, 1500); // 1.5s de debounce: espera a que Biofile termine de renderizar
}

function attachTableObserver() {
    const tabla = document.querySelector('#TbCitasAsignadas');
    if (!tabla) return false;

    const obs = new MutationObserver(triggerSync);

    const tbody = tabla.querySelector('tbody');
    if (tbody) obs.observe(tbody, { childList: true }); // filas nuevas/eliminadas
    obs.observe(tabla, { childList: true });             // reemplazo del tbody entero

    console.log('[CONTENT] Observer activo en #TbCitasAsignadas');
    return true;
}

// Si la tabla ya está en el DOM al cargar, adjuntar directo.
// Si no, esperar a que aparezca (carga asíncrona de Biofile).
if (!attachTableObserver()) {
    const waitObs = new MutationObserver(() => {
        if (attachTableObserver()) waitObs.disconnect();
    });
    waitObs.observe(document.body, { childList: true, subtree: true });
}
