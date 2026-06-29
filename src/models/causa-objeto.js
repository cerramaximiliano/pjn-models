const mongoose = require("mongoose");

// Catálogo de objetos de causa distintos por fuero.
//
// Motivación: conocer "qué objetos existen" hoy requiere un aggregate $group
// sobre colecciones de cientos de miles de documentos (causas-trabajo ~835k).
// Esta colección materializa el universo de objetos por fuero para acceso O(1):
// dropdowns/filtros en el front, analítica y reportes.
//
// Población:
//   - En vivo: los workers de pjn-workers llaman a `recordObjeto(fuero, objeto)`
//     cuando descubren/verifican una causa. Upsert idempotente — si el par
//     (fuero, objeto) ya existe se ignora (solo refresca lastSeenAt), si es
//     nuevo se inserta. Fire-and-forget: nunca bloquea ni rompe el scraping.
//   - Backfill: `scripts/maintenance/seed-objetos-catalog.js` siembra el
//     catálogo y recalcula `count` con un aggregate sobre las colecciones de
//     causas. El conteo NO se mantiene en vivo (evita doble conteo en
//     re-scrapes) — se recalcula periódicamente por el backfill.

// Normaliza el fuero a su forma canónica de 3 letras (CNT/CIV/CSS/COM/...).
// Acepta los alias legacy ("Trabajo", "Seguridad Social", etc.) que conviven
// en datos viejos.
const FUERO_ALIASES = {
    "trabajo": "CNT",
    "civil": "CIV",
    "seguridad social": "CSS",
    "seg social": "CSS",
    "comercial": "COM",
};

function normalizeFuero(fuero) {
    if (!fuero) return null;
    const raw = String(fuero).trim();
    if (!raw) return null;
    const lower = raw.toLowerCase();
    if (FUERO_ALIASES[lower]) return FUERO_ALIASES[lower];
    // Si ya viene como código corto (CNT, CIV, FSA, ...) lo dejamos en mayúsculas.
    return raw.toUpperCase();
}

// Normaliza el objeto al mismo criterio que el setter de las causas:
// trim, colapsar espacios, sin puntos/guiones colgando, mayúsculas.
function normalizeObjeto(objeto) {
    if (!objeto) return null;
    const clean = String(objeto)
        .trim()
        .replace(/\s+/g, " ")
        .replace(/[\.\-]+$/, "")
        .replace(/\n/g, "")
        .trim()
        .toUpperCase();
    return clean || null;
}

const schema = new mongoose.Schema(
    {
        fuero: { type: String, required: true },   // "CNT", "CIV", "CSS", "COM", ...
        objeto: { type: String, required: true },  // "COBRO DE SALARIOS" (normalizado)

        // Cantidad de causas con este objeto. Se recalcula en el backfill, NO en
        // vivo. null = todavía no calculado (descubierto solo por el hook).
        count: { type: Number, default: null },

        // Un ejemplo de carátula con este objeto — útil para previsualizar en UI.
        sampleCaratula: { type: String },

        firstSeenAt: { type: Date, default: Date.now },
        lastSeenAt: { type: Date, default: Date.now },

        // Última vez que el backfill recalculó `count`.
        countUpdatedAt: { type: Date },
    },
    {
        collection: "causa-objetos",
        timestamps: true,
    }
);

// Unicidad por par (fuero, objeto): un objeto por fuero aparece una sola vez.
// Este mismo índice sirve para listar alfabéticamente los objetos de un fuero.
schema.index({ fuero: 1, objeto: 1 }, { unique: true });

schema.statics.normalizeFuero = normalizeFuero;
schema.statics.normalizeObjeto = normalizeObjeto;

// Registra (idempotente) la presencia de un (fuero, objeto). Pensado para
// llamarse fire-and-forget desde los workers al descubrir/verificar una causa.
// Devuelve la promesa del updateOne (el caller decide si .catch()ea).
// No incrementa `count` — eso lo hace el backfill.
schema.statics.recordObjeto = function recordObjeto(fuero, objeto, sampleCaratula) {
    const f = normalizeFuero(fuero);
    const o = normalizeObjeto(objeto);
    if (!f || !o) return Promise.resolve(null);

    const now = new Date();
    const setOnInsert = { firstSeenAt: now };
    if (sampleCaratula) setOnInsert.sampleCaratula = String(sampleCaratula).trim();

    return this.updateOne(
        { fuero: f, objeto: o },
        { $setOnInsert: setOnInsert, $set: { lastSeenAt: now } },
        { upsert: true }
    ).exec();
};

module.exports = mongoose.models.CausaObjeto || mongoose.model("CausaObjeto", schema);
