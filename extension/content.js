chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (msg.tipo !== 'SOLICITAR_DATOS') return;

    try {
        const loginName = document.querySelector('#LoginName')?.textContent.trim() || null;

        const tabla = document.querySelector('#TbCitasAsignadas');
        if (!tabla) return sendResponse({ loginName, pacientes: [] });

        // Encabezados de columna: índice 0 = "N°", índice 1..n = nombre del profesional
        const headers = Array.from(tabla.querySelectorAll('thead th')).map(th => th.textContent.trim());

        const pacientes = [];

        tabla.querySelectorAll('tbody tr').forEach(fila => {
            const celdas = fila.querySelectorAll('td');

            // celdas[0] = número de fila, celdas[1..n] = datos del paciente por profesional
            for (let i = 1; i < celdas.length; i++) {
                const celda = celdas[i];

                // Parsear innerHTML para manejar <br> como saltos de línea
                const texto = celda.innerHTML
                    .replace(/<input[^>]*>/gi, '')
                    .replace(/<br\s*\/?>/gi, '\n')
                    .replace(/<[^>]+>/g, '')
                    .trim();

                if (!texto) continue;

                const lineas = texto.split('\n').map(l => l.trim()).filter(l => l);
                if (lineas.length < 2) continue;

                const nombrePaciente      = lineas[0];
                const numeroIdentificacion = lineas[1];

                if (!/^\d{5,12}$/.test(numeroIdentificacion)) continue;

                const estado       = lineas[2] || '';
                const tipoAtencion = lineas[3] ? lineas[3].replace(/[\[\]]/g, '').trim() : '';
                const llegadaLinea = lineas.find(l => l.startsWith('Llegada:'));
                const horaLlegadaBiofile = llegadaLinea ? llegadaLinea.replace('Llegada:', '').trim() : null;

                // El encabezado de columna identifica al profesional y su especialidad
                const columnaHeader    = headers[i] || `col_${i}`;
                const nombreProfesional = columnaHeader;

                pacientes.push({
                    numeroIdentificacion,
                    nombrePaciente,
                    estado,
                    tipoAtencion,
                    nombreProfesional,
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
