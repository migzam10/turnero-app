// Capa de override sobre config.js. Permite cambiar Servidor/Secret desde el popup
// (se guarda en chrome.storage.local) sin re-empaquetar el .crx. Vacío = usa config.js.
// Requiere que config.js (global CONFIG) se haya cargado antes que este archivo.
const OVERRIDE_KEY = "cfgOverride";

// Piso de la cadencia de sincronización: por debajo de 15s se dispara el rate-limit /
// firewall de Biofile. Ojo: chrome.alarms no baja de 30s aunque se pida menos.
const INTERVALO_MIN = 15;

function normalizarIntervalo(valor, porDefecto) {
    const n = Number(valor);
    return Number.isFinite(n) && n > 0 ? Math.max(INTERVALO_MIN, Math.round(n)) : porDefecto;
}

// Config efectiva = override con valor (si lo hay) sobre los valores de config.js.
function getEffectiveConfig() {
    return new Promise((resolve) => {
        chrome.storage.local.get([OVERRIDE_KEY], (data) => {
            const ov = data[OVERRIDE_KEY] || {};
            const base = normalizarIntervalo(CONFIG.INTERVALO_SEG, 30);
            resolve({
                SERVER_URL:       (ov.SERVER_URL || "").trim()       || CONFIG.SERVER_URL,
                EXTENSION_SECRET: (ov.EXTENSION_SECRET || "").trim()  || CONFIG.EXTENSION_SECRET,
                INTERVALO_SEG:    ov.INTERVALO_SEG ? normalizarIntervalo(ov.INTERVALO_SEG, base) : base
            });
        });
    });
}

// Mini-panel del popup (no se usa en el service worker). Espera en el DOM:
//   #cfg-toggle #cfg-panel #cfg-url #cfg-secret #cfg-save #cfg-reset #cfg-hint #cfg-status
// #cfg-intervalo es OPCIONAL: solo el Sync lo muestra (el Injector no sincroniza).
function initConfigUI() {
    const $ = (id) => document.getElementById(id);
    const toggle = $("cfg-toggle"), panel = $("cfg-panel");
    if (!toggle || !panel) return;
    const usaIntervalo = !!$("cfg-intervalo");

    const hint = () => chrome.storage.local.get([OVERRIDE_KEY], (data) => {
        const ov = data[OVERRIDE_KEY] || {};
        const url = (ov.SERVER_URL || "").trim() || CONFIG.SERVER_URL;
        const secOv = !!(ov.EXTENSION_SECRET || "").trim();
        let txt = "Usando: " + url + "  \u00b7  secret: " + (secOv ? "override" : "config.js");
        if (usaIntervalo) {
            const base = normalizarIntervalo(CONFIG.INTERVALO_SEG, 30);
            txt += "  \u00b7  cada " + (ov.INTERVALO_SEG ? normalizarIntervalo(ov.INTERVALO_SEG, base) : base) + "s";
        }
        if ($("cfg-hint")) $("cfg-hint").textContent = txt;
    });
    const flash = (t) => { const s = $("cfg-status"); if (s) { s.textContent = t; setTimeout(() => s.textContent = "", 2000); } };

    toggle.addEventListener("click", () => {
        panel.style.display = (panel.style.display === "none" || !panel.style.display) ? "block" : "none";
    });

    chrome.storage.local.get([OVERRIDE_KEY], (data) => {
        const ov = data[OVERRIDE_KEY] || {};
        $("cfg-url").value = ov.SERVER_URL || "";
        $("cfg-secret").value = ov.EXTENSION_SECRET || "";
        $("cfg-url").placeholder = CONFIG.SERVER_URL || "http://IP:3000";
        $("cfg-secret").placeholder = "(config.js)";
        if (usaIntervalo) {
            $("cfg-intervalo").value = ov.INTERVALO_SEG || "";
            $("cfg-intervalo").placeholder = normalizarIntervalo(CONFIG.INTERVALO_SEG, 30) + " (config.js)";
        }
        hint();
    });

    $("cfg-save").addEventListener("click", () => {
        const ov = { SERVER_URL: $("cfg-url").value.trim(), EXTENSION_SECRET: $("cfg-secret").value.trim() };
        let aviso = "Guardado";
        if (usaIntervalo) {
            const crudo = $("cfg-intervalo").value.trim();
            if (crudo) {
                // Se guarda ya normalizado para que el campo muestre lo que realmente rige.
                const seg = normalizarIntervalo(crudo, normalizarIntervalo(CONFIG.INTERVALO_SEG, 30));
                ov.INTERVALO_SEG = seg;
                $("cfg-intervalo").value = seg;
                if (Number(crudo) < INTERVALO_MIN) aviso = "Guardado (mínimo " + INTERVALO_MIN + "s)";
            }
        }
        // El service worker del Sync reprograma su alarma al ver este cambio en storage.
        chrome.storage.local.set({ [OVERRIDE_KEY]: ov }, () => { hint(); flash(aviso); });
    });

    $("cfg-reset").addEventListener("click", () => {
        chrome.storage.local.remove(OVERRIDE_KEY, () => {
            $("cfg-url").value = ""; $("cfg-secret").value = "";
            if (usaIntervalo) $("cfg-intervalo").value = "";
            hint(); flash("Usando config.js");
        });
    });
}
