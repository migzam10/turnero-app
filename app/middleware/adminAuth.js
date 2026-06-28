// Autenticación simple por token de sesión para los endpoints /api/admin/*.
// El token se genera al iniciar sesión (POST /api/admin/login) y se almacena en
// memoria con expiración. El cliente lo envía en el header Authorization.
// No requiere dependencias externas; usa el módulo crypto del runtime.

const crypto = require('crypto');

const TTL_MS = 8 * 60 * 60 * 1000;        // 8 horas de validez
const tokens = new Map();                  // token -> epoch ms de expiración

function crearToken() {
    const token = crypto.randomBytes(32).toString('hex');
    tokens.set(token, Date.now() + TTL_MS);
    return token;
}

function tokenValido(token) {
    if (!token) return false;
    const exp = tokens.get(token);
    if (!exp) return false;
    if (Date.now() > exp) {
        tokens.delete(token);
        return false;
    }
    return true;
}

function extraerToken(req) {
    const auth = req.headers['authorization'] || '';
    if (auth.startsWith('Bearer ')) return auth.slice(7).trim();
    return req.headers['x-admin-token'] || null;
}

function validarAdminToken(req, res, next) {
    if (!tokenValido(extraerToken(req))) {
        return res.status(401).json({ error: 'no_autorizado' });
    }
    next();
}

// Limpieza periódica de tokens expirados (no mantiene vivo el proceso).
setInterval(() => {
    const ahora = Date.now();
    for (const [t, exp] of tokens) {
        if (ahora > exp) tokens.delete(t);
    }
}, 60 * 60 * 1000).unref();

module.exports = { crearToken, tokenValido, validarAdminToken };
