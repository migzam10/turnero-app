// Capa de override sobre config.js. Permite cambiar Servidor/Secret desde el popup
// (se guarda en chrome.storage.local) sin re-empaquetar el .crx. Vacío = usa config.js.
// Requiere que config.js (global CONFIG) se haya cargado antes que este archivo.
const OVERRIDE_KEY = "cfgOverride";

// Config efectiva = override con valor (si lo hay) sobre los valores de config.js.
function getEffectiveConfig() {
    return new Promise((resolve) => {
        chrome.storage.local.get([OVERRIDE_KEY], (data) => {
            const ov = data[OVERRIDE_KEY] || {};
            resolve({
                SERVER_URL:       (ov.SERVER_URL || "").trim()       || CONFIG.SERVER_URL,
                EXTENSION_SECRET: (ov.EXTENSION_SECRET || "").trim()  || CONFIG.EXTENSION_SECRET,
                INTERVALO_SEG:    (typeof CONFIG.INTERVALO_SEG !== "undefined") ? CONFIG.INTERVALO_SEG : 30
            });
        });
    });
}

// Mini-panel del popup (no se usa en el service worker). Espera en el DOM:
//   #cfg-toggle #cfg-panel #cfg-url #cfg-secret #cfg-save #cfg-reset #cfg-hint #cfg-status
function initConfigUI() {
    const $ = (id) => document.getElementById(id);
    const toggle = $("cfg-toggle"), panel = $("cfg-panel");
    if (!toggle || !panel) return;

    const hint = () => chrome.storage.local.get([OVERRIDE_KEY], (data) => {
        const ov = data[OVERRIDE_KEY] || {};
        const url = (ov.SERVER_URL || "").trim() || CONFIG.SERVER_URL;
        const secOv = !!(ov.EXTENSION_SECRET || "").trim();
        if ($("cfg-hint")) $("cfg-hint").textContent = "Usando: " + url + "  \u00b7  secret: " + (secOv ? "override" : "config.js");
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
        hint();
    });

    $("cfg-save").addEventListener("click", () => {
        const ov = { SERVER_URL: $("cfg-url").value.trim(), EXTENSION_SECRET: $("cfg-secret").value.trim() };
        chrome.storage.local.set({ [OVERRIDE_KEY]: ov }, () => { hint(); flash("Guardado"); });
    });

    $("cfg-reset").addEventListener("click", () => {
        chrome.storage.local.remove(OVERRIDE_KEY, () => {
            $("cfg-url").value = ""; $("cfg-secret").value = "";
            hint(); flash("Usando config.js");
        });
    });
}
