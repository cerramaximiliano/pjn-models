const mongoose = require("mongoose");

/**
 * Campos compartidos que se inyectan en todos los causa-models (causas-civil,
 * causas-trabajo, causas-segsocial, causas-comercial, etc.) vía
 * schema.add(require('../shared/sentencias-scan-fields')).
 *
 * Agrupa dos bloques:
 *  1. `sentenciasScan` — tracking del sentencias-collector-worker.
 *  2. `saij` — vínculo con sentencias extraídas del scraper SAIJ
 *     (saij-workers). Permite marcar causas que fueron originadas o
 *     enriquecidas con jurisprudencia/sumarios provenientes de SAIJ y
 *     mantener back-refs a los docs en la colección `saij-sentencias`.
 */
module.exports = {
    // ── sentencias-collector (Phase 1) ────────────────────────────────────
    sentenciasScan: {
        // Timestamp del último scan del collector sobre esta causa.
        // null = nunca escaneada (o pre-backfill).
        lastAt: {
            type: Date,
            default: null,
            index: true
        },
        // Cantidad de sentencias capturables detectadas en el último scan.
        // Refleja el estado del movimiento[] al momento del scan.
        foundOnLast: {
            type: Number,
            default: 0
        },
        // Total acumulado de sentencias INSERTADAS para esta causa a lo largo
        // del tiempo (solo se incrementa con upserts nuevos, no con re-scans
        // que vuelven a ver las mismas sentencias).
        totalFound: {
            type: Number,
            default: 0
        }
    },

    // ── saij-workers (vinculación con SAIJ) ───────────────────────────────
    saij: {
        // True si esta causa tiene al menos una sentencia/sumario asociado en
        // la colección `saij-sentencias`. Indexable para listados.
        isFromSaij: {
            type: Boolean,
            default: false,
            index: true
        },
        // Referencias a los docs de saij-sentencias (jurisprudencia/sumarios)
        // vinculados a esta causa. Se agregan via $addToSet.
        saijSentenciaIds: [{
            type: mongoose.Schema.Types.ObjectId
        }],
        // Jurisdicción del filtro de scraping en SAIJ que detectó la causa
        // (ej: 'NACIONAL'). Preparado para multi-jurisdicción futura.
        saijJurisdiccion: {
            type: String,
            default: null
        },
        // Timestamp del primer link establecido entre la causa y SAIJ.
        linkedAt: {
            type: Date
        },
        // True si la causa fue CREADA como resultado de un fallo SAIJ
        // (no existía previamente en URLDB_LOCAL). Distingue causas
        // "orgánicas" del PJN de causas inyectadas desde jurisprudencia SAIJ.
        createdViaSaij: {
            type: Boolean,
            default: false
        }
    }
};
