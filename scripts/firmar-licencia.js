#!/usr/bin/env node
/**
 * Emisor de licencias del Turnero. HERRAMIENTA INTERNA: nunca se entrega a un
 * cliente, aunque por sí sola es inofensiva — sin la llave privada no firma nada.
 *
 * SE CORRE EN EL EQUIPO DEL TITULAR (la Mac de desarrollo), desde la raíz del
 * repositorio. Nunca en el servidor del cliente: allá no está la llave privada.
 *
 * Uso:
 *   node scripts/firmar-licencia.js --cliente "IPS Los Andes" --dias 30 --edicion basica
 *   node scripts/firmar-licencia.js --cliente "IPS Los Andes" --vence nunca --edicion plus
 *   node scripts/firmar-licencia.js --cliente "Clínica X" --vence 2026-12-31 --edicion plus --host SRV-CLINICA
 *
 * Opciones (--cliente, --edicion y el vencimiento son obligatorios):
 *   --cliente <nombre>    Nombre del licenciatario. Se muestra en Admin.
 *   --edicion <valor>     basica (solo timbre) | plus (timbre + voz TTS).
 *                         Obligatoria: no tiene valor por defecto para que no se
 *                         emita por descuido una licencia con la edición errada.
 *   --vence <YYYY-MM-DD>  Último día de validez (ese día todavía funciona), o
 *                         "nunca" para una licencia perpetua.
 *   --dias <n>            En vez de --vence: vence en n días contados desde hoy.
 *   --host <nombre>       Ata la licencia al hostname del servidor del cliente.
 *                         Sin esto, la licencia sirve en cualquier equipo.
 *   --nota <texto>        Texto libre (p.ej. "Evaluación 30 días"). No se valida.
 *   --salida <ruta>       Archivo destino (default: licencias/<id>.lic).
 *   --llave <ruta>        Llave privada (default: ~/.turnero-licencias/privada.pem).
 *
 * El archivo resultante se llama `licencia.lic` en el servidor del cliente y va
 * junto al ejecutable, en el mismo directorio que el .env.
 */

const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { firmar } = require('../app/utils/licencia');

function arg(nombre, porDefecto = null) {
    const i = process.argv.indexOf(`--${nombre}`);
    return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : porDefecto;
}

function salir(mensaje) {
    console.error(`\n  ${mensaje}\n`);
    process.exit(1);
}

const cliente = arg('cliente');
if (!cliente) salir('Falta --cliente "Nombre del licenciatario".');

// --edicion es OBLIGATORIA a propósito. Si tuviera un valor por defecto, un
// olvido al emitir le entregaría al cliente una licencia sin voz que él pagó
// con voz, y el error solo se descubriría el día de la instalación.
const edicionArg = (arg('edicion') || '').toLowerCase();
if (!edicionArg) {
    salir('Falta --edicion basica|plus.\n\n' +
          '    basica = solo timbre\n' +
          '    plus   = timbre + anuncio por voz (TTS)\n\n' +
          '  Es obligatorio para que no se emita una licencia con la edición equivocada.');
}
if (edicionArg !== 'basica' && edicionArg !== 'plus') {
    salir(`--edicion "${edicionArg}" no existe. Los valores válidos son: basica | plus.`);
}
const edicion = edicionArg;
const host = arg('host');
const nota = arg('nota', '');

// Vencimiento: --vence YYYY-MM-DD | "nunca", o --dias N.
const TZ = 'America/Bogota';
const hoy = new Date().toLocaleDateString('en-CA', { timeZone: TZ });
let vence = arg('vence');
const dias = arg('dias');

if (!vence && dias) {
    const n = parseInt(dias, 10);
    if (!Number.isFinite(n) || n < 1) salir('--dias debe ser un número de días mayor que 0.');
    const d = new Date(Date.parse(`${hoy}T12:00:00-05:00`) + n * 86400000);
    vence = d.toLocaleDateString('en-CA', { timeZone: TZ });
}
if (!vence) salir('Falta --vence YYYY-MM-DD (o --dias N, o --vence nunca).');

if (vence.toLowerCase() === 'nunca') {
    vence = null;
} else {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(vence)) salir('--vence debe tener formato YYYY-MM-DD, o ser "nunca".');
    if (vence < hoy) salir(`--vence ${vence} ya pasó (hoy es ${hoy}). La licencia nacería bloqueada.`);
}

// Llave privada
const rutaLlave = arg('llave', path.join(os.homedir(), '.turnero-licencias', 'privada.pem'));
let llavePrivada;
try {
    llavePrivada = crypto.createPrivateKey(fs.readFileSync(rutaLlave, 'utf8'));
} catch {
    salir(`No se pudo leer la llave privada en:\n    ${rutaLlave}\n\n  ` +
          'Generala con: node scripts/generar-llaves-licencia.js');
}

const slug = cliente.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 32) || 'cliente';
const id = `${slug}-${crypto.randomBytes(2).toString('hex')}`;

const payload = { v: 1, id, cliente, edicion, host: host || null, emitida: hoy, vence, nota };
const sobre = { payload, firma: firmar(payload, llavePrivada) };

const salida = arg('salida', path.join(__dirname, '..', 'licencias', `${id}.lic`));
fs.mkdirSync(path.dirname(salida), { recursive: true });
fs.writeFileSync(salida, JSON.stringify(sobre, null, 2) + '\n');

console.log('\n  Licencia emitida.\n');
console.log(`  Cliente:   ${cliente}`);
console.log(`  ID:        ${id}`);
console.log(`  Edición:   ${edicion}${edicion === 'plus' ? ' (con voz)' : ' (sin voz)'}`);
console.log(`  Vence:     ${vence || 'nunca (perpetua)'}`);
console.log(`  Equipo:    ${host || 'cualquiera'}`);
console.log(`  Archivo:   ${salida}\n`);
console.log('  Copialo al servidor del cliente como  licencia.lic , junto al ejecutable');
console.log('  (mismo directorio que el .env), y reiniciá el servicio.\n');
