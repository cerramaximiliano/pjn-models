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

ok("traslado de demanda CSS → 60 días (Estado/ANSES, regla empírica)", () => {
    const r = clasificarActo(reglas, { texto: "traslado de la demanda", fuero: "CSS" });
    assert.strictEqual(r.clave, "traslado_demanda_estado_css");
    assert.strictEqual(r.plazoDias, 60);
});

ok("variante real CSS: 'DE LA DEMANDA..., CONFIERO TRASLADO'", () => {
    const r = clasificarActo(reglas, {
        texto: "De la demanda, de la prueba documental digitalizada y de su ampliación (si la hubiere), confiero traslado a la demandada.",
        fuero: "CSS",
    });
    assert.strictEqual(r.clave, "traslado_demanda_estado_css");
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

ok("mención incidental de traslado NO matchea (endurecido)", () => {
    const r = clasificarActo(reglas, { texto: "a cuyo traslado conferido de fs. 145 adhirió la parte demandada", fuero: "CIV" });
    assert.strictEqual(r, null);
});

ok("acto de conferir traslado SÍ matchea: 'córrase traslado a la actora'", () => {
    const r = clasificarActo(reglas, { texto: "Córrase traslado a la parte actora del informe pericial.", fuero: "CIV" });
    assert.strictEqual(r.clave, "traslado_generico");
    assert.strictEqual(r.plazoDias, 5);
});

ok("vista laboral → 3 días art. 54 LO (validado contra t.o.)", () => {
    const r = clasificarActo(reglas, { texto: "Dese vista a la parte actora de la liquidación practicada.", fuero: "CNT" });
    assert.strictEqual(r.clave, "traslado_vista_cnt");
    assert.strictEqual(r.plazoDias, 3);
});

ok("catch-all NOTIFIQUESE: resolución sin acto reconocible → 5 días", () => {
    const r = clasificarActo(reglas, { texto: "Téngase presente lo manifestado. Regístrese y NOTIFÍQUESE.", fuero: "CIV" });
    assert.strictEqual(r.clave, "resolucion_notificada");
    assert.strictEqual(r.plazoDias, 5);
});

ok("catch-all NOTIFIQUESE laboral → 3 días art. 54", () => {
    const r = clasificarActo(reglas, { texto: "Téngase presente. Notifíquese.", fuero: "CNT" });
    assert.strictEqual(r.clave, "resolucion_notificada_cnt");
    assert.strictEqual(r.plazoDias, 3);
});

ok("sentencia definitiva CNT le gana al catch-all aunque diga notifíquese", () => {
    const r = clasificarActo(reglas, { texto: "Se dicta SENTENCIA DEFINITIVA. Regístrese y notifíquese.", fuero: "CNT" });
    assert.strictEqual(r.clave, "apelacion_sentencia_definitiva_cnt");
    assert.strictEqual(r.plazoDias, 6);
});

ok("regla específica de objeto solo aplica si el objeto matchea", () => {
    const conObjeto = [
        { _id: "amparo_especial", fuero: ["*"], objetos: ["AMPARO"], matchers: ["NOTIFIQUESE"], plazoDias: 3, norma: "x", prioridad: 1 },
        ...reglas,
    ];
    const enAmparo = clasificarActo(conObjeto, { texto: "Notifíquese.", fuero: "CIV", objeto: "ACCION DE AMPARO" });
    assert.strictEqual(enAmparo.clave, "amparo_especial");
    const enDanios = clasificarActo(conObjeto, { texto: "Notifíquese.", fuero: "CIV", objeto: "DAÑOS Y PERJUICIOS" });
    assert.strictEqual(enDanios.clave, "resolucion_notificada");
    // Sin objeto conocido, la regla específica NO aplica (cae en genérica).
    const sinObjeto = clasificarActo(conObjeto, { texto: "Notifíquese.", fuero: "CIV" });
    assert.strictEqual(sinObjeto.clave, "resolucion_notificada");
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
