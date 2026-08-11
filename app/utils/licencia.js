// Licencia de uso con vencimiento (candado técnico del producto).
//
// Modelo: un archivo `licencia.lic` firmado con Ed25519 por el Titular. El
// ejecutable lleva embebida la llave PÚBLICA, así que puede verificar la firma
// pero nunca fabricar una licencia: emitirlas requiere la llave privada, que
// vive solo en el equipo del Titular (ver scripts/firmar-licencia.js).
// Todo es offline: no llama a ningún servidor, no necesita internet.
//
// Dónde se exige:
//   - Corriendo como .exe empaquetado con pkg  -> SIEMPRE se exige.
//   - Corriendo desde código (node server.js)  -> NO se exige, salvo que se
//     ponga LICENCIA_REQUERIDA=true en el .env.
// Esa asimetría es deliberada: el .exe es lo único que se entrega a un cliente
// en evaluación, mientras que las instalaciones perpetuas que corren desde
// código (servicio NSSM + git pull) no pueden quedar a merced de un archivo.
//
// Qué se verifica, en orden:
//   1. Que el archivo exista y sea legible.
//   2. Que la firma corresponda al contenido exacto (nadie editó la fecha).
//   3. Que el equipo sea el autorizado, si la licencia está atada a un host.
//   4. Que no esté vencida.
//   5. Que el reloj del sistema no se haya atrasado para revivir una licencia
//      vencida (se recuerda la fecha más adelantada ya vista).

const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { TZ } = require('./fecha');

// Llave pública del Titular. Su par privado NO está en este repositorio.
// Cambiarla invalida todas las licencias emitidas.
const LLAVE_PUBLICA_PEM = `-----BEGIN PUBLIC KEY-----
MCowBQYDK2VwAyEAGrZXuzGsje6Wovy6bGfH/otFUxUT1nEwMpG15WlfvYQ=
-----END PUBLIC KEY-----`;

// Días de antelación con que se empieza a avisar el vencimiento.
const AVISO_DIAS = 15;

// Cuánto puede atrasarse el reloj sin considerarse manipulación. Cubre ajustes
// normales de NTP y cambios de zona horaria; una licencia vencida se revive
// atrasando meses, no horas.
const TOLERANCIA_RELOJ_MS = 36 * 60 * 60 * 1000;

// Raíz de la instalación: junto al ejecutable cuando corre empaquetado, o la
// carpeta app/ cuando corre desde código (el mismo sitio donde vive el .env).
function raizInstalacion() {
    return process.pkg ? path.dirname(process.execPath) : path.join(__dirname, '..');
}

function rutaLicencia() {
    return process.env.LICENCIA_PATH || path.join(raizInstalacion(), 'licencia.lic');
}

// Respaldo en disco del reloj visto. Se complementa con la fila en base de
// datos: borrar uno de los dos no alcanza para atrasar el reloj impunemente.
function rutaEstado() {
    return path.join(raizInstalacion(), '.turnero-estado');
}

// ¿Esta ejecución debe exigir licencia?
function licenciaRequerida() {
    if (String(process.env.LICENCIA_REQUERIDA || '').toLowerCase() === 'true') return true;
    return Boolean(process.pkg);
}

// Serialización estable: la firma se calcula sobre esto, así que dos procesos
// distintos deben producir byte por byte lo mismo para el mismo objeto.
function canonico(obj) {
    if (obj === null || typeof obj !== 'object') return JSON.stringify(obj);
    if (Array.isArray(obj)) return `[${obj.map(canonico).join(',')}]`;
    const claves = Object.keys(obj).sort();
    return `{${claves.map(k => `${JSON.stringify(k)}:${canonico(obj[k])}`).join(',')}}`;
}

function firmar(payload, llavePrivada) {
    return crypto.sign(null, Buffer.from(canonico(payload), 'utf8'), llavePrivada).toString('base64');
}

function firmaValida(payload, firmaB64) {
    try {
        return crypto.verify(
            null,
            Buffer.from(canonico(payload), 'utf8'),
            LLAVE_PUBLICA_PEM,
            Buffer.from(String(firmaB64), 'base64')
        );
    } catch {
        return false;
    }
}

// Fecha YYYY-MM-DD en hora de Colombia para un instante dado.
function diaBogota(fecha) {
    return fecha.toLocaleDateString('en-CA', { timeZone: TZ });
}

// Días completos entre hoy y una fecha YYYY-MM-DD (negativo = ya pasó).
function diasHasta(dia, ahora) {
    const fin = Date.parse(`${dia}T23:59:59-05:00`);
    return Math.floor((fin - ahora.getTime()) / 86400000);
}

const DIA_RE = /^\d{4}-\d{2}-\d{2}$/;

// ── Memoria del reloj ────────────────────────────────────────────────────────

async function leerRelojGuardado() {
    let masAlto = 0;
    try {
        const crudo = JSON.parse(fs.readFileSync(rutaEstado(), 'utf8'));
        const t = Date.parse(crudo.reloj);
        if (Number.isFinite(t)) masAlto = Math.max(masAlto, t);
    } catch { /* sin archivo previo, o ilegible */ }
    try {
        const { query } = require('../database/db');
        const { rows } = await query(`SELECT valor FROM licencia_estado WHERE clave = 'reloj'`);
        if (rows[0]) {
            const t = Date.parse(rows[0].valor);
            if (Number.isFinite(t)) masAlto = Math.max(masAlto, t);
        }
    } catch { /* la base puede no estar lista; el archivo alcanza */ }
    return masAlto;
}

