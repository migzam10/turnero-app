# 00 — Visión General del Sistema Turnero CertiMedic

> Última actualización: 2026-07-05

## ¿Qué es?

Sistema de gestión de turnos para CertiMedic IPS que cubre el flujo completo desde que un paciente llega a la clínica hasta que termina de ser atendido por todos sus profesionales asignados.

**Restricción fundamental:** Biofile (plataforma privada de la clínica) no tiene API pública. Toda integración se hace leyendo el DOM de páginas específicas mediante una extensión de navegador.

---

## Actores del sistema

| Actor | Cantidad | Qué hace |
|---|---|---|
| Recepción | 1 terminal | Escanea la cédula del paciente, registra llegada, asigna prioridad, puede editar o eliminar registros erróneos |
| Admisiones | 2–3 terminales (módulos) | Llama pacientes desde la lista y gestiona el trámite en Biofile en dos tiempos (Admisionando → Finalizar); la extensión Injector llena Biofile |
| Profesional | N terminales (médico, optometría, laboratorio, fonoaudiología, psicología, etc.) | Ve su lista de pacientes asignados, llama, atiende, finaliza. En consultorios *multipaciente* (toma de muestras, laboratorio, psicología) puede llamar a varios a la vez |
| Pantalla TV | N TVs (PC/HDMI o Android TV con navegador) | Muestra en tiempo real quién está siendo llamado, con doble timbre; reporta su estado de audio al Admin |
| Admin | 1 usuario (clave) | Dashboard en vivo, reportes por rango con exportación Excel, gráficas, catálogo de consultorios, parámetros, auditoría de eventos y monitoreo de terminales/pantallas |

---

## Flujo completo paso a paso

### Paso 1 — Recepción (sin Biofile)
1. Paciente llega y entrega su cédula al personal de recepción.
2. El personal escanea la cédula con la pistola lectora en el módulo de recepción del turnero.
3. El sistema captura automáticamente del escaneo:
   - Número de identificación
   - Primer apellido, segundo apellido
   - Primer nombre, segundo nombre (si aplica)
   - Fecha de nacimiento
   - Ciudad de nacimiento
   - Género
4. El sistema registra la **hora de llegada real** (timestamp del servidor).
5. El personal puede asignar **prioridad**: Normal (default), Media, Alta.
6. El paciente queda en la cola del turnero esperando ser llamado por admisiones.

### Paso 2 — Admisiones (flujo de DOS TIEMPOS, espejo del de profesionales)
1. La persona de admisiones ve en su terminal la **lista de pacientes en espera**, ordenada por prioridad y hora de llegada (con tiempo de espera visible y búsqueda por nombre/cédula).
2. También puede ajustar la prioridad si recepción no la puso.
3. **Llamar** → el paciente aparece en las pantallas TV con timbre (estado `llamando_admision`). Puede volver a **Sonar** o **Cancelar** (devuelve a espera).
4. Cuando el paciente llega al módulo: **Admisionando** (Tiempo 1) → se registra la hora real de inicio del trámite (`hora_llamado_admision`) y el paciente sale del display, aunque el trámite siga abierto.
5. El personal realiza el ingreso en Biofile con apoyo de la **extensión Injector** (llena los campos automáticamente; el antiguo botón "Copiar datos para Biofile" ya no existe).
6. **Finalizar** (Tiempo 2) → cierra el trámite (`hora_admision`). Si la extensión ya sincronizó el cruce con Biofile, la hora de admisión **ES la de Biofile**; si aún no (o es un paciente particular sin cruce), queda la del clic y un sync posterior la corrige.
7. Biofile asigna el paciente a los profesionales correspondientes; para particulares que no pasan por Biofile existe **"Asignar a profesional"** manual.
8. Cada módulo procesa **un paciente a la vez**; los pacientes en proceso por otros módulos se ven en modo solo lectura ("En Módulo X").

### Paso 3 — Extensión lee Biofile (background automático)
1. La extensión está instalada en los PCs de admisiones (los que tienen Biofile abierto).
2. La extensión monitorea la pestaña que tiene abierta `AtencionesSeguimiento.aspx` (URL: `https://ipscertimedic.biofile.com.co/Factura/AtencionesSeguimiento.aspx`).
3. Cada 60 segundos (o al detectar cambios), la extensión:
   a. Lee `#LoginName` para saber qué usuario está logueado en Biofile.
   b. Simula clic en `#B_BH_TdBuscar` para actualizar la tabla del día.
   c. Lee la tabla `#TbCitasAsignadas`:
      - Encabezados (columnas) = nombre del profesional + área. Ejemplo: `KENDY ZABALETA(OPTOMETRIA)`
      - Cada celda de datos contiene: nombre del paciente (línea 1), número de cédula (línea 2), hora de llegada en Biofile (línea con prefijo "Llegada:")
   d. Envía todos los datos vía `fetch()` al servidor local del turnero.
