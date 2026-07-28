/**
 * test-plazos-normativa.js — Regresión del clasificador de acto notificado
 * contra las reglas del seed (first-match-wins por prioridad).
 * Uso: node scripts/test-plazos-normativa.js  (exit 0 = OK)
 */
const assert = require("assert");
const { clasificarActo } = require("../src/utils/plazos-normativa");
const { REGLAS } = require("./maintenance/seed-plazos-normativa");

// Simular el orden de getReglas(): prioridad ascendente.
const reglas = [...REGLAS].sort((a, b) => a.prioridad - b.prioridad);

let n = 0;
const ok = (name, fn) => {
    fn();
    n++;
    console.log(`  ✓ ${name}`);
};

ok("sentencia definitiva CIV → apelación 5 días art. 244", () => {
    const r = clasificarActo(reglas, { texto: "Se notifica la SENTENCIA DEFINITIVA dictada en autos.", fuero: "CIV" });
    assert.strictEqual(r.clave, "apelacion_sentencia_definitiva");
    assert.strictEqual(r.plazoDias, 5);
});

ok("sentencia definitiva CNT → regla laboral 6 días (prioridad)", () => {
    const r = clasificarActo(reglas, { texto: "se notifica la sentencia definitiva", fuero: "CNT" });
    assert.strictEqual(r.clave, "apelacion_sentencia_definitiva_cnt");
    assert.strictEqual(r.plazoDias, 6);
});

ok("traslado de demanda CIV → 15 días art. 338 (le gana al traslado genérico)", () => {
    const r = clasificarActo(reglas, { texto: "Córrase TRASLADO DE LA DEMANDA por el término de ley.", fuero: "CIV" });
    assert.strictEqual(r.clave, "traslado_demanda_ordinario");
    assert.strictEqual(r.plazoDias, 15);
});

ok("traslado de demanda CSS → cae en traslado genérico (338 es CIV/COM)", () => {
    const r = clasificarActo(reglas, { texto: "traslado de la demanda", fuero: "CSS" });
    assert.strictEqual(r.clave, "traslado_generico");
});

ok("traslado del REX → 10 días art. 257", () => {
    const r = clasificarActo(reglas, { texto: "córrese traslado del recurso extraordinario interpuesto", fuero: "CSS" });
    assert.strictEqual(r.clave, "traslado_recurso_extraordinario");
    assert.strictEqual(r.plazoDias, 10);
});

ok("clasificación por detalle sin texto (doc no_url)", () => {
    const r = clasificarActo(reglas, { texto: null, detalle: "FIRMA DESPACHO - SENTENCIA INTERLOCUTORIA", fuero: "CIV" });
    assert.strictEqual(r.clave, "apelacion_interlocutoria");
    assert.strictEqual(r.matchedIn, "detalle");
});

ok("texto sin acto reconocible → null", () => {
    const r = clasificarActo(reglas, { texto: "Se deja constancia de la agregación del escrito.", fuero: "CIV" });
    assert.strictEqual(r, null);
});

ok("regla con regex inválida no rompe", () => {
    const rotas = [{ _id: "rota", fuero: ["*"], matchers: ["([inval"], plazoDias: 5, norma: "x", prioridad: 1 }, ...reglas];
    const r = clasificarActo(rotas, { texto: "sentencia definitiva", fuero: "CIV" });
    assert.strictEqual(r.clave, "apelacion_sentencia_definitiva");
});

ok("fundamento presente: patrón + snippet", () => {
    const r = clasificarActo(reglas, { texto: "Notifíquese la sentencia definitiva a las partes.", fuero: "CIV" });
    assert.ok(r.matchedPattern && r.snippet.includes("SENTENCIA DEFINITIVA"));
});

console.log(`\nplazos-normativa: ${n} tests OK`);
