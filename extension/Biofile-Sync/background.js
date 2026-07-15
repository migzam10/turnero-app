importScripts('config.js', 'config-override.js');

// Cadencia de sincronización. NUNCA por debajo de 15s para no disparar el rate-limit /
// firewall de Biofile. chrome.alarms es el reemplazo fiable de setInterval en un service
// worker MV3: setInterval muere cuando el SW se suspende (~30s de inactividad), mientras que
// alarms persiste y reanima al worker. El mínimo efectivo de periodInMinutes es 0.5 (30s).
const POLL_SEGUNDOS = Math.max(15, Number(CONFIG.INTERVALO_SEG) || 30);

function programarAlarma() {
    chrome.alarms.create('sync', { periodInMinutes: POLL_SEGUNDOS / 60 });
}

chrome.runtime.onInstalled.addListener(programarAlarma);
chrome.runtime.onStartup.addListener(programarAlarma);

chrome.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name === 'sync') syncRegistrado();
});

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (msg.tipo !== 'SYNC_AHORA') return;
    syncRegistrado().then(sendResponse);
    return true;
});

// Ejecuta un sync y registra SIEMPRE el intento (éxito o fallo) en storage como 'lastAttempt',
// con hora, servidor usado y error. Así el popup refleja el estado REAL en vivo y no se queda
// mostrando el último "OK" viejo cuando el servidor es inalcanzable o el secret no corresponde.
async function syncRegistrado() {
    const cfg = await getEffectiveConfig();
    const attempt = { ts: Date.now(), url: cfg.SERVER_URL, ok: false, error: null };
    try {
        const r = await ejecutarSync();
        if (r && r.error) attempt.error = r.error; else attempt.ok = true;
        await chrome.storage.local.set({ lastAttempt: attempt });
        return r;
    } catch (err) {
        attempt.error = err?.message || String(err);
        await chrome.storage.local.set({ lastAttempt: attempt });
        return { error: attempt.error };
    }
}

