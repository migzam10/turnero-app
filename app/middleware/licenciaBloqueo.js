// Modo bloqueado por licencia.
//
// Cuando la licencia no está vigente el proceso NO se muere: levanta igual y
// responde a todo con un aviso. Es a propósito —
//   - el cliente ve una pantalla que explica qué pasa, en vez de "no abre nada";
//   - NSSM no entra en un ciclo de reinicios cada 3 segundos;
//   - /health sigue contestando, así se puede diagnosticar en remoto.
// Como interruptor comercial es igual de efectivo: no hay forma de admisionar,
// llamar ni consultar nada.

const path = require('path');
const { sistemaBloqueado, estadoLicencia } = require('../utils/licencia');

// Lo único que sigue vivo con el sistema bloqueado.
const EXENTAS = new Set(['/health', '/api/licencia/estado']);

function bloqueoLicencia(req, res, next) {
    if (!sistemaBloqueado() || EXENTAS.has(req.path)) return next();

    const est = estadoLicencia();
    const pideHtml = req.method === 'GET' && String(req.headers.accept || '').includes('text/html');

    if (pideHtml) {
        return res.status(403).sendFile(path.join(__dirname, '..', 'public', 'licencia-bloqueada.html'));
    }
    return res.status(403).json({
        error: 'licencia_invalida',
        motivo: est.motivo,
        mensaje: est.mensaje
    });
}

module.exports = { bloqueoLicencia };
