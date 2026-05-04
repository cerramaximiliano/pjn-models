const mongoose = require("mongoose");

// Lista canónica de causaTypes soportados (espejo del enum del Folder en
// law-analytics-server). Mantener sincronizado si se agregan fueros.
const CAUSA_TYPES = [
    "CausasCivil",
    "CausasComercial",
    "CausasTrabajo",
    "CausasSegSoc",
    "CausasSegSocial",
    "CausasCAF",
    "CausasCCF",
    "CausasCNE",
    "CausasCPE",
    "CausasCFP",
    "CausasCCC",
    "CausasCSJ",
    "CausasFSM",
    "CausasCPF",
    "CausasCPN",
    "CausasFBB",
    "CausasFCR",
    "CausasFCB",
    "CausasFCT",
    "CausasFGR",
    "CausasFLP",
    "CausasFMP",
    "CausasFMZ",
    "CausasFPO",
    "CausasFPA",
    "CausasFRE",
    "CausasFSA",
    "CausasFRO",
    "CausasFTU",
];

// Espejo del enum source de Causa.updateHistory (causas-civil.js:236-239).
const SCRAPING_SOURCES = [
    "scraping",
    "scraping-capsolver",
    "app",
    "api",
    "manual",
    "admin_manual",
    "error_verification_worker",
    "recovery_worker",
    "stuck_documents_worker",
    "verify_worker_recovery",
    "cache",
    "pjn-login",
    "sync",
];

const PDF_STATUSES = [
    "pending",         // recién creado, PDF aún no descargado
    "downloading",     // worker tomó el job
    "downloaded",      // PDF en S3, OK
    "failed",          // error en descarga (ver pdfError)
    "not_applicable",  // movimiento sin URL, no hay nada que descargar
    "expired",         // link de PJN expiró antes de poder bajarlo
];

const schema = new mongoose.Schema(
    {
        // _id determinístico: "{causaId}:{sourceId}"
        // - causaId: ObjectId de la Causa padre (24 chars hex)
        // - sourceId: hash estable generado por generatePjnMovementId
        // El causaId garantiza unicidad global; el hash solo necesita ser único
        // dentro de la causa.
        _id: { type: String },

        // === Identidad / parentesco ===
        causaId: {
            type: mongoose.Schema.Types.ObjectId,
            required: true,
            refPath: "causaType",
            index: true,
        },
        causaType: { type: String, required: true, enum: CAUSA_TYPES },
        fuero: { type: String, required: true, index: true },

        // sourceId base (sin el prefijo causaId). Útil para joins con
        // RagDocument.sourceId del subsistema RAG.
        sourceId: { type: String, required: true },

        // contentHash: los 12 chars de MD5 que componen el sourceId.
        // Útil para detectar si el contenido del movimiento cambió en re-scrape.
        contentHash: { type: String },

        // === Datos del movimiento (espejo del subdoc actual) ===
        fecha: { type: Date, index: true },
        tipo: { type: String },
        detalle: { type: String },
        url: { type: String },     // URL original de PJN (puede expirar)
        link: { type: String },    // alias usado por algunos scrapers, conservar por compat

        // === PDF en S3 (Fase 1) ===
        pdfStatus: { type: String, enum: PDF_STATUSES, default: "pending", index: true },
        pdfS3Bucket: { type: String },
        pdfS3Key: { type: String },
        pdfMimeType: { type: String },
        pdfBytes: { type: Number },
        pdfDownloadedAt: { type: Date },
        pdfDownloadAttempts: { type: Number, default: 0 },
        pdfError: { type: String },

        // === Procedencia y ciclo de vida ===
        // true si el movimiento viene de la tabla VER HISTÓRICAS del PJN.
        isHistorical: { type: Boolean, default: false },

        // Primera vez que vimos este movimiento. No cambia entre re-scrapes.
        firstSeenAt: { type: Date, default: Date.now },

        // Última vez que un scrape lo confirmó. Se actualiza incluso si no hay
        // cambios en el contenido (señal de "sigue vivo en el listado").
        lastSeenAt: { type: Date, default: Date.now },

        // De dónde vino la última vez que lo vimos (worker o source).
        scrapingSource: { type: String, enum: SCRAPING_SOURCES },
    },
    {
        collection: "pjn-movements",
        timestamps: true,
        _id: false, // _id es string custom, no ObjectId auto
    }
);

// Índices compuestos
// Listado de movimientos de una causa, orden cronológico descendente.
schema.index({ causaId: 1, fecha: -1 });
// Hard guarantee de unicidad por causa+sourceId. El _id ya es único por
// construcción ("causaId:sourceId"), pero este índice deja explícita la
// invariante y permite queries por sourceId aislado.
schema.index({ causaId: 1, sourceId: 1 }, { unique: true });
// Queries cross-causa por fuero+fecha (notification coordinator, etc.).
schema.index({ fuero: 1, fecha: -1 });

module.exports = mongoose.model("PjnMovement", schema);
