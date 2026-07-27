const mongoose = require("mongoose");

/**
 * EtapaResultado — tabla de HECHOS de causas TERMINADAS (una fila por causa).
 *
 * Captura cómo terminó cada causa (subtipo de terminación: conciliación,
 * caducidad, desistimiento, sentencia firme, archivo...) y sus duraciones
 * agregadas. Solo causas con etapaProcesal.terminal=true — las en trámite no
 * entran (pedido explícito: solo hechos consumados).
 *
 * La puebla el worker etapa-stats (pjn-workers-scraping) junto con
 * EtapaSegmento. Base de: distribución de resultados por fuero/objeto,
 * duración total por tipo de resultado, y target de entrenamiento para
 * predicción de resultado (Fase 2).
 */
const schema = new mongoose.Schema(
    {
        // _id determinístico: `${causaType}:${causaId}` — una fila por causa.
        _id: { type: String },

        causaId: { type: mongoose.Schema.Types.ObjectId, required: true },
        causaType: { type: String, required: true },
        fuero: { type: String, required: true },
        objeto: { type: String, default: null },
        familia: { type: String, default: null },
        juzgado: { type: Number, default: null },
        sala: { type: Number, default: null },

        // Etapa terminal (fin_litigio | archivo) + subtipo normalizado del hito.
        resultado: { type: String, required: true },
        detalle: { type: String, default: null },

        fechaInicio: { type: Date, default: null },
        fechaResultado: { type: Date, default: null },
        anioInicio: { type: Number, default: null },

        // Duraciones agregadas (días).
        diasTotales: { type: Number, default: null },
        // demanda → sentencia de primera instancia (null si no hubo sentencia).
        diasHastaSentencia: { type: Number, default: null },

        // Conformidad contra el patrón maestro de la familia (v4):
        // con-merito | anticipada | gap | reapertura. `faltantes` lista las
        // etapas presupuestas no registradas (candidatas a inferir en Fase 2).
        // `firma` es la secuencia completa de etapas ("demanda > ... > archivo").
        conformidad: { type: String, default: null, index: true },
        faltantes: { type: [String], default: undefined },
        firma: { type: String, default: null },

        // Hitos por los que pasó (features de resultado).
        tuvoSentencia: { type: Boolean, default: false },
        pasoPorCamara: { type: Boolean, default: false },
        pasoPorREX: { type: Boolean, default: false },
        tuvoEjecucion: { type: Boolean, default: false },
        retrocesos: { type: Number, default: 0 },

        version: { type: Number },
        computedAt: { type: Date },
    },
    {
        collection: "etapa-resultados",
        timestamps: false,
        versionKey: false,
    }
);

schema.index({ fuero: 1, objeto: 1 });
schema.index({ fuero: 1, resultado: 1 });

module.exports = mongoose.models.EtapaResultado || mongoose.model("EtapaResultado", schema);
