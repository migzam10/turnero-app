const { Router } = require('express');
const { query } = require('../database/db');

const router = Router();

// GET /api/config/publica
// Configuración pública consumida por todas las pantallas (sin autenticación):
// el sufijo de título personalizable y el logo del Display.
router.get('/publica', async (req, res) => {
    try {
        const { rows } = await query(
            `SELECT clave, valor FROM configuracion
             WHERE clave IN ('titulo_sufijo', 'display_logo')`
        );
        const cfg = Object.fromEntries(rows.map(r => [r.clave, r.valor]));
        return res.json({
            titulo_sufijo: cfg.titulo_sufijo || 'Turnero CertiMedic',
            display_logo: cfg.display_logo || ''
        });
    } catch (err) {
        console.error('[config/publica]', err);
        return res.status(500).json({ error: 'db_error' });
    }
});

module.exports = router;
