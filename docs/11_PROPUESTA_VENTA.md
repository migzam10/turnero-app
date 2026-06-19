# Sistema Turnero CertiMedic — Propuesta de Desarrollo

---

## 1. Objetivo de la Propuesta

Presentar la estimación de tiempos, fases de ejecución y esquema de inversión para el desarrollo del sistema de gestión de turnos, tomando como base los requerimientos y avances definidos en nuestras reuniones de alineación previas.

---

## 2. Alcance del Proyecto (Módulos Generales)

El sistema estará compuesto por los siguientes bloques funcionales, orientados a cubrir el flujo operativo completo de atención al paciente:

- **Módulo de Recepción:** Registro de llegada del paciente y gestión de prioridades en cola.
- **Módulo de Admisiones:** Gestión de la cola de espera y procesamiento del ingreso al sistema de historia clínica.
- **Módulo de Profesionales:** Lista de pacientes asignados por especialidad y control de estados de atención.
- **Pantalla Pública (Display TV):** Visualización en tiempo real de llamados, con alerta sonora.
- **Módulo de Administración:** Configuración de terminales, módulos y parametrización general.
- **Integración con Sistema de Historia Clínica:** Sincronización automática de asignaciones de profesionales sin intervención del software existente.

---

## 3. Flujo Operativo del Paciente

El sistema acompaña al paciente desde su llegada hasta la finalización de todas sus atenciones, registrando tiempos en cada etapa:

```
  LLEGADA       ADMISIÓN      LLAMADO     EN ATENCIÓN    FINALIZADO
     │              │             │             │              │
    [T1]           [T2]          [T3]          [T4]           [T5]
  Escaneo       Ingreso al    Profesional   Paciente       Cierre de
  de cédula     sistema HC    llama al      entra al       la atención
  en recepción  (Historia     paciente →    consultorio
                Clínica)      aparece en TV

  ◄── Espera recepción ──►◄── Espera consulta ──►◄── Tiempo atención ──►
       T2 − T1                   T3 − T2                T5 − T4
```

Cada intervalo queda registrado, permitiendo generar reportes de tiempos de espera y calidad de atención para los indicadores de la IPS.

Un paciente puede tener atenciones simultáneas con múltiples especialidades (médico, laboratorio, fonoaudiología), cada una con su propia línea de tiempo independiente.

---

## 4. Infraestructura Requerida

El sistema opera sobre la infraestructura existente de la clínica, sin inversión en hardware especializado:

- **Servidor:** Windows Server disponible en la clínica (instalación del motor del sistema).
- **Terminales:** Cualquier computador con navegador web en la red local — sin instalaciones adicionales por puesto.
- **Pantallas TV:** Televisores conectados por HDMI o SmartTV con navegador; sin dispositivos especiales.
- **Red:** Funciona completamente en red local (LAN). No requiere conexión a internet.

---

## 5. Fases de Ejecución y Tiempos *(pendiente por definir)*

## 6. Esquema de Inversión *(pendiente por definir)*
