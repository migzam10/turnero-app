# Candado técnico de licencia

Guía interna del Titular. **No se entrega al cliente.**

Cubre el mecanismo técnico que hace que una instalación deje de funcionar al
vencerse su licencia. Es independiente de `13_LICENCIA_DE_USO.md`, que es el
documento legal.

---

## 1. Cómo funciona

Un archivo `licencia.lic` firmado con **Ed25519**. El ejecutable lleva embebida
la **llave pública** y verifica la firma al arrancar; emitir licencias requiere
la **llave privada**, que vive únicamente en el equipo del Titular.

Es **100% offline**: no llama a ningún servidor, no necesita internet, no envía
telemetría. Una clínica sin conexión funciona igual.

El archivo es texto plano legible, y eso es a propósito: el cliente puede ver
qué dice su licencia. Lo que no puede es cambiarla — cualquier edición rompe la
firma y el sistema se bloquea.

### Qué se verifica, en orden

| # | Chequeo | Si falla |
|---|---|---|
| 1 | El archivo existe y es legible | `ausente` / `ilegible` |
| 2 | La firma corresponde al contenido exacto | `firma` |
| 3 | El equipo es el autorizado (si está atada a un host) | `host` |
| 4 | No está vencida | `vencida` |
| 5 | El reloj del sistema no se atrasó respecto de lo ya visto | `reloj` |

El chequeo 5 cierra el atajo obvio: poner la fecha del servidor en el pasado
para revivir una licencia vencida. El sistema recuerda la fecha más adelantada
que vio, en dos lugares a la vez (un archivo `.turnero-estado` junto al
ejecutable y la tabla `licencia_estado` de la base de datos) y toma la mayor de
las dos. Borrar uno no alcanza. Tolera 36 horas de atraso, para no molestar con
ajustes normales de NTP o de zona horaria.

Además del arranque, la verificación **se repite cada hora**: un servicio que
arrancó en enero y no se reinició se da cuenta igual de que la licencia venció
en marzo.

---

## 2. ¿Cuándo se exige licencia?

Esta es la parte que más se presta a confusión, así que va explícita.

| Cómo corre | `LICENCIA_REQUERIDA` en el `.env` | ¿Exige `licencia.lic`? |
|---|---|---|
| **`.exe`** (empaquetado con pkg) | lo que sea, o nada | **SÍ** |
| `node server.js` / Docker / NSSM sobre `node.exe` | sin poner nada | **NO** |
| `node server.js` / Docker / NSSM sobre `node.exe` | `LICENCIA_REQUERIDA=true` | **SÍ** |

Dos consecuencias que conviene tener claras:

- **En el `.exe` el candado no se puede apagar desde el `.env`.** Aunque el
  cliente escriba `LICENCIA_REQUERIDA=false`, el `.exe` sigue exigiendo la
  licencia. La variable solo puede *encender* el candado, nunca apagarlo.
- **Correr desde código sin la variable NO es una "licencia perpetua".** Es que
  no hay ninguna licencia que revisar: el sistema funciona sin límite de tiempo
  porque nadie le pide un archivo. Es el caso de tu producción actual y de tu
  entorno de desarrollo.

> **"Perpetua" es otra cosa:** una licencia real, firmada, emitida con
> `--vence nunca`. Tiene licenciatario, edición y firma; simplemente no caduca.
> Se usa cuando el cliente sí tiene que tener un `licencia.lic` (porque corre el
> `.exe`) pero compró el producto para siempre.

La asimetría entre `.exe` y código es deliberada: el `.exe` es lo único que se
entrega a un cliente en evaluación, mientras que las instalaciones perpetuas que
corren desde código no pueden quedar a merced de un archivo — un `git pull`
nunca les va a apagar el sistema.

Ambas variables están documentadas en `.env.example`.

---

## 3. Emitir una licencia

### 3.1 Dónde se ejecuta