// =============================================================================
// PASO 1 + PASO 4 — Refresco e ingesta del nuevo DOM (PacientesSeguimiento.aspx)
// -----------------------------------------------------------------------------
// Esta función se inyecta en el MAIN world de la pestaña (chrome.scripting con
// world:'MAIN'), por lo que SÍ ve los globales de la página (jQuery,
// ObtenerPacientesSeguimiento). Debe ser autocontenida: todo helper que use tiene
// que vivir dentro de ella, no puede referenciar el scope del service worker.
//
// Estructura del nuevo DOM (una fila por paciente, N atenciones por fila):
//   tr > cells[0] = N°
//        cells[1] = "NOMBRE PACIENTE<br><b>IDENTIFICACION</b> - N°: OS:xxxx"
//        cells[2] = varios <div>, cada uno una atención:
//                   L0 = profesional crudo  "BRIGITTE DIAZ(SALUD OCUPACIONAL)"
//                   L1 = estado             "ABIERTA" | "PROCESADA" | "CERRADA"
//                   L2 = servicio           " [EXAMEN ...]"  (con corchetes)
//                   L3 = "Llegada: 30/06/2026 07:04 a.&nbsp;m."  (puede faltar)
// =============================================================================
async function refrescarYExtraer() {
    // Convierte un fragmento HTML en texto plano decodificando entidades (&nbsp; → espacio).
    const limpiar = (html) => {
        const tmp = document.createElement('div');
        tmp.innerHTML = html;
        return (tmp.textContent || '')
            .replace(/ /g, ' ')
            .replace(/\s+/g, ' ')
            .trim();
    };

    // Banderas internas para decidir si la extracción es CONFIABLE (snapshot autoritativo).
    // Una extracción confiable exige las tres cosas: la función nativa existía, el refresco
    // resolvió por ajaxComplete (no por el tope de seguridad) y la tabla estaba en el DOM.
    let funcionNativaExiste = false;
    let resolvioPorAjax = false; // true solo si ajaxComplete disparó; false si cayó al timeout

    // ---- PASO 4: refrescar la grilla con la función nativa de Biofile y esperar al AJAX ----
    if (typeof ObtenerPacientesSeguimiento === 'function') {
        funcionNativaExiste = true;
        await new Promise((resolve) => {
            let resuelto = false;
            // Distingue cómo se resolvió la Promise: por el AJAX real (fiable) o por el
            // tope de seguridad (sospechoso → extracción no confiable).
            const finPorAjax    = () => { if (!resuelto) { resuelto = true; resolvioPorAjax = true; resolve(); } };
            const finPorTimeout = () => { if (!resuelto) { resuelto = true; resolve(); } };
            try {
                // El refresco es una petición jQuery; resolvemos en cuanto termine cualquier AJAX.
                // Sin jQuery el handler nunca se registra → siempre cae al timeout → no confiable.
                if (window.jQuery) window.jQuery(document).one('ajaxComplete', finPorAjax);
                ObtenerPacientesSeguimiento();
            } catch (_) {
                finPorTimeout();
            }
            setTimeout(finPorTimeout, 6000); // tope de seguridad si el AJAX no dispara/cuelga
        });
        // Respiro para que el tbody termine de pintarse antes de raspar.
        await new Promise(r => setTimeout(r, 400));
    }

    // ---- PASO 1: raspado del DOM ----
    const loginName = document.querySelector('#LoginName')?.textContent.trim() || null;
    const contenedorTabla = document.querySelector('#TbCitasAsignadas');
    const filas = contenedorTabla ? contenedorTabla.querySelectorAll('tbody tr') : [];
    const pacientes = [];

    filas.forEach((fila) => {
        const celdaPaciente  = fila.cells?.[1];
        const celdaServicios = fila.cells?.[2];
        if (!celdaPaciente || !celdaServicios) return;

        // Identificación: selector estricto sobre <b>.
        const numeroIdentificacion = celdaPaciente.querySelector('b')?.textContent.trim() || '';
        if (!/^\d{5,12}$/.test(numeroIdentificacion)) return;

        // Orden de Servicio: aparece como "... - N°: OS:14518" en la misma celda. Es la
        // LLAVE del ingreso: cada OS es una orden distinta (empresa/particular) y un mismo
        // paciente puede tener varias el mismo día en filas separadas.
        const ordenServicio = (celdaPaciente.textContent.match(/OS:\s*(\d+)/i) || [])[1] || null;

        // Nombre: nodo de texto que precede a <b> (primer segmento antes del <br>).
        const nombrePaciente = limpiar(celdaPaciente.innerHTML.split(/<br\s*\/?>/i)[0] || '');

        // Cada <div> de la celda de servicios es una atención individual.
        celdaServicios.querySelectorAll('div').forEach((div) => {
            const lineas = div.innerHTML.split(/<br\s*\/?>/i).map(limpiar);

            const nombreProfesionalCrudo = lineas[0] || '';
            const estado                 = lineas[1] || '';
            const tipoAtencion           = (lineas[2] || '').replace(/[\[\]]/g, '').trim();

            // "Llegada:" no siempre está en la línea 3 (los exámenes complementarios no la traen);
            // la buscamos por prefijo para ser robustos.
            const lineaLlegada       = lineas.find(l => /^Llegada:/i.test(l));
            const horaLlegadaBiofile = lineaLlegada ? lineaLlegada.replace(/^Llegada:\s*/i, '').trim() : null;

            if (!nombreProfesionalCrudo) return; // div vacío/atípico

            pacientes.push({
                numeroIdentificacion,
                ordenServicio,
                nombrePaciente,
                nombreProfesionalCrudo,
                estado,
                tipoAtencion,
                horaLlegadaBiofile
            });
        });
    });

    // Extracción confiable = el camino nativo completo funcionó. Solo en ese caso el
    // backend puede tratar `pacientes` como snapshot autoritativo y reconciliar stale.
    // Una tabla presente pero vacía (0 filas) con extraccionOk:true es un "vacío real".
    const extraccionOk = funcionNativaExiste && resolvioPorAjax && !!contenedorTabla;

    return { loginName, pacientes, extraccionOk };
}

// =============================================================================
// PASO 3 — Saneamiento del nombre del profesional
// "BRIGITTE DIAZ(SALUD OCUPACIONAL)"  → "BRIGITTE DIAZ"
// "BRIGITTE DIAZ (SALUD OCUPACIONAL)" → "BRIGITTE DIAZ"
// "(EXÁMENES COMPLEMENTARIOS)"        → ""  (se descarta luego)
// =============================================================================
function sanearNombreProfesional(crudo) {
    return String(crudo || '')
        .replace(/\s*\([^)]*\)\s*$/g, '') // elimina la profesión entre paréntesis al final
        .replace(/\s+/g, ' ')
        .trim();
}

