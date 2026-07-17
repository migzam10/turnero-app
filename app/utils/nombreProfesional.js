// Identidad del profesional a partir de su nombre.
//
// Biofile no expone un identificador del profesional: el tablero PacientesSeguimiento
// solo trae el nombre como texto ("ANA GOMEZ (LABORATORIO CLINICO)"). El nombre es,
// de hecho, el usuario de Biofile — pero Biofile lo guarda tal cual lo tecleó quien creó
// la cuenta y no normaliza nada. En esta misma BD conviven 'ANA GOMEZ' y
// 'luis torres': el mismo campo, con convenciones opuestas.
//
// Por eso el nombre crudo no sirve como llave y hay que canonizarlo. No es cosmética:
// `columna_header` (= el nombre del profesional) es parte de uq_asig_ingreso_columna, la
// llave del ON CONFLICT del sync. Si mañana el mismo profesional llega escrito distinto,
// el upsert no encuentra la fila y crea una segunda: el paciente aparece duplicado en la
// pantalla del profesional y en el Display.
//
// Esta regla DEBE vivir en el backend, no en la extensión. La extensión es código que
// corre en el Chrome de cada PC de la clínica y se actualiza por separado; si la identidad
// dependiera de ella, una PC con una versión vieja empezaría a crear profesionales
// fantasma. El servidor canoniza siempre, sin confiar en lo que le llega.
//
// La regla es idéntica a la de canonizar_nombre_profesional() en schema.sql, que usa la
// migración para el backfill. Si cambia una, cambia la otra: si la migración escribe
// una llave distinta a la que produce el runtime, el sync no la encuentra y duplica al
// profesional. Hay un test de paridad que lo verifica byte a byte contra la función
// real instalada en la BD.

// Tildes ortográficas: se pliegan. En español no hay dos nombres que se distingan solo
// por la tilde, así que MARÍA y MARIA son siempre la misma persona.
const TILDES = { 'Á': 'A', 'É': 'E', 'Í': 'I', 'Ó': 'O', 'Ú': 'U', 'Ü': 'U' };

// Espacios que no son U+0020 y que el DOM de Biofile sí emite (la tabla viene con &nbsp;).
// Se listan con escapes explícitos en vez de confiar en \s, cuyo alcance difiere entre
// motores: \s en JavaScript captura U+00A0, en PostgreSQL no. Dejarlo implícito haría que
// esta función y la del SQL de análisis discrepen justo en los casos sucios.
const ESPACIOS_RAROS = /[\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000\ufeff]/g;

// Quita el área entre paréntesis del final, con o sin espacio antes:
//   "LUIS TORRES(SALUD OCUPACIONAL)"  -> "LUIS TORRES"
//   "ANA GOMEZ (LABORATORIO)"       -> "ANA GOMEZ"
//   "(EXÁMENES COMPLEMENTARIOS)"        -> ""   (se descarta aguas arriba)
// NFC primero: el texto raspado puede venir descompuesto (n + tilde combinante) y sin
// componer, la ñ no sobreviviría intacta al plegado.
function quitarArea(crudo) {
    return String(crudo ?? '')
        .normalize('NFC')
        .replace(ESPACIOS_RAROS, ' ')
        .replace(/\s*\([^)]*\)\s*$/, '');
}

// Nombre para mostrar: limpio pero con el case de la fuente intacto. No se inventa
// capitalización — las pantallas ya la resuelven con CSS, igual que hace Biofile.
function sanear(crudo) {
    return quitarArea(crudo).replace(/\s+/g, ' ').trim();
}

// Llave de identidad. Dos nombres que canonizan igual son la misma persona.
//
// La ñ NO se pliega, a diferencia de las tildes: en español es una letra distinta, y PEÑA
// y PENA son dos apellidos reales. Los dos errores no cuestan lo mismo — partir a una
// persona en dos se ve en el catálogo y se arregla fusionando; fusionar a dos personas en
// una es silencioso y le muestra a un profesional los pacientes de otro.
function canonizar(crudo) {
    return sanear(crudo)
        .toUpperCase()
        .replace(/[ÁÉÍÓÚÜ]/g, c => TILDES[c]);
}

// ¿Este texto corresponde a un profesional real? El tablero trae divs sin persona
// ("(EXÁMENES COMPLEMENTARIOS)") que canonizan a vacío y no deben crear nada.
function esProfesionalValido(crudo) {
    return canonizar(crudo).length > 0;
}

module.exports = { canonizar, sanear, esProfesionalValido };