**En tu Mac de desarrollo, parado en la raíz del repositorio**
(`/Users/migzam/Proyectos/CertiMedic/turnero/turnero-app`):

```bash
cd /Users/migzam/Proyectos/CertiMedic/turnero/turnero-app
node scripts/firmar-licencia.js --cliente "..." --edicion ... --dias ...
```

**Nunca en el servidor del cliente**: allá no está la llave privada, y no debe
estarlo. El script sin la llave no firma nada.

El archivo sale en `licencias/<id>.lic` dentro del repo (carpeta ignorada por
git). De ahí lo copiás al servidor del cliente.

### 3.2 Glosario de parámetros

| Parámetro | ¿Obligatorio? | Valores | Qué hace |
|---|---|---|---|
| `--cliente` | **Sí** | texto libre entre comillas | Nombre del licenciatario. Es lo que se muestra en el panel de Admin y en la pantalla de bloqueo. Solo informativo: no se valida contra nada. |
| `--edicion` | **Sí** | `basica` \| `plus` | Define si la instalación tiene voz. Ver sección 4. No tiene valor por defecto a propósito. |
| `--vence` | Sí, salvo que uses `--dias` | `YYYY-MM-DD` \| `nunca` | Último día en que la licencia funciona (**ese día todavía sirve**; se bloquea al siguiente). `nunca` emite una licencia perpetua. |
| `--dias` | Alternativa a `--vence` | número entero > 0 | Vence en N días contados desde hoy. `--dias 30` emitido el 5 de agosto da `--vence 2026-09-04`. Comodidad para evaluaciones. |
| `--host` | No | hostname del servidor | Ata la licencia a ese equipo: copiarla a otro servidor no funciona. **Sin este parámetro la licencia sirve en cualquier máquina.** Tiene que ser el hostname exacto (mayúsculas/minúsculas no importan). |
| `--nota` | No | texto libre | Comentario que queda guardado dentro de la licencia, p. ej. `"Evaluación IPS Los Andes"`. No afecta el funcionamiento. |
| `--salida` | No | ruta de archivo | Dónde escribir el `.lic`. Por defecto `licencias/<id>.lic`. |
| `--llave` | No | ruta al `.pem` | Llave privada a usar. Por defecto `~/.turnero-licencias/privada.pem`. Solo se usa si movés la llave de sitio. |

El script se niega a emitir si falta `--cliente`, si falta `--edicion`, si la
edición no es `basica` ni `plus`, si no hay vencimiento, o si la fecha de
vencimiento ya pasó (nacería bloqueada).

### 3.3 Ejemplos

```bash
# Evaluación de 30 días, sin voz
node scripts/firmar-licencia.js --cliente "IPS Los Andes" --edicion basica --dias 30

# Un año, con voz, atada al servidor del cliente
node scripts/firmar-licencia.js --cliente "IPS Los Andes" --edicion plus \
    --vence 2027-08-05 --host SRV-CLINICA

# Perpetua con voz (cliente que compró el producto definitivo)
node scripts/firmar-licencia.js --cliente "Clínica X" --edicion plus --vence nunca
```

El script imprime un resumen (cliente, edición, vencimiento, equipo, archivo).
**Leelo antes de mandar el archivo**: es el momento de detectar un error.

### 3.4 Instalarla en el cliente

Copiar el archivo como **`licencia.lic`** (ese nombre exacto), en el mismo
directorio del ejecutable, y reiniciar el servicio. Nada más.

Si por alguna razón necesitás ponerla en otra carpeta, existe `LICENCIA_PATH`
en el `.env` para indicar la ruta completa.

### 3.5 Renovar o corregir

Emitir una nueva, reemplazar el archivo, reiniciar el servicio. El cliente no
reinstala nada y no pierde ningún dato.

Esto aplica igual si te equivocaste: **una licencia mal emitida se arregla
emitiendo otra**, no hay nada que revertir.

---

## 4. La edición Básica / Plus

Hay **dos interruptores distintos** para la voz, y conviene no confundirlos:

