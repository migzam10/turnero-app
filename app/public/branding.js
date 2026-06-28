// Branding dinámico de las pantallas.
// Lee la configuración pública (sufijo de título y logo del Display) y la aplica.
// Cada módulo marca:
//   - <body data-modulo="Recepción">           -> base para document.title
//   - [data-titulo-base="Recepción"]            -> elemento de encabezado a renderizar
//        (base vacío => se muestra solo el sufijo, p.ej. el logo del Display/menú)
//   - [data-display-logo] con hijos [data-logo-default] y [data-logo-img]
//        -> zona del logo del Display (campana por defecto / imagen cargada)
(function () {
    function aplicarBranding(cfg) {
        const sufijo = (cfg && cfg.titulo_sufijo ? cfg.titulo_sufijo : 'Turnero CertiMedic').trim();

        document.querySelectorAll('[data-titulo-base]').forEach(el => {
            const base = el.getAttribute('data-titulo-base');
            el.textContent = base ? `${base} — ${sufijo}` : sufijo;
        });

        const baseDoc = document.body.getAttribute('data-modulo') || '';
        document.title = baseDoc ? `${baseDoc} — ${sufijo}` : sufijo;

        const slot = document.querySelector('[data-display-logo]');
        if (slot) {
            const def = slot.querySelector('[data-logo-default]');
            const img = slot.querySelector('[data-logo-img]');
            if (img) {
                if (cfg && cfg.display_logo) {
                    img.src = cfg.display_logo;
                    img.style.display = '';
                    if (def) def.style.display = 'none';
                } else {
                    img.removeAttribute('src');
                    img.style.display = 'none';
                    if (def) def.style.display = '';
                }
            }
        }
    }

    async function recargarBranding() {
        try {
            const r = await fetch('/api/config/publica');
            if (r.ok) aplicarBranding(await r.json());
        } catch {}
    }

    window.aplicarBranding = aplicarBranding;
    window.recargarBranding = recargarBranding;

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', recargarBranding);
    } else {
        recargarBranding();
    }
})();
