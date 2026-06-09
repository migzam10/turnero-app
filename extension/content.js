// Escucha mensajes del service worker y extrae datos del DOM de Biofile
chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (msg.tipo !== 'SOLICITAR_DATOS') return;

    try {
        const loginEl = document.querySelector('#LoginName');
        const loginName = loginEl ? loginEl.textContent.trim() : null;
        if (!loginName) return sendResponse({ pacientes: [] });

        const pacientes = [];
        const tabla = document.querySelector('#TbCitasAsignadas');
        if (!tabla) return sendResponse({ loginName, pacientes: [] });

        const filas = tabla.querySelectorAll('tr');
        filas.forEach(fila => {
            const celdas = fila.querySelectorAll('td');
            if (celdas.length < 3) return;

            // La estructura exacta de columnas se confirma durante pruebas con el DOM real
            const numeroIdentificacion = celdas[0]?.textContent.trim();
            const columnaHeader = fila.closest('table')?.dataset?.header || 'general';
            const area = document.title || 'general';
            const horaLlegadaTexto = fila.querySelector('.hora-llegada, [data-llegada]')?.textContent.trim();

            if (!numeroIdentificacion || !/^\d{5,12}$/.test(numeroIdentificacion)) return;

            pacientes.push({
                numeroIdentificacion,
                nombreProfesional: loginName,
                area,
                columnaHeader,
                horaLlegadaBiofile: horaLlegadaTexto || null
            });
        });

        sendResponse({ loginName, pacientes });
    } catch (err) {
        console.error('[CONTENT] Error al leer DOM:', err);
        sendResponse({ pacientes: [] });
    }

    return true; // mantener canal abierto para respuesta asíncrona
});