| | Quién lo controla | Dónde vive |
|---|---|---|
| **Edición** (`basica` / `plus`) | Vos, al emitir la licencia | Firmado dentro de `licencia.lic`, o `EDICION` del `.env` |
| **`voz_habilitada`** | El cliente, desde el panel de Admin | Tabla `configuracion` de la base de datos |

La voz suena solamente si la edición es **plus** Y el cliente tiene
`voz_habilitada` en true. La edición decide si la instalación *puede* hablar; el
switch de Admin decide si en este momento *quiere* hablar.

### De dónde sale la edición

La regla **no** es "`.exe` usa la licencia y el código usa el `.env`". Es una
sola pregunta: **¿esta instalación exige licencia?** (sección 2).

- **Sí** → manda la edición firmada en `licencia.lic`. El `EDICION` del `.env`
  no se mira, en ninguna de las dos direcciones.
- **No** → manda el `EDICION` del `.env`. Sin ese valor, `basica`.

Correr como `.exe` es solo *una* de las dos formas de caer en "sí". Poner
`LICENCIA_REQUERIDA=true` es la otra, y se comporta exactamente igual.

| Cómo corre | Licencia | `EDICION` del `.env` | Queda en |
|---|---|---|---|
| `.exe` | `--edicion plus` | `basica` | **plus** |
| `.exe` | `--edicion basica` | `plus` | **basica** |
| Código + `LICENCIA_REQUERIDA=true` | `--edicion plus` | `basica` | **plus** |
| Código + `LICENCIA_REQUERIDA=true` | `--edicion basica` | `plus` | **basica** |
| Código, sin la variable | (no se lee) | `plus` | **plus** |
| Código, sin la variable | (no se lee) | sin valor | **basica** |

Ese es justamente el punto de meterla en la licencia: antes el cliente pasaba de
Básica a Plus editando una línea del `.env`; ahora tendría que falsificar una
firma Ed25519.

> Detalle menor: si la licencia está **bloqueada** por no tener firma válida o
> por faltar el archivo, la edición vuelve a salir del `.env` — pero da lo
> mismo, porque con el sistema bloqueado no funciona nada, ni la voz ni el resto.

### Qué cambia entre una y otra

| | Básica | Plus |
|---|---|---|
| Endpoint `/api/tts` | responde 403 | funciona |
| Sección de voz en el panel de Admin | oculta | visible |
| Pantalla TV | solo timbre | timbre + voz (si `voz_habilitada`) |

Todo lo demás —consultorios, admisiones, recepción, display, reportes, KPIs— es
idéntico en las dos ediciones.

### "Emití una perpetua y me olvidé de ponerle plus"

Ese caso ya no puede pasar por descuido: **`--edicion` es obligatoria**. Si no
la ponés, el script no emite nada y te dice qué falta.

Y si igual emitiste la edición equivocada, el arreglo toma medio minuto:

```bash
node scripts/firmar-licencia.js --cliente "Clínica X" --edicion plus --vence nunca
```

Reemplazás el `licencia.lic` del servidor por el nuevo, reiniciás el servicio, y
listo. No se reinstala nada, no se pierde nada, y la licencia vieja simplemente
deja de usarse (no hay que "revocarla": el sistema lee el archivo que esté
puesto). En el panel de Admin, pestaña **Documentación**, se ve qué licencia
está activa — ahí confirmás que quedó en Plus.

---

## 5. Qué pasa al vencer

El sistema **no se muere**: arranca en modo bloqueado y responde a todo con una
pantalla que dice que la licencia no está vigente y que hay que contactar al
proveedor.

Se eligió así porque:

- el cliente ve una explicación en vez de "no abre nada";
- NSSM no entra en un ciclo de reinicios cada 3 segundos;
- `/health` sigue contestando, así se diagnostica en remoto.

Como interruptor comercial es igual de efectivo: no se puede admisionar, llamar
ni consultar nada, y los sockets tampoco se abren (las pantallas ya cargadas
dejan de recibir llamados).

