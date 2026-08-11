// Verificación de licencias firmadas (utils/licencia.js).
//
// Lo que se prueba acá es exactamente lo que separa una licencia legítima de un
// intento de estirarla: la firma cubre el contenido completo, así que cambiar la
// fecha de vencimiento a mano invalida el archivo, y atrasar el reloj del
// servidor tampoco revive una licencia ya vencida.
//
// El test firma con un par de llaves PROPIO generado al vuelo, no con el par de
// producción: la llave privada real no está en el repositorio.

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');

const { canonico, evaluar, firmar, AVISO_DIAS } = require('../utils/licencia');

// Fecha fija para que el test no dependa del día en que se corra.
const AHORA = new Date('2026-08-05T10:00:00-05:00');
const dia = offset =>
    new Date(AHORA.getTime() + offset * 86400000).toLocaleDateString('en-CA', { timeZone: 'America/Bogota' });

// Par de llaves de prueba. Como la llave pública embebida en licencia.js es la
// de producción, las licencias firmadas acá NO validan contra ella: sirven para
// comprobar los rechazos, y la ruta feliz se prueba con firma simulada.
const par = crypto.generateKeyPairSync('ed25519');

function sobre(payload, firma = 'firma-que-no-corresponde') {
    return { payload, firma };
}

const base = {
    v: 1, id: 'prueba-0001', cliente: 'IPS de Prueba', edicion: 'plus',
    host: null, emitida: dia(-10), vence: dia(30), nota: ''
};

describe('serialización canónica', () => {
    test('el orden de las claves no cambia lo que se firma', () => {
        const a = { cliente: 'X', vence: '2026-01-01', v: 1 };
        const b = { v: 1, vence: '2026-01-01', cliente: 'X' };
        assert.equal(canonico(a), canonico(b));
    });

    test('cambiar un valor sí cambia lo que se firma', () => {
        assert.notEqual(
            canonico({ ...base, vence: dia(30) }),
            canonico({ ...base, vence: dia(3000) })
        );
    });

    test('la firma solo verifica contra el contenido exacto', () => {
        const firma = firmar(base, par.privateKey);
        const ok = crypto.verify(null, Buffer.from(canonico(base)), par.publicKey, Buffer.from(firma, 'base64'));
        assert.equal(ok, true);

        // El escenario real: el cliente abre el .lic y se estira el vencimiento.
        const estirada = { ...base, vence: dia(3000) };
        const roto = crypto.verify(null, Buffer.from(canonico(estirada)), par.publicKey, Buffer.from(firma, 'base64'));
        assert.equal(roto, false);
    });
});

describe('evaluación de la licencia', () => {
    test('sin archivo válido queda bloqueada', () => {
        assert.equal(evaluar(null, AHORA, 0).estado, 'bloqueada');
        assert.equal(evaluar({}, AHORA, 0).motivo, 'ilegible');
        assert.equal(evaluar({ payload: base }, AHORA, 0).motivo, 'ilegible');
    });

    test('una firma que no corresponde se rechaza', () => {
        const r = evaluar(sobre(base), AHORA, 0);
        assert.equal(r.estado, 'bloqueada');
        assert.equal(r.motivo, 'firma');
    });

    test('la firma se valida ANTES que la fecha: una licencia vigente pero falsa no pasa', () => {
        const r = evaluar(sobre({ ...base, vence: dia(3000) }), AHORA, 0);
        assert.equal(r.motivo, 'firma');
    });
});

// La ruta feliz y el resto de las reglas se prueban sobre `evaluar` con la
// verificación de firma neutralizada: lo que interesa medir acá son las fechas.
describe('reglas de vigencia (con firma dada por buena)', () => {
    const evaluarSinFirma = (payload, ahora, reloj) => {
        const original = crypto.verify;
        crypto.verify = () => true;
        try {
            return evaluar(sobre(payload), ahora, reloj);
        } finally {
            crypto.verify = original;
        }
    };

    test('licencia vigente', () => {
        const r = evaluarSinFirma({ ...base, vence: dia(60) }, AHORA, 0);
        assert.equal(r.estado, 'activa');
        assert.equal(r.edicion, 'plus');
        assert.equal(r.cliente, 'IPS de Prueba');
    });

    test('avisa cuando está por vencer, pero sigue funcionando', () => {
        const r = evaluarSinFirma({ ...base, vence: dia(AVISO_DIAS - 1) }, AHORA, 0);
        assert.equal(r.estado, 'por_vencer');
        assert.ok(r.diasRestantes <= AVISO_DIAS);
    });

    test('vence al día siguiente del último día válido', () => {
        assert.equal(evaluarSinFirma({ ...base, vence: dia(0) }, AHORA, 0).estado, 'por_vencer');
        assert.equal(evaluarSinFirma({ ...base, vence: dia(-1) }, AHORA, 0).motivo, 'vencida');
    });

    test('sin fecha de vencimiento es perpetua', () => {
        const r = evaluarSinFirma({ ...base, vence: null }, AHORA, 0);
        assert.equal(r.estado, 'activa');
        assert.equal(r.vence, null);
    });

    test('atrasar el reloj no revive una licencia vencida', () => {
        const vencida = { ...base, vence: dia(-1) };
        // El sistema ya vio el 5 de agosto; alguien pone el reloj en junio.
        const junio = new Date('2026-06-01T10:00:00-05:00');
        const r = evaluarSinFirma(vencida, junio, AHORA.getTime());
        assert.equal(r.motivo, 'reloj');
    });

    test('un ajuste chico de hora no bloquea nada', () => {
        const r = evaluarSinFirma({ ...base, vence: dia(60) }, new Date(AHORA.getTime() - 3600000), AHORA.getTime());
        assert.equal(r.estado, 'activa');
    });

    test('la licencia atada a otro equipo no sirve', () => {
        const r = evaluarSinFirma({ ...base, host: 'SERVIDOR-QUE-NO-EXISTE' }, AHORA, 0);
        assert.equal(r.motivo, 'host');
    });

    test('la edición desconocida cae a básica (no se regala la voz)', () => {
        assert.equal(evaluarSinFirma({ ...base, edicion: 'premium' }, AHORA, 0).edicion, 'basica');
    });
});