// =============================================================================
// PASO 2 — Parseo de la fecha de Biofile
// Formato NUEVO: "30/06/2026 07:04 a. m." / "30/06/2026 02:10 p. m."
//   - admite espacio o &nbsp;/  entre "a." y "m." (y puntos opcionales)
// Formato LEGACY: "Jun 30 2026 7:14AM"  (se mantiene por compatibilidad)
// Devuelve { anio, mesIdx (0-11), dia, h, min } o null. La conversión a UTC-5
// (Colombia) la siguen haciendo parseFechaBiofile / fechaLlegadaISO sin cambios.
// =============================================================================
function parsearComponentesBiofile(str) {
    if (!str) return null;
    const limpio = String(str)
        .replace(/&nbsp;/gi, ' ')
        .replace(/ /g, ' ')
        .replace(/\s+/g, ' ')
        .trim();

    // NUEVO: DD/MM/YYYY hh:mm a. m. / p. m.
    const nuevo = limpio.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})\s+(\d{1,2}):(\d{2})\s*([ap])\.?\s*m\.?$/i);
    if (nuevo) {
        const dia    = parseInt(nuevo[1], 10);
        const mesIdx = parseInt(nuevo[2], 10) - 1; // mes 1-12 → índice 0-11
        const anio   = parseInt(nuevo[3], 10);
        if (dia < 1 || dia > 31 || mesIdx < 0 || mesIdx > 11) return null;

        let h = parseInt(nuevo[4], 10);
        const meridiano = nuevo[6].toLowerCase();
        if (meridiano === 'a' && h === 12) h = 0;
        if (meridiano === 'p' && h !== 12) h += 12;
        if (h > 23) return null;

        return { anio, mesIdx, dia, h, min: parseInt(nuevo[5], 10) };
    }

    // LEGACY: "Jun 30 2026 7:14AM"
    const legacy = limpio.match(/^(\w{3})\s+(\d{1,2})\s+(\d{4})\s+(\d{1,2}):(\d{2})\s*(AM|PM)$/i);
    if (legacy) {
        const MESES = { jan:0, feb:1, mar:2, apr:3, may:4, jun:5,
                        jul:6, aug:7, sep:8, oct:9, nov:10, dec:11 };
        const mesIdx = MESES[legacy[1].toLowerCase()];
        if (mesIdx === undefined) return null;

        const dia  = parseInt(legacy[2], 10);
        const anio = parseInt(legacy[3], 10);
        if (dia < 1 || dia > 31) return null;

        let h = parseInt(legacy[4], 10);
        if (legacy[6].toUpperCase() === 'AM' && h === 12) h = 0;
        if (legacy[6].toUpperCase() === 'PM' && h !== 12) h += 12;

        return { anio, mesIdx, dia, h, min: parseInt(legacy[5], 10) };
    }

    return null;
}

// "30/06/2026 07:04 a. m." → "2026-06-30T12:04:00.000Z" (instante absoluto, Colombia +5 = UTC)
function parseFechaBiofile(str) {
    const c = parsearComponentesBiofile(str);
    if (!c) return null;
    // Colombia es UTC-5: hora_UTC = hora_Colombia + 5
    const utc = Date.UTC(c.anio, c.mesIdx, c.dia, c.h + 5, c.min);
    return isNaN(utc) ? null : new Date(utc).toISOString();
}

