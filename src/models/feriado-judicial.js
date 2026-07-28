const mongoose = require("mongoose");

/**
 * FeriadoJudicial — calendario de días inhábiles judiciales.
 *
 * Un doc por (fecha, ambito). Fuente del Set de inhábiles que consume
 * src/utils/dias-habiles.js para computar plazos procesales. Se siembra con
 * scripts/maintenance/seed-feriados-judiciales.js (feriados por ley 27.399 +
 * ferias) y se mantiene desde la admin UI: los puentes turísticos, traslados
 * por decreto, la feria de julio (acordada CSJN anual) y los asuetos salen
 * DESPUÉS de sembrado el año — por eso existe `verificado`.
 *
 * ⚠️ Los docs con verificado:false son estimaciones (traslado computado por
 * la regla general de la ley, rango típico de feria) y deben confirmarse
 * contra el decreto/acordada del año antes de confiar plazos sobre ellos.
 */
const schema = new mongoose.Schema(
    {
        // _id determinístico `${fecha}|${ambito}` — re-seeds idempotentes.
        _id: { type: String },

        // Día calendario argentino. String para que el cómputo sea inmune a TZ.
        fecha: { type: String, required: true, match: /^\d{4}-\d{2}-\d{2}$/, index: true },

        tipo: {
            type: String,
            required: true,
            enum: [
                "feriado_nacional", // inamovibles ley 27.399
                "feriado_trasladable", // 17/6·17/8·12/10·20/11 — fecha efectiva post-traslado
                "dia_no_laborable", // p.ej. Jueves Santo (tribunales sin actividad)
                "puente_turistico", // decreto anual
                "feria_enero", // feria judicial de verano (1-31/1)
                "feria_julio", // feria judicial de invierno (acordada CSJN anual)
                "asueto", // asuetos por acordada/resolución
                "otro",
            ],
        },

        // 'nacional' aplica a todos los fueros PJN. Valores específicos (p.ej.
        // una cámara con asueto local) permiten calendarios por ámbito.
        ambito: { type: String, default: "nacional" },

        descripcion: { type: String, default: "" },
        // Norma que lo establece (ley/decreto/acordada) — trazabilidad jurídica.
        fuente: { type: String, default: "" },

        // false = estimación pendiente de confirmar contra el decreto/acordada.
        verificado: { type: Boolean, default: false },
        // Baja lógica editable desde admin (p.ej. traslado que no ocurrió).
        habilitado: { type: Boolean, default: true },
        notas: { type: String, default: "" },
    },
    {
        collection: "feriados-judiciales",
        timestamps: true,
        versionKey: false,
    }
);

schema.index({ fecha: 1, ambito: 1 }, { unique: true });
schema.index({ verificado: 1, fecha: 1 });

schema.statics.makeId = function (fecha, ambito = "nacional") {
    return `${fecha}|${ambito}`;
};

/**
 * Set de días inhábiles 'YYYY-MM-DD' para dias-habiles.js.
 * @param {Object} [opts]
 * @param {string} [opts.desde] — 'YYYY-MM-DD' inclusive
 * @param {string} [opts.hasta] — 'YYYY-MM-DD' inclusive
 * @param {string[]} [opts.ambitos=['nacional']]
 * @param {boolean} [opts.soloVerificados=false] — excluir estimaciones
 */
schema.statics.getSet = async function ({ desde, hasta, ambitos = ["nacional"], soloVerificados = false } = {}) {
    const q = { habilitado: true, ambito: { $in: ambitos } };
    if (desde || hasta) {
        q.fecha = {};
        if (desde) q.fecha.$gte = desde;
        if (hasta) q.fecha.$lte = hasta;
    }
    if (soloVerificados) q.verificado = true;
    const docs = await this.find(q).select({ fecha: 1, _id: 0 }).lean();
    return new Set(docs.map((d) => d.fecha));
};

// Cache in-memory por proceso (los workers computan plazos por cada
// movimiento nuevo — no queremos un find() por cédula).
const _cache = new Map(); // key → { at, set }

schema.statics.getSetCached = async function (opts = {}) {
    const { ttlMs = 6 * 60 * 60 * 1000, ...rest } = opts;
    const key = JSON.stringify(rest);
    const hit = _cache.get(key);
    if (hit && Date.now() - hit.at < ttlMs) return hit.set;
    const set = await this.getSet(rest);
    _cache.set(key, { at: Date.now(), set });
    return set;
};

schema.statics.clearSetCache = function () {
    _cache.clear();
};

module.exports = mongoose.models.FeriadoJudicial || mongoose.model("FeriadoJudicial", schema);
