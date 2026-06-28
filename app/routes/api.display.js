const { Router } = require('express');
const { query } = require('../database/db');

const router = Router();

// GET /api/display/activos
// Devuelve exclusivamente los pacientes que ahora mismo están en estado "Llamando",
// tanto de Admisiones (llamando_admision) como de Profesionales (llamando). El Display
// consulta este endpoint al iniciar para recuperar su estado exacto tras un F5 o un
// corte de luz, sin depender de que el operador cancele y vuelva a llamar.
router.get('/activos', async (req, res) => {
    try {
        const { rows: admisiones } = await query(
            `SELECT id, modulo_admision,
                    primer_nombre || ' ' || primer_apellido AS nombre_paciente
             FROM pacientes_cola
             WHERE fecha = CURRENT_DATE
               AND estado_admision = 'llamando_admision'
               AND modulo_admision IS NOT NULL
             ORDER BY hora_llamado_admision`
        );

        const { rows: profesionales } = await query(
            `SELECT ap.numero_identificacion, ap.nombre_profesional, ap.consultorio_profesional, ap.area,
                    COALESCE(pc.primer_nombre || ' ' || pc.primer_apellido, ap.nombre_paciente, ap.numero_identificacion) AS nombre_paciente
             FROM asignaciones_profesionales ap
             LEFT JOIN pacientes_cola pc
                 ON pc.numero_identificacion = ap.numero_identificacion AND pc.fecha = ap.fecha
             WHERE ap.fecha = CURRENT_DATE AND ap.estado = 'llamando'
             ORDER BY ap.hora_llamado`
        );

        const activos = [
            ...admisiones.map(p => ({
                tipo: 'admision',
                id: p.id,
                modulo: p.modulo_admision,
                nombre_paciente: p.nombre_paciente,
                destino: p.modulo_admision
            })),
            ...profesionales.map(a => ({
                tipo: 'profesional',
                numero_identificacion: a.numero_identificacion,
                nombre_paciente: a.nombre_paciente,
                nombre_profesional: a.nombre_profesional,
                consultorio: a.consultorio_profesional,
                destino: a.consultorio_profesional
                    ? `Consultorio ${a.consultorio_profesional}`
                    : (a.area || 'Consultorio')
            }))
        ];

        return res.json({ activos });
    } catch (err) {
        console.error('[display/activos]', err);
        return res.status(500).json({ error: 'db_error' });
    }
});

module.exports = router;
