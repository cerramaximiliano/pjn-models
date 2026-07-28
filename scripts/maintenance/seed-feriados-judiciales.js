/**
 * seed-feriados-judiciales.js — Siembra el calendario de días inhábiles
 * judiciales (colección `feriados-judiciales`, modelo FeriadoJudicial).
 *
 * Genera por año (2024–2027):
 *   - Feriados inamovibles de la ley 27.399 (incl. carnaval y Viernes Santo,
 *     computados con el algoritmo de Pascua de Meeus) → verificado: true
 *   - Jueves Santo como día no laborable (tribunales sin actividad)
 *   - Feriados trasladables (17/6, 17/8, 12/10, 20/11) con el traslado
 *     computado por la regla del art. 6 ley 27.399 (mar/mié → lunes anterior,
 *     jue/vie → lunes siguiente) → verificado: FALSE (el decreto anual puede
 *     alterarlo — confirmar)
 *   - Puentes turísticos conocidos (2024/2025) → verificado: FALSE
 *   - Feria judicial de enero (1–31/1) → verificado: true
 *   - Feria judicial de julio (rango típico de 2 semanas) → verificado: FALSE
 *     (la fija la acordada CSJN de cada año — confirmar)
 *
 * Idempotente y re-runnable: upsert por _id `${fecha}|nacional`. En re-seeds
 * NO pisa `verificado`, `habilitado` ni `notas` (ediciones manuales de admin
 * sobreviven); sí actualiza tipo/descripcion/fuente.
 *
 * ⚠️ Los docs verificado:false son ESTIMACIONES. Antes de confiar plazos que
 * los atraviesen, confirmarlos desde la admin (o marcar verificado a mano).
 *
 * Uso:
 *   FERIADOS_URLDB="mongodb://localhost:27017/law_analytics" node scripts/maintenance/seed-feriados-judiciales.js
 * Fallback de conexión: FERIADOS_URLDB || URLDB_LOCAL || URLDB || localhost.
 */
const mongoose = require("mongoose");
const FeriadoJudicial = require("../../src/models/feriado-judicial");
const { toDay, addDays, dow } = require("../../src/utils/dias-habiles");

const URI =
    process.env.FERIADOS_URLDB ||
    process.env.URLDB_LOCAL ||
    process.env.URLDB ||
    "mongodb://localhost:27017/law_analytics";

const YEARS = [2024, 2025, 2026, 2027];

