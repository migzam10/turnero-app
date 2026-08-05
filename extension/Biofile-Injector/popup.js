// Servidor/secret: config.js por defecto, con override opcional desde el popup (⚙).

// Último listado traído del servidor. El buscador filtra SOBRE ESTE ARRAY en memoria:
// escribir no vuelve a consultar al Turnero (la lista se refresca solo con "Actualizar").
let pacientes = [];

document.addEventListener("DOMContentLoaded", () => {
    const btnActualizar = document.getElementById("btn-actualizar");
    btnActualizar.addEventListener("click", cargarPacientes);

    // Filtrado en vivo: cada tecla repinta la lista. 'input' (no 'keyup') también cubre
    // el pegado con el mouse y la "x" que Chrome dibuja en los <input type="search">.
    const buscador = document.getElementById("buscar");
    buscador.addEventListener("input", renderLista);
    buscador.focus(); // el popup abre listo para escribir, sin tener que hacer clic

    // Mini-panel del engranaje (override de Servidor/Secret sobre config.js).
    initConfigUI();

    // Carga inicial
    cargarPacientes();
});

async function cargarPacientes() {
    const listaEl = document.getElementById("lista");
    const btnActualizar = document.getElementById("btn-actualizar");

    listaEl.innerHTML = '<div class="loader">Consultando Turnero...</div>';
    btnActualizar.disabled = true;
    btnActualizar.style.opacity = "0.5";

    let cfg;
    try {
        cfg = await getEffectiveConfig();
        const resp = await fetch(`${cfg.SERVER_URL}/api/extension/pendientes`, {
            method: 'GET',
            headers: {
                'Accept': 'application/json',
                'X-Extension-Secret': cfg.EXTENSION_SECRET
            },
            cache: 'no-store' // Evita lectura de caché corrupta
        });

        if (!resp.ok) {
            throw new Error(`HTTP Error: ${resp.status}`);
        }

        pacientes = await resp.json();
        // Se conserva lo que haya escrito el usuario: al actualizar la lista sigue filtrada.
        renderLista();

    } catch (err) {
        pacientes = [];
        document.getElementById("contador").textContent = "";
        const destino = cfg ? cfg.SERVER_URL : '(servidor)';
        listaEl.innerHTML = `
            <div class="loader" style="color:#dc2626;">
                <b>Error de conexión</b><br>
                Verifique que el servidor esté ejecutándose en ${esc(destino)}.
                <div class="error-msg">${esc(err.message)}</div>
            </div>`;
    } finally {
        restaurarBoton(btnActualizar);
    }
}

// Texto comparable: sin tildes, en mayúsculas y sin la puntuación con que suele escribirse
// la cédula (1.048.069.617 → 1048069617). Aquí SÍ se pliega la ñ (MUÑOZ = MUNOZ): esto es
// una búsqueda, no una llave de identidad como canonizar() del backend —donde plegarla
// fusionaría a dos personas distintas—, y quien busca rara vez escribe la ñ.
function normalizar(texto) {
    return String(texto ?? '')
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '') // marcas de tilde sueltas que deja el NFD (U+0300-U+036F)
        .toUpperCase()
        .replace(/[.\-]/g, '');
}

// Cada palabra escrita debe aparecer en algún lado del paciente (nombre completo o cédula),
// sin importar el orden: "gomez juan" encuentra a JUAN CARLOS GOMEZ igual que "juan gomez".
function coincide(p, tokens) {
    const heno = normalizar(`${p.nombre_completo} ${p.numero_identificacion}`);
    return tokens.every(t => heno.includes(t));
}

function renderLista() {
    const listaEl = document.getElementById("lista");
    const contadorEl = document.getElementById("contador");
    const consulta = document.getElementById("buscar").value.trim();
    const tokens = normalizar(consulta).split(/\s+/).filter(Boolean);
    const visibles = tokens.length ? pacientes.filter(p => coincide(p, tokens)) : pacientes;

    if (!pacientes.length) {
        contadorEl.textContent = "";
        listaEl.innerHTML = '<div class="loader">No hay pacientes en espera.</div>';
        return;
    }

    contadorEl.textContent = tokens.length
        ? `${visibles.length} de ${pacientes.length}`
        : `${pacientes.length} en espera`;

    if (!visibles.length) {
        listaEl.innerHTML = `<div class="loader">Sin coincidencias para “${esc(consulta)}”.</div>`;
        return;
    }

    listaEl.innerHTML = "";
    visibles.forEach(p => listaEl.appendChild(crearCard(p)));
}

function crearCard(p) {
    const card = document.createElement("div");
    card.className = "paciente-card";

    // Formatear hora de llegada
    const hora = new Date(p.hora_llegada).toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit' });

    card.innerHTML = `
        <div class="nombre">${esc(p.nombre_completo)}</div>
        <div class="cedula">CC: ${esc(p.numero_identificacion)} <span class="hora">${hora}</span></div>
    `;

    // Enviar datos al content script
    card.addEventListener("click", () => {
        chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
            const tab = tabs[0];
            if (tab.url && tab.url.includes("biofile.com.co")) {
                chrome.tabs.sendMessage(tab.id, { action: "INYECTAR_PACIENTE", datos: p }, () => {
                    window.close();
                });
            } else {
                alert("Debes estar en la pestaña de Biofile (Ordenes de Servicio) para inyectar.");
            }
        });
    });

    return card;
}

// Los nombres vienen de la BD: un apellido con "&" rompía el innerHTML de la tarjeta.
function esc(texto) {
    return String(texto ?? '').replace(/[&<>"']/g, c => (
        { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
    ));
}

function restaurarBoton(btn) {
    btn.disabled = false;
    btn.style.opacity = "1";
}
