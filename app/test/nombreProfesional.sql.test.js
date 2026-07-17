// Paridad entre la canonización de JavaScript y la de SQL.
//
// La misma regla de identidad vive en dos motores:
//   - app/utils/nombreProfesional.js         -> la usa el runtime al sincronizar
//   - canonizar_nombre_profesional() (SQL)   -> la usa la migración (schema.sql) para
//                                               el backfill y para alinear los nombres
//                                               ya guardados
//
// Si derivan, la migración escribe una llave distinta a la que el runtime va a producir:
// el backfill crea 'ANA MUÑOZ' y el sync busca 'ANA MUNOZ', no empata, y aparece un
// profesional duplicado con los pacientes partidos entre los dos.
//
// Ya pasó una vez — \s en PostgreSQL NO captura U+00A0 (en JavaScript sí) y el SQL no
// normalizaba NFC, así que discrepaban justo en los casos sucios. Los valores se veían
// idénticos en pantalla y diferían en bytes.
//
// Este test NO lee un archivo: interroga a la función REAL instalada en la BD (la que
// creó la migración). Así prueba lo que de verdad corre, no una copia que podría estar
// desactualizada. Se salta solo si no hay PostgreSQL a mano.

const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');

const { canonizar } = require('../utils/nombreProfesional');

// Casos con la mugre real del tablero de Biofile, con nombres inventados: lo que se
// prueba son clases de caracteres, no personas. Los invisibles van con escapes
// explícitos a propósito: escritos como literales, un editor que "normalice" el archivo
// los volvería espacios normales y el test pasaría sin probar nada.
const CASOS = [
    'ANA GOMEZ',
    'ana gomez',
    'Ana Gomez',
    'ANA  GOMEZ ',
    '  ANA GOMEZ',
    'ANA GOMEZ (LABORATORIO CLINICO DE HEMATOLOGIA Y BANCO DE SANGRE)',
    'LUIS TORRES(SALUD OCUPACIONAL)',
    'ROSA VEGA(FONOAUDIOLOGIA)',
    '(EXÁMENES COMPLEMENTARIOS)',
    'JOSÉ RAMÍREZ',
    'JOSE RAMIREZ',
    'MARÍA GÜELL',
    'PEÑA',
    'PENA',
    'CARLOS SOTO',
    'ana mun\u0303oz',            // NFD: n + U+0303 (tilde combinante)
    'ana mu\u00f1oz',             // NFC: U+00F1 (un solo carácter)
    'ANA\u00a0GOMEZ',             // U+00A0: el &nbsp; que emite el tablero
    'ANA\u202fGOMEZ',             // U+202F: narrow nbsp
    '',
    '   ',
];

describe('paridad JS <-> SQL de la canonización', () => {
    let cliente = null;
    let motivoSalto = null;

    before(async () => {
        let Client;
        try {
            ({ Client } = require('pg'));
        } catch {
            motivoSalto = 'el paquete pg no está instalado';
            return;
        }
        cliente = new Client({
            host: process.env.DB_HOST || 'db',
            port: process.env.DB_PORT || 5432,
            database: process.env.DB_NAME || 'turnero',
            user: process.env.DB_USER || 'turnero_user',
            password: process.env.DB_PASSWORD,
            connectionTimeoutMillis: 3000,
        });
        try {
            await cliente.connect();
        } catch (err) {
            motivoSalto = `no hay PostgreSQL alcanzable (${err.code || err.message})`;
            cliente = null;
        }
    });

    after(async () => {
        if (cliente) await cliente.end();
    });

    test('la función existe en la BD y conserva sus reglas', async (t) => {
        if (!cliente) return t.skip(motivoSalto);

        const { rows } = await cliente.query(
            `SELECT prosrc FROM pg_proc WHERE proname = 'canonizar_nombre_profesional'`);
        assert.equal(rows.length, 1,
            'no existe canonizar_nombre_profesional(): ¿corrió la migración?');
        const src = rows[0].prosrc;

        assert.ok(src.includes('normalize'), 'falta normalize(NFC): discreparía en NFD');
        assert.ok(src.includes('00a0'), 'falta la clase de espacios raros: discreparía en nbsp');
        // La ñ va a Ñ (sube de caja), NUNCA a N: es otra letra, no una tilde.
        assert.ok(src.includes("'áéíóúüÁÉÍÓÚÜñ','aeiouuAEIOUUÑ'"),
            'cambió el plegado de tildes/ñ: revisá la paridad con nombreProfesional.js');
        // upper() depende del locale de la BD: en 'C'/'POSIX' deja ñ y vocales acentuadas
        // intactas (upper('muñoz') -> 'MUñOZ'). Plegando primero, upper() solo ve ASCII y
        // el resultado es el mismo en cualquier instalación de PostgreSQL.
        assert.ok(/upper\(\s*translate\(/.test(src),
            'el translate debe ir DENTRO del upper (correr primero), o el resultado depende del locale');
    });

    test('ambos motores producen la MISMA llave, byte a byte', async (t) => {
        if (!cliente) return t.skip(motivoSalto);

        const params = CASOS.map((_, i) => `($${i + 1})`).join(',');
        const { rows } = await cliente.query(
            `SELECT crudo, canonizar_nombre_profesional(crudo) AS canonico
             FROM (VALUES ${params}) AS t(crudo)`,
            CASOS
        );

        assert.equal(rows.length, CASOS.length);
        const discrepancias = [];
        for (const fila of rows) {
            const js = canonizar(fila.crudo);
            if (js !== fila.canonico) {
                discrepancias.push({
                    crudo: JSON.stringify(fila.crudo),
                    js: JSON.stringify(js),
                    sql: JSON.stringify(fila.canonico),
                });
            }
        }
        assert.deepEqual(discrepancias, [],
            'JS y SQL canonizan distinto: la migración escribiría una llave que el sync no encuentra');
    });

    test('PEÑA y PENA siguen separados también en SQL', async (t) => {
        if (!cliente) return t.skip(motivoSalto);

        const { rows } = await cliente.query(
            `SELECT canonizar_nombre_profesional(crudo) AS canonico
             FROM (VALUES ($1),($2)) AS t(crudo)`,
            ['PEÑA', 'PENA']
        );
        assert.notEqual(rows[0].canonico, rows[1].canonico,
            'el SQL fusionó PEÑA y PENA: dos personas distintas quedarían como una');
    });
});
