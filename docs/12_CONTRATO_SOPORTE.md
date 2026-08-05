# 12 — Contrato General de Soporte y Mantenimiento

> Documento: Contrato General — Sistema **Turnero**
> Versión: 1.0
> Vigencia: **22 de julio de 2026 – 22 de enero de 2027** (seis meses)

---

## 1. Partes

| | Datos |
|---|---|
| **EL PROVEEDOR** | [NOMBRE DEL PROVEEDOR], identificado con [NIT / C.C.], representado por [NOMBRE], en calidad de [CARGO] |
| **EL CLIENTE** | [NOMBRE DEL CLIENTE], identificado con [NIT], representado por [NOMBRE], en calidad de [CARGO] |

---

## 2. Objeto

EL PROVEEDOR se obliga a prestar a EL CLIENTE los servicios de **soporte técnico y mantenimiento** del sistema de gestión de turnos **Turnero** (en adelante, **EL SISTEMA**), instalado en la infraestructura de EL CLIENTE, en los términos y con el alcance que se detallan en este contrato.

EL SISTEMA comprende los módulos de Recepción, Admisiones, Profesionales, Pantalla Pública (Display TV) y Administración, junto con las extensiones de navegador de integración con Biofile, conforme a la documentación técnica del directorio `docs/`.

---

## 3. Licencia de uso — remisión

El derecho de uso de EL SISTEMA, la titularidad del software, las facultades de modificación de EL CLIENTE y las restricciones de distribución y explotación comercial **se rigen íntegramente por el documento `13_LICENCIA_DE_USO.md`** ("Licencia de Uso — Sistema Turnero", versión 1.0 del 22 de julio de 2026), que hace parte integral de este contrato y se entiende conocido y aceptado por ambas partes.

En particular, y sin perjuicio de lo allí establecido:

- EL CLIENTE puede **usar y modificar EL SISTEMA libremente** dentro de su organización (sección 1 de la Licencia).
- EL CLIENTE **no puede distribuir ni comercializar** EL SISTEMA ni sus obras derivadas sin autorización previa y escrita de EL PROVEEDOR (sección 2 de la Licencia).
- El presente contrato **no amplía, restringe ni sustituye** la licencia de uso; su vencimiento no extingue el derecho perpetuo de uso.

En caso de contradicción entre este contrato y la licencia respecto de derechos sobre el software, **prevalece la licencia**.

---

## 4. Vigencia

El contrato tiene una duración de **seis (6) meses**, contados a partir del **22 de julio de 2026**, y termina el **22 de enero de 2027**.

Podrá renovarse por períodos iguales mediante acuerdo escrito entre las partes, suscrito con al menos quince (15) días calendario de anticipación al vencimiento. La ausencia de manifestación se entiende como no renovación.

---

## 5. Alcance del soporte (servicios incluidos)

Durante la vigencia, EL PROVEEDOR prestará sin costo adicional:

1. **Corrección de errores (mantenimiento correctivo).** Diagnóstico y solución de fallas del código entregado por EL PROVEEDOR que impidan o degraden el funcionamiento descrito en la documentación.
2. **Soporte funcional y de operación.** Atención de consultas del personal de Recepción, Admisiones, Profesionales y Administración sobre el uso de EL SISTEMA.
3. **Mantenimiento de la integración con Biofile.** Ajustes en las extensiones Biofile-Injector y Biofile-Sync cuando cambios en el DOM de Biofile rompan la lectura o el llenado de datos, dentro de los límites de la cláusula 9.
4. **Actualizaciones menores.** Entrega e instalación de correcciones y mejoras menores que EL PROVEEDOR libere durante el período.
5. **Acompañamiento en despliegue.** Reinstalación o reconfiguración de EL SISTEMA en el servidor de EL CLIENTE ante fallas, migraciones de equipo o restauración de respaldos.
6. **Asesoría sobre respaldos.** Verificación del esquema de copias de seguridad de la base de datos y apoyo en su restauración.
7. **Ajustes menores de parametrización.** Consultorios, áreas, textos de pantalla, prioridades y demás parámetros del módulo de Administración.

---

## 6. Canales y horario de atención

| Concepto | Definición |
|---|---|
| Canales | [WhatsApp / Teléfono: __________] · [Correo: __________] · Acceso remoto asistido |
| Horario | Lunes a viernes, [8:00 a.m. – 6:00 p.m.]; sábados [8:00 a.m. – 12:00 m.] |
| Fuera de horario | Atención de incidentes críticos según disponibilidad, sin compromiso de tiempo de respuesta |

Las solicitudes deben radicarse por los canales acordados, indicando módulo afectado, descripción del problema, hora y evidencia (captura de pantalla o mensaje de error).

---

## 7. Niveles de servicio (tiempos de respuesta)

| Severidad | Descripción | Respuesta inicial | Solución o mitigación |
|---|---|---|---|
| **Crítica** | EL SISTEMA fuera de servicio; la cola de pacientes o las pantallas TV no operan | 2 horas hábiles | 8 horas hábiles |
| **Alta** | Un módulo inoperante o la sincronización con Biofile detenida; existe forma manual de continuar | 4 horas hábiles | 2 días hábiles |
| **Media** | Falla que afecta parcialmente la operación o los reportes | 1 día hábil | 5 días hábiles |
| **Baja** | Consultas, ajustes de parámetros, mejoras cosméticas | 2 días hábiles | Según programación acordada |

