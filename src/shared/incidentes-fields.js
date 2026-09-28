const mongoose = require("mongoose");

/**
 * Campos compartidos que se inyectan en los causa-models de los fueros con
 * incidentes en Atlas (causas-civil, causas-segsocial, causas-trabajo,
 * causas-comercial) vía schema.add(require('../shared/incidentes-fields')).
 *
 * Vínculo principal ↔ incidente por _id, mantenido en los dos sentidos:
 *  - el incidente apunta al principal con `parentCausaId` (campo base del schema);
 *  - el principal lista sus incidentes en `incidentes[]` (este bloque).
 *
 * `incidentes` vive SOLO en principales (incidente: null) y es el espejo de
 * `parentCausaId` de cada incidente de la misma colección con el mismo
 * {number, year}. Lo mantienen causa-sync-service (pjn-mis-causas, al crear
 * principales e incidentes), el hub/pjn-api al crear principales y
 * scripts/backfill-incidentes-link.js (pjn-mis-causas).
 *
 * Los consumidores con versiones viejas de pjn-models (sin este campo en el
 * schema) escriben con updateOne/updateMany + { strict: false } y leen con
 * .lean(); el push se guarda con el filtro { 'incidentes.causaId': { $ne: id } }
 * para no duplicar. Sin índice: se accede siempre por el _id del principal.
 */
module.exports = {
    incidentes: {
        type: [{
            _id: false,
            // _id del incidente (misma colección que el principal).
            causaId: {
                type: mongoose.Schema.Types.ObjectId,
                required: true
            },
            // Sufijo del incidente tal como está en el doc del incidente ("1", "42/2").
            incidente: {
                type: String,
                required: true
            },
            // Cuándo se estableció el vínculo (se conserva en re-cálculos).
            linkedAt: {
                type: Date,
                default: Date.now
            }
        }],
        // Sin default: si fuera [] Mongoose lo persistiría en cada save() de cualquier
        // proceso (también en incidentes) y pisaría un push concurrente del sync.
        // Mismo criterio que etapa-procesal-fields.js.
        default: undefined
    }
};
