const mongoose = require("mongoose");

/**
 * Pestaña "Vinculados" del detalle público de un PRINCIPAL (expediente:connectedTable),
 * inyectada en causas-civil / causas-segsocial / causas-trabajo / causas-comercial vía
 * schema.add(require('../shared/vinculados-fields')).
 *
 * Es la lista de incidentes de la familia {fuero, number, year} tal como la muestra el
 * portal (número, dependencia, situación, carátula, última actuación). NO crea docs de
 * incidente: un incidente solo tiene doc cuando una credencial lo trae por lista o un
 * usuario lo sigue desde esta lista. `causaId` es un cache del doc si existe.
 *
 * Lo escribe pjn-workers (app-update, con el detalle del principal ya abierto → 0
 * captchas extra) con `vinculadosMeta.source='app-update'`. Las filas que dejan de
 * figurar no se borran: se marcan `goneAt`. Sin default en el array (mismo criterio que
 * incidentes-fields.js: un [] persistido pisaría escrituras concurrentes).
 */
module.exports = {
    vinculados: {
        type: [{
            _id: false,
            // Sufijo canónico ("1", "42/2"), igual que `incidente` del doc del incidente.
            incidente: { type: String, required: true },
            // Celda EXPEDIENTE cruda ("COM 023063/2015/1").
            expediente: { type: String },
            // Carátula tal como la muestra la fila (puede venir cortada).
            caratula: { type: String },
            dependencia: { type: String },
            situacion: { type: String },
            // ULT. ACT. de la fila (solo día).
            ultAct: { type: Date, default: null },
            firstSeenAt: { type: Date },
            seenAt: { type: Date },
            // Dejó de figurar en la pestaña (se conserva la fila).
            goneAt: { type: Date, default: null },
            // _id del doc del incidente en la misma colección, si existe (cache).
            causaId: { type: mongoose.Schema.Types.ObjectId, default: null }
        }],
        default: undefined
    },
    vinculadosMeta: {
        type: {
            capturedAt: { type: Date },
            // Total que declara el portal ("Se han encontrado un total de N vinculado(s)").
            total: { type: Number },
            // Páginas leídas / declaradas.
            pagesRead: { type: Number },
            pages: { type: Number },
            source: { type: String, enum: ["app-update", "vinculados-worker", "mis-causas"] },
            // Mensaje del portal cuando no hay tabla ("El expediente no posee vinculados…").
            portalMsg: { type: String },
            error: { type: String },
            // Filas de otra familia (conexos de otro número/fuero) — solo conteo.
            otros: { type: Number }
        },
        required: false,
        default: undefined
    }
};
