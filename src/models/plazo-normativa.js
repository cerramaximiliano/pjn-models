const mongoose = require("mongoose");

/**
 * PlazoNormativa — reglas de plazo SUBSIDIARIO por tipo de acto notificado.
 *
 * Capa 3 del subsistema de plazos: cuando la cédula NO trae plazo expreso en
 * su texto (la mayoría — p.ej. notificación de sentencia), el plazo surge de
 * la normativa según el acto notificado. Cada doc es una regla:
 * matchers (regex sobre el texto normalizado de la cédula, o sobre el
 * `detalle` del movimiento) → acto → plazoDias con cita legal.
 *
 * First-match-wins por `prioridad` ascendente (reglas específicas primero,
 * genéricas al final). El clasificador vive en
 * src/utils/plazos-normativa.js (clasificarActo — puro, testeable).
 *
 * CURADA A MANO: el seed (scripts/maintenance/seed-plazos-normativa.js) es
 * insert-only — NUNCA pisa una regla existente, porque el mantenimiento
 * posterior (correcciones de plazo/cita, reglas nuevas) es del admin.
 * `verificado:false` = regla sembrada pendiente de revisión jurídica.
 */
const schema = new mongoose.Schema(
    {
        // Clave estable de la regla (slug), p.ej. 'apelacion_sentencia_definitiva'.
        _id: { type: String },

        label: { type: String, required: true },
        // Acto notificado que la regla reconoce (slug).
        acto: { type: String, required: true },
        // Fueros donde aplica; '*' = todos. Una regla específica de fuero debe
        // tener prioridad menor (evaluarse antes) que su genérica.
        fuero: { type: [String], default: ["*"] },
        // Objetos del juicio donde aplica; '*' = todos. Regex (strings) sobre
        // el objeto NORMALIZADO de la causa (p.ej. 'DESPIDO', 'REAJUSTES?',
        // 'AMPARO', 'EJECUTIV'). El plazo puede variar por objeto (sumarísimo,
        // amparo, ejecutivo...) — una regla específica de objeto debe tener
        // prioridad menor que su genérica. Si la regla exige objeto y la causa
        // no lo tiene, la regla NO aplica.
        objetos: { type: [String], default: ["*"] },

        // Regex (strings) sobre el TEXTO NORMALIZADO de la cédula
        // (mayúsculas, sin tildes — ver _norm del clasificador).
        matchers: { type: [String], default: [] },
        // Regex sobre el `detalle` del movimiento (para docs sin PDF).
        matchersDetalle: { type: [String], default: [] },
        // Regex de contextos que NO son el acto (P22): si la oración donde
        // matcheó (hasta 160 caracteres a cada lado) matchea alguno, esa aparición
        // se descarta y se busca la siguiente. Ej.: honorarios "solicitada",
        // "por cumplida la intimación".
        excluye: { type: [String], default: [] },
        // false = la regla reconoce el acto pero no propone vencimiento: la
        // cédula va a revisión manual (P22: las genéricas "NOTIFÍQUESE").
        proponeVencimiento: { type: Boolean, default: true },

        plazoDias: { type: Number, required: true },
        tipoPlazo: { type: String, enum: ["habiles", "corridos"], default: "habiles" },

        // Cita legal ("art. 244 CPCCN") — SIEMPRE visible en la UI como
        // fundamento del cómputo.
        norma: { type: String, required: true },
        descripcion: { type: String, default: "" },

        prioridad: { type: Number, default: 100 },
        habilitado: { type: Boolean, default: true },
        // false = sembrada, pendiente de revisión jurídica del admin.
        // Tipo de proceso al que aplica la variante (P21): 'ordinario' |
        // 'sumario' (= sumarísimo) | null (cualquiera). Un acto cuyo plazo
        // depende del trámite tiene una regla por tipo; si la causa no tiene
        // tipo conocido no se propone vencimiento.
        tipoProceso: { type: String, enum: [null, "ordinario", "sumario"], default: null },
        verificado: { type: Boolean, default: false },
        // Quién y cuándo la verificó (revisión legal, desde la admin).
        verificadoPor: { type: String, default: null },
        verificadoAt: { type: Date, default: null },
        verificadoNota: { type: String, default: null },
        notas: { type: String, default: "" },
    },
    {
        collection: "plazos-normativa",
        timestamps: true,
        versionKey: false,
    }
);

schema.index({ habilitado: 1, prioridad: 1 });

schema.statics.getReglas = async function () {
    return this.find({ habilitado: true }).sort({ prioridad: 1 }).lean();
};

// Cache in-memory por proceso (el worker clasifica por cada cédula).
let _cache = null;

schema.statics.getReglasCached = async function ({ ttlMs = 10 * 60 * 1000 } = {}) {
    if (_cache && Date.now() - _cache.at < ttlMs) return _cache.reglas;
    const reglas = await this.getReglas();
    _cache = { at: Date.now(), reglas };
    return reglas;
};

schema.statics.clearReglasCache = function () {
    _cache = null;
};

module.exports = mongoose.models.PlazoNormativa || mongoose.model("PlazoNormativa", schema);