**Ningún dato se pierde.** Al instalar una licencia vigente todo vuelve a operar
con la información intacta.

Se avisa en el panel de Admin (pestaña Documentación) desde **15 días antes** del
vencimiento.

### Diagnóstico remoto

```bash
curl http://<servidor>:3000/health              # ok:false, licencia:"bloqueada"
curl http://<servidor>:3000/api/licencia/estado # motivo y mensaje exactos
```

---

## 6. El `.exe` como servicio de Windows (NSSM)

Sí, el `.exe` se instala como servicio igual que hoy, y queda mejor: no hay que
pasarle `server.js` como argumento porque el ejecutable ya es la aplicación
entera.

### Disposición de archivos recomendada

Poné **todo en la misma carpeta**. No es un capricho: el `.env` se lee del
directorio de trabajo del servicio, mientras que `licencia.lic` se busca **junto
al ejecutable**. Si los separás, uno de los dos no aparece.

```
C:\turnero\
    turnero.exe
    .env
    licencia.lic
    logs\
```

### Instalación

```powershell
C:\nssm\nssm.exe install TurneroApp C:\turnero\turnero.exe
C:\nssm\nssm.exe set TurneroApp AppDirectory C:\turnero
C:\nssm\nssm.exe set TurneroApp DependOnService postgresql-x64-16
C:\nssm\nssm.exe set TurneroApp Start SERVICE_AUTO_START
C:\nssm\nssm.exe set TurneroApp AppExit Default Restart
C:\nssm\nssm.exe set TurneroApp AppRestartDelay 3000
C:\nssm\nssm.exe set TurneroApp AppStdout C:\turnero\logs\salida.log
C:\nssm\nssm.exe set TurneroApp AppStderr C:\turnero\logs\error.log
C:\nssm\nssm.exe set TurneroApp AppRotateFiles 1
C:\nssm\nssm.exe start TurneroApp
```

`SERVICE_AUTO_START` es lo que hace que levante solo al prender el servidor, sin
que nadie inicie sesión. `DependOnService` evita que arranque antes que
PostgreSQL. Es la misma configuración que la instalación desde código, apuntando
al `.exe` en vez de a `node.exe`.

### Detalles a tener en cuenta

- **PostgreSQL se instala aparte.** El `.exe` trae la aplicación, no la base de
  datos.
