# 08 — Pantalla de Display (TVs)

URL: `http://SERVER_IP:3000/display`  
Archivo: `public/display/index.html`

Esta página se muestra en las TVs de la sala de espera. Es de **solo lectura** — no tiene botones ni interacción. Se actualiza automáticamente vía Socket.io.

---

## Layout visual

```
┌──────────────────────────────────────────────────────────────────────────────┐
│                                                                              │
│  PROFESIONALES           LLAMANDO               ADMISIONES                  │
│  ┌────────────┐     ┌──────────────────┐     ┌────────────┐                 │
│  │ Consultorio│     │                  │     │  Módulo 1  │                 │
│  │     3      │     │  JUAN MARTINEZ   │     │  ANA GARCIA│                 │
│  │ SOFIA PEREZ│     │   Módulo 2       │     │            │                 │
│  ├────────────┤     │                  │     ├────────────┤                 │
│  │ Consultorio│     │  ── ── ── ──     │     │  Módulo 2  │                 │
│  │     5      │     │                  │     │  (Libre)   │                 │
│  │ CARLOS DIAZ│     │                  │     │            │                 │
│  ├────────────┤     └──────────────────┘     ├────────────┤                 │
│  │ Consultorio│                              │  Módulo 3  │                 │
│  │     7      │                              │  (Libre)   │                 │
│  │  (Libre)   │                              │            │                 │
│  └────────────┘                              └────────────┘                 │
│                                                                              │
│                      CERTIMEDIC IPS          [Reloj: 10:32:15]              │
└──────────────────────────────────────────────────────────────────────────────┘
```

**Zona izquierda:** Consultorios de profesionales. Muestra si está libre o el paciente en atención.  
**Centro:** El paciente que se está llamando AHORA. Animación de pulso y sonido.  
**Zona derecha:** Módulos de admisiones. Muestra si está libre o el paciente en atención.

---

## Comportamiento detallado

### Cuando se llama a un paciente (admisiones o profesional):
1. El nombre aparece en el **centro** con animación de fade-in.
2. Suena el audio: **2 beeps** seguidos (o un chime de llamado).
3. La zona central muestra: `NOMBRE DEL PACIENTE` + `Módulo X` o `Consultorio Y`.
4. La duración en el centro: hasta que el estado cambie a "En Atención".

### Cuando hay un segundo llamado mientras el centro está ocupado:
1. El paciente del centro se mueve a su zona correspondiente (admisiones izq. o profesional der.).
2. El nuevo paciente aparece en el centro.
3. Suena el audio.
4. *Los llamados se encolan: si hay 3 llamados casi simultáneos, se muestran en secuencia.*

### Cuando el estado cambia a "En Atención":
1. El paciente desaparece del centro (si aún estaba ahí).
2. El nombre aparece debajo del nombre del módulo o consultorio en la zona lateral.
3. Cuando el estado cambia a "Finalizado" o el profesional llama al siguiente: desaparece de la zona lateral.

### Información que NUNCA aparece en el display:
- Número de cédula/identificación.
- Fecha de nacimiento.
- Información médica o de prioridad.
- Solo el nombre del paciente (primer nombre + primer apellido como mínimo).

---

## HTML — `public/display/index.html`

