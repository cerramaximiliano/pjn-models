/**
 * TipoProcesoCausa — tipo de proceso de cada causa (P21 de plazos automáticos),
 * colección `causas-tipo-proceso` (Atlas, causas de usuarios).
 *
 * Un doc por causa (_id = causaId). `tipo` es el vigente según
 * utils/tipo-proceso.js#resolverTipo sobre `evidencias`: las detectadas en los
 * textos de la causa (declaración expresa o plazo expreso) y, si un operador
 * lo fijó desde la admin, la suya (gana siempre). Lo escribe el pipeline de
 * plazos (worker_02) al leer textos nuevos de pjn-movement-texts; lo lee
 * plazos-worker para elegir la variante de la regla.
 */

const mongoose = require("mongoose");

const evidencia = new mongoose.Schema(
    {
        tipo: { type: String, enum: ["ordinario", "sumario"], required: true },
        fuente: { type: String, enum: ["expreso", "plazo_demanda", "plazo_agravios", "operador"], required: true },
        movementId: { type: String, default: null }, // `${causaId}:${sourceId}` de pjn-movements
        fecha: { type: Date, default: null }, // fecha del movimiento (o del cambio del operador)
        frase: { type: String, default: null },
        operador: { type: String, default: null }, // correo del admin si fuente = 'operador'
    },
    { _id: false }
);

const schema = new mongoose.Schema(
    {
        _id: { type: mongoose.Schema.Types.ObjectId }, // causaId
        fuero: { type: String, required: true },
        tipo: { type: String, enum: [null, "ordinario", "sumario"], default: null },
        fuente: { type: String, default: null },
        movementId: { type: String, default: null },
        fecha: { type: Date, default: null },
        frase: { type: String, default: null },
        evidencias: { type: [evidencia], default: [] }, // máx. 10 (las más recientes)
        conflicto: { type: Boolean, default: false }, // hay evidencias de los dos tipos
    },
    { collection: "causas-tipo-proceso", timestamps: true, versionKey: false }
);

schema.index({ tipo: 1, fuero: 1 });

module.exports = mongoose.models.TipoProcesoCausa || mongoose.model("TipoProcesoCausa", schema);
