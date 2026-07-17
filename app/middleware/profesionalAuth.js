// Mini-login opcional del módulo Profesional.
//
// El problema que resuelve: la pantalla del profesional no pedía nada. Cualquiera en
// cualquier PC tecleaba el nombre de otro y veía sus pacientes. Con esto, el profesional
// que quiera puede ponerse una clave.
//
// Es OPCIONAL y POR PERSONA (`profesionales.requiere_password`), no una política global:
// en una clínica chica nadie la usa y en otra la usa solo quien maneja datos sensibles.
// Quien no la tiene encendida entra como siempre — la cola no se frena por esto.
//
// Se aplica en la API y no solo escondiendo el formulario: el riesgo real es el compañero
// del PC de al lado, y si solo se ocultara la pantalla, un GET a /asignaciones?profesional=X
// seguiría devolviendo los pacientes de X.
//
// Mismo patrón que adminAuth.js (tokens en memoria + TTL + rate-limit, sin dependencias),
// con una diferencia importante: el token queda ATADO al profesional que hizo login. Si
// solo dijera "alguien se autenticó", la clave de uno serviría para leer los pacientes de
// cualquier otro, que es justo lo que esto viene a impedir.

const crypto = require('crypto');
const { query } = require('../database/db');

const TTL_MS = 12 * 60 * 60 * 1000;   // una jornada: se loguea al abrir y trabaja todo el día
const tokens = new Map();             // token -> { canonico, exp }

function crearTokenProfesional(canonico) {
    const token = crypto.randomBytes(32).toString('hex');
    tokens.set(token, { canonico, exp: Date.now() + TTL_MS });
    return token;
}

// Devuelve el nombre canónico del dueño del token, o null si no vale.
function profesionalDeToken(token) {
    if (!token) return null;
    const reg = tokens.get(token);
    if (!reg) return null;
    if (Date.now() > reg.exp) {
        tokens.delete(token);
        return null;
    }
    return reg.canonico;
}

function extraerToken(req) {
    const auth = req.headers['authorization'] || '';
    if (auth.startsWith('Bearer ')) return auth.slice(7).trim();
    return req.headers['x-profesional-token'] || null;
}

// ¿Este profesional exige clave? Lectura por índice único, despreciable frente a la propia
// consulta de asignaciones. Sin caché a propósito: si el admin enciende o apaga la
// exigencia, aplica en la siguiente petición y no hasta que venza un TTL.
async function requierePassword(canonico) {
    const { rows } = await query(
        `SELECT requiere_password, (password_hash IS NOT NULL) AS tiene
           FROM profesionales WHERE nombre_canonico = $1`,
        [canonico]
    );
    // Sin clave puesta no se puede exigir nada: dejaría al profesional afuera sin forma de
    // entrar. El PATCH del admin ya lo bloquea; esto es el cinturón por si se coló.
    return rows[0]?.requiere_password === true && rows[0]?.tiene === true;
}

// Exige el token SOLO si ese profesional tiene la clave encendida.
//
// Va DESPUÉS del middleware que canoniza `profesional`, así que aquí ya llega la forma
// canónica. Si la petición no trae profesional, se deja pasar: el handler la rechaza por
// su cuenta (400) y no devuelve datos de nadie.
async function exigirPasswordSiAplica(req, res, next) {
    try {
        const canonico = req.query?.profesional || req.body?.profesional;
        if (!canonico) return next();

        if (!(await requierePassword(canonico))) return next();

        const duenio = profesionalDeToken(extraerToken(req));
        if (!duenio) return res.status(401).json({ error: 'password_requerida' });
        // El token es de otro profesional: no sirve para leer los pacientes de este.
        if (duenio !== canonico) return res.status(403).json({ error: 'token_de_otro_profesional' });

        return next();
    } catch (err) {
        console.error('[profesionalAuth]', err);
        return res.status(500).json({ error: 'db_error' });
    }
}

// ── Rate-limit del login (en memoria, sin dependencias) ──────────────────────
// Se llavea por IP + profesional: en la LAN varias pantallas comparten IP, y una sola
// llave por IP dejaría que los tanteos contra un profesional bloquearan a los demás.
const MAX_FALLOS = 5;
const VENTANA_MS = 15 * 60 * 1000;
const intentos = new Map();

const llave = (ip, canonico) => `${ip}|${canonico}`;

function loginProfBloqueado(ip, canonico) {
    const reg = intentos.get(llave(ip, canonico));
    if (!reg) return false;
    if (Date.now() - reg.ventanaInicio > VENTANA_MS) {
        intentos.delete(llave(ip, canonico));
        return false;
    }
    return reg.fallos >= MAX_FALLOS;
}

function registrarFalloProf(ip, canonico) {
    const k = llave(ip, canonico);
    const ahora = Date.now();
    const reg = intentos.get(k);
    if (!reg || ahora - reg.ventanaInicio > VENTANA_MS) {
        intentos.set(k, { fallos: 1, ventanaInicio: ahora });
    } else {
        reg.fallos++;
    }
}

function limpiarFallosProf(ip, canonico) {
    intentos.delete(llave(ip, canonico));
}

// Limpieza periódica (no mantiene vivo el proceso).
setInterval(() => {
    const ahora = Date.now();
    for (const [t, reg] of tokens) if (ahora > reg.exp) tokens.delete(t);
    for (const [k, reg] of intentos) if (ahora - reg.ventanaInicio > VENTANA_MS) intentos.delete(k);
}, 60 * 60 * 1000).unref();

module.exports = {
    crearTokenProfesional, profesionalDeToken, exigirPasswordSiAplica, requierePassword,
    loginProfBloqueado, registrarFalloProf, limpiarFallosProf
};
