// Tests de la función de identidad del profesional.
//
// Estos invariantes NO son detalles: `canonizar` decide si dos filas son la misma
// persona, y su salida alimenta `columna_header`, que es parte de la llave única
// uq_asig_ingreso_columna. Aflojar una regla aquí no rompe un test lejano — duplica
// pacientes en la pantalla del profesional o le muestra a uno los pacientes de otro.
//
// Los nombres son INVENTADOS a propósito: este repo se clona para varios clientes y el
// personal de uno no tiene por qué viajar en los tests de otro. Lo que se prueba son
// clases de caracteres (tilde, ñ, NFD, nbsp, paréntesis del área), no personas: un
// apellido real no probaría ni un caso más que 'PEÑA'.
//
// Correr:  npm test        (dentro de app/, o docker exec turnero_app npm test)

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');

const { canonizar, sanear, esProfesionalValido } = require('../utils/nombreProfesional');

describe('canonizar — limpieza básica', () => {
    test('deja intacto un nombre ya limpio', () => {
        assert.equal(canonizar('ANA GOMEZ'), 'ANA GOMEZ');
    });

    test('unifica el case: Biofile guarda los usuarios como los tecleó quien los creó', () => {
        // La fuente no normaliza nada: en una misma BD conviven usuarios en MAYÚSCULAS,
        // en minúsculas y capitalizados.
        assert.equal(canonizar('ana gomez'), 'ANA GOMEZ');
        assert.equal(canonizar('Ana Gomez'), 'ANA GOMEZ');
        assert.equal(canonizar('ANA GOMEZ'), 'ANA GOMEZ');
    });

    test('recorta espacios al borde y colapsa los internos', () => {
        assert.equal(canonizar('  ANA GOMEZ'), 'ANA GOMEZ');
        assert.equal(canonizar('ANA GOMEZ '), 'ANA GOMEZ');
        assert.equal(canonizar('ANA  GOMEZ'), 'ANA GOMEZ');
        assert.equal(canonizar('  ANA   GOMEZ  '), 'ANA GOMEZ');
    });
});

describe('canonizar — el área entre paréntesis', () => {
    test('la quita con espacio antes', () => {
        assert.equal(
            canonizar('ANA GOMEZ (LABORATORIO CLINICO DE HEMATOLOGIA Y BANCO DE SANGRE)'),
            'ANA GOMEZ');
    });

    test('la quita sin espacio antes (el tablero emite las dos formas)', () => {
        // La fuente es inconsistente consigo misma: ambas formas conviven en una tabla.
        assert.equal(canonizar('LUIS TORRES(SALUD OCUPACIONAL)'), 'LUIS TORRES');
        assert.equal(canonizar('ROSA VEGA(FONOAUDIOLOGIA)'), 'ROSA VEGA');
    });

    test('un div sin persona canoniza a vacío y no debe crear profesional', () => {
        assert.equal(canonizar('(EXÁMENES COMPLEMENTARIOS)'), '');
        assert.equal(esProfesionalValido('(EXÁMENES COMPLEMENTARIOS)'), false);
    });
});

describe('canonizar — tildes y ñ (la regla con más consecuencias)', () => {
    test('pliega las tildes: son ortográficas, nunca distinguen personas', () => {
        assert.equal(canonizar('JOSÉ RAMÍREZ'), canonizar('JOSE RAMIREZ'));
        assert.equal(canonizar('MARÍA GÜELL'), 'MARIA GUELL');
    });

    test('NO pliega la ñ: PEÑA y PENA son dos apellidos distintos', () => {
        // El invariante más importante del módulo. Plegar la ñ fusionaría a dos
        // personas en silencio, y un profesional vería los pacientes del otro.
        // Partir a una persona en dos, en cambio, se ve en el catálogo y se arregla.
        assert.notEqual(canonizar('PEÑA'), canonizar('PENA'));
        assert.equal(canonizar('PEÑA'), 'PEÑA');
        assert.equal(canonizar('ana muñoz'), 'ANA MUÑOZ');
    });
});

