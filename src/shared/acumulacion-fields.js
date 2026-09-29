const mongoose = require("mongoose");

/**
 * Decisión de ACUMULAR esta causa (o incidente) a otra, detectada en sus movimientos del
 * portal (utils/acumulacion.js). Se inyecta en causas-civil / segsocial / trabajo /
 * comercial vía schema.add(require('../shared/acumulacion-fields')).
 *
 * Lo escribe pjn-workers (app-update al ver el hito en movimientos nuevos o al hacer un
 * resync por reescritura del portal; scripts/backfill-acumulacion.js para el histórico).
 * Cada detección deja además una entrada en updateHistory (updateType 'acumulacion' o
 * 'resync'). Sin default: solo existe en causas acumuladas.
 */
module.exports = {
    acumulacion: {
        type: {
            // Movimiento que registra la decisión (el más reciente si hay varios).
            fecha: { type: Date },
            tipo: { type: String },
            detalle: { type: String },
            url: { type: String },
            clase: { type: String, enum: ["evento", "cambio_estado", "despacho"] },
            detectadaAt: { type: Date },
            fuente: { type: String, enum: ["app-update", "mis-causas", "backfill", "manual"] },
            // Rol de ESTA causa: 'acumulada' solo con el evento del sistema ("ACUMULA LA CAUSA A
            // OTRA"); null = interviene sin rol afirmado (el texto del despacho es ambiguo).
            rol: { type: String, enum: ["acumulada", null], default: null },
            // La otra causa (número del despacho; causaId si está en la misma colección).
            otra: {
                number: { type: Number },
                year: { type: Number },
                causaId: { type: mongoose.Schema.Types.ObjectId, default: null }
            },
            // Relecturas completas "solo agregar" que quedan por hacer: la receptora incorpora las
            // actuaciones de la acumulada con su fecha ORIGINAL (anteriores a lo guardado) y el
            // incremental no las ve; la incorporación puede llegar días después del despacho.
            relecturasPendientes: { type: Number, default: 0 },
            ultimaRelecturaAt: { type: Date },
            // Último resync por reescritura del portal asociado a la acumulación.
            resync: {
                at: { type: Date },
                retirados: { type: Number },
                incorporados: { type: Number },
                coincidencia: { type: Number },
                fuente: { type: String }
            }
        },
        required: false,
        default: undefined
    },
    // Causas que nombraron a ESTA en su decisión de acumular (vínculo inverso para la UI).
    acumulacionRelacionadas: {
        type: [{
            _id: false,
            causaId: { type: mongoose.Schema.Types.ObjectId },
            number: { type: Number },
            year: { type: Number },
            incidente: { type: String, default: null },
            fecha: { type: Date },
            rol: { type: String, default: null },
            linkedAt: { type: Date }
        }],
        default: undefined
    }
};