// "30/06/2026 07:04 a. m." → "2026-06-30" (fecha calendario en Colombia, tal cual la muestra Biofile)
// Se deriva de los componentes crudos, NO del timestamp UTC, para no correr el día en horas PM.
function fechaLlegadaISO(str) {
    const c = parsearComponentesBiofile(str);
    if (!c) return null;
    const mes = String(c.mesIdx + 1).padStart(2, '0');
    const dia = String(c.dia).padStart(2, '0');
    return `${c.anio}-${mes}-${dia}`;
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
    const tabs = await chrome.tabs.query({ url: '*://*.biofile.com.co/*PacientesSeguimiento*' });
    if (tabs.length === 0) return { error: 'No hay pestaña de Biofile abierta en PacientesSeguimiento' };

    let results;
    try {
        results = await chrome.scripting.executeScript({
            target: { tabId: tabs[0].id },
            world: 'MAIN',            // necesario para ver ObtenerPacientesSeguimiento / jQuery
            func: refrescarYExtraer
        });
    } catch (err) {
        return { error: `No se pudo inyectar el script: ${err.message}` };
    }

    const respuesta = results[0]?.result;
    if (!respuesta) return { error: 'Sin respuesta del script' };

    // ¿Fue confiable el scraping? De esto depende si el payload es un snapshot autoritativo.
    const extraccionOk = respuesta.extraccionOk === true;

    // Normaliza cada atención: sanea profesional (PASO 3), deriva fecha calendario y hora
    // de llegada en ISO UTC (PASO 2). Una columna por profesional, como en el modelo previo.
    // OJO: NO hay early-return por lista vacía. Una tabla vacía legítima (extraccionOk:true,
    // 0 filas) es un snapshot válido y debe viajar como pacientes:[] para que el backend
    // cancele las atenciones stale. El "vacío por fallo" se filtra más abajo.
    const vistos = new Set();
    const pacientesNorm = (respuesta.pacientes || [])
        .map(p => {
            const nombreProfesional = sanearNombreProfesional(p.nombreProfesionalCrudo);
            return {
                numeroIdentificacion: p.numeroIdentificacion,
                ordenServicio: p.ordenServicio || null,
                nombrePaciente: p.nombrePaciente,
                nombreProfesional,
                columnaHeader: nombreProfesional,
                estado: p.estado,
                tipoAtencion: p.tipoAtencion,
                area: 'PacientesSeguimiento',
                fecha: fechaLlegadaISO(p.horaLlegadaBiofile),
                horaLlegadaBiofile: parseFechaBiofile(p.horaLlegadaBiofile)
            };
        })
        // Descarta atenciones sin profesional real (p. ej. "(EXÁMENES COMPLEMENTARIOS)").
        .filter(p => p.nombreProfesional)
        // Deduplica por (OS + profesional): así el mismo profesional en dos OS distintas NO
        // se fusiona (son ingresos separados). Sin OS (fila atípica) cae a la cédula.
        .filter(p => {
            const clave = `${p.ordenServicio || p.numeroIdentificacion}|${p.columnaHeader}`;
            if (vistos.has(clave)) return false;
            vistos.add(clave);
            return true;
        });

    // Modo seguro: extracción NO confiable y además sin atenciones útiles. No tenemos nada
    // que aportar ni garantía de snapshot, así que evitamos un POST que el backend ignoraría
    // para reconciliar igualmente. (El vacío legítimo —extraccionOk:true, 0 filas— SÍ se envía.)
    if (!extraccionOk && pacientesNorm.length === 0) {
        return { error: `Extracción no confiable y sin pacientes (loginName: ${respuesta.loginName || 'no encontrado'})` };
    }

    // snapshotCompleto = extraccionOk (pacientesNorm.length >= 0 siempre se cumple). Solo cuando
    // el scraping fue confiable autorizamos al backend a dar de baja las atenciones ausentes.
    // Con extracción dudosa enviamos snapshotCompleto:false → backend en modo seguro (solo upsert).
    const snapshotCompleto = extraccionOk;

    // ── Contrato del payload POST /api/extension/sync ─────────────────────────────────────
    // {
    //   loginName:        string,                    // dueño del LIS; scope de la reconciliación
    //   terminalId:       string (UUID),             // terminal que origina el sync
    //   snapshotCompleto: boolean,                   // true ⇒ pacientes[] es snapshot autoritativo
    //   pacientes: [{                                // puede ser [] si snapshotCompleto:true (vacío real)
    //     numeroIdentificacion: string,              // ⟵ clave compuesta del delta (intacta)
    //     ordenServicio:        string | null,       // ⟵ N° OS de Biofile = llave del ingreso
    //     columnaHeader:        string,              // ⟵ clave compuesta del delta (intacta)
    //     nombrePaciente:       string,
    //     nombreProfesional:    string,
    //     estado:               string,              // ABIERTA | PROCESADA | CERRADA ...
    //     tipoAtencion:         string,
    //     area:                 'PacientesSeguimiento',
    //     fecha:                'YYYY-MM-DD' | null,  // fecha calendario (Colombia)
    //     horaLlegadaBiofile:   ISO UTC | null
    //   }]
    // }
    // Respuesta: { ok, nuevos, actualizados, autocreados, reconciliados, errores }
    // ──────────────────────────────────────────────────────────────────────────────────────
    // Servidor/secret efectivos: override del popup (chrome.storage) o, si está vacío, config.js.
    const cfg = await getEffectiveConfig();
    const res = await fetch(`${cfg.SERVER_URL}/api/extension/sync`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'x-extension-secret': cfg.EXTENSION_SECRET
        },
        body: JSON.stringify({
            loginName: respuesta.loginName,
            terminalId: await getTerminalId(),
            snapshotCompleto,
            pacientes: pacientesNorm
        })
    });

    // Un 401/500 no lanza por sí solo: lo convertimos en error explícito (p. ej. secret que no
    // corresponde al servidor) para que NO se guarde como si hubiera sido un sync exitoso.
    if (!res.ok) {
        let detalle = '';
        try { detalle = (await res.json())?.error || ''; } catch { /* cuerpo no-JSON */ }
        throw new Error(`servidor respondió ${res.status}${detalle ? ': ' + detalle : ''}`);
    }

    const data = await res.json();
    // Guardamos también snapshotCompleto (lo que enviamos) y reconciliados (lo que el backend
    // dio de baja) para que el popup muestre el alcance real del último sync.
    const resultado = {
        ...data,
        snapshotCompleto,
        reconciliados: data?.reconciliados ?? 0,
        ts: Date.now()
    };
    chrome.storage.local.set({ lastSync: resultado });
    return resultado; // mismo objeto que persiste, así el popup ve snapshotCompleto en el sync manual
}
