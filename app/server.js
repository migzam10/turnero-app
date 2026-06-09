require('dotenv').config();
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const { migrate } = require('./database/migrate');
const { registrarEventosSocket } = require('./sockets/events');

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

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Hacer io disponible en las rutas via req.app.get('io')
app.set('io', io);

// Rutas
app.use('/api/recepcion',   require('./routes/api.recepcion'));
app.use('/api/admisiones',  require('./routes/api.admisiones'));
app.use('/api/profesional', require('./routes/api.profesional'));
app.use('/api/extension',   require('./routes/api.extension'));
app.use('/api/admin',       require('./routes/api.admin'));

// Ruta de salud
app.get('/health', (req, res) => {
    res.json({ ok: true, ts: new Date().toISOString(), env: process.env.NODE_ENV });
});

// Socket.io
registrarEventosSocket(io);

const PORT = process.env.PORT || 3000;

migrate()
    .then(() => {
        server.listen(PORT, () => {
            console.log(`[SERVER] Turnero corriendo en http://localhost:${PORT}`);
            console.log(`[SERVER] NODE_ENV: ${process.env.NODE_ENV || 'development'}`);
        });
    })
    .catch(err => {
        console.error('[SERVER] No se pudo iniciar — error en migración:', err.message);
        process.exit(1);
    });
