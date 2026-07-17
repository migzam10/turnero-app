// Resolución de un profesional a partir de su nombre, para todos los caminos que crean
// asignaciones: el sync de Biofile y los dos manuales (reasignar, asignar desde
// admisiones). Vive aquí y no en una ruta porque tener tres copias de "cómo se resuelve
// un profesional" es exactamente cómo vuelve el problema que esto arregla — antes había
// un .toUpperCase() casero en api.profesional.js que hacía media canonización por su
// cuenta.

const { canonizar, sanear, esProfesionalValido } = require('../utils/nombreProfesional');

// Devuelve el id del profesional, creándolo si no existía. NUNCA lanza por un nombre raro:
// devuelve null y el llamador sigue — una asignación sin profesional resoluble no puede
// frenar la atención del paciente.
//
// Recibe el nombre CRUDO: la canonización (la llave) y el saneado (el display) se hacen
// aquí. Pasarle uno ya canonizado no rompe la llave —canonizar es idempotente— pero deja
// el display en mayúsculas y sin tildes, que es justo lo que `sanear` evita.
//
// El ON CONFLICT refresca `visto_ultima_vez` pero NO toca `nombre_display` ni `archivado`:
// el display lo corrige el admin y tiene que quedarse (si el sync lo pisara en cada
// escaneo, la corrección duraría hasta el siguiente), y a quien archivaron no lo resucita
// un escaneo.
//
// Devuelve { id, esNuevo }. `esNuevo` sale de (xmax = 0), el truco estándar de PostgreSQL
// para distinguir un INSERT real de un DO UPDATE.
async function resolverProfesional(ejecutor, crudo, origen = 'biofile') {
    if (!esProfesionalValido(crudo)) return { id: null, esNuevo: false };

    const { rows } = await ejecutor.query(
        `INSERT INTO profesionales (nombre_canonico, nombre_display, origen, visto_ultima_vez)
         VALUES ($1, $2, $3, NOW())
         ON CONFLICT (nombre_canonico) DO UPDATE SET
             visto_ultima_vez = NOW(),
             updated_at       = NOW()
         RETURNING id, (xmax = 0) AS es_nuevo`,
        [canonizar(crudo), sanear(crudo), origen]
    );
    return { id: rows[0].id, esNuevo: rows[0].es_nuevo === true };
}

// Azúcar para los llamadores que solo necesitan la FK.
async function resolverProfesionalId(ejecutor, crudo, origen = 'biofile') {
    return (await resolverProfesional(ejecutor, crudo, origen)).id;
}

module.exports = { resolverProfesional, resolverProfesionalId };
