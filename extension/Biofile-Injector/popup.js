// URL cargada desde config.js (ver config.example.js para configurar)
const URL_TURNERO = `${CONFIG.SERVER_URL}/api/extension/pendientes`;

document.addEventListener("DOMContentLoaded", () => {
    const btnActualizar = document.getElementById("btn-actualizar");
    btnActualizar.addEventListener("click", cargarPacientes);
    
    // Carga inicial
    cargarPacientes();
});

async function cargarPacientes() {
    const listaEl = document.getElementById("lista");
    const btnActualizar = document.getElementById("btn-actualizar");
    
    listaEl.innerHTML = '<div class="loader">Consultando Turnero...</div>';
    btnActualizar.disabled = true;
    btnActualizar.style.opacity = "0.5";
    
    try {
        const resp = await fetch(URL_TURNERO, {
            method: 'GET',
            headers: {
                'Accept': 'application/json',
                'X-Extension-Secret': CONFIG.EXTENSION_SECRET
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
        listaEl.innerHTML = `
            <div class="loader" style="color:#dc2626;">
                <b>Error de conexión</b><br>
                Verifique que el servidor local esté ejecutándose en 192.168.26.110:3000.
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