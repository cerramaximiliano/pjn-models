/**
 * TipoProcesoCausa — tipo de proceso de cada causa (P21 de plazos automáticos),
 * colección `causas-tipo-proceso` (Atlas, causas de usuarios).
 *
 * Un doc por causa (_id = causaId). `tipo` es el vigente según
 * utils/tipo-proceso.js#resolverTipo sobre `evidencias`: las detectadas en los
 * textos de la causa (declaración expresa o plazo expreso), el objeto, la norma
 * del fuero (CNT) y, si un operador lo fijó desde la admin, la suya (gana
 * siempre). El vigente se copia a la causa (`tipoProceso`) y a sus carpetas
 * (`judFolder.tipoProceso`). Lo escribe el pipeline de
 * plazos (worker_02) al leer textos nuevos de pjn-movement-texts; lo lee
 * plazos-worker para elegir la variante de la regla.
 */

const mongoose = require("mongoose");

const evidencia = new mongoose.Schema(
    {
        tipo: { type: String, enum: ["ordinario", "sumario", "especial"], required: true },
        fuente: {
            type: String,
            enum: ["expreso", "plazo_demanda", "plazo_agravios", "objeto", "objeto_especial", "norma", "usuario", "operador"],
            required: true,
        },
        movementId: { type: String, default: null }, // `${causaId}:${sourceId}` de pjn-movements
        fecha: { type: Date, default: null }, // fecha del movimiento o del cambio del operador (null: objeto, norma)
        frase: { type: String, default: null },
        operador: { type: String, default: null }, // correo del admin (fuente operador) o userId (fuente usuario)
    },
    { _id: false }
);

const schema = new mongoose.Schema(
    {
        _id: { type: mongoose.Schema.Types.ObjectId }, // causaId
        fuero: { type: String, required: true },
        tipo: { type: String, enum: [null, "ordinario", "sumario", "especial"], default: null },
        fuente: { type: String, default: null },
        movementId: { type: String, default: null },
        fecha: { type: Date, default: null },
        frase: { type: String, default: null },
        evidencias: { type: [evidencia], default: [] }, // máx. 10 (las más recientes)
        conflicto: { type: Boolean, default: false }, // hay evidencias de tipos distintos (sin contar la norma)
        // Sin tipo: sugerencia por objeto para el operador (no habilita cálculo).
        sugerencia: { tipo: { type: String, default: null }, motivo: { type: String, default: null } },
    },
    { collection: "causas-tipo-proceso", timestamps: true, versionKey: false }
);

schema.index({ tipo: 1, fuero: 1 });

module.exports = mongoose.models.TipoProcesoCausa || mongoose.model("TipoProcesoCausa", schema);
