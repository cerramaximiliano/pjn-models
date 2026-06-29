/**
 * seed-objetos-catalog.js
 *
 * Siembra / recalcula el catálogo `causa-objetos` (modelo CausaObjeto):
 * para cada colección de causas (CausasTrabajo, CausasCivil, ... y los fueros
 * federales) agrupa por (fuero, objeto), cuenta las causas y upsertea el
 * resultado. Idempotente — se puede correr cuantas veces se quiera; recalcula
 * `count` (que NO se mantiene en vivo).
 *
 * Opera sobre UNA sola base (lee causas + escribe catálogo en la misma DB).
 * Correr una vez por base que quiera tener su catálogo:
 *   - Caché worker_01 (la más extensa):
 *       CATALOG_URLDB="mongodb://localhost:27017/law_analytics" node scripts/maintenance/seed-objetos-catalog.js
 *   - Atlas producción (la que mantiene el hook en vivo):
 *       CATALOG_URLDB="$URLDB" node scripts/maintenance/seed-objetos-catalog.js
 *
 * Si no se pasa CATALOG_URLDB, usa process.env.URLDB y como último fallback
 * mongodb://localhost:27017/law_analytics.
 */
const mongoose = require("mongoose");
const models = require("../../index.js");
const { CausaObjeto } = models;

const URI =
    process.env.CATALOG_URLDB ||
    process.env.URLDB ||
    "mongodb://localhost:27017/law_analytics";

// Todos los modelos de causas exportados por pjn-models (CausasTrabajo,
// CausasCivil, ... CausasFSA, etc). Cada uno declara su propia colección.
const CAUSA_MODELS = Object.keys(models).filter(
    (k) => k.startsWith("Causas") && models[k] && models[k].aggregate
);

function modelDefaultFuero(Model) {
    try {
        const p = Model.schema.path("fuero");
        const d = p && p.options ? p.options.default : null;
        return d || null;
    } catch (_) {
        return null;
    }
}

async function main() {
    const t0 = Date.now();
    console.log(`[seed-objetos] conectando a ${URI.replace(/:\/\/[^@]*@/, "://***@")}`);
    await mongoose.connect(URI);
    console.log(`[seed-objetos] ${CAUSA_MODELS.length} modelos de causas a procesar`);

    // Merge global: clave -> { fuero, objeto, count, sample }
    const merged = new Map();
    const keyOf = (f, o) => `${f}${o}`;

    for (const name of CAUSA_MODELS) {
        const Model = models[name];
        const coll = Model.collection.name;
        const fallbackFuero = CausaObjeto.normalizeFuero(modelDefaultFuero(Model));
        let rows;
        try {
            rows = await Model.aggregate(
                [
                    { $match: { objeto: { $nin: [null, ""] } } },
                    {
                        $group: {
                            _id: { fuero: "$fuero", objeto: "$objeto" },
                            count: { $sum: 1 },
                            sample: { $first: "$caratula" },
                        },
                    },
                ],
                { allowDiskUse: true }
            );
        } catch (err) {
            console.warn(`[seed-objetos] ${name} (${coll}) aggregate falló: ${err.message}`);
            continue;
        }

        let added = 0;
        for (const r of rows) {
            const f = CausaObjeto.normalizeFuero(r._id.fuero) || fallbackFuero;
            const o = CausaObjeto.normalizeObjeto(r._id.objeto);
            if (!f || !o) continue;
            const key = keyOf(f, o);
            const prev = merged.get(key) || { fuero: f, objeto: o, count: 0, sample: null };
            prev.count += r.count;
            if (!prev.sample && r.sample) prev.sample = String(r.sample).trim();
            merged.set(key, prev);
            added++;
        }
        console.log(
            `[seed-objetos] ${name.padEnd(18)} ${coll.padEnd(20)} grupos:${rows.length} válidos:${added}`
        );
    }

    console.log(`[seed-objetos] ${merged.size} pares (fuero, objeto) distintos. Upserteando...`);

    const now = new Date();
    const ops = [];
    for (const v of merged.values()) {
        const set = { count: v.count, countUpdatedAt: now, lastSeenAt: now };
        if (v.sample) set.sampleCaratula = v.sample;
        ops.push({
            updateOne: {
                filter: { fuero: v.fuero, objeto: v.objeto },
                update: { $set: set, $setOnInsert: { firstSeenAt: now } },
                upsert: true,
            },
        });
    }

    // bulkWrite en lotes para no mandar un payload gigante.
    const BATCH = 1000;
    let upserted = 0,
        modified = 0;
    for (let i = 0; i < ops.length; i += BATCH) {
        const res = await CausaObjeto.bulkWrite(ops.slice(i, i + BATCH), { ordered: false });
        upserted += res.upsertedCount || 0;
        modified += res.modifiedCount || 0;
    }

    console.log(
        `[seed-objetos] LISTO. nuevos:${upserted} actualizados:${modified} total:${merged.size} en ${((Date.now() - t0) / 1000).toFixed(1)}s`
    );

    // Resumen por fuero
    const porFuero = await CausaObjeto.aggregate([
        { $group: { _id: "$fuero", objetos: { $sum: 1 }, causas: { $sum: "$count" } } },
        { $sort: { causas: -1 } },
    ]);
    console.log("[seed-objetos] catálogo por fuero (objetos distintos | causas):");
    porFuero.forEach((p) => console.log(`   ${String(p._id).padEnd(6)} ${String(p.objetos).padStart(5)} | ${p.causas}`));

    await mongoose.connection.close();
}

main().catch(async (err) => {
    console.error("[seed-objetos] ERROR fatal:", err);
    try {
        await mongoose.connection.close();
    } catch (_) {}
    process.exit(1);
});