```html
<!DOCTYPE html>
<html lang="es">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Turnero — CertiMedic</title>
    <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }

        body {
            background: #0a1628;
            color: white;
            font-family: 'Segoe UI', Arial, sans-serif;
            height: 100vh;
            overflow: hidden;
            display: flex;
            flex-direction: column;
        }

        /* ── Header ──────────────────────────── */
        header {
            background: #061020;
            padding: 8px 24px;
            display: flex;
            justify-content: space-between;
            align-items: center;
            border-bottom: 2px solid #1a3a6e;
            flex-shrink: 0;
        }
        header .logo { font-size: 20px; font-weight: bold; color: #4a9eff; letter-spacing: 2px; }
        header .reloj { font-size: 28px; font-weight: bold; color: white; font-variant-numeric: tabular-nums; }

        /* ── Layout principal ────────────────── */
        main {
            display: grid;
            grid-template-columns: 1fr 2fr 1fr;
            gap: 12px;
            padding: 12px;
            flex: 1;
            min-height: 0;
        }

        /* ── Columnas laterales ──────────────── */
        .columna {
            display: flex;
            flex-direction: column;
            gap: 8px;
        }

        .columna-titulo {
            text-align: center;
            font-size: 16px;
            font-weight: bold;
            text-transform: uppercase;
            letter-spacing: 3px;
            color: #7ab3ff;
            padding-bottom: 6px;
            border-bottom: 1px solid #1a3a6e;
        }

        .modulo-card {
            background: #0d1f3c;
            border: 1px solid #1a3a6e;
            border-radius: 8px;
            padding: 10px;
            text-align: center;
            transition: all 0.3s ease;
        }

        .modulo-card.ocupado {
            border-color: #2d6aff;
            background: #0d1f4a;
        }

        .modulo-nombre {
            font-size: 13px;
            color: #7ab3ff;
            text-transform: uppercase;
            letter-spacing: 1px;
        }

        .modulo-paciente {
            font-size: 16px;
            font-weight: bold;
            color: white;
            margin-top: 4px;
            min-height: 22px;
        }

        .modulo-paciente.libre { color: #3a5a8a; font-size: 13px; font-weight: normal; }

        /* ── Centro: llamando ────────────────── */
        .centro {
            display: flex;
            align-items: center;
            justify-content: center;
            flex-direction: column;
            gap: 16px;
        }

        .llamando-box {
            background: linear-gradient(135deg, #1a3a6e, #0d2244);
            border: 2px solid #4a9eff;
            border-radius: 16px;
            padding: 30px 40px;
            text-align: center;
            width: 100%;
            animation: pulso 2s ease-in-out infinite;
            display: none; /* Oculto cuando no hay llamado */
        }

        .llamando-box.visible { display: block; }

        @keyframes pulso {
            0%, 100% { border-color: #4a9eff; box-shadow: 0 0 20px rgba(74, 158, 255, 0.3); }
            50% { border-color: #80c0ff; box-shadow: 0 0 40px rgba(74, 158, 255, 0.6); }
        }

        .llamando-label {
            font-size: 14px;
            text-transform: uppercase;
            letter-spacing: 4px;
            color: #7ab3ff;
            margin-bottom: 12px;
        }

        .llamando-nombre {
            font-size: 52px;
            font-weight: bold;
            color: white;
            text-transform: uppercase;
            line-height: 1.1;
        }

        .llamando-destino {
            font-size: 28px;
            color: #4a9eff;
            margin-top: 10px;
            font-weight: bold;
        }

        .sin-llamados {
            color: #2a4a6a;
            font-size: 18px;
            text-align: center;
        }

        /* ── Footer ──────────────────────────── */
        footer {
            background: #061020;
            padding: 6px 24px;
            text-align: center;
            font-size: 12px;
            color: #3a5a8a;
            flex-shrink: 0;
        }
    </style>
</head>
<body>

    <header>
        <div class="logo">CertiMedic IPS</div>
        <div class="reloj" id="reloj">--:--:--</div>
    </header>

    <main>
        <!-- Zona izquierda: Profesionales -->
        <div class="columna">
            <div class="columna-titulo">Consultorios</div>
            <div id="zona-profesionales">
                <!-- Los consultorios se renderizan aquí dinámicamente -->
            </div>
        </div>

        <!-- Centro: Llamando -->
        <div class="centro">
            <div id="llamando-box" class="llamando-box">
                <div class="llamando-label">Por favor acercarse a</div>
                <div class="llamando-nombre" id="llamando-nombre">—</div>
                <div class="llamando-destino" id="llamando-destino">—</div>
            </div>
            <div class="sin-llamados" id="sin-llamados">
                Bienvenido a CertiMedic IPS
            </div>
        </div>

        <!-- Zona derecha: Admisiones -->
        <div class="columna">
            <div class="columna-titulo">Admisiones</div>
            <div id="zona-admisiones">
                <!-- Los módulos se renderizan aquí dinámicamente -->
            </div>
        </div>
    </main>

    <footer>
        Sistema de Gestión de Turnos — CertiMedic IPS
    </footer>

    <script src="/socket.io/socket.io.js"></script>
    <script src="/assets/js/display.js"></script>
</body>
</html>
```

---

## `public/assets/js/display.js`