async function guardarReloj(ahora) {
    const iso = ahora.toISOString();
    try {
        fs.writeFileSync(rutaEstado(), JSON.stringify({ reloj: iso }));
    } catch { /* disco de solo lectura: no es motivo para caerse */ }
    try {
        const { query } = require('../database/db');
        await query(
            `INSERT INTO licencia_estado (clave, valor) VALUES ('reloj', $1)
             ON CONFLICT (clave) DO UPDATE SET valor = $1`,
            [iso]
        );
    } catch { /* idem */ }
}

// ── Evaluación ───────────────────────────────────────────────────────────────

function bloqueada(motivo, mensaje, extra = {}) {
    return { estado: 'bloqueada', motivo, mensaje, cliente: null, id: null,
             edicion: null, vence: null, diasRestantes: null, ...extra };
}

// Evalúa el contenido de una licencia ya leída. Separada de la lectura para
// poder probarla sin tocar disco ni base de datos.
function evaluar(sobre, ahora, relojGuardado) {
    if (!sobre || typeof sobre !== 'object' || !sobre.payload || !sobre.firma) {
        return bloqueada('ilegible', 'El archivo de licencia no tiene el formato esperado.');
    }
    const p = sobre.payload;

    if (!firmaValida(p, sobre.firma)) {
        return bloqueada('firma', 'La licencia no es auténtica o fue modificada después de emitirse.');
    }

    const datos = {
        cliente: p.cliente || '—',
        id: p.id || null,
        edicion: p.edicion === 'plus' ? 'plus' : 'basica',
        vence: DIA_RE.test(p.vence || '') ? p.vence : null,
        host: p.host || null
    };

    if (datos.host && datos.host.toLowerCase() !== os.hostname().toLowerCase()) {
        return bloqueada('host',
            `Esta licencia fue emitida para el equipo "${datos.host}" y no para "${os.hostname()}".`,
            datos);
    }

    if (relojGuardado && ahora.getTime() < relojGuardado - TOLERANCIA_RELOJ_MS) {
        return bloqueada('reloj',
            'La fecha del sistema está atrasada respecto de la última registrada. ' +
            'Corregí la fecha y hora del servidor para continuar.',
            datos);
    }

    // Sin fecha de vencimiento válida = licencia perpetua.
    if (!datos.vence) {
        return { estado: 'activa', motivo: null, mensaje: 'Licencia perpetua.',
                 diasRestantes: null, ...datos };
    }

    const dias = diasHasta(datos.vence, ahora);
    if (dias < 0) {
        return bloqueada('vencida', `La licencia venció el ${datos.vence}.`,
            { ...datos, diasRestantes: dias });
    }

    return {
        estado: dias <= AVISO_DIAS ? 'por_vencer' : 'activa',
        motivo: null,
        mensaje: dias <= AVISO_DIAS
            ? `La licencia vence en ${dias} día(s) (${datos.vence}).`
            : `Licencia vigente hasta el ${datos.vence}.`,
        diasRestantes: dias,
        ...datos
    };
}

// ── Estado vivo del proceso ──────────────────────────────────────────────────

let estado = { requerida: false, estado: 'no_aplica', motivo: null,
               mensaje: 'Esta instalación no requiere licencia.',
               cliente: null, id: null, edicion: null, vence: null, diasRestantes: null };

function estadoLicencia() {
    return estado;
}

// ¿Está el sistema bloqueado ahora mismo?
function sistemaBloqueado() {
    return estado.estado === 'bloqueada';
}

async function verificarLicencia() {
    if (!licenciaRequerida()) {
        estado = { requerida: false, estado: 'no_aplica', motivo: null,
                   mensaje: 'Esta instalación no requiere licencia.',
                   cliente: null, id: null, edicion: null, vence: null, diasRestantes: null };
        return estado;
    }

    const ahora = new Date();
    let sobre = null;
    let fallo = null;

    try {
        sobre = JSON.parse(fs.readFileSync(rutaLicencia(), 'utf8'));
    } catch (err) {
        fallo = err.code === 'ENOENT'
            ? bloqueada('ausente', `No se encontró el archivo de licencia en ${rutaLicencia()}.`)
            : bloqueada('ilegible', 'El archivo de licencia no se pudo leer.');
    }

    const relojGuardado = await leerRelojGuardado();
    const nuevo = fallo || evaluar(sobre, ahora, relojGuardado);

    // La marca de reloj solo avanza: así un atraso posterior queda en evidencia.
    if (ahora.getTime() > relojGuardado) await guardarReloj(ahora);

    estado = { requerida: true, ...nuevo };
    return estado;
}

// Revisa periódicamente: un servicio que arranca en enero y no se reinicia
// tiene que darse cuenta de que la licencia venció en marzo.
function vigilarLicencia(intervaloMs = 60 * 60 * 1000) {
    if (!licenciaRequerida()) return null;
    const t = setInterval(() => {
        const antes = estado.estado;
        verificarLicencia()
            .then(nuevo => {
                if (nuevo.estado !== antes) {
                    console.log(`[LICENCIA] ${antes} -> ${nuevo.estado}: ${nuevo.mensaje}`);
                }
            })
            .catch(() => { /* se reintenta en el próximo ciclo */ });
    }, intervaloMs);
    t.unref();
    return t;
}

module.exports = {
    verificarLicencia, estadoLicencia, sistemaBloqueado, licenciaRequerida,
    vigilarLicencia, rutaLicencia,
    // exportados para el firmador y las pruebas
    canonico, firmar, firmaValida, evaluar, AVISO_DIAS
};