// ---------------------------------------------------------------------------
// Pascua (algoritmo de Meeus/Jones/Butcher) → 'YYYY-MM-DD'
// ---------------------------------------------------------------------------
function pascua(year) {
    const a = year % 19;
    const b = Math.floor(year / 100);
    const c = year % 100;
    const d = Math.floor(b / 4);
    const e = b % 4;
    const f = Math.floor((b + 8) / 25);
    const g = Math.floor((b - f + 1) / 3);
    const h = (19 * a + b - d - g + 15) % 30;
    const i = Math.floor(c / 4);
    const k = c % 4;
    const l = (32 + 2 * e + 2 * i - h - k) % 7;
    const m = Math.floor((a + 11 * h + 22 * l) / 451);
    const month = Math.floor((h + l - 7 * m + 114) / 31);
    const day = ((h + l - 7 * m + 114) % 31) + 1;
    return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

// Traslado según art. 6 ley 27.399: mar/mié → lunes anterior; jue/vie →
// lunes siguiente; sáb/dom/lun → queda donde cae.
function trasladar(day) {
    const d = dow(day);
    if (d === 2) return addDays(day, -1);
    if (d === 3) return addDays(day, -2);
    if (d === 4) return addDays(day, 4);
    if (d === 5) return addDays(day, 3);
    return day;
}

// ---------------------------------------------------------------------------
// Construcción del calendario (Map fecha → entry; primer escritor gana, los
// feriados tienen precedencia sobre los días de feria)
// ---------------------------------------------------------------------------
function buildEntries() {
    const map = new Map();
    const put = (fecha, entry) => {
        if (!map.has(fecha)) map.set(fecha, { fecha, ambito: "nacional", ...entry });
    };

    for (const y of YEARS) {
        const pas = pascua(y);

        // Inamovibles ley 27.399.
        const inamovibles = [
            [`${y}-01-01`, "Año Nuevo"],
            [addDays(pas, -48), "Carnaval (lunes)"],
            [addDays(pas, -47), "Carnaval (martes)"],
            [`${y}-03-24`, "Día Nacional de la Memoria por la Verdad y la Justicia"],
            [`${y}-04-02`, "Día del Veterano y de los Caídos en la Guerra de Malvinas"],
            [addDays(pas, -2), "Viernes Santo"],
            [`${y}-05-01`, "Día del Trabajador"],
            [`${y}-05-25`, "Día de la Revolución de Mayo"],
            [`${y}-06-20`, "Paso a la Inmortalidad del Gral. Manuel Belgrano"],
            [`${y}-07-09`, "Día de la Independencia"],
            [`${y}-12-08`, "Inmaculada Concepción de María"],
            [`${y}-12-25`, "Navidad"],
        ];
        for (const [fecha, descripcion] of inamovibles) {
            put(fecha, { tipo: "feriado_nacional", descripcion, fuente: "Ley 27.399", verificado: true });
        }

        // Jueves Santo — día no laborable; tribunales sin actividad.
        put(addDays(pas, -3), {
            tipo: "dia_no_laborable",
            descripcion: "Jueves Santo",
            fuente: "Ley 27.399 art. 7",
            verificado: true,
            notas: "Día no laborable — sin actividad tribunalicia (inhábil a los fines procesales).",
        });

        // Trasladables (fecha efectiva computada por la regla general).
        const trasladables = [
            [`${y}-06-17`, "Paso a la Inmortalidad del Gral. Martín Miguel de Güemes"],
            [`${y}-08-17`, "Paso a la Inmortalidad del Gral. José de San Martín"],
            [`${y}-10-12`, "Día del Respeto a la Diversidad Cultural"],
            [`${y}-11-20`, "Día de la Soberanía Nacional"],
        ];
        for (const [nominal, descripcion] of trasladables) {
            const efectivo = trasladar(nominal);
            put(efectivo, {
                tipo: "feriado_trasladable",
                descripcion: `${descripcion}${efectivo !== nominal ? ` (trasladado del ${nominal})` : ""}`,
                fuente: "Ley 27.399 art. 6",
                verificado: false,
                notas: "Traslado computado por la regla general — CONFIRMAR contra el decreto anual de feriados.",
            });
        }

        // Feria judicial de enero (mes completo).
        for (let d = `${y}-01-01`; d <= `${y}-01-31`; d = addDays(d, 1)) {
            put(d, {
                tipo: "feria_enero",
                descripcion: "Feria judicial de verano",
                fuente: "RJN — feria de enero",
                verificado: true,
            });
        }
    }

    // Feria judicial de julio — rangos estimados (2 semanas típicas, lunes a
    // viernes de la 2ª quincena). La acordada CSJN de cada año fija el rango
    // real → verificado: false SIEMPRE hasta confirmar.
    const feriasJulio = {
        2024: ["2024-07-15", "2024-07-26"],
        2025: ["2025-07-14", "2025-07-25"],
        2026: ["2026-07-13", "2026-07-24"],
        2027: ["2027-07-12", "2027-07-23"],
    };
    for (const [y, [desde, hasta]] of Object.entries(feriasJulio)) {
        for (let d = desde; d <= hasta; d = addDays(d, 1)) {
            put(d, {
                tipo: "feria_julio",
                descripcion: `Feria judicial de invierno ${y}`,
                fuente: "Acordada CSJN (anual)",
                verificado: false,
                notas: "Rango ESTIMADO — confirmar contra la acordada de feria de la CSJN del año.",
            });
        }
    }

    // Puentes turísticos conocidos (decretos anuales).
    const puentes = [
        ["2024-04-01", "Puente turístico"],
        ["2024-06-21", "Puente turístico"],
        ["2024-10-11", "Puente turístico"],
        ["2025-05-02", "Puente turístico"],
        ["2025-08-15", "Puente turístico"],
        ["2025-11-21", "Puente turístico"],
    ];
    for (const [fecha, descripcion] of puentes) {
        put(fecha, {
            tipo: "puente_turistico",
            descripcion,
            fuente: "Decreto anual de feriados con fines turísticos",
            verificado: false,
            notas: "CONFIRMAR contra el decreto del año.",
        });
    }

    return map;
}

// ---------------------------------------------------------------------------
module.exports = { buildEntries, pascua, trasladar };
if (require.main !== module) return;

(async () => {
    const entries = buildEntries();
    // Sanity: todas las fechas bien formadas.
    for (const fecha of entries.keys()) toDay(fecha);

    await mongoose.connect(URI);
    let upserts = 0;
    let inserts = 0;

    for (const e of entries.values()) {
        const res = await FeriadoJudicial.updateOne(
            { _id: FeriadoJudicial.makeId(e.fecha, e.ambito) },
            {
                $set: { fecha: e.fecha, ambito: e.ambito, tipo: e.tipo, descripcion: e.descripcion, fuente: e.fuente },
                // Ediciones manuales (verificado/habilitado/notas) sobreviven re-seeds.
                $setOnInsert: { verificado: e.verificado, habilitado: true, notas: e.notas || "" },
            },
            { upsert: true }
        );
        upserts++;
        if (res.upsertedCount) inserts++;
    }

    const pendientes = await FeriadoJudicial.countDocuments({ verificado: false, habilitado: true });
    const target = /mongodb\+srv|(?!.*(localhost|127\.0\.0\.1))/.test(URI) && !/localhost|127\.0\.0\.1/.test(URI) ? "ATLAS/REMOTO" : "LOCAL";
    console.log(`feriados-judiciales: ${upserts} docs procesados (${inserts} nuevos) en ${target} [años ${YEARS[0]}–${YEARS[YEARS.length - 1]}]`);
    if (pendientes) {
        console.warn(`⚠️  ${pendientes} días con verificado:false (feria de julio, traslados, puentes).`);
        console.warn("   Confirmarlos contra decreto/acordada antes de confiar plazos que los atraviesen.");
        console.warn("   Nota: los puentes turísticos 2026/2027 NO están sembrados — cargarlos cuando salga el decreto.");
    }
    await mongoose.disconnect();
})().catch((e) => {
    console.error("FATAL:", e);
    process.exit(1);
});
