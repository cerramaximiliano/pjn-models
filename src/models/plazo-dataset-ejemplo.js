const mongoose = require("mongoose");

/**
 * PlazoDatasetEjemplo — dataset de plazos EXPRESOS observados en cédulas
 * reales, para minería de reglas empíricas por (fuero, objeto, acto).
 *
 * Cada doc es un ejemplo etiquetado POR EL PROPIO TRIBUNAL: una cédula cuyo
 * texto fija el plazo explícitamente. Fuentes:
 *   - 'inline': el plazos-worker lo cosecha al computar fuente 'texto'
 *     (cédulas nuevas, en tiempo real).
 *   - 'backfill': plazos-dataset-worker recorre cédulas HISTÓRICAS de las
 *     causas (plazos vencidos — inservibles para vencimientos, ideales para
 *     aprender la distribución real de plazos).
 *
 * También se guardan ejemplos negativos (sinPlazo: true) para medir qué
 * fracción de cédulas trae plazo expreso por segmento.
 *
 * Uso: agregación por (fuero, objeto, acto) → donde n y consistencia superan
 * umbral, es un CANDIDATO a regla de plazos-normativa que el admin revisa y
 * aprueba (pjn-api /admin/plazos/dataset/candidatos). El dataset nunca
 * aplica plazos por sí mismo — evidencia, no autoridad.
 */
const schema = new mongoose.Schema(
    {
        // `${causaId}:${sourceId}` — idempotente entre inline y backfill.
        _id: { type: String },

        causaId: { type: mongoose.Schema.Types.ObjectId, required: true, index: true },
        collection: { type: String },
        fuero: { type: String, required: true },
        objeto: { type: String, default: null },
        number: { type: Number },
        year: { type: Number },

        sourceId: { type: String, required: true },
        movimiento: {
            fecha: { type: Date },
            tipo: { type: String },
            detalle: { type: String },
            url: { type: String },
        },

        // Acto notificado según las reglas de plazos-normativa vigentes al
        // momento de la cosecha (clasificarActo sobre el texto) — la dimensión
        // "tipo de traslado" del dataset. 'desconocido' si ninguna matcheó.
        acto: { type: String, default: "desconocido", index: true },
        actoReglaClave: { type: String, default: null },

        // Etiqueta: el plazo que el tribunal escribió en la cédula.
        plazoDias: { type: Number, default: null },
        tipoPlazo: { type: String, enum: ["habiles", "corridos", null], default: null },
        plazoHoras: { type: Number, default: null },
        confianza: { type: String, enum: ["alta", "media", null], default: null },
        sinPlazo: { type: Boolean, default: false },

        // Evidencia (para auditar el ejemplo y citarlo al crear la regla).
        snippet: { type: String, default: null },
        apercibimiento: { type: String, default: null },

        extractorVersion: { type: Number },
        source: { type: String, enum: ["inline", "backfill"], required: true },
        harvestedAt: { type: Date, default: Date.now },
    },
    {
        collection: "plazos-dataset",
        timestamps: false,
        versionKey: false,
    }
);

// Dimensiones de la minería de reglas.
schema.index({ fuero: 1, objeto: 1, acto: 1 });
schema.index({ acto: 1, plazoDias: 1 });
schema.index({ sinPlazo: 1, fuero: 1 });

schema.statics.makeId = function (causaId, sourceId) {
    return `${String(causaId)}:${sourceId}`;
};

module.exports = mongoose.models.PlazoDatasetEjemplo || mongoose.model("PlazoDatasetEjemplo", schema);