4. El servidor turnero cruza los pacientes de Biofile con los registros de recepción por número de cédula.

### Paso 4 — Módulo de Profesionales
1. Cada terminal de profesional tiene el turnero abierto en el navegador (`http://SERVER_IP/profesional`).
2. El terminal se configura **una sola vez**: nombre (con sugerencias del histórico de 60 días; debe coincidir con Biofile) y consultorio, elegido de un **catálogo administrable** desde Admin (guardado en localStorage).
3. Si el consultorio elegido es **multipaciente** (toma de muestras, laboratorio, psicología — marcado así en el catálogo), el profesional puede llamar a **varios pacientes a la vez**; en los demás consultorios, uno a la vez.
4. El profesional ve **solo los pacientes asignados a él** (filtrado por columna en Biofile = nombre profesional), con aviso sonoro suave cuando le llega uno nuevo.
5. Acciones disponibles:
   - **Llamar** → Estado: `llamando`. Aparece en las pantallas TV con timbre. Se graba timestamp.
   - **En Atención** → Estado: `en_atencion`. Desaparece de las pantallas TV. Se graba timestamp.
   - **Finalizado** → Estado: `finalizado`. Se libera el paciente para que otros profesionales puedan llamarlo. Se graba timestamp.
   - **Modo gestión** (con clave de admin): Cancelar asignaciones y Reasignar a otro profesional.
6. Un paciente puede estar asignado a múltiples profesionales (médico, laboratorio, fonoaudiología...). Cada profesional maneja su propia línea de tiempo independiente; si otro profesional lo tiene en atención, el botón Llamar se bloquea con aviso.

### Paso 5 — Pantallas TV (display público)
- **Zona derecha:** Módulos de admisiones con el paciente que están llamando actualmente.
- **Centro:** El paciente que está siendo llamado AHORA, con **doble timbre** (al aparecer y ~1,5 s antes de desaparecer). Muestra nombre + módulo o consultorio. La duración del anuncio es configurable desde Admin (4–30 s).
- **Zona izquierda:** Consultorios llamando (nombre del catálogo tal cual: "Consultorio 1", "Toma de Muestras"...) con el nombre completo del paciente. Un consultorio multipaciente puede tener varias tarjetas a la vez.
- Si varios llaman al mismo tiempo, los anuncios entran a una **cola secuencial** (cada uno con su timbre); los siguientes se ven como chips abajo. "Sonar" (de admisiones o de un profesional) retoma el centro de inmediato.
- Cuando el paciente pasa a "Admisionando"/"En Atención", desaparece de la pantalla.
- **Audio garantizado:** overlay de activación al encender (un OK del control basta), banner rojo 🔇 si el audio se bloquea, y reporte del estado de audio al panel Admin (Terminales → Pantallas).
- Tras un corte de luz o F5, la pantalla **reconstruye sola** su estado desde el servidor.
- **NUNCA** se muestra el número de cédula en las TVs, solo el nombre.

---

## Restricciones y decisiones de diseño

1. **Sin API de Biofile** → extensión de navegador que lee DOM.
2. **Un solo servidor local** → Windows Server 2019 (instalación NATIVA: PostgreSQL + Node como servicios; ver `docs/09_INSTALACION_SERVIDOR.md`). Desarrollo en Mac con Docker.
3. **TVs mixtas** → PC por HDMI (Chrome kiosco con autoplay habilitado) y/o Android TVs con navegador apuntando a la IP del servidor (recomendado Fully Kiosk Browser).
4. **Sin modificar Biofile** → La extensión solo lee (no escribe) Biofile.
5. **La extensión NO almacena credenciales** → usa la sesión activa del usuario de Biofile.
6. **Prioridad en la cola de admisiones y en la cola de profesionales son independientes** → Admisiones tiene su propia cola; profesionales tienen la suya filtrada por asignaciones de Biofile.
7. **Flujos admisiones y profesionales no se cruzan** → Un paciente ya en atención con un profesional no vuelve a ser llamado por admisiones.
8. **La hora de llegada (T1) oficial** es la del turnero (scanner en recepción). **La hora de admisión (T2) es autoritativa de Biofile**: cuando la extensión cruza al paciente con el LIS, `hora_admision` se sobrescribe con la hora registrada en Biofile; solo los particulares sin cruce conservan la hora del clic "Finalizar".
9. **Todo queda auditado** → cada llamado, admisión, cancelación, reasignación, eliminación y login queda registrado en `eventos_log`, consultable desde Admin → Configuración → Eventos.