- **Permisos de escritura en `C:\turnero\`**: el servicio escribe ahí el archivo
  `.turnero-estado` (la memoria del reloj) y la caché de voz. Si no puede
  escribir, no se cae —la memoria del reloj queda solo en la base de datos— pero
  el candado pierde una de sus dos anclas.
- **Actualizar el sistema** pasa a ser: parar el servicio, reemplazar el
  `turnero.exe`, arrancar. Ya no hay `git pull` ni `npm install` en el servidor
  del cliente, que es justamente la gracia.
- El `.exe` es de **Windows x64**; se compila desde la Mac con
  `pkg . --output turnero.exe` y solo se puede probar en Windows.

---

## 7. La llave privada

En `~/.turnero-licencias/privada.pem`, generada una sola vez con
`scripts/generar-llaves-licencia.js`.

- **Si se pierde**, no se puede emitir ni renovar ninguna licencia nunca más, y
  las instalaciones existentes se bloquean al vencer. Hay que regenerar el par,
  cambiar la llave pública en `app/utils/licencia.js`, recompilar el `.exe` y
  reinstalarlo en todos los clientes.
- **Si se filtra**, cualquiera se emite una licencia perpetua.

Hacé un respaldo fuera del equipo. `*.pem` está en `.gitignore`, pero la llave no
debería estar dentro del repositorio en ningún caso.

Regenerar el par **invalida todas las licencias emitidas**; por eso el script se
niega a sobrescribir una llave existente salvo que se le pase `--forzar`.

---

## 8. Encaje con la licencia legal

`13_LICENCIA_DE_USO.md` concede uso **perpetuo e ilimitado**. Un candado con
vencimiento contradice eso, así que:

- **Cliente que compró la licencia perpetua** → licencia `--vence nunca`, o
  directamente instalación desde código (que no exige licencia). Nunca se le
  puede apagar el sistema.
- **Evaluación / arriendo / suscripción** → licencia con fecha, y su propio
  acuerdo de evaluación con fecha de corte, **no** `13_LICENCIA_DE_USO.md`.

Firmar el acuerdo antes de instalar nada es lo que de verdad protege. El candado
técnico es el respaldo, no el argumento principal.

---

## 9. Hasta dónde llega (honestidad)

- `pkg` **empaqueta, no encripta**. Alguien decidido puede extraer el snapshot
  del `.exe`, encontrar la verificación y parchearla. Sube mucho el costo del
  robo; no lo vuelve imposible.
- El frontend siempre es visible desde el navegador (F12). Lo que el `.exe`
  esconde es la lógica del backend, que es lo que importa.
- Contra un cliente que solo quiere seguir usando el sistema después de la
  prueba, esto alcanza y sobra. Contra un atacante dedicado a robar el producto,
  lo que te protege es el contrato.

---

## 10. Preguntas frecuentes

**¿Si no pongo `LICENCIA_REQUERIDA` en el `.env`, la instalación queda perpetua?**
No: queda *sin candado*. Corriendo desde código funciona para siempre porque
nadie le pide un archivo de licencia. Corriendo como `.exe`, la variable es
irrelevante: la licencia se exige igual.

**¿Puede el cliente apagar el candado del `.exe` editando el `.env`?**
No. En el `.exe` la exigencia está en el código compilado. La variable solo sirve
para *encender* el candado cuando se corre desde código.

**¿Qué pasa si el cliente borra `licencia.lic`?**
El sistema arranca bloqueado con motivo `ausente`. Borrarla no lo libera.

**¿Y si borra la tabla `licencia_estado` o el archivo `.turnero-estado`?**
Pierde una de las dos anclas de la memoria del reloj, pero la otra sigue. Y si
borra las dos, lo único que consigue es volver al estado inicial: la licencia
sigue teniendo su fecha de vencimiento firmada.

**Emití la licencia con la edición equivocada. ¿Se puede corregir?**
Sí, emitiendo otra y reemplazando el archivo. Ver sección 4.

**Si la licencia dice `plus` y el `.env` dice `EDICION=basica`, ¿cuál gana?**
La licencia. Y al revés también: licencia `basica` con `.env plus` queda en
básica. Mientras la instalación exija licencia, el `.env` no cuenta. Ver la
tabla de la sección 4.

**¿Necesita internet la clínica para que esto funcione?**
No. Nunca. El sistema no consulta ningún servidor.

**¿Cómo sé qué licencia tiene puesta un cliente?**
Panel de Admin → pestaña **Documentación** → bloque "Licencia del sistema"
(licenciatario, edición, vigencia y días restantes). En remoto, con
`curl http://<servidor>:3000/api/licencia/estado`.

---

## 11. Archivos

| Archivo | Rol |
|---|---|
| `scripts/generar-llaves-licencia.js` | Genera el par Ed25519. Se corre una vez. |
| `scripts/firmar-licencia.js` | Emite licencias. Herramienta interna. |
| `app/utils/licencia.js` | Verificación, llave pública embebida, revisión horaria. |
| `app/middleware/licenciaBloqueo.js` | Modo bloqueado. |
| `app/routes/api.licencia.js` | `GET /api/licencia/estado` (público). |
| `app/public/licencia-bloqueada.html` | Pantalla que ve el cliente. |
| `app/test/licencia.test.js` | Pruebas de firma, vencimiento y atraso de reloj. |
| `licencia.lic` | En el servidor del cliente, junto al ejecutable. |
| `.turnero-estado` | Memoria del reloj. Se regenera solo. |
