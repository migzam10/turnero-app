const { query } = require('../database/db');

function registrarEventosSocket(io) {
    io.on('connection', (socket) => {
        console.log(`[WS] Conectado: ${socket.id}`);

        socket.on('join', async ({ tipo, profesional, terminalId, consultorio, audioOk }) => {
            if (!tipo) return;

            socket.join(tipo);
            if (tipo === 'profesional' && profesional) {
                socket.join(`profesional:${profesional}`);
            }

            socket.data.tipo = tipo;
            socket.data.profesional = profesional;
            socket.data.terminalId = terminalId;

            if (terminalId) {
                try {
                    await query(
                        `INSERT INTO terminales (id, tipo, login_name_biofile, consultorio_numero, audio_ok, ultimo_heartbeat)
                         VALUES ($1, $2, $3, $4, $5, NOW())
                         ON CONFLICT (id) DO UPDATE
                         SET tipo = $2, login_name_biofile = $3, consultorio_numero = $4, audio_ok = $5,
                             ultimo_heartbeat = NOW(), updated_at = NOW()`,
                        [terminalId, tipo, profesional || null, consultorio || null,
                         typeof audioOk === 'boolean' ? audioOk : null]
                    );
                } catch (err) {
                    console.error('[WS] Error al registrar terminal:', err.message);
                }
            }

            console.log(`[WS] ${socket.id} sala=${tipo}${profesional ? ' prof=' + profesional : ''}`);
        });

        socket.on('heartbeat', async ({ terminalId, audioOk }) => {
            if (!terminalId) return;
            try {
                // COALESCE conserva el valor previo si el heartbeat no reporta audio.
                await query(
                    `UPDATE terminales
                     SET ultimo_heartbeat = NOW(),
                         audio_ok = COALESCE($2, audio_ok),
                         updated_at = NOW()
                     WHERE id = $1`,
                    [terminalId, typeof audioOk === 'boolean' ? audioOk : null]
                );
            } catch (_) {}
        });

        // Profesional solicita sonar el timbre en el display
        socket.on('display:sonar', (data) => {
            io.to('display').emit('display:sonar', data);
        });

        // Admisiones solicita reenviar la alerta de un paciente ya llamado
        socket.on('admision:sonar', (data) => {
            io.to('display').emit('admision:sonar', data);
        });

        socket.on('disconnect', () => {
            console.log(`[WS] Desconectado: ${socket.id} (${socket.data.tipo || 'unknown'})`);
        });
    });
}

module.exports = { registrarEventosSocket };
