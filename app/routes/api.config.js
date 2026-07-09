const { Router } = require('express');
const { query } = require('../database/db');
const { edicionPlus } = require('../utils/edicion');

const router = Router();

// GET /api/config/publica
// Configuración pública consumida por todas las pantallas (sin autenticación):
// el sufijo de título personalizable y el logo del Display.
router.get('/publica', async (req, res) => {
    try {
        const { rows } = await query(
            `SELECT clave, valor FROM configuracion
             WHERE clave IN ('titulo_sufijo', 'display_logo', 'sonido_habilitado', 'duracion_anuncio_seg',
                             'voz_habilitada', 'voz_plantilla')`
        );
        const cfg = Object.fromEntries(rows.map(r => [r.clave, r.valor]));
        return res.json({
            titulo_sufijo: cfg.titulo_sufijo || 'Turnero',
            display_logo: cfg.display_logo || '',
            sonido_habilitado: cfg.sonido_habilitado !== 'false',   // default true
            duracion_anuncio_seg: Math.min(30, Math.max(4, parseInt(cfg.duracion_anuncio_seg, 10) || 8)),
            voz_habilitada: cfg.voz_habilitada === 'true',   // default false
            voz_plantilla: cfg.voz_plantilla || 'Turno para {nombre}. Diríjase a {destino}.',
            // Edición de licencia (candado comercial): 'basica' | 'plus'. Fija en el .env,
            // el cliente no la cambia. La voz solo aplica en 'plus'.
            voz_incluida: edicionPlus()
        });
    } catch (err) {
        console.error('[config/publica]', err);
        return res.status(500).json({ error: 'db_error' });
    }
});

module.exports = router;
