const mongoose = require("mongoose");

/**
 * ConfiguracionPlazosWorker — configuración + estado del plazos-worker
 * (pjn-workers-scraping, capa 2 del subsistema de plazos).
 *
 * Singleton { _id: 'global' } en la colección `plazos-worker-config` (la
 * misma que el worker usaba como kill-switch crudo — compatible). El worker
 * la lee en cada ciclo (hot-reload: enabled y parámetros aplican sin
 * restart; un cambio de cronPattern re-agenda el cron en caliente) y
 * escribe su heartbeat. Administrable vía pjn-api
 * `/api/plazos-worker-config/*` (vista admin Workers PJN).
 */
const schema = new mongoose.Schema(
    {
        _id: { type: String, default: "global" },

        // ── Configuración (editable desde admin) ─────────────────────────────
        enabled: { type: Boolean, default: true },
        cronPattern: { type: String, default: "*/1 * * * *" },
        lockTimeoutMinutes: { type: Number, default: 10, min: 1, max: 120 },
        maxRetries: { type: Number, default: 3, min: 1, max: 10 },
        downloadTimeoutMs: { type: Number, default: 60000, min: 5000, max: 300000 },
        // Umbral chars/página para marcar PDF escaneado (→ revision_manual:
        // cédula física digitalizada, no computable automáticamente).
        scanCharsPerPageThreshold: { type: Number, default: 150, min: 10, max: 2000 },
        // Espejar los docs procesados a Atlas (colección plazos-notificaciones)
        // para que el plazos-folders-worker pueda leer de Atlas según su config.
        mirrorToAtlas: { type: Boolean, default: true },

        // ── Estado (escrito por el worker) ───────────────────────────────────
        heartbeat: {
            workerId: { type: String, default: null },
            startedAt: { type: Date, default: null },
            lastCycleAt: { type: Date, default: null },
            lastProcessedAt: { type: Date, default: null },
            lastProcessedId: { type: String, default: null },
            lastResult: { type: String, default: null }, // computed | parsed | ...
        },

        // Contadores acumulados (inc por el worker al finalizar cada doc).
        stats: {
            processed: { type: Number, default: 0 },
            computed: { type: Number, default: 0 },
            parsed: { type: Number, default: 0 },
            extracted: { type: Number, default: 0 },
            ocrNeeded: { type: Number, default: 0 },
            revisionManual: { type: Number, default: 0 },
            notPdf: { type: Number, default: 0 },
            failed: { type: Number, default: 0 },
        },
    },
    {
        collection: "plazos-worker-config",
        timestamps: true,
        versionKey: false,
        minimize: false,
    }
);

schema.statics.getGlobal = async function () {
    return this.findOneAndUpdate(
        { _id: "global" },
        { $setOnInsert: { _id: "global" } },
        { new: true, upsert: true, setDefaultsOnInsert: true }
    );
};

module.exports = mongoose.models.ConfiguracionPlazosWorker || mongoose.model("ConfiguracionPlazosWorker", schema);
