"use strict";

/**
 * Identidad de incidentes PJN: un solo parser para el sufijo que llega desde
 * distintas fuentes con distinto formato.
 *
 *  - listado "Mis Causas" (pjn-mis-causas):  "1", "42/2", a veces "1/"
 *  - pestaña Vinculados del detalle público:  "COM 023063/2015/1", "35258/2010/2"
 *  - alta desde la UI (hub `expedientIncidente`): lo que tipee el usuario
 *
 * Forma canónica = la que guarda `incidente` en los causa-models: dígitos y
 * barras internas, sin ceros a la izquierda por tramo, sin barra final
 * ("1", "42/2"). Recursos de cámara ("CA001"), sufijos de etapa ("TO01") y
 * cualquier tramo no numérico NO son incidentes numerados → null.
 */

const CELDA_EXPEDIENTE = /^\s*(?:([A-Z]{2,5})\s*)?0*(\d+)\s*\/\s*(\d{4})(?:\s*\/\s*(\S+))?\s*$/;
const SUFIJO_NUMERADO = /^\d+(?:\/\d+)*\/?$/;

/** "01/2" → "1/2"; "1/" → "1"; "CA001" → null; "" → null. */
function normalizarIncidente(raw) {
    if (raw === null || raw === undefined) return null;
    const s = String(raw).trim();
    if (!s || !SUFIJO_NUMERADO.test(s)) return null;
    return s.split("/").filter(Boolean).map((t) => String(Number(t))).join("/");
}

/** true para la forma canónica o cualquier variante numérica ("1", "42/2", "1/", "01"). */
function esIncidenteNumerado(raw) {
    return normalizarIncidente(raw) !== null;
}

/**
 * Parsea la celda EXPEDIENTE de Vinculados (o un identificador completo).
 * "COM 023063/2015/1" → { fuero:'COM', number:23063, year:2015, sufijo:'1', incidente:'1' }
 * "35258/2010/CA001"  → { fuero:null, number:35258, year:2010, sufijo:'CA001', incidente:null }
 * "COM 23063/2015"    → { ..., sufijo:null, incidente:null }   (el principal)
 * Devuelve null si no tiene la forma número/año.
 */
function parseExpedienteCelda(celda) {
    const m = CELDA_EXPEDIENTE.exec(String(celda || ""));
    if (!m) return null;
    const sufijo = m[4] ? m[4].trim() : null;
    return {
        fuero: m[1] || null,
        number: Number(m[2]),
        year: Number(m[3]),
        sufijo,
        incidente: sufijo ? normalizarIncidente(sufijo) : null,
    };
}

/** La celda pertenece a la familia de {fuero, number, year} (mismo número y año; el fuero solo si viene). */
function esDeLaFamilia(parsed, principal) {
    if (!parsed || !principal) return false;
    if (parsed.number !== Number(principal.number) || parsed.year !== Number(principal.year)) return false;
    if (parsed.fuero && principal.fuero && parsed.fuero.toUpperCase() !== String(principal.fuero).toUpperCase()) return false;
    return true;
}

module.exports = { normalizarIncidente, esIncidenteNumerado, parseExpedienteCelda, esDeLaFamilia };
