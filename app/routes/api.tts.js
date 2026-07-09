const { Router } = require('express');
const crypto = require('crypto');
const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const { synthesize } = require('../services/tts');
const { edicionPlus } = require('../utils/edicion');

const router = Router();

const CACHE_DIR = path.join(__dirname, '..', '..', 'vendor', 'tts-cache');
const MAX_TEXTO = 200;
const PURGA_MS = 7 * 24 * 60 * 60 * 1000; // 7 días

// De-duplicación: promesas de síntesis en vuelo por cacheKey (si 2 requests piden
// el mismo texto a la vez, se sintetiza una sola vez).
const enVuelo = new Map();

// El cache se crea si no existe; purga de arranque (borra WAV con mtime > 7 días).
fs.mkdirSync(CACHE_DIR, { recursive: true });
purgarCacheAntiguo();

function purgarCacheAntiguo() {
    fsp.readdir(CACHE_DIR).then(async (archivos) => {
        const ahora = Date.now();
        for (const f of archivos) {
            if (!f.endsWith('.wav')) continue;
            const full = path.join(CACHE_DIR, f);
            try {
                const st = await fsp.stat(full);
                if (ahora - st.mtimeMs > PURGA_MS) await fsp.unlink(full);
            } catch { /* archivo ya borrado por otra instancia: ignorar */ }
        }
    }).catch(() => { /* el directorio aún no existe: ignorar */ });
}

// Identidad de la voz: misma frase con distinto motor/voz/ritmo => audio distinto.
// Incluye la velocidad para que al cambiarla no se sirva un WAV viejo desde la caché.
function vozActual() {
    return [process.env.VOZ_SAPI, process.env.PIPER_MODEL, process.env.PIPER_SPEAKER,
            process.env.PIPER_LENGTH_SCALE, process.env.PIPER_SENTENCE_SILENCE]
        .filter(Boolean).join('|');
}

// Sintetiza a un tmp y lo mueve atómicamente al cache. Dedupe por cacheKey.
function sintetizarUnaVez(cacheKey, texto, archivo) {
    if (enVuelo.has(cacheKey)) return enVuelo.get(cacheKey);
    const promesa = (async () => {
        const tmp = path.join(CACHE_DIR, `${cacheKey}.${process.pid}.${Date.now()}.tmp`);
        try {
            await synthesize(texto, tmp);
            await fsp.rename(tmp, archivo); // atómico dentro del mismo filesystem
        } catch (err) {
            await fsp.unlink(tmp).catch(() => {});
            throw err;
        }
    })().finally(() => enVuelo.delete(cacheKey));
    enVuelo.set(cacheKey, promesa);
    return promesa;
}

function streamWav(res, archivo) {
    const stat = fs.statSync(archivo);
    res.setHeader('Content-Type', 'audio/wav');
    // 5 min: el servidor ya cachea en disco (rápido); un TTL corto en el navegador evita
    // servir la voz vieja tras cambiar de motor/voz/velocidad desde Admin.
    res.setHeader('Cache-Control', 'public, max-age=300');
    res.setHeader('Content-Length', stat.size);
    const stream = fs.createReadStream(archivo);
    stream.on('error', (err) => {
        console.error('[tts]', err);
        if (!res.headersSent) res.status(500).json({ error: 'tts_error' });
        else res.destroy();
    });
    stream.pipe(res);
}

// GET /api/tts?texto=...
router.get('/', async (req, res) => {
    // Candado de licencia: la voz solo existe en la edición Plus. Aunque alguien llame
    // esta URL a mano en una Básica, no se genera audio.
    if (!edicionPlus()) return res.status(403).json({ error: 'edicion_sin_voz' });

    const texto = (req.query.texto || '').toString().trim();
    if (!texto) return res.status(400).json({ error: 'texto_requerido' });
    if (texto.length > MAX_TEXTO) return res.status(400).json({ error: 'texto_muy_largo' });

    const engine = process.env.TTS_ENGINE || 'espeak';
    const cacheKey = crypto.createHash('sha1')
        .update(`${engine}|${vozActual()}|${texto}`).digest('hex');
    const archivo = path.join(CACHE_DIR, `${cacheKey}.wav`);

    try {
        if (!fs.existsSync(archivo)) {
            await sintetizarUnaVez(cacheKey, texto, archivo);
        }
        return streamWav(res, archivo);
    } catch (err) {
        console.error('[tts]', err);
        return res.status(500).json({ error: 'tts_error' });
    }
});

module.exports = router;
