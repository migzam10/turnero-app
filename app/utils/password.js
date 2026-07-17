// Hashing de contraseñas de profesionales.
//
// Usa scrypt del módulo `crypto` del runtime: es una función de derivación pensada para
// contraseñas (lenta y con costo de memoria a propósito, para que un atacante con la BD en
// la mano no pueda probar millones por segundo). No agrega dependencias — bcrypt o argon2
// serían equivalentes, pero traen binarios nativos que hay que compilar en el Windows
// Server, y aquí no hacen falta.
//
// OJO, deuda conocida que NO es de este módulo: la clave del panel admin se guarda en
// texto plano en la tabla `configuracion` (ver adminAuth.js). Eso ya era así; estas
// contraseñas NO copian ese patrón. Vale la pena arreglar aquello aparte.
//
// Formato guardado: scrypt$<salt_b64>$<hash_b64>. Lleva el algoritmo por delante para que
// migrar a otro más adelante no rompa los hashes viejos.

const crypto = require('crypto');
const { promisify } = require('util');

const scrypt = promisify(crypto.scrypt);
const LONGITUD_CLAVE = 64;
const BYTES_SAL = 16;

async function hashear(plana) {
    const texto = String(plana ?? '');
    if (!texto) throw new Error('password_vacia');
    const sal = crypto.randomBytes(BYTES_SAL);
    const hash = await scrypt(texto, sal, LONGITUD_CLAVE);
    return `scrypt$${sal.toString('base64')}$${hash.toString('base64')}`;
}

// Devuelve true/false. Nunca lanza por un hash malformado: un registro corrupto debe
// negar el acceso, no tumbar la petición.
async function verificar(plana, guardado) {
    try {
        const texto = String(plana ?? '');
        if (!texto || !guardado) return false;

        const [algoritmo, salB64, hashB64] = String(guardado).split('$');
        if (algoritmo !== 'scrypt' || !salB64 || !hashB64) return false;

        const esperado = Buffer.from(hashB64, 'base64');
        const calculado = await scrypt(texto, Buffer.from(salB64, 'base64'), esperado.length);

        // timingSafeEqual y no ===: comparar bytes con corto-circuito filtra, por el tiempo
        // que tarda, cuántos coinciden desde el principio.
        return crypto.timingSafeEqual(esperado, calculado);
    } catch {
        return false;
    }
}

module.exports = { hashear, verificar };
