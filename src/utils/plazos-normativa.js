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

function testMatchers(patterns, texto) {
    for (const p of patterns || []) {
        const re = compile(p);
        if (!re) continue;
        const m = re.exec(texto);
        if (m) {
            const start = Math.max(0, m.index - 80);
            return { pattern: p, snippet: texto.slice(start, m.index + m[0].length + 80).trim() };
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
 * @returns {Object|null} — { clave, acto, label, plazoDias, tipoPlazo, norma,
 *   matchedPattern, matchedIn: 'texto'|'detalle', snippet, verificado } | null
 */
function clasificarActo(reglas, { texto, detalle, fuero, objeto }) {
    const t = texto ? norm(texto) : null;
    const d = detalle ? norm(detalle) : null;
    const o = objeto ? norm(objeto) : null;

    for (const r of reglas || []) {
        if (!r || r.habilitado === false) continue;
        const fueros = r.fuero && r.fuero.length ? r.fuero : ["*"];
        if (!fueros.includes("*") && !fueros.includes(fuero)) continue;
        if (!matchObjeto(r.objetos, o)) continue;

        let hit = null;
        let matchedIn = null;
        if (t && r.matchers && r.matchers.length) {
            hit = testMatchers(r.matchers, t);
            if (hit) matchedIn = "texto";
        }
        if (!hit && d && r.matchersDetalle && r.matchersDetalle.length) {
            hit = testMatchers(r.matchersDetalle, d);
            if (hit) matchedIn = "detalle";
        }
        if (hit) {
            return {
                clave: r._id,
                acto: r.acto,
                label: r.label,
                plazoDias: r.plazoDias,
                tipoPlazo: r.tipoPlazo || "habiles",
                norma: r.norma,
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
