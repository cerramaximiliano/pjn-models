/**
 * test-dias-habiles.js — Tests de regresión de la lib de cómputo de plazos.
 * Casos verificados a mano contra el calendario 2025/2026.
 * Uso: node scripts/test-dias-habiles.js  (exit 0 = OK)
 */
const assert = require("assert");
const dh = require("../src/utils/dias-habiles");

let n = 0;
const ok = (name, fn) => {
    fn();
    n++;
    console.log(`  ✓ ${name}`);
};

// --- Normalización ----------------------------------------------------------
ok("toDay: Date medianoche UTC → día calendario", () => {
    assert.strictEqual(dh.toDay(new Date("2026-03-20T00:00:00Z")), "2026-03-20");
});
ok("toDayART: instante 02:30Z → día anterior argentino", () => {
    assert.strictEqual(dh.toDayART(new Date("2026-03-20T02:30:00Z")), "2026-03-19");
    assert.strictEqual(dh.toDayART(new Date("2026-03-20T12:00:00Z")), "2026-03-20");
});
ok("toDay: string inválido lanza", () => {
    assert.throws(() => dh.toDay("20/03/2026"), TypeError);
});

// --- Hábiles básicos --------------------------------------------------------
const FERIADOS_MAR = new Set(["2026-03-24"]); // martes, feriado nacional
ok("esHabil: finde y feriado son inhábiles", () => {
    assert.strictEqual(dh.esHabil("2026-03-21", FERIADOS_MAR), false); // sábado
    assert.strictEqual(dh.esHabil("2026-03-22", FERIADOS_MAR), false); // domingo
    assert.strictEqual(dh.esHabil("2026-03-24", FERIADOS_MAR), false); // feriado
    assert.strictEqual(dh.esHabil("2026-03-23", FERIADOS_MAR), true); // lunes
});
ok("siguienteHabil: viernes → lunes; lunes pre-feriado → miércoles", () => {
    assert.strictEqual(dh.siguienteHabil("2026-03-20", FERIADOS_MAR), "2026-03-23");
    assert.strictEqual(dh.siguienteHabil("2026-03-23", FERIADOS_MAR), "2026-03-25");
});
ok("addDiasHabiles: 5 hábiles desde viernes con feriado en el medio", () => {
    // vie 20 → lun 23 (1), mié 25 (2), jue 26 (3), vie 27 (4), lun 30 (5)
    assert.strictEqual(dh.addDiasHabiles("2026-03-20", 5, FERIADOS_MAR), "2026-03-30");
});
ok("habilesEntre: (vie 20, lun 30] = 5 hábiles", () => {
    assert.strictEqual(dh.habilesEntre("2026-03-20", "2026-03-30", FERIADOS_MAR), 5);
});

// --- Vencimiento en días hábiles -------------------------------------------
ok("computarVencimiento: notif viernes, 5 hábiles, feriado intermedio", () => {
    const r = dh.computarVencimiento({
        fechaNotificacion: "2026-03-20", // viernes
        plazoDias: 5,
        feriados: FERIADOS_MAR,
    });
    assert.strictEqual(r.perfeccionamiento, "2026-03-20"); // hábil: queda
    assert.strictEqual(r.inicioPlazo, "2026-03-23");
    assert.strictEqual(r.vencimiento, "2026-03-30");
    assert.strictEqual(r.vencimientoConGracia, "2026-03-31");
    assert.deepStrictEqual(r.diasComputados, ["2026-03-23", "2026-03-25", "2026-03-26", "2026-03-27", "2026-03-30"]);
    assert.deepStrictEqual(r.feriadosAplicados, ["2026-03-24"]);
    assert.strictEqual(r.version, dh.VERSION);
});
ok("computarVencimiento: notificación en sábado perfecciona el lunes", () => {
    const r = dh.computarVencimiento({
        fechaNotificacion: "2026-03-21", // sábado
        plazoDias: 3,
        feriados: FERIADOS_MAR,
    });
    assert.strictEqual(r.perfeccionamiento, "2026-03-23"); // lunes
    // mar 24 feriado → mié 25 (1), jue 26 (2), vie 27 (3)
    assert.strictEqual(r.vencimiento, "2026-03-27");
    assert.strictEqual(r.vencimientoConGracia, "2026-03-30");
});
ok("computarVencimiento: acepta Date como input", () => {
    const r = dh.computarVencimiento({
        fechaNotificacion: new Date("2026-03-20T00:00:00Z"),
        plazoDias: 5,
        feriados: FERIADOS_MAR,
    });
    assert.strictEqual(r.vencimiento, "2026-03-30");
});

// --- Vencimiento en días corridos ------------------------------------------
ok("corridos: vence en sábado → prorroga al lunes hábil", () => {
    const r = dh.computarVencimiento({
        fechaNotificacion: "2026-06-03", // miércoles
        plazoDias: 10,
        tipoPlazo: "corridos",
    });
    // 3/6 + 10 = 13/6 (sábado) → lunes 15/6
    assert.strictEqual(r.vencimiento, "2026-06-15");
    assert.strictEqual(r.prorrogado, true);
    assert.strictEqual(r.diasComputados, null);
});
ok("corridos: vence en hábil → sin prórroga", () => {
    const r = dh.computarVencimiento({
        fechaNotificacion: "2026-06-05", // viernes
        plazoDias: 10,
        tipoPlazo: "corridos",
    });
    assert.strictEqual(r.vencimiento, "2026-06-15"); // lunes
    assert.strictEqual(r.prorrogado, false);
});

// --- Feria de enero ---------------------------------------------------------
ok("feria enero: plazo que atraviesa la feria salta al 1/2", () => {
    const feriados = new Set(["2025-12-25", "2026-01-01"]);
    for (let d = "2026-01-01"; d <= "2026-01-31"; d = dh.addDays(d, 1)) feriados.add(d);
    const r = dh.computarVencimiento({
        fechaNotificacion: "2025-12-29", // lunes
        plazoDias: 3,
        feriados,
    });
    // mar 30 (1), mié 31 (2), feria enero completa, dom 1/2 → lun 2/2 (3)
    assert.strictEqual(r.vencimiento, "2026-02-02");
    assert.deepStrictEqual(r.diasComputados, ["2025-12-30", "2025-12-31", "2026-02-02"]);
});

// --- Validaciones -----------------------------------------------------------
ok("plazoDias inválido lanza", () => {
    assert.throws(() => dh.computarVencimiento({ fechaNotificacion: "2026-03-20", plazoDias: 0 }), TypeError);
    assert.throws(() => dh.computarVencimiento({ fechaNotificacion: "2026-03-20", plazoDias: 5.5 }), TypeError);
});
ok("tipoPlazo inválido lanza", () => {
    assert.throws(
        () => dh.computarVencimiento({ fechaNotificacion: "2026-03-20", plazoDias: 5, tipoPlazo: "lunas" }),
        TypeError
    );
});

console.log(`\ndias-habiles v${dh.VERSION}: ${n} tests OK`);