```javascript
const socket = io();

// Estado del display
const estadoDisplay = {
    modulosAdmision: {},     // { "Módulo 1": { paciente: "JUAN", estado: "en_atencion" }, ... }
    consultorios: {},        // { "Consultorio 5": { paciente: "ANA", estado: "en_atencion" }, ... }
    colaCentro: [],          // Cola de llamados pendientes de mostrar en el centro
    mostrando: false         // true si hay algo en el centro ahora mismo
};

// ── Sonido ────────────────────────────────────────────────────

const audioCtx = new (window.AudioContext || window.webkitAudioContext)();

function reproducirBeep(veces = 2) {
    let tiempo = audioCtx.currentTime;
    for (let i = 0; i < veces; i++) {
        const osc = audioCtx.createOscillator();
        const gain = audioCtx.createGain();
        osc.connect(gain);
        gain.connect(audioCtx.destination);
        osc.type = 'sine';
        osc.frequency.setValueAtTime(880, tiempo); // La5
        gain.gain.setValueAtTime(0.5, tiempo);
        gain.gain.exponentialRampToValueAtTime(0.001, tiempo + 0.4);
        osc.start(tiempo);
        osc.stop(tiempo + 0.4);
        tiempo += 0.6; // Pausa entre beeps
    }
}

// ── Socket.io ─────────────────────────────────────────────────

socket.on('connect', () => {
    socket.emit('join', { tipo: 'display' });
    // Solicitar estado actual al conectar
    socket.emit('pedir_estado_display');
});

socket.on('estado_display_inicial', (estado) => {
    // Recibir el estado completo (para cuando el display abre o reconecta)
    Object.assign(estadoDisplay.modulosAdmision, estado.modulosAdmision || {});
    Object.assign(estadoDisplay.consultorios, estado.consultorios || {});
    renderizarLateral();
});

socket.on('display_evento', (evento) => {
    procesarEvento(evento);
});

// ── Procesar eventos ──────────────────────────────────────────

function procesarEvento(evento) {
    switch (evento.tipo) {

        case 'admision_llamando':
            // 1. Encolar para mostrar en el centro
            estadoDisplay.colaCentro.push({
                nombre: formatNombreDisplay(evento.paciente_nombre),
                destino: evento.modulo,
                tipo: 'admision'
            });
            // 2. Actualizar estado del módulo
            estadoDisplay.modulosAdmision[evento.modulo] = {
                paciente: evento.paciente_nombre,
                estado: 'llamando'
            };
            procesarColaCentro();
            renderizarLateral();
            break;

        case 'admision_en_atencion':
            if (evento.modulo && estadoDisplay.modulosAdmision[evento.modulo]) {
                estadoDisplay.modulosAdmision[evento.modulo].estado = 'en_atencion';
            }
            renderizarLateral();
            break;

        case 'admision_cancelado':
            if (evento.modulo) {
                delete estadoDisplay.modulosAdmision[evento.modulo];
            }
            renderizarLateral();
            break;

        case 'profesional_llamando':
            estadoDisplay.colaCentro.push({
                nombre: formatNombreDisplay(evento.paciente_nombre),
                destino: evento.consultorio,
                tipo: 'profesional'
            });
            estadoDisplay.consultorios[evento.consultorio] = {
                paciente: evento.paciente_nombre,
                estado: 'llamando'
            };
            procesarColaCentro();
            renderizarLateral();
            break;

        case 'profesional_en_atencion':
            if (evento.consultorio && estadoDisplay.consultorios[evento.consultorio]) {
                estadoDisplay.consultorios[evento.consultorio].estado = 'en_atencion';
            }
            renderizarLateral();
            break;

        case 'profesional_finalizado':
            if (evento.consultorio) {
                delete estadoDisplay.consultorios[evento.consultorio];
            }
            renderizarLateral();
            break;
    }
}

// ── Cola del centro ───────────────────────────────────────────

function procesarColaCentro() {
    if (estadoDisplay.mostrando) return; // Esperar a que termine el actual
    mostrarSiguienteCentro();
}

function mostrarSiguienteCentro() {
    if (estadoDisplay.colaCentro.length === 0) {
        estadoDisplay.mostrando = false;
        ocultarCentro();
        return;
    }

    estadoDisplay.mostrando = true;
    const llamado = estadoDisplay.colaCentro.shift();

    reproducirBeep(2);
    mostrarEnCentro(llamado.nombre, llamado.destino);

    // El llamado permanece en el centro por 8 segundos
    // (o hasta que llegue evento en_atencion)
    setTimeout(() => {
        mostrarSiguienteCentro();
    }, 8000);
}

function mostrarEnCentro(nombre, destino) {
    document.getElementById('llamando-nombre').textContent = nombre;
    document.getElementById('llamando-destino').textContent = destino;
    document.getElementById('llamando-box').classList.add('visible');
    document.getElementById('sin-llamados').style.display = 'none';
}

function ocultarCentro() {
    document.getElementById('llamando-box').classList.remove('visible');
    document.getElementById('sin-llamados').style.display = 'block';
}

// ── Renderizar zonas laterales ────────────────────────────────

function renderizarLateral() {
    // Zona admisiones (izquierda)
    const zonaAdm = document.getElementById('zona-admisiones');
    // Obtener lista de módulos configurados del servidor
    fetch('/api/admin/config', { headers: {} })
        .then(r => r.json())
        .then(config => {
            const modulos = JSON.parse(config.modulos_admisiones || '["Módulo 1","Módulo 2","Módulo 3"]');
            zonaAdm.innerHTML = modulos.map(modulo => {
                const estado = estadoDisplay.modulosAdmision[modulo];
                const ocupado = estado && estado.estado !== 'finalizado';
                return `
                    <div class="modulo-card ${ocupado ? 'ocupado' : ''}">
                        <div class="modulo-nombre">${modulo}</div>
                        <div class="modulo-paciente ${ocupado ? '' : 'libre'}">
                            ${ocupado ? formatNombreDisplay(estado.paciente) : 'Disponible'}
                        </div>
                    </div>
                `;
            }).join('');
        });

    // Zona profesionales (derecha)
    const zonaPro = document.getElementById('zona-profesionales');
    const consultorios = Object.entries(estadoDisplay.consultorios)
        .filter(([_, v]) => v.estado === 'en_atencion');

    if (consultorios.length === 0) {
        zonaPro.innerHTML = '<div class="sin-llamados">Sin atenciones activas</div>';
    } else {
        zonaPro.innerHTML = consultorios.map(([consultorio, estado]) => `
            <div class="modulo-card ocupado">
                <div class="modulo-nombre">${consultorio}</div>
                <div class="modulo-paciente">
                    ${formatNombreDisplay(estado.paciente)}
                </div>
            </div>
        `).join('');
    }
}

// ── Formato de nombres ────────────────────────────────────────

function formatNombreDisplay(nombreCompleto) {
    if (!nombreCompleto) return '';
    // Solo mostrar primer nombre + primer apellido para que quepa en la pantalla
    // El nombre viene como "JUAN PABLO GARCIA MARTINEZ"
    const partes = nombreCompleto.trim().split(' ');
    if (partes.length >= 2) {
        // Intentar: primer nombre + primer apellido
        // Asumiendo que el formato es APELLIDO1 APELLIDO2 NOMBRE1 NOMBRE2
        // o NOMBRE1 NOMBRE2 APELLIDO1 APELLIDO2 dependiendo de cómo llegue
        // AJUSTAR SEGÚN EL FORMATO REAL QUE LLEGA
        return partes.slice(0, 2).join(' ');
    }
    return nombreCompleto;
}

// ── Reloj ─────────────────────────────────────────────────────

function actualizarReloj() {
    document.getElementById('reloj').textContent =
        new Date().toLocaleTimeString('es-CO', {
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit'
        });
}
setInterval(actualizarReloj, 1000);
actualizarReloj();

// ── Estado inicial de zonas laterales ────────────────────────

// Cargar módulos al inicio
renderizarLateral();

// ── Autoconexión y fallback ───────────────────────────────────

// Si la conexión se cae, reconectar automáticamente (Socket.io lo hace por defecto)
socket.on('disconnect', () => {
    console.log('[Display] Desconectado. Reconectando...');
});
```

