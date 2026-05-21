/**
 * Snapshots de la estructura HTML del portal PJN.
 *
 * Cada worker que scrapea exitosamente emite uno cada N requests (sampleRate
 * configurable, default 1/200). Costo: 1 write cada ~200 scrapings, trivial.
 *
 * Un cron diario lee los fingerprints recientes y compara contra una baseline
 * (último fingerprint considerado válido). Si la mayoría diverge → abre un
 * PjnHtmlDriftIncident type='fingerprint-drift'.
 *
 * TTL de 30 días: solo necesitamos histórico corto para análisis, no archivo
 * permanente. Para histórico largo, los drifts ya quedan en la otra colección.
 */
const mongoose = require("mongoose");

const pjnHtmlFingerprintSchema = new mongoose.Schema(
  {
    // Cantidad total de spans en body — sensible a cambios estructurales.
    totalSpans: { type: Number, required: true },

    // Sufijos de id JSF detectados (post-prefix expediente:j_idtNN:).
    // Ej: ['detailCamera', 'detailDependencia', 'detailSituation', 'detailCover']
    idsPresentes: { type: [String], default: [] },

    // Flag rápido: presencia de detailSituation (el span nuevo del 2026-05-21).
    situacionPresent: { type: Boolean, default: false },

    // Presencia del 4 obligatorios.
    hasCaratula: { type: Boolean, default: false },
    hasDependencia: { type: Boolean, default: false },
    hasCamara: { type: Boolean, default: false },

    // Fuente del fingerprint (worker que lo emitió).
    sourceWorker: { type: String, default: null },     // ej: "pjn-app-update-civil"
    fuero:        { type: String, default: null },     // CIV, CNT, CSS, COM
    causaRef:     { type: String, default: null },     // "CIV 8772/2025"

    timestamp: { type: Date, default: () => new Date() },
  },
  {
    collection: "pjn-html-fingerprints",
    timestamps: false  // tenemos timestamp explícito
  }
);

// TTL: 30 días. Es analítico, no archivo permanente.
pjnHtmlFingerprintSchema.index(
  { timestamp: 1 },
  { expireAfterSeconds: 30 * 24 * 60 * 60 }
);

module.exports =
  mongoose.models.PjnHtmlFingerprint ||
  mongoose.model("PjnHtmlFingerprint", pjnHtmlFingerprintSchema);