Los tiempos se cuentan dentro del horario de la cláusula 6 y se suspenden mientras EL PROVEEDOR esté a la espera de información, accesos o acciones a cargo de EL CLIENTE.

---

## 8. Obligaciones de EL CLIENTE

1. Mantener operativa la infraestructura: servidor Windows Server, red local, terminales, pantallas y navegadores compatibles.
2. Otorgar acceso remoto y/o presencial oportuno cuando el diagnóstico lo requiera.
3. Conservar las credenciales de administración bajo custodia de personal autorizado.
4. Ejecutar y verificar las copias de seguridad conforme al procedimiento entregado.
5. Reportar los incidentes por los canales definidos, con la información mínima señalada.
6. Designar un **contacto técnico responsable**: [NOMBRE / CARGO].
7. Mantener su propio licenciamiento de sistema operativo, base de datos y demás software de base.
8. Informar previamente a EL PROVEEDOR sobre modificaciones al código de EL SISTEMA, para efectos de la cláusula 9.

---

## 9. Exclusiones (servicios no incluidos)

No hacen parte de este contrato y se cotizan por separado:

1. **Desarrollo de nuevas funcionalidades**, módulos o integraciones no contemplados en el alcance entregado.
2. **Soporte sobre código modificado por EL CLIENTE o por terceros a su cargo.** Conforme a la sección 3 de `13_LICENCIA_DE_USO.md`, EL CLIENTE puede modificar EL SISTEMA libremente, pero el diagnóstico y corrección de fallas originadas en esas modificaciones no está cubierto.
3. **Rediseños mayores** exigidos por cambios estructurales de Biofile (por ejemplo, migración a otra plataforma de historia clínica o rediseño completo de sus pantallas).
4. **Infraestructura**: fallas de hardware, red, energía, sistema operativo, antivirus o proveedores de internet.
5. **Recuperación de datos** cuando no exista copia de seguridad vigente por causa imputable a EL CLIENTE.
6. **Capacitación adicional** más allá de la entrega inicial y del `MANUAL_USUARIO.md`.
7. **Instalaciones en sedes nuevas** o ampliaciones de infraestructura.
8. **Soporte a equipos de terceros**: lectores de código de barras, televisores, dispositivos Android TV.

---

## 10. Contraprestación

| Concepto | Valor |
|---|---|
| Soporte y mantenimiento (6 meses) | [$ __________] |
| Forma de pago | [__________] |
| Servicios excluidos | Cotización previa y aprobación escrita de EL CLIENTE |

---

## 11. Confidencialidad y datos personales

Ambas partes se obligan a guardar reserva sobre la información técnica, comercial y operativa a la que accedan con ocasión de este contrato, de forma indefinida.

Los datos de pacientes almacenados por EL SISTEMA son propiedad de EL CLIENTE, quien actúa como responsable del tratamiento. EL PROVEEDOR, cuando acceda a ellos por labores de soporte, actúa como encargado, los utiliza únicamente para ese fin y aplica las medidas de seguridad razonables, conforme a la sección 4 de `13_LICENCIA_DE_USO.md` y a la normativa colombiana de protección de datos y de historia clínica.

---

## 12. Terminación

Este contrato termina por:

1. Vencimiento del plazo, sin renovación.
2. Mutuo acuerdo escrito.
3. Incumplimiento grave de cualquiera de las partes, previo requerimiento escrito y plazo de quince (15) días calendario para subsanar.

A la terminación, EL PROVEEDOR entregará a EL CLIENTE la versión vigente del código fuente, la documentación actualizada y las credenciales de administración. **La terminación de este contrato no afecta la licencia de uso**, que conserva su carácter perpetuo según `13_LICENCIA_DE_USO.md`.

---

## 13. Ley aplicable y solución de controversias

Este contrato se rige por las leyes de la República de Colombia. Las diferencias se resolverán primero de forma directa entre las partes dentro de los treinta (30) días siguientes al reclamo escrito; de no lograrse acuerdo, se someterán a la jurisdicción ordinaria competente de **[CIUDAD]**.

---

## 14. Documentos que hacen parte del contrato

| Documento | Contenido |
|---|---|
| `13_LICENCIA_DE_USO.md` | Licencia de uso del software (documento integral y prevalente en materia de derechos) |
| `00_VISION_GENERAL.md` | Alcance funcional y flujo operativo |
| `09_INSTALACION_SERVIDOR.md` | Instalación y despliegue en servidor |
| `MANUAL_USUARIO.md` | Manual de operación entregado a EL CLIENTE |
| `04_EXTENSION_BIOFILE.md` | Funcionamiento y límites de la integración con Biofile |

---

## Firmas

En constancia, las partes suscriben el presente contrato en [CIUDAD], a los ____ días del mes de ____________ de ______.

| | EL PROVEEDOR | EL CLIENTE |
|---|---|---|
| Nombre | [NOMBRE DEL PROVEEDOR] | [NOMBRE DEL CLIENTE] |
| Identificación | [NIT / C.C.] | [NIT] |
| Representante | [NOMBRE] | [NOMBRE] |
| Cargo | [CARGO] | [CARGO] |
| Firma | ______________________ | ______________________ |
