/**
 * plazos-normativa.js — Clasificador del acto notificado contra las reglas
 * de plazo subsidiario (colección plazos-normativa, modelo PlazoNormativa).
 *
 * Puro y mongoose-agnóstico: recibe las reglas como array plano (lean) y el
 * texto/detalle de la cédula; devuelve la primera regla que matchea
 * (first-match-wins por el orden recibido — getReglas() ya ordena por
 * prioridad ascendente).
 *
 * El resultado incluye el patrón y el snippet que matchearon — la UI debe
 * poder mostrar SIEMPRE por qué se aplicó esa regla.
 *
 * Tipo de proceso (P21): una regla con `tipoProceso` ('ordinario' | 'sumario',
 * sumario = sumarísimo) solo aplica a causas de ese tipo. Si el acto matchea
 * una regla con tipo y la causa no tiene tipo conocido, el resultado es
 * `{ requiereTipoProceso: true, ... }` sin plazo: no se propone vencimiento.
 *
 * P22: `excluye` descarta apariciones cuyo contexto no es el acto (se busca la
 * siguiente aparición del mismo patrón) y `proponeVencimiento: false` reconoce
 * el acto sin proponer vencimiento (`{ sinVencimiento: true, ... }`: revisión
 * manual).
 */

// Misma normalización que el extractor de plazos expresos: mayúsculas, sin
// tildes, espacios colapsados. Los matchers se escriben contra esta forma.
function norm(text) {
    return (text || "")
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .toUpperCase()
        .replace(/\s+/g, " ");
}

function compile(pattern) {
    try {
        return new RegExp(pattern);
    } catch (_) {
        return null; // regla mal escrita en Mongo — se ignora, no rompe
    }
}

const MAX_APARICIONES = 50;

// Oración donde está la aparición (entre puntos seguidos de espacio, para no
// cortar en "122.336" o "art. 94"; hasta 160 caracteres a cada lado): es el
// contexto contra el que se prueban las exclusiones.
function oracion(texto, i, largo) {
    const antes = texto.slice(Math.max(0, i - 160), i);
    const corteAntes = antes.lastIndexOf(". ");
    const desde = corteAntes === -1 ? Math.max(0, i - 160) : i - antes.length + corteAntes + 2;
    const despues = texto.slice(i + largo, i + largo + 160);
    const corteDespues = despues.indexOf(". ");
    return texto.slice(desde, corteDespues === -1 ? i + largo + despues.length : i + largo + corteDespues);
}

function testMatchers(patterns, texto, excluye = []) {
    const excl = (excluye || []).map(compile).filter(Boolean);
    for (const p of patterns || []) {
        const base = compile(p);
        if (!base) continue;
        // Sin exclusiones alcanza con la primera aparición; con exclusiones se
        // recorren las apariciones hasta una cuyo contexto no esté excluido.
        const re = new RegExp(base.source, base.flags.includes("g") ? base.flags : base.flags + "g");
        let m;
        let vueltas = 0;
        while ((m = re.exec(texto)) && vueltas++ < MAX_APARICIONES) {
            const start = Math.max(0, m.index - 80);
            const snippet = texto.slice(start, m.index + m[0].length + 80).trim();
            if (!excl.length || !excl.some((x) => x.test(oracion(texto, m.index, m[0].length)))) return { pattern: p, snippet };
            if (m[0].length === 0) re.lastIndex++;
        }
    }
    return null;
}

// ¿La regla aplica al objeto de la causa? '*' = todos. Si la regla es
// específica de objeto y la causa no tiene objeto conocido, NO aplica
// (mejor caer en una regla genérica que aplicar mal una específica).
function matchObjeto(reglaObjetos, objetoNorm) {
    const objetos = reglaObjetos && reglaObjetos.length ? reglaObjetos : ["*"];
    if (objetos.includes("*")) return true;
    if (!objetoNorm) return false;
    return objetos.some((p) => {
        const re = compile(p);
        return re && re.test(objetoNorm);
    });
}

/**
 * @param {Array} reglas — docs lean de PlazoNormativa (orden = prioridad asc)
 * @param {Object} input
 * @param {string} [input.texto] — texto de la cédula (crudo; se normaliza acá)
 * @param {string} [input.detalle] — detalle del movimiento (crudo)
 * @param {string} input.fuero — CIV | CSS | CNT | COM | ...
 * @param {string} [input.objeto] — objeto del juicio de la causa (crudo)
 * @param {string} [input.tipoProceso] — 'ordinario' | 'sumario' | null (desconocido)
 * @returns {Object|null} — { clave, acto, label, plazoDias, tipoPlazo, norma,
 *   tipoProceso, matchedPattern, matchedIn: 'texto'|'detalle', snippet, verificado }
 *   | { requiereTipoProceso: true, clave, acto, label, plazoDias: null, ... }
 *   | { sinVencimiento: true, clave, acto, label, plazoDias: null, ... } | null
 */
function clasificarActo(reglas, { texto, detalle, fuero, objeto, tipoProceso = null }) {
    const t = texto ? norm(texto) : null;
    const d = detalle ? norm(detalle) : null;
    const o = objeto ? norm(objeto) : null;

    for (const r of reglas || []) {
        if (!r || r.habilitado === false) continue;
        const fueros = r.fuero && r.fuero.length ? r.fuero : ["*"];
        if (!fueros.includes("*") && !fueros.includes(fuero)) continue;
        if (!matchObjeto(r.objetos, o)) continue;
        // Variante de otro tipo de proceso que el de la causa: no aplica.
        if (r.tipoProceso && tipoProceso && r.tipoProceso !== tipoProceso) continue;

        let hit = null;
        let matchedIn = null;
        if (t && r.matchers && r.matchers.length) {
            hit = testMatchers(r.matchers, t, r.excluye);
            if (hit) matchedIn = "texto";
        }
        if (!hit && d && r.matchersDetalle && r.matchersDetalle.length) {
            hit = testMatchers(r.matchersDetalle, d, r.excluye);
            if (hit) matchedIn = "detalle";
        }
        if (hit && r.tipoProceso && !tipoProceso) {
            // El plazo depende del tipo de proceso y la causa no lo tiene.
            return {
                requiereTipoProceso: true,
                clave: r._id,
                acto: r.acto,
                label: r.label,
                plazoDias: null,
                tipoPlazo: r.tipoPlazo || "habiles",
                norma: r.norma,
                verificado: false,
                matchedPattern: hit.pattern,
                matchedIn,
                snippet: hit.snippet,
            };
        }
        if (hit && r.proponeVencimiento === false) {
            // Acto reconocido, sin plazo identificable: revisión manual.
            return {
                sinVencimiento: true,
                clave: r._id,
                acto: r.acto,
                label: r.label,
                plazoDias: null,
                tipoPlazo: r.tipoPlazo || "habiles",
                norma: r.norma,
                verificado: r.verificado === true,
                matchedPattern: hit.pattern,
                matchedIn,
                snippet: hit.snippet,
            };
        }
        if (hit) {
            return {
                clave: r._id,
                acto: r.acto,
                label: r.label,
                plazoDias: r.plazoDias,
                tipoPlazo: r.tipoPlazo || "habiles",
                norma: r.norma,
                tipoProceso: r.tipoProceso || null,
                verificado: r.verificado === true,
                matchedPattern: hit.pattern,
                matchedIn,
                snippet: hit.snippet,
            };
        }
    }
    return null;
}

module.exports = { clasificarActo, _norm: norm };
