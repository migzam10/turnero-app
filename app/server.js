// Zona horaria del proceso Node: garantiza que cualquier `new Date()` del backend
// y el parseo de timestamps por node-pg usen hora de Colombia (UTC-5).
process.env.TZ = 'America/Bogota';

require('dotenv').config();
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const { migrate } = require('./database/migrate');
const { registrarEventosSocket } = require('./sockets/events');
const { verificarLicencia, vigilarLicencia, sistemaBloqueado, licenciaRequerida } = require('./utils/licencia');
const { bloqueoLicencia } = require('./middleware/licenciaBloqueo');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
    cors: { origin: '*', methods: ['GET', 'POST'] }
});

// CORS — permite peticiones desde extensiones Chrome y cualquier origen local
app.use((req, res, next) => {
    res.setHeader('Access-Control-Allow-Origin', req.headers.origin || '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PATCH, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-extension-secret');
    res.setHeader('Access-Control-Allow-Private-Network', 'true');
    if (req.method === 'OPTIONS') return res.sendStatus(204);
    next();
});

// Límite ampliado para admitir el logo del Display enviado como data URL (base64).
app.use(express.json({ limit: '5mb' }));

// Candado de licencia. Va ANTES de express.static y de las rutas: con la
// licencia vencida no se sirve ni una pantalla ni un endpoint (salvo /health y
// el estado de licencia, que la propia pantalla de bloqueo consulta).
app.use(bloqueoLicencia);

// La ruta raíz "/" muestra el menú principal de selección de módulos
// (servido por express.static desde public/index.html).
app.use(express.static(path.join(__dirname, 'public')));

// Hacer io disponible en las rutas via req.app.get('io')
app.set('io', io);

// Rutas
app.use('/api/recepcion',   require('./routes/api.recepcion'));
app.use('/api/admisiones',  require('./routes/api.admisiones'));
app.use('/api/profesional', require('./routes/api.profesional'));
app.use('/api/extension',   require('./routes/api.extension'));
app.use('/api/admin',       require('./routes/api.admin'));
app.use('/api/config',      require('./routes/api.config'));
app.use('/api/licencia',    require('./routes/api.licencia'));
app.use('/api/display',     require('./routes/api.display'));
app.use('/api/tts',         require('./routes/api.tts'));

// Ruta de salud. Responde también con el sistema bloqueado por licencia: es la
// forma de diagnosticar en remoto por qué una instalación no atiende.
app.get('/health', async (req, res) => {
    const licencia = require('./utils/licencia').estadoLicencia().estado;
    try {
        await require('./database/db').query('SELECT 1');
        res.json({ ok: !sistemaBloqueado(), db: true, licencia, ts: new Date().toISOString(), env: process.env.NODE_ENV });
    } catch {
        res.status(503).json({ ok: false, db: false, licencia, ts: new Date().toISOString() });
    }
});

// Socket.io
registrarEventosSocket(io);

// Con la licencia vencida tampoco se abren sockets: si no, las pantallas ya
// cargadas seguirían recibiendo llamados en vivo pese al bloqueo.
io.use((socket, next) => {
    if (sistemaBloqueado()) return next(new Error('licencia_invalida'));
    next();
});

const PORT = process.env.PORT || 3000;

migrate()
    .then(() => verificarLicencia())
    .then(lic => {
        if (licenciaRequerida()) {
            console.log(`[LICENCIA] ${lic.cliente || 'sin licenciatario'} — ${lic.estado}: ${lic.mensaje}`);
        }
        vigilarLicencia();
        server.listen(PORT, () => {
            console.log(`[SERVER] Turnero corriendo en http://localhost:${PORT}`);
            console.log(`[SERVER] NODE_ENV: ${process.env.NODE_ENV || 'development'}`);
            if (sistemaBloqueado()) {
                console.log('[SERVER] MODO BLOQUEADO: el sistema solo responde el aviso de licencia.');
            }
        });
    })
    .catch(err => {
        console.error('[SERVER] No se pudo iniciar — error en migración:', err.message);
        process.exit(1);
    });
