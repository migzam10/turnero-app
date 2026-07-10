// Servidor/secret: config.js por defecto, con override opcional desde el popup (⚙).
document.addEventListener("DOMContentLoaded", () => {
    const btnActualizar = document.getElementById("btn-actualizar");
    btnActualizar.addEventListener("click", cargarPacientes);

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
        
        const pacientes = await resp.json();

        if (pacientes.length === 0) {
            listaEl.innerHTML = '<div class="loader">No hay pacientes en espera.</div>';
            restaurarBoton(btnActualizar);
            return;
        }

        listaEl.innerHTML = "";
        pacientes.forEach(p => {
            const card = document.createElement("div");
            card.className = "paciente-card";
            
            // Formatear hora de llegada
            const hora = new Date(p.hora_llegada).toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit' });

            card.innerHTML = `
                <div class="nombre">${p.nombre_completo}</div>
                <div class="cedula">CC: ${p.numero_identificacion} <span class="hora">${hora}</span></div>
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

            listaEl.appendChild(card);
        });

    } catch (err) {
        const destino = cfg ? cfg.SERVER_URL : '(servidor)';
        listaEl.innerHTML = `
            <div class="loader" style="color:#dc2626;">
                <b>Error de conexión</b><br>
                Verifique que el servidor esté ejecutándose en ${destino}.
                <div class="error-msg">${err.message}</div>
            </div>`;
    } finally {
        restaurarBoton(btnActualizar);
    }
}

function restaurarBoton(btn) {
    btn.disabled = false;
    btn.style.opacity = "1";
}