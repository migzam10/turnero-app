# Manual de Usuario — Turnero

> Guía operativa del sistema de turnos, paso a paso, desde que el paciente llega hasta que termina su atención.
> Última actualización: 2026-07-07

Este manual está pensado para el **personal que usa el turnero a diario**: recepción, admisiones, profesionales y administración. No requiere conocimientos técnicos. Si busca la documentación técnica (arquitectura, base de datos, API), consulte los archivos `00`–`11` de esta misma carpeta.

---

## 1. ¿Qué hace el sistema?

El Turnero organiza el recorrido completo de cada paciente dentro de la IPS y lo muestra en tiempo real en las pantallas de sala. Reemplaza los llamados a viva voz por un **anuncio visual con timbre** en las TVs, y deja registrada cada hora del proceso para medir tiempos de espera y atención.

**Módulos del sistema** (pantalla de inicio):

![Menú principal del turnero](Capturas/manual_menu.png)

| Módulo | Quién lo usa | Para qué |
|---|---|---|
| **Recepción** | Personal de recepción (1 terminal) | Escanear la cédula y registrar la llegada del paciente |
| **Admisiones** | Admisiones (2–3 módulos) | Llamar al paciente y hacer el ingreso en Biofile |
| **Profesional** | Cada consultorio (médico, optometría, laboratorio…) | Ver sus pacientes asignados, llamarlos y atenderlos |
| **Pantalla TV** | TVs de sala de espera | Mostrar a quién se está llamando, con sonido |
| **Administración** | Coordinación (con clave) | Ver el tablero en vivo, reportes y configuración |

---

## 2. El recorrido del paciente, paso a paso

El paciente pasa por una secuencia fija. En cada punto el sistema graba una **hora real** (marca de tiempo del servidor). Esas horas son las que luego alimentan los reportes.

### Paso 1 — Recepción: registro de llegada

Cuando el paciente llega, recepción **escanea su cédula** con la pistola lectora. El sistema captura automáticamente los datos del documento (identificación, nombres, apellidos, fecha de nacimiento) y registra la **hora de llegada (T1)**.

![Módulo de Recepción](Capturas/manual_recepcion.png)

- Los campos marcados con `*` son obligatorios. Si el escaneo falla, se pueden llenar a mano (etiqueta **MANUAL**).
- Se puede asignar **prioridad**: `Normal` (por defecto), `Media` o `Alta`. La prioridad reordena la cola de admisiones.
- A la derecha se ve la **Cola del día** en vivo, con la prioridad de cada paciente (color) y su hora de llegada.
- Al presionar **Registrar paciente**, el paciente entra a la cola de espera de admisiones.

> **Hora que se graba aquí:** `T1 — Llegada`. Es la hora oficial de ingreso a la clínica.

### Paso 2 — Admisiones: llamado e ingreso (dos tiempos)

Admisiones ve la **Cola de espera** ordenada por prioridad y hora de llegada. El trámite se hace en **dos tiempos**, igual que en los consultorios.

![Módulo de Admisiones](Capturas/manual_admisiones.png)

1. **Llamar** → el paciente aparece en las pantallas TV con timbre. Se puede volver a **Sonar** (repite el anuncio) o **Cancelar** (lo devuelve a la espera).
2. Cuando el paciente llega al módulo: **Admisionando** → arranca el trámite. El paciente **sale de la pantalla** aunque el ingreso siga abierto. *(Se graba `T2a — Inicio de admisión`.)*
3. El personal hace el ingreso en Biofile; la **extensión Injector** llena los campos automáticamente.
4. **Finalizar** → cierra el trámite. *(Se graba `T2 — Admisión`.)*
5. Debajo de la cola, la sección **Admisionados hoy** muestra cada paciente ya ingresado, **con qué módulo** lo atendió y sus horas de llegada y admisión.

Cada módulo procesa **un paciente a la vez**. Los que están en proceso por otro módulo se ven en modo solo lectura ("En Módulo X").

> **Horas que se graban aquí:** `T2a — Inicio de admisión` y `T2 — Admisión`.
> La hora de admisión (T2) es **autoritativa de Biofile**: cuando la extensión cruza al paciente con el sistema de la clínica, se ajusta a la hora registrada en Biofile.

### Paso 3 — La extensión lee Biofile (automático)

En los PCs de admisiones corre una **extensión de navegador** que lee la tabla de citas de Biofile cada ~60 segundos y le informa al turnero **qué profesionales** tienen asignado a cada paciente (por número de cédula). No se escribe nada en Biofile: la extensión solo lee.

Gracias a esto, cada profesional ve automáticamente su lista de pacientes sin que nadie los asigne a mano. Para pacientes particulares que no pasan por Biofile, admisiones tiene el botón **Asignar a profesional**.

### Paso 4 — Profesional: llamar y atender

Cada consultorio abre su módulo y lo configura **una sola vez** (nombre del profesional + consultorio del catálogo). A partir de ahí ve **solo sus pacientes asignados**, con un aviso sonoro suave cuando le llega uno nuevo.

![Módulo de Profesional](Capturas/manual_profesional.png)

Los pacientes se agrupan por estado, con contadores arriba:

- **Llamar** → aparece en las TVs con timbre. *(Se graba `T3 — Llamado`.)*
- **En Atención** → desaparece de las TVs; el paciente ya está en el consultorio. *(Se graba `T4 — Inicio de atención`.)*
- **Finalizar** → cierra la atención y libera al paciente. *(Se graba `T5 — Fin de atención`.)*
- **Atendidos hoy** → lista al final, con las horas de llegada, admisión, atención y finalización, y los minutos de atención.

Un mismo paciente puede estar asignado a **varios profesionales** (médico, laboratorio, fonoaudiología…); cada uno maneja su propia línea de tiempo. En consultorios **multipaciente** (toma de muestras, laboratorio) se puede llamar a varios a la vez.

> **Horas que se graban aquí:** `T3 — Llamado`, `T4 — Inicio de atención`, `T5 — Fin de atención`.

### Paso 5 — Pantalla TV: el anuncio público

Las TVs de la sala muestran, en tiempo real, a quién se está llamando. Fuerzan **tema claro** para verse bien en cualquier televisor.

![Pantalla TV / Display](Capturas/manual_display.png)

- **Centro:** el paciente que se llama **ahora**, con **doble timbre** (al aparecer y ~1,5 s antes de desaparecer). Muestra nombre + consultorio o módulo.
- **Izquierda — Consultorios:** profesionales que están llamando, con el nombre del consultorio tal cual del catálogo.
- **Derecha — Admisiones:** módulos de admisiones que están llamando.
- Si varios llaman a la vez, los anuncios entran a una **cola** (cada uno con su timbre) y los siguientes se ven como fichas.
- Tras un corte de luz o recarga, la pantalla **reconstruye sola** su estado.
- **Nunca** se muestra el número de cédula en las TVs, solo el nombre.

---

## 3. Los tiempos del proceso

El sistema graba cinco marcas de tiempo a lo largo del recorrido. Con ellas calcula los indicadores de espera y atención.

| Marca | Nombre | ¿Cuándo se graba? | ¿Quién la genera? |
|---|---|---|---|
| **T1** | Llegada | Al escanear la cédula | Recepción |
| **T2a** | Inicio de admisión | Al presionar **Admisionando** | Admisiones |
| **T2** | Admisión | Al presionar **Finalizar** (o la hora de Biofile) | Admisiones |
| **T3** | Llamado | Al presionar **Llamar** en el consultorio | Profesional |
| **T4** | Inicio de atención | Al presionar **En Atención** | Profesional |
| **T5** | Fin de atención | Al presionar **Finalizar** | Profesional |

**Indicadores que se calculan solos:**

- **Espera de admisión** = tiempo desde la llegada (T1) hasta que admisiones lo llama.
- **Registro (Biofile)** = duración del trámite de admisión (T2a → T2).
- **Tiempo de atención** = duración de la atención del profesional (T4 → T5).

---

## 4. Administración: tablero y reportes

El módulo de **Administración** (protegido con clave) reúne la vista gerencial del día y los reportes históricos.

### Tablero en vivo

Tarjetas con los números del día (registrados, admisionados, en espera, prioridad alta, en atención, finalizados, tiempos promedio) y dos tablas en tiempo real: estado de admisiones y estado por profesional.

![Administración — Tablero](Capturas/manual_admin_dashboard.png)

### Reportes por rango de fechas

Se elige un rango (**Desde / Hasta**) y se presiona **Generar reporte**. Muestra:

- **Resumen** de pacientes, admisionados, tiempos promedio y particulares.
- **Por profesional:** asignados, atendidos, en proceso, cancelados y promedio de atención.
- **Timeline T1–T5 por paciente:** todas las marcas de tiempo de cada paciente, con esperas y minutos totales.
- Botón **Excel** para exportar el reporte a una hoja de cálculo.

![Administración — Reportes](Capturas/manual_admin_reportes.png)

Otras pestañas: **Pacientes** (búsqueda y corrección de registros), **Gráficas** (KPIs visuales), **Configuración** (catálogo de consultorios, parámetros, duración del anuncio, auditoría de eventos) y **Terminales** (monitoreo de equipos y estado de audio de las TVs).

---

## 5. Recomendaciones prácticas

- **Encender las TVs primero.** Al abrir el display, dé un **OK** con el control para activar el audio (la política del navegador exige un gesto). Si aparece un banner rojo 🔇, el audio está bloqueado: repita el OK.
- **El nombre del profesional debe coincidir con Biofile.** El cruce de pacientes se hace por ese nombre; si no coincide, el profesional no verá sus pacientes.
- **Escanee siempre en recepción.** La hora de llegada (T1) es la base de todos los tiempos; sin ella el reporte queda incompleto.
- **Prioridad Alta para casos urgentes.** Reordena la cola de admisiones de inmediato.
- **Un módulo, un paciente.** Termine (Finalizar) antes de llamar al siguiente, salvo en consultorios multipaciente.

---

*Turnero · Documento de uso interno.*
