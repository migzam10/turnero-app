# 04 — Extensiones de Navegador (Chrome/Edge Manifest V3)

> Última actualización: 2026-07-05
>
> **Fuente de verdad: `extension/Biofile-Sync/` y `extension/Biofile-Injector/`.**
> Este documento describe qué hace cada una y cómo se configuran; el código manda.

El sistema usa **DOS extensiones** instaladas en los PCs de admisiones (donde está
abierto Biofile). Ninguna almacena credenciales — usan la sesión activa del usuario.

| Extensión | Dirección del dato | Página de Biofile |
|---|---|---|
| **Biofile-Sync** | Biofile → Turnero (lee asignaciones) | `Factura/AtencionesSeguimiento.aspx` |
| **Biofile-Injector** | Turnero → Biofile (llena el formulario de ingreso) | `Factura/OrdenesServiciosSaludOcupacional.aspx` |

---

## 1. Biofile-Sync — sincronización de asignaciones

### Qué hace
1. Con una alarma periódica (`chrome.alarms`), busca la pestaña abierta de
   `AtencionesSeguimiento.aspx`.
2. Inyecta un script (`chrome.scripting.executeScript`) que lee:
   - `#LoginName` → usuario logueado en Biofile.
   - La tabla `#TbCitasAsignadas`: cada **columna** es un profesional
     (`KENDY ZABALETA(OPTOMETRIA)`), cada celda un paciente con nombre, cédula y la
     línea `Llegada: ...` (hora de llegada en Biofile).
3. Envía el snapshot al servidor: `POST /api/extension/sync`.

### Payload real del sync

```json
{
    "loginName": "USUARIO_BIOFILE",
    "terminalId": "uuid-de-la-terminal",
    "snapshotCompleto": true,
    "pacientes": [
        {
            "numeroIdentificacion": "1043131936",
            "nombrePaciente": "JUAN PABLO GARCIA",
            "nombreProfesional": "KENDY ZABALETA",
            "area": "OPTOMETRIA",
            "columnaHeader": "KENDY ZABALETA(OPTOMETRIA)",
            "horaLlegadaBiofile": "Jul 5 2026 7:08AM",
            "fecha": "2026-07-05"
        }
    ]
}
```

Autenticación: header **`X-Extension-Secret`** (debe coincidir con el `.env` del
servidor). Todos los endpoints de `/api/extension/*` lo exigen.

### Qué hace el servidor con el sync (resumen; detalle en `03_BACKEND_API.md`)
- Upsert de cada asignación por `(fecha, cédula, columna_header)`.
- Autocrea en `pacientes_cola` a los pacientes que no pasaron por recepción.
- **Sobrescribe `hora_admision`** del paciente con `MIN(hora_llegada_biofile)`
  (la hora de admisión es autoritativa de Biofile cuando hay cruce).
- **Reconciliación** (solo si `snapshotCompleto: true` y hay pacientes): las
  asignaciones activas de ese login que ya no están en el snapshot se dan de baja
  (`activo=false`, `origen_baja='lis'`), **excepto** las que están en curso
  (llamando/en_atencion/finalizado), las gestionadas por un humano
  (`manual_override`) y las de `origen='manual'` (particulares).

### Archivos
```
extension/Biofile-Sync/
├── manifest.json      ← MV3; permisos: alarms, storage, tabs, scripting
├── background.js      ← Alarma + extracción del DOM + POST /sync
├── popup.html/js      ← Estado del último sync y snapshot leído
├── config.example.js  ← Plantilla (SERVER_URL, EXTENSION_SECRET, INTERVALO_SEG)
└── config.js          ← Config real (GITIGNORED — crear a partir del example)
```

---

## 2. Biofile-Injector — llenado del formulario de ingreso

Reemplazó al antiguo botón "Copiar datos para Biofile" de admisiones.

### Qué hace
1. Su popup consulta `GET /api/extension/pendientes` (autenticado con el mismo
   `X-Extension-Secret`): pacientes del día en estado `esperando`/`llamando_admision`
   con nombres, cédula, sexo y fecha de nacimiento formateada.
2. El operador elige el paciente en el popup y la extensión **llena los campos** del
   formulario de `OrdenesServiciosSaludOcupacional.aspx` (content script con
   `activeTab`/`scripting`).
3. El operador completa lo restante en Biofile y guarda; el Sync detectará después la
   asignación y cruzará las horas.

### Archivos
```
extension/Biofile-Injector/
├── manifest.json      ← MV3; permisos: activeTab, scripting, tabs
├── content.js         ← Llena los campos del formulario de ingreso
├── popup.html/js      ← Lista de pendientes (fetch con X-Extension-Secret)
├── config.example.js  ← Plantilla (SERVER_URL, EXTENSION_SECRET)
└── config.js          ← Config real (GITIGNORED)
```

---

## Instalación en cada PC de admisiones

1. Copiar la carpeta `extension/` al PC.
2. En **cada** extensión, crear `config.js` desde `config.example.js`:
   - `SERVER_URL`: `http://IP_DEL_SERVIDOR:3000`
   - `EXTENSION_SECRET`: el mismo del `.env` del servidor (ambas lo necesitan).
   - (Sync) `INTERVALO_SEG`: cadencia de sincronización (mínimo 15 s; típico 30–60).
3. `chrome://extensions` → Modo desarrollador → **"Cargar extensión sin empaquetar"**
   → seleccionar `Biofile-Sync/`; repetir con `Biofile-Injector/`.
4. Fijar ambas en la barra (ícono del puzzle).
5. Dejar abierta la pestaña de `AtencionesSeguimiento.aspx` para el Sync.

---

## Consideraciones operativas

- **El Sync solo funciona con la pestaña de `AtencionesSeguimiento.aspx` abierta.**
  Si Biofile cierra sesión, deja de llegar información nueva (el popup muestra el
  estado del último sync).
- Si el secret no coincide, el servidor responde `403 extension_secret_invalido` —
  revisar `config.js` de la extensión Y el `.env` del servidor (y recordar que en
  Docker el contenedor debe recrearse tras editar `.env`).
- Un sync exitoso emite `UPDATE_PATIENTS`/`extension:sync` por socket: las pantallas
  de profesionales se refrescan solas, sin intervención.
- La reconciliación es de **modo seguro**: con snapshot parcial o vacío jamás se da
  de baja nada (evita borrados masivos por un fallo de scraping).
