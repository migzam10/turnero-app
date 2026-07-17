// Tests del hashing de contraseñas de profesionales.
//
// Lo que se protege aquí no es un detalle: si `verificar` devolviera true de más, un
// profesional entraría a ver los pacientes de otro. Y si el hash acabara siendo reversible
// o predecible, la BD (que se respalda a diario en un .dump) dejaría de ser segura.

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');

const { hashear, verificar } = require('../utils/password');

describe('hashear', () => {
    test('no guarda la clave en texto plano', async () => {
        const h = await hashear('secreta123');
        assert.ok(!h.includes('secreta123'), 'la clave aparece dentro del hash');
    });

    test('lleva el algoritmo por delante (para poder migrarlo después)', async () => {
        assert.match(await hashear('x'), /^scrypt\$/);
    });

    test('la misma clave produce hashes distintos (sal aleatoria)', async () => {
        // Sin sal por hash, dos profesionales con la misma clave tendrían el mismo valor
        // en la BD, y una tabla precalculada las rompería todas de una.
        const [a, b] = [await hashear('misma'), await hashear('misma')];
        assert.notEqual(a, b);
        // ...y aun así ambas validan.
        assert.equal(await verificar('misma', a), true);
        assert.equal(await verificar('misma', b), true);
    });

    test('rechaza una clave vacía', async () => {
        await assert.rejects(() => hashear(''), /password_vacia/);
        await assert.rejects(() => hashear(null), /password_vacia/);
    });
});

describe('verificar', () => {
    test('acepta la correcta y rechaza la incorrecta', async () => {
        const h = await hashear('secreta123');
        assert.equal(await verificar('secreta123', h), true);
        assert.equal(await verificar('secreta124', h), false);
        assert.equal(await verificar('SECRETA123', h), false, 'la clave NO es case-insensitive');
        assert.equal(await verificar('secreta123 ', h), false, 'no se recorta: un espacio cuenta');
    });

    test('nunca lanza: un registro corrupto niega el acceso, no tumba la petición', async () => {
        for (const malo of [null, undefined, '', 'basura', 'basura$mala', 'md5$a$b', 'scrypt$$']) {
            assert.equal(await verificar('x', malo), false, `explotó o aceptó con: ${JSON.stringify(malo)}`);
        }
    });

    test('una clave vacía nunca entra, ni contra un hash válido', async () => {
        const h = await hashear('secreta123');
        assert.equal(await verificar('', h), false);
        assert.equal(await verificar(null, h), false);
        assert.equal(await verificar(undefined, h), false);
    });
});
