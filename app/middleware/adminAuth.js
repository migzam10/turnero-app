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

// ── Rate-limit del login admin (en memoria, sin dependencias) ─────────────────
// Frena la fuerza bruta: ≥MAX_FALLOS intentos fallidos desde una misma IP dentro
// de una ventana de VENTANA_MS la bloquean hasta que la ventana venza.
const MAX_FALLOS = 5;
const VENTANA_MS = 15 * 60 * 1000;          // 15 minutos
const intentos = new Map();                  // ip -> { fallos, ventanaInicio }

function loginBloqueado(ip) {
    const reg = intentos.get(ip);
    if (!reg) return false;
    // Limpieza perezosa: si la ventana venció, se resetea al consultar.
    if (Date.now() - reg.ventanaInicio > VENTANA_MS) {
        intentos.delete(ip);
        return false;
    }
    return reg.fallos >= MAX_FALLOS;
}

function registrarIntentoFallido(ip) {
    const ahora = Date.now();
    const reg = intentos.get(ip);
    if (!reg || ahora - reg.ventanaInicio > VENTANA_MS) {
        intentos.set(ip, { fallos: 1, ventanaInicio: ahora });
    } else {
        reg.fallos++;
    }
}

function limpiarIntentos(ip) {
    intentos.delete(ip);
}

// Limpieza periódica de tokens expirados y ventanas de intentos vencidas
// (no mantiene vivo el proceso).
setInterval(() => {
    const ahora = Date.now();
    for (const [t, exp] of tokens) {
        if (ahora > exp) tokens.delete(t);
    }
    for (const [ip, reg] of intentos) {
        if (ahora - reg.ventanaInicio > VENTANA_MS) intentos.delete(ip);
    }
}, 60 * 60 * 1000).unref();

module.exports = {
    crearToken, tokenValido, validarAdminToken,
    loginBloqueado, registrarIntentoFallido, limpiarIntentos
};
