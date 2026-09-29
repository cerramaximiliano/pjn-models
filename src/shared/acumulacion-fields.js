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
            fuente: { type: String, enum: ["app-update", "backfill", "manual"] },
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
    }
};
