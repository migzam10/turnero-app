const { execFile } = require('child_process');

// Motor de voz intercambiable por process.env.TTS_ENGINE (default 'espeak').
// Todos los motores generan un WAV en outWavPath. NUNCA se concatena el texto en
// una cadena de shell: se usa execFile con args (o stdin) para evitar inyección.

const TIMEOUT_MS = 8000;

// Ejecuta un binario con argumentos aislados (sin shell). `stdin` se escribe en la
// entrada estándar (lo usa piper); `env` añade variables al entorno del proceso
// (lo usa SAPI para pasar texto/ruta sin exponerlos en la línea de comandos).
function ejecutar(cmd, args, { stdin, env } = {}) {
    return new Promise((resolve, reject) => {
        const opts = { timeout: TIMEOUT_MS };
        if (env) opts.env = { ...process.env, ...env };
        const hijo = execFile(cmd, args, opts, (err) => {
            if (err) return reject(err);
            resolve();
        });
        if (stdin != null) {
            hijo.stdin.on('error', reject); // p.ej. EPIPE si el binario no existe
            hijo.stdin.write(stdin);
            hijo.stdin.end();
        }
    });
}

// Cada fábrica devuelve { cmd, args, stdin? } para el texto/salida dados.
const MOTORES = {
    // Robótico, sin modelos que descargar; ideal para validar el pipeline en dev/Docker.
    espeak(texto, out) {
        return { cmd: 'espeak-ng', args: ['-v', 'es', '-w', out, texto] };
    },
    // Voz neuronal es_ES (recomendado en producción, multiplataforma). El texto va por stdin.
    piper(texto, out) {
        const bin = process.env.PIPER_BIN;
        const modelo = process.env.PIPER_MODEL;
        if (!bin || !modelo) throw new Error('PIPER_BIN/PIPER_MODEL no configurados');
        const args = ['-m', modelo, '-f', out];
        // Hablante (opcional): modelos multi-voz (p.ej. sharvard tiene 2) eligen con --speaker.
        if (process.env.PIPER_SPEAKER) args.push('--speaker', process.env.PIPER_SPEAKER);
        // Ritmo (opcional): length_scale >1 = más lento; silencio tras cada frase.
        if (process.env.PIPER_LENGTH_SCALE) args.push('--length_scale', process.env.PIPER_LENGTH_SCALE);
        if (process.env.PIPER_SENTENCE_SILENCE) args.push('--sentence_silence', process.env.PIPER_SENTENCE_SILENCE);
        return { cmd: bin, args, stdin: texto };
    },
    // Windows nativo (voces Sabina/Helena). El texto y la ruta se pasan por variables
    // de entorno (TTS_TEXT/TTS_OUT), NO por la línea de comandos: así se evita del todo
    // la ambigüedad de $args con -Command entre versiones de PowerShell, y no hay inyección.
    sapi(texto, out) {
        const script = [
            'Add-Type -AssemblyName System.Speech;',
            '$s=New-Object System.Speech.Synthesis.SpeechSynthesizer;',
            'if($env:VOZ_SAPI){$s.SelectVoice($env:VOZ_SAPI)};',
            '$s.SetOutputToWaveFile($env:TTS_OUT);',
            '$s.Speak($env:TTS_TEXT);'
        ].join('');
        return { cmd: 'powershell', args: ['-NoProfile', '-Command', script],
                 env: { TTS_OUT: out, TTS_TEXT: texto } };
    },
    // macOS (dev). Voz Paulina, WAV PCM 16-bit @22050.
    say(texto, out) {
        return { cmd: 'say', args: ['-v', 'Paulina', '-o', out, '--data-format=LEI16@22050', texto] };
    }
};

// Sintetiza `texto` a un WAV en `outWavPath`. Lanza si el motor falla o expira (8s).
async function synthesize(texto, outWavPath) {
    const engine = process.env.TTS_ENGINE || 'espeak';
    const fabrica = MOTORES[engine];
    if (!fabrica) throw new Error(`TTS_ENGINE desconocido: ${engine}`);
    const { cmd, args, stdin, env } = fabrica(texto, outWavPath);
    await ejecutar(cmd, args, { stdin, env });
}

module.exports = { synthesize };
