// node scripts/test-incidente-sufijo.js — sin DB
const assert = require("assert");
const { normalizarIncidente, esIncidenteNumerado, parseExpedienteCelda, esDeLaFamilia } = require("../src/utils/incidente-sufijo");
const P = { fuero: "COM", number: 23063, year: 2015 };
const casos = [
  ["1", "1"], ["42/2", "42/2"], ["1/", "1"], ["01", "1"], ["01/02", "1/2"], [" 3 ", "3"],
  ["CA001", null], ["TO01", null], ["", null], [null, null], [undefined, null], ["1/a", null], ["/1", null],
];
for (const [i, o] of casos) assert.strictEqual(normalizarIncidente(i), o, `normalizar(${JSON.stringify(i)})`);
assert.strictEqual(esIncidenteNumerado("42/2"), true); assert.strictEqual(esIncidenteNumerado("CA001"), false); assert.strictEqual(esIncidenteNumerado(null), false);

assert.deepStrictEqual(parseExpedienteCelda("COM 023063/2015/1"), { fuero: "COM", number: 23063, year: 2015, sufijo: "1", incidente: "1" });
assert.deepStrictEqual(parseExpedienteCelda("35258/2010/2"), { fuero: null, number: 35258, year: 2010, sufijo: "2", incidente: "2" });
assert.deepStrictEqual(parseExpedienteCelda("CSS 035258/2010/CA001"), { fuero: "CSS", number: 35258, year: 2010, sufijo: "CA001", incidente: null });
assert.deepStrictEqual(parseExpedienteCelda("COM 23063/2015"), { fuero: "COM", number: 23063, year: 2015, sufijo: null, incidente: null });
assert.deepStrictEqual(parseExpedienteCelda("COM 023063/2015/12/1"), { fuero: "COM", number: 23063, year: 2015, sufijo: "12/1", incidente: "12/1" });
assert.strictEqual(parseExpedienteCelda("Incidente Nº 1 - ..."), null);
assert.strictEqual(parseExpedienteCelda(""), null);

assert.strictEqual(esDeLaFamilia(parseExpedienteCelda("COM 023063/2015/1"), P), true);
assert.strictEqual(esDeLaFamilia(parseExpedienteCelda("023063/2015/1"), P), true);       // sin fuero en la celda
assert.strictEqual(esDeLaFamilia(parseExpedienteCelda("CIV 023063/2015/1"), P), false);   // otro fuero
assert.strictEqual(esDeLaFamilia(parseExpedienteCelda("COM 023064/2015/1"), P), false);   // otro número
assert.strictEqual(esDeLaFamilia(parseExpedienteCelda("COM 023063/2016/1"), P), false);   // otro año
assert.strictEqual(esDeLaFamilia(null, P), false);
console.log("test-incidente-sufijo: OK");
