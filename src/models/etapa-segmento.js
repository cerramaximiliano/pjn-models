const mongoose = require("mongoose");

/**
 * EtapaSegmento — tabla de HECHOS de segmentos de etapa procesal CERRADOS.
 *
 * Cada doc es un tramo terminado del timeline de una causa: "estuvo en PRUEBA
 * del 2023-02-01 al 2023-11-20 (292 días) y pasó a ALEGATOS". Solo segmentos
 * con `hasta` (los abiertos no tienen duración real y quedan excluidos por
 * diseño — pedido explícito: nunca mezclar etapas abiertas en las stats).
 *
 * La puebla el worker etapa-stats (pjn-workers-scraping) de forma incremental
 * (watermark sobre etapaProcesal.computedAt) con upserts idempotentes por _id
 * determinístico. Es la base de:
 *   - estadísticas de duración por fuero/objeto/etapa/juzgado/sala
 *   - matriz de transiciones etapa→etapa
 *   - features de entrenamiento para predicción de duración (Fase 2)
 */
const schema = new mongoose.Schema(
    {
        // _id determinístico: `${causaType}:${causaId}:${etapa}:${desde.getTime()}`
        // — re-procesar la misma causa re-upserta los mismos hechos sin duplicar.
        _id: { type: String },

        causaId: { type: mongoose.Schema.Types.ObjectId, required: true, index: true },
        causaType: { type: String, required: true },
        fuero: { type: String, required: true },
        objeto: { type: String, default: null },
        familia: { type: String, default: null },

        etapa: { type: String, required: true },
        rank: { type: Number },
        desde: { type: Date, required: true },
        hasta: { type: Date, required: true },
        dias: { type: Number, required: true },
        retroceso: { type: Boolean, default: false },

        // A qué etapa pasó al cerrarse (transición saliente).
        etapaSiguiente: { type: String, default: null },
        rankSiguiente: { type: Number, default: null },

        // Contexto de organismo al momento del cómputo (campos legacy derivados
        // de la trayectoria). juzgado aplica a primera instancia; sala a las
        // etapas de revisión (rank >= 70).
        juzgado: { type: Number, default: null },
        sala: { type: Number, default: null },

        // Cohorte temporal (año de inicio del segmento) para series históricas.
        anioDesde: { type: Number },

        version: { type: Number },
        computedAt: { type: Date },
    },
    {
        collection: "etapa-segmentos",
        timestamps: false,
        versionKey: false,
    }
);

// Dimensiones de agregación principales.
schema.index({ fuero: 1, etapa: 1 });
schema.index({ fuero: 1, objeto: 1, etapa: 1 });
schema.index({ fuero: 1, juzgado: 1, etapa: 1 });

module.exports = mongoose.models.EtapaSegmento || mongoose.model("EtapaSegmento", schema);
