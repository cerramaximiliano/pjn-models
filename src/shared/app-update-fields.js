const mongoose = require("mongoose");

/**
 * Campos que el app-update de pjn-workers lee o escribe en la causa y que los
 * esquemas de los fueros "nuevos" (todo lo que no es civil / comercial / ss /
 * trabajo) no declaraban. Sin ellos Mongoose (strict) descarta en silencio las
 * escrituras del worker: no quedaban los contadores de error, el PDF diferido
 * a pdf-backfill ni el estado de huérfana de Mis Causas.
 *
 * Inyectado vía schema.add(require('../shared/app-update-fields')) en esos
 * fueros. Las definiciones son las mismas de causas-civil.js: si cambian allá,
 * cambiar acá.
 */
module.exports = {
    // Fill del historial de PDFs a S3 (lo levanta pjn-pdf-backfill).
    needsPdfBackfill: { type: Boolean, default: false },
    // true si ≥1 linkedCredentials apunta a una credencial habilitada (ruteo
    // pjn-mis-causas vs buscador público).
    hasActiveCredential: { type: Boolean, default: false, index: true },
    // Huérfana de Mis Causas: credencial deshabilitada + carpeta viva. La mantiene
    // el reconcile de pjn-mis-causas; app-update la toma por el buscador público.
    orphanedAt: { type: Date, default: null },
    // Intervinientes (extra-info-worker / pjn-intervinientes-publicas): la causa ya fue leída
    // y cuándo. Los intervinientes en sí van a la colección `intervinientes`.
    detailsLoaded: { type: Boolean, default: false, index: true },
    detailsLastUpdate: { type: Date },
    // Contador diario de errores (espeja updateStats.today).
    errorStats: {
        count: { type: Number, default: 0 },
        last: { type: Date },
        lastErrorType: { type: String },
        today: {
            date: { type: String },
            count: { type: Number, default: 0 },
            hours: [{ type: Number }],
            byType: { type: mongoose.Schema.Types.Mixed, default: {} }
        }
    }
};
