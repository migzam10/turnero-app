// Notifica a las vistas que re-renderizan el estado global de pacientes
// (panel admin y módulo profesional). Las demás pantallas tienen sus eventos
// específicos y no deben recibir este broadcast.
function emitUpdatePatients(io) {
    if (!io) return;
    io.to('admin').to('profesional').emit('UPDATE_PATIENTS', { ts: Date.now() });
}
module.exports = { emitUpdatePatients };
