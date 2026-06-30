chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === "INYECTAR_PACIENTE") {
        procesarIngresoBiofile(request.datos);
        sendResponse({ status: "ok" });
    }
});

function procesarIngresoBiofile(paciente) {
    const inputIdentificacion = document.getElementById("TxtNumeroIdentificacion");
    if (!inputIdentificacion) {
        alert("No se detectó el formulario de Biofile.");
        return;
    }

    // Inyecta cédula y emula evento para disparar AsignarDatos()
    inputIdentificacion.value = paciente.numero_identificacion;
    inputIdentificacion.dispatchEvent(new Event('change', { bubbles: true }));

    esperarConsultaAjax(() => {
        const inputPrimerNombre = document.getElementById("TxtPrimerNombre");
        // Si el nombre sigue vacío, Biofile no lo encontró. Inyectamos los datos.
        if (inputPrimerNombre && inputPrimerNombre.value.trim() === "") {
            llenarRestoCampos(paciente);
        }
    });
}

function esperarConsultaAjax(callback) {
    const progressDiv = document.getElementById("UpdateProgress");
    if (!progressDiv) {
        setTimeout(callback, 1500);
        return;
    }

    const observer = new MutationObserver((mutations) => {
        mutations.forEach((mutation) => {
            if (mutation.attributeName === "style" && progressDiv.style.display === "none") {
                observer.disconnect();
                callback();
            }
        });
    });

    observer.observe(progressDiv, { attributes: true });

    // Seguro contra fallos de red de Biofile
    setTimeout(() => { observer.disconnect(); callback(); }, 5000);
}

function llenarRestoCampos(paciente) {
    const inyectar = (id, valor) => {
        const el = document.getElementById(id);
        if (el && valor) {
            el.value = valor;
            el.dispatchEvent(new Event('change', { bubbles: true }));
        }
    };

    inyectar("TxtPrimerNombre", paciente.primer_nombre);
    inyectar("TxtSegundoNombre", paciente.segundo_nombre);
    inyectar("TxtPrimerApellido", paciente.primer_apellido);
    inyectar("TxtSegundoApellido", paciente.segundo_apellido);
    inyectar("TxtFechaNacimiento", paciente.fecha_nacimiento_fmt);

    const cbGenero = document.getElementById("CbGenero");
    if (cbGenero && paciente.sexo) {
        cbGenero.value = paciente.sexo.toUpperCase() === 'M' ? 'MASCULINO' : 'FEMENINO';
        cbGenero.dispatchEvent(new Event('change', { bubbles: true }));
    }
}