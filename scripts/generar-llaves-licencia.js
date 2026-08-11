#!/usr/bin/env node
/**
 * Generador del par de llaves Ed25519 para firmar licencias del Turnero.
 *
 * SE CORRE UNA SOLA VEZ EN LA VIDA DEL PRODUCTO.
 *
 *   - La llave PRIVADA queda fuera del repositorio (por defecto en
 *     ~/.turnero-licencias/) y es lo único que permite emitir licencias.
 *     Si se pierde, no se pueden emitir ni renovar licencias nunca más.
 *     Si se filtra, cualquiera puede fabricarse una licencia perpetua.
 *   - La llave PÚBLICA se pega en app/utils/licencia.js y viaja dentro del
 *     ejecutable que se entrega al cliente. No es secreta.
 *
 * Uso:
 *   node scripts/generar-llaves-licencia.js
 *   node scripts/generar-llaves-licencia.js --dir /ruta/segura --forzar
 *
 * Regenerar el par INVALIDA todas las licencias ya emitidas: por eso el script
 * se niega a sobrescribir una llave existente salvo que se pase --forzar.
 */

const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');

function arg(nombre, porDefecto = null) {
    const i = process.argv.indexOf(`--${nombre}`);
    return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : porDefecto;
}
const flag = nombre => process.argv.includes(`--${nombre}`);

const DIR = arg('dir', path.join(os.homedir(), '.turnero-licencias'));
const RUTA_PRIVADA = path.join(DIR, 'privada.pem');
const RUTA_PUBLICA = path.join(DIR, 'publica.pem');

if (fs.existsSync(RUTA_PRIVADA) && !flag('forzar')) {
    console.error(`\n  Ya existe una llave privada en:\n    ${RUTA_PRIVADA}\n`);
    console.error('  Regenerarla invalidaría TODAS las licencias emitidas hasta hoy.');
    console.error('  Si de verdad es lo que querés, repetí el comando con --forzar.\n');
    process.exit(1);
}

fs.mkdirSync(DIR, { recursive: true, mode: 0o700 });

const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');

const pemPrivada = privateKey.export({ type: 'pkcs8', format: 'pem' });
const pemPublica = publicKey.export({ type: 'spki', format: 'pem' });

fs.writeFileSync(RUTA_PRIVADA, pemPrivada, { mode: 0o600 });
fs.writeFileSync(RUTA_PUBLICA, pemPublica, { mode: 0o644 });

console.log('\n  Par de llaves Ed25519 generado.\n');
console.log(`  Privada (SECRETA, respaldala):  ${RUTA_PRIVADA}`);
console.log(`  Pública:                        ${RUTA_PUBLICA}\n`);
console.log('  Pegá esta llave pública en la constante LLAVE_PUBLICA_PEM');
console.log('  de app/utils/licencia.js:\n');
console.log(pemPublica.trim().split('\n').map(l => `    ${l}`).join('\n'));
console.log('\n  Recordá: hacé un respaldo de la llave privada FUERA de este equipo.');
console.log('  Sin ella no podés emitir ni renovar licencias.\n');
