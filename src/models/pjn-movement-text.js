const mongoose = require("mongoose");

// Colección satélite de `pjn-movements`: texto plano extraído de los
// documentos de organismo (resoluciones, despachos, sentencias).
//
// Diseño: mismo _id que el PjnMovement ("{causaId}:{sourceId}") — join 1:1
// trivial en ambas direcciones. El texto vive acá y NO en pjn-movements para
// no arrastrar payload al working set de la colección operativa (los listados
// de movimientos, scans de backfill y coordinadores de notificaciones no
// necesitan el texto). El estado de extracción (textoStatus, charCount,
// método) vive en el PjnMovement; acá solo el payload + claves de join.
//
// Consumidores: generador de dataset (pjn-etapa-model), etiquetador admin,
// inferencia en cascada del clasificador, RAG (join por sourceId).
const schema = new mongoose.Schema(
    {
        // "{causaId}:{sourceId}" — idéntico al _id del PjnMovement hermano.
        _id: { type: String },

        causaId: {
            type: mongoose.Schema.Types.ObjectId,
            required: true,
            index: true,
        },
        fuero: { type: String, required: true, index: true },

        // sourceId aislado (join con RagDocument.sourceId y con el hermano).
        sourceId: { type: String, required: true },

        // Texto plano completo del documento (cap sugerido ~400KB en el writer).
        texto: { type: String, required: true },
    },
    {
        collection: "pjn-movement-texts",
        timestamps: true,
        _id: false, // _id es string custom, no ObjectId auto
    }
);

// Fetch de todos los textos de una causa (etiquetador, generador de dataset).
schema.index({ causaId: 1, sourceId: 1 }, { unique: true });

module.exports = mongoose.models.PjnMovementText || mongoose.model("PjnMovementText", schema);
