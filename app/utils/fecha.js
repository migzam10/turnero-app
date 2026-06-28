// Utilidades de fecha centradas en la zona horaria de la clínica (America/Bogota).
// Evita el bug de `new Date().toISOString().split('T')[0]`, que devuelve la fecha
// en UTC y se corre un día después de las 7:00 PM hora local.

const TZ = 'America/Bogota';

// Devuelve la fecha de "hoy" en Bogotá con formato YYYY-MM-DD (en-CA produce ISO).
function fechaHoyBogota() {
    return new Date().toLocaleDateString('en-CA', { timeZone: TZ });
}

module.exports = { fechaHoyBogota, TZ };