---

## Estado del display en el servidor

El servidor debe mantener en memoria el estado actual del display para enviarlo cuando un TV reconecta (`pedir_estado_display`).

En `sockets/events.js`, agregar:

```javascript
// Estado en memoria del display (se resetea al reiniciar el servidor)
const estadoDisplayServidor = {
    modulosAdmision: {},
    consultorios: {}
};

// Cuando el display pide el estado
socket.on('pedir_estado_display', () => {
    socket.emit('estado_display_inicial', estadoDisplayServidor);
});

// Actualizar el estado del servidor cuando llegan eventos
// (esto se llama desde las rutas de API al emitir display_evento)
```

---

## Configuración de Chrome en modo kiosco (para el PC de las TVs)

```powershell
# Crear un acceso directo con este comando:
chrome.exe --kiosk --no-first-run --disable-web-security "http://localhost:3000/display"

# O si las TVs acceden por red:
chrome.exe --kiosk --no-first-run "http://192.168.1.100:3000/display"
```

- `--kiosk`: Pantalla completa sin bordes ni barras.
- El PC de las TVs debe tener desactivado el salvapantallas y la suspensión.
- Si se usan Smart TVs o dispositivos como Chromecast: abrir el navegador nativo en `http://SERVER_IP:3000/display`.

---

## HDMI Splitter — Configuración física recomendada

Para 3 TVs con la misma imagen:
1. PC del display → cable HDMI → **Splitter HDMI 1 entrada 4 salidas** (se vende por ~$20-40 USD).
2. Splitter → 3 cables HDMI → 3 TVs.
3. El PC muestra `http://localhost:3000/display` en pantalla completa.
4. Las 3 TVs muestran exactamente lo mismo sin latencia.

Si en el futuro se quiere contenido diferente por TV (actualmente no es el caso, ya que "se mostrara lo mismo en los 3 tv"), se puede cambiar a 3 mini PCs/dispositivos individuales apuntando a la misma URL.
