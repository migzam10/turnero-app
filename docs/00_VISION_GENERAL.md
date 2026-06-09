# 00 — Visión General del Sistema Turnero CertiMedic

## ¿Qué es?

Sistema de gestión de turnos para CertiMedic IPS que cubre el flujo completo desde que un paciente llega a la clínica hasta que termina de ser atendido por todos sus profesionales asignados.

**Restricción fundamental:** Biofile (plataforma privada de la clínica) no tiene API pública. Toda integración se hace leyendo el DOM de páginas específicas mediante una extensión de navegador.

---

## Actores del sistema

| Actor | Cantidad | Qué hace |
|---|---|---|
| Recepción | 1 terminal | Escanea la cédula del paciente, registra llegada, asigna prioridad |
| Admisiones | 2–3 terminales | Llama pacientes desde la lista, los ingresa a Biofile, usa pegado especial de datos |
| Profesional | N terminales (médico, optometría, laboratorio, fonoaudiología, psicología, etc.) | Ve su lista de pacientes asignados, llama, atiende, finaliza |
| Pantalla TV | 2–3 TVs | Muestra en tiempo real quién está siendo llamado, con sonido |
| Admin | 1 usuario | Configura terminales, consultorios, reportes |

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

### Paso 2 — Admisiones (interfaz mixta: turnero + Biofile)
1. La persona de admisiones ve en su terminal la **lista de pacientes en espera**, ordenada por prioridad y hora de llegada.
2. También puede ajustar la prioridad si recepción no la puso.
3. Cuando llama a un paciente para ingresarlo a Biofile, hace clic en **"Copiar datos para Biofile"**.
4. El sistema copia al portapapeles un string Tab-separado con los datos en el **orden exacto de los campos de Biofile** (`OrdenesServiciosSaludOcupacional.aspx`):
   ```
   {cedula}\t{ciudad}\t{fecha_nacimiento}\t{apellido1}\t{apellido2}\t{nombre1}\t{nombre2}
   ```
5. El personal pega en Biofile (en el campo `TxtNumeroIdentificacion`), los Tabs llenan automáticamente los campos.
6. El personal completa el resto en Biofile y guarda.
7. Biofile asigna el paciente a los profesionales correspondientes.
8. La hora de admisión queda registrada en el turnero.

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
2. El terminal está configurado **una sola vez** con el número de consultorio (guardado en localStorage; no se pide cada vez que abre).
3. Si el profesional cambia de consultorio, entra al panel de configuración del terminal y lo actualiza.
4. El profesional ve **solo los pacientes asignados a él** (filtrado por columna en Biofile = nombre profesional).
5. Acciones disponibles:
   - **Llamar** → Estado: `llamando`. Aparece en las pantallas TV con sonido (2 beeps). Se graba timestamp.
   - **En Atención** → Estado: `en_atencion`. Desaparece de las pantallas TV. Se graba timestamp.
   - **Finalizado** → Estado: `finalizado`. Se libera el paciente para que otros profesionales puedan llamarlo. Se graba timestamp.
6. Un paciente puede estar asignado a múltiples profesionales (médico, laboratorio, fonoaudiología...). Cada profesional maneja su propia línea de tiempo independiente.

### Paso 5 — Pantallas TV (display público)
- **Zona derecha:** Módulos de admisiones disponibles (Módulo 1, Módulo 2...) con el paciente que están atendiendo actualmente debajo de cada nombre de módulo.
- **Centro:** El paciente que está siendo llamado AHORA (con sonido 2 beeps). Muestra nombre + módulo o consultorio.
- **Zona izquierda:** Profesionales activos (Consultorio 3, Consultorio 4...) con el paciente en atención.
- Cuando se llama un segundo paciente mientras hay uno en centro: el primero se mueve a la zona correspondiente (módulo o consultorio), y el nuevo aparece en el centro.
- Cuando el estado cambia a "En Atención", el paciente desaparece del centro.
- **NUNCA** se muestra el número de cédula en las TVs, solo el nombre.

---

## Restricciones y decisiones de diseño

1. **Sin API de Biofile** → extensión de navegador que lee DOM.
2. **Un solo servidor local** → Windows Server 2019 disponible.
3. **TVs por HDMI** → Un PC conectado a las TVs mediante HDMI splitter (señal idéntica en todos los TVs) o cada TV tiene un dispositivo que abre el browser con la URL del display.
4. **Sin modificar Biofile** → La extensión solo lee (no escribe) Biofile.
5. **La extensión NO almacena credenciales** → usa la sesión activa del usuario de Biofile.
6. **Prioridad en la cola de admisiones y en la cola de profesionales son independientes** → Admisiones tiene su propia cola; profesionales tienen la suya filtrada por asignaciones de Biofile.
7. **Flujos admisiones y profesionales no se cruzan** → Un paciente ya en atención con un profesional no vuelve a ser llamado por admisiones.
8. **La hora de llegada oficial** es la del turnero (scanner en recepción). La hora de llegada de Biofile se guarda como referencia pero no es la oficial.
