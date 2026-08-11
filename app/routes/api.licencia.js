const { Router } = require('express');
const { estadoLicencia } = require('../utils/licencia');

const router = Router();

// GET /api/licencia/estado
// Público a propósito: es lo que consulta la pantalla de bloqueo (que se sirve
// justamente cuando el resto del sistema no responde) y sirve de diagnóstico
// remoto en soporte. Solo expone el nombre del propio licenciatario y la fecha
// de vencimiento; nada sensible.
router.get('/estado', (req, res) => {
    const e = estadoLicencia();
    res.json({
        requerida: e.requerida,
        estado: e.estado,
        motivo: e.motivo,
        mensaje: e.mensaje,
        cliente: e.cliente,
        vence: e.vence,
        diasRestantes: e.diasRestantes
    });
});

module.exports = router;
