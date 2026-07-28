/**
 * seed-plazos-normativa.js — Siembra las reglas iniciales de plazo
 * subsidiario (colección `plazos-normativa`, modelo PlazoNormativa).
 *
 * ⚠️ INSERT-ONLY: si la regla ya existe NO se toca — el mantenimiento
 * posterior (corregir plazos/citas, agregar reglas, deshabilitar) es del
 * admin. Re-ejecutar solo agrega reglas nuevas del catálogo.
 *
 * ⚠️ REVISIÓN JURÍDICA: la mayoría se siembra con verificado:false — las
 * citas y plazos deben confirmarse antes de confiar vencimientos computados
 * con ellas (el doc resultante guarda `plazo.norma.verificado` para eso).
 *
 * Uso:
 *   FERIADOS_URLDB="mongodb://..." node scripts/maintenance/seed-plazos-normativa.js
 * Fallback de conexión: FERIADOS_URLDB || URLDB_LOCAL || URLDB || localhost.
 */
const mongoose = require("mongoose");
const PlazoNormativa = require("../../src/models/plazo-normativa");

const URI =
    process.env.FERIADOS_URLDB ||
    process.env.URLDB_LOCAL ||
    process.env.URLDB ||
    "mongodb://localhost:27017/law_analytics";

// Matchers escritos contra texto NORMALIZADO (mayúsculas, sin tildes).
// Orden de evaluación = prioridad ascendente; específicas de fuero primero.
const REGLAS = [
    // ── CNT (laboral, ley 18.345) — antes que las genéricas ─────────────────
    {
        _id: "apelacion_sentencia_definitiva_cnt",
        label: "Apelación de sentencia definitiva (laboral)",
        acto: "sentencia_definitiva",
        fuero: ["CNT"],
        matchers: ["SENTENCIA DEFINITIVA"],
        matchersDetalle: ["SENTENCIA DEFINITIVA"],
        plazoDias: 6,
        norma: "art. 116 ley 18.345",
        prioridad: 10,
        verificado: false,
        notas: "Confirmar: apelación laboral 6 días (art. 116 LO).",
    },
    {
        _id: "traslado_demanda_cnt",
        label: "Traslado de demanda (laboral)",
        acto: "traslado_demanda",
        fuero: ["CNT"],
        matchers: ["TRASLADO DE (LA )?DEMANDA"],
        matchersDetalle: ["TRASLADO DE (LA )?DEMANDA"],
        plazoDias: 10,
        norma: "art. 68 ley 18.345",
        prioridad: 12,
        verificado: false,
        notas: "Confirmar: contestación de demanda laboral 10 días.",
    },

    // ── Genéricas CPCCN (CIV/COM/CSS y supletorio) ──────────────────────────
    {
        _id: "apelacion_sentencia_definitiva",
        label: "Apelación de sentencia definitiva",
        acto: "sentencia_definitiva",
        fuero: ["*"],
        matchers: ["SENTENCIA DEFINITIVA"],
        matchersDetalle: ["SENTENCIA DEFINITIVA"],
        plazoDias: 5,
        norma: "art. 244 CPCCN",
        prioridad: 20,
        verificado: true,
    },
    {
        _id: "apelacion_interlocutoria",
        label: "Apelación de interlocutoria",
        acto: "sentencia_interlocutoria",
        fuero: ["*"],
        matchers: ["(SENTENCIA|RESOLUCION) INTERLOCUTORIA"],
        matchersDetalle: ["INTERLOCUTORIA"],
        plazoDias: 5,
        norma: "art. 244 CPCCN",
        prioridad: 25,
        verificado: true,
    },
    {
        _id: "traslado_demanda_ordinario",
        label: "Traslado de demanda (proceso ordinario)",
        acto: "traslado_demanda",
        fuero: ["CIV", "COM"],
        matchers: ["TRASLADO DE (LA )?DEMANDA"],
        matchersDetalle: ["TRASLADO DE (LA )?DEMANDA"],
        plazoDias: 15,
        norma: "art. 338 CPCCN",
        prioridad: 30,
        verificado: false,
        notas: "Ordinario 15 días. OJO sumarísimo (art. 498): 5 días — refinar con matcher propio si aparece volumen.",
    },
    {
        _id: "traslado_recurso_extraordinario",
        label: "Traslado del recurso extraordinario",
        acto: "traslado_rex",
        fuero: ["*"],
        matchers: ["TRASLADO[^.]{0,80}RECURSO EXTRAORDINARIO", "RECURSO EXTRAORDINARIO[^.]{0,80}TRASLADO"],
        plazoDias: 10,
        norma: "art. 257 CPCCN",
        prioridad: 35,
        verificado: true,
    },
    {
        _id: "traslado_expresion_agravios",
        label: "Traslado de la expresión de agravios",
        acto: "traslado_agravios",
        fuero: ["*"],
        matchers: ["EXPRESION DE AGRAVIOS"],
        plazoDias: 5,
        norma: "art. 265 CPCCN",
        prioridad: 40,
        verificado: false,
        notas: "Confirmar: contestación de agravios 5 días en libre (art. 265)? Distinguir del plazo para expresar agravios.",
    },
    {
        _id: "impugnacion_liquidacion",
        label: "Impugnación de liquidación",
        acto: "liquidacion",
        fuero: ["*"],
        matchers: ["LIQUIDACION[^.]{0,100}(VISTA|TRASLADO|IMPUGNA)", "(APRUEBA|PRACTICADA?|VISTA)[^.]{0,100}LIQUIDACION"],
        plazoDias: 5,
        norma: "art. 503 CPCCN",
        prioridad: 50,
        verificado: false,
        notas: "Confirmar cita y plazo por fuero (CNT: art. 132 LO — vista de liquidación, ¿3 días?).",
    },
    {
        _id: "apelacion_honorarios",
        label: "Apelación de regulación de honorarios",
        acto: "honorarios",
        fuero: ["*"],
        matchers: ["REGULA[^.]{0,80}HONORARIOS", "HONORARIOS[^.]{0,60}REGULAD"],
        plazoDias: 5,
        norma: "art. 244 CPCCN",
        prioridad: 60,
        verificado: false,
        notas: "Confirmar interacción con ley 27.423 (arancel).",
    },
    {
        _id: "traslado_generico",
        label: "Traslado (genérico)",
        acto: "traslado",
        fuero: ["*"],
        matchers: ["\\bTRASLADO\\b"],
        plazoDias: 5,
        norma: "art. 150 CPCCN",
        prioridad: 80,
        verificado: true,
    },
    {
        _id: "vista_generica",
        label: "Vista (genérica)",
        acto: "vista",
        fuero: ["*"],
        matchers: ["\\bVISTA\\b"],
        plazoDias: 5,
        norma: "art. 150 CPCCN",
        prioridad: 85,
        verificado: true,
    },
    {
        _id: "intimacion_supletoria",
        label: "Intimación sin plazo expreso (supletorio)",
        acto: "intimacion",
        fuero: ["*"],
        matchers: ["INTIMA", "EMPLAZA", "REQUIER"],
        plazoDias: 5,
        norma: "plazo supletorio (conf. art. 150/155 CPCCN)",
        prioridad: 90,
        verificado: false,
        notas: "Confirmar la cita correcta del plazo supletorio general.",
    },
];

module.exports = { REGLAS };
if (require.main !== module) return;

(async () => {
    await mongoose.connect(URI);
    let inserted = 0;
    let skipped = 0;

    for (const r of REGLAS) {
        const res = await PlazoNormativa.updateOne(
            { _id: r._id },
            { $setOnInsert: { ...r, habilitado: true } },
            { upsert: true }
        );
        if (res.upsertedCount) inserted++;
        else skipped++;
    }

    const sinVerificar = await PlazoNormativa.countDocuments({ verificado: false, habilitado: true });
    console.log(`plazos-normativa: ${inserted} reglas nuevas, ${skipped} existentes (no tocadas).`);
    if (sinVerificar) {
        console.warn(`⚠️  ${sinVerificar} reglas con verificado:false — REVISAR plazos y citas antes de confiar en ellas.`);
        console.warn("   Los vencimientos computados con reglas no verificadas quedan marcados en plazo.norma.verificado=false.");
    }
    await mongoose.disconnect();
})().catch((e) => {
    console.error("FATAL:", e);
    process.exit(1);
});
