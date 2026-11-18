const test = require("node:test");
const assert = require("node:assert");
const { canonizarSufijo, esEscrito, parseExpedienteCelda, normalizarIncidente } = require("../src/utils/incidente-sufijo");

test("canonizarSufijo: numéricos sin ceros, alfanuméricos en mayúsculas", () => {
    assert.strictEqual(canonizarSufijo("073/1"), "73/1");
    assert.strictEqual(canonizarSufijo("TO01/33/1/1/1"), "TO01/33/1/1/1");
    assert.strictEqual(canonizarSufijo("to01"), "TO01");
    assert.strictEqual(canonizarSufijo("CA001"), "CA001");
    assert.strictEqual(canonizarSufijo("1/"), "1");
    assert.strictEqual(canonizarSufijo("2/ES01"), "2/ES01");
});

test("canonizarSufijo: principal y formas inválidas → null", () => {
    for (const v of [null, undefined, "", "  ", "-00", "/", "A-B", "TO01/x.y", "ABCDEF1"]) {
        assert.strictEqual(canonizarSufijo(v), null, String(v));
    }
});

test("normalizarIncidente no cambia (solo numerados)", () => {
    assert.strictEqual(normalizarIncidente("TO01"), null);
    assert.strictEqual(normalizarIncidente("01/2"), "1/2");
});

test("esEscrito: último tramo ESnn", () => {
    assert.strictEqual(esEscrito("2/ES01"), true);
    assert.strictEqual(esEscrito("TO01/33/1/1/7/ES01"), true);
    assert.strictEqual(esEscrito("TO01/33"), false);
    assert.strictEqual(esEscrito(null), false);
});

test("parseExpedienteCelda: -00 de la CSJ es el principal", () => {
    const p = parseExpedienteCelda("CSJ 000146/2025-00");
    assert.deepStrictEqual(p, { fuero: "CSJ", number: 146, year: 2025, sufijo: null, incidente: null, canonico: null });
});

test("parseExpedienteCelda: legajos penales con canonico", () => {
    const p = parseExpedienteCelda("CFP 012446/2008/TO01/33/1/1/1");
    assert.strictEqual(p.number, 12446);
    assert.strictEqual(p.year, 2008);
    assert.strictEqual(p.incidente, null);
    assert.strictEqual(p.canonico, "TO01/33/1/1/1");
    assert.strictEqual(parseExpedienteCelda("CFP 012446/2008/73/1").canonico, "73/1");
    assert.strictEqual(parseExpedienteCelda("COM 023063/2015/1").incidente, "1");
});