describe('canonizar — mugre invisible del DOM raspado', () => {
    test('normaliza NFD a NFC: la ñ descompuesta es la misma ñ', () => {
        const nfd = 'ana mun\u0303oz';  // n + U+0303 (tilde combinante)
        const nfc = 'ana mu\u00f1oz';   // U+00F1 (la ñ como un solo carácter)
        assert.notEqual(nfd, nfc, 'los strings crudos SÍ difieren (si no, el test no prueba nada)');
        assert.equal(canonizar(nfd), canonizar(nfc));
        assert.equal(canonizar(nfd), 'ANA MUÑOZ');
    });

    test('trata el nbsp como espacio (el tablero de Biofile emite &nbsp;)', () => {
        const conNbsp    = 'ANA\u00a0GOMEZ';   // U+00A0, el &nbsp; que emite el tablero
        const conAngosto = 'ANA\u202fGOMEZ';   // U+202F (narrow nbsp)
        // Autocomprobación: si un editor 'normaliza' el archivo y los convierte en
        // espacios normales, el test seguiría en verde sin probar nada.
        assert.ok(!conNbsp.includes(' '), 'el fixture perdió el nbsp: el test no prueba nada');
        assert.equal(canonizar(conNbsp), 'ANA GOMEZ');
        assert.equal(canonizar(conAngosto), 'ANA GOMEZ');
    });
});

describe('canonizar — entradas degeneradas', () => {
    test('null, undefined y vacío no explotan', () => {
        assert.equal(canonizar(null), '');
        assert.equal(canonizar(undefined), '');
        assert.equal(canonizar(''), '');
        assert.equal(canonizar('   '), '');
    });

    test('nada de eso es un profesional válido', () => {
        for (const v of [null, undefined, '', '   ']) {
            assert.equal(esProfesionalValido(v), false);
        }
    });
});

describe('canonizar — propiedades', () => {
    test('es idempotente: canonizar lo ya canonizado no lo cambia', () => {
        // Importante porque el valor canónico vuelve a pasar por la función al
        // releerse de la BD; si no fuera idempotente, la llave derivaría sola.
        const casos = [
            'ANA GOMEZ', 'ana gomez', 'JOSÉ RAMÍREZ', 'ana muñoz',
            'LUIS TORRES(SALUD OCUPACIONAL)', 'PEÑA', '  X  Y ', '',
        ];
        for (const c of casos) {
            assert.equal(canonizar(canonizar(c)), canonizar(c), `no idempotente: ${JSON.stringify(c)}`);
        }
    });

    test('el resultado nunca trae espacios al borde ni dobles', () => {
        for (const c of ['  A  B  ', 'A  B', ' (X) ', 'A (B)']) {
            const r = canonizar(c);
            assert.equal(r, r.trim());
            assert.ok(!/\s{2,}/.test(r), `espacio doble en ${JSON.stringify(r)}`);
        }
    });

    test('nombres distintos no colapsan en el mismo canónico', () => {
        // La contracara del test de idempotencia: canonizar limpia, pero no debe
        // fusionar. Si alguien agrega un plegado de más (la ñ, un apellido sin
        // espacios, quitar acentos "de más"), esto se pone rojo.
        const distintos = [
            'ANA GOMEZ', 'ANA MUÑOZ', 'ANA MUNOZ', 'LUIS TORRES',
            'JOSE RAMIREZ', 'ROSA VEGA', 'PEÑA', 'PENA',
        ];
        assert.equal(new Set(distintos.map(canonizar)).size, distintos.length,
            'dos nombres distintos colapsaron al mismo canónico');
    });
});

describe('sanear — el nombre para mostrar', () => {
    test('limpia igual que canonizar pero conserva el case de la fuente', () => {
        assert.equal(sanear('ana muñoz'), 'ana muñoz');
        assert.equal(sanear('JOSÉ RAMÍREZ'), 'JOSÉ RAMÍREZ');
        assert.equal(sanear('  Ana  Gomez '), 'Ana Gomez');
        assert.equal(sanear('LUIS TORRES(SALUD OCUPACIONAL)'), 'LUIS TORRES');
    });

    test('no inventa capitalización: eso lo resuelve el CSS, como hace Biofile', () => {
        assert.equal(sanear('ana gomez'), 'ana gomez');
    });
});
