"use strict";

/**
 * Detector de la DECISIÓN de acumular una causa (o un incidente) a otra, a partir de sus
 * movimientos del portal PJN.
 *
 * Por qué importa: al acumular, el portal puede REESCRIBIR la historia del expediente
 * acumulado (actuaciones que desaparecen y reaparecen como "DESPACHO/ESCRITO INCORPORADO"
 * con otra fecha; carátula renumerada). Caso real: CNT 6788/2026/1 (29-09-2026), evento
 * "ACUMULA LA CAUSA A OTRA" del 24/06 y las 15 actuaciones del 23/06 reaparecidas el 07/07.
 * pjn-workers usa este hito como guard del resync automático y lo registra en la causa.
 *
 * Solo la decisión EFECTIVA cuenta (relevado en Atlas 29-09 sobre los 4 fueros):
 *   EVENTO | ACUMULA LA CAUSA A OTRA                          (14 causas CNT)
 *   CAMBIO DE ESTADO DE EXPEDIENTE | ACUMULACION DE ACCIONES  (CIV)
 *   MOVIMIENTO | ACUMULACION DE ACCIONES                      (CIV)
 *   FIRMA DESPACHO | ORDENA ACUMULAR…, ORDENA EFECTIVIZAR ACUMULACION…, RESUELVE/SE RESUELVE
 *                    ACUMULACIÓN, …ACUMULA AL EXPT…, SE AGREGA AL PRINCIPAL
 * NO cuentan (planteos, rechazos, avisos): SOLICITA/MANIFIESTA/CONTESTA/PLANTEO ACUMULACION,
 * RECHAZA ACUMULACION, DESACUMULACION, CONEXIDAD INFORMATIVA/DETECTADA, READJUDICACION POR NO
 * EXISTIR CONEXIDAD.
 */

const normalizar = (t) => String(t || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toUpperCase().replace(/\s+/g, " ").trim();

// Planteos/rechazos: la palabra tiene que referirse a la acumulación ("CONTESTA ACUMULACION",
// "PEDIDO DE ACUMULACION"), no a otra cosa del mismo despacho ("POR CONTESTADOS LOS
// AGRAVIOS. ACUMULA AL EXPT…" sí es decisión efectiva).
const EXCLUIR = /\b(?:SOLICIT\w*|MANIFIEST\w*|CONTEST\w*|PLANTEO|PLANTEA|PEDIDO|RECHAZ\w*|REQUERIMIENTO)\s+(?:(?:SOBRE|DE|DEL|LA|EL|POR)\s+){0,2}(?:DES)?ACUMUL|DESACUMUL|NO EXISTIR|INFORMATIV|DETECTAD/;

const EFECTIVA = [
  // Evento del sistema de gestión (la señal más limpia).
  { re: /^ACUMULA LA CAUSA A OTRA\b/, tipos: /^EVENTO$/, clase: "evento" },
  { re: /\bACUMULACION DE ACCIONES\b/, tipos: /^(CAMBIO DE ESTADO DE EXPEDIENTE|MOVIMIENTO)$/, clase: "cambio_estado" },
  { re: /\bINTEGRACION DE LITIS - ACUMULADOR\b/, tipos: /^CAMBIO DE ESTADO DE EXPEDIENTE$/, clase: "cambio_estado" },
  // Despachos que la ordenan o la resuelven.
  { re: /\bORDENA (EFECTIVIZAR (LA )?)?ACUMUL/, tipos: null, clase: "despacho" },
  { re: /\b(SE )?RESUELVE (LA )?ACUMULACION\b/, tipos: null, clase: "despacho" },
  { re: /\bACUMULA AL (EXPT|EXPTE|EXPEDIENTE|PRINCIPAL)\b/, tipos: null, clase: "despacho" },
  { re: /\bSE AGREGA AL PRINCIPAL\b/, tipos: null, clase: "despacho" },
];

/**
 * @param {{tipo?:string, detalle?:string}} mov
 * @returns {null | {clase:'evento'|'cambio_estado'|'despacho'}}
 */
function clasificarMovimiento(mov) {
  if (!mov) return null;
  const tipo = normalizar(mov.tipo);
  const detalle = normalizar(mov.detalle);
  if (!detalle || EXCLUIR.test(detalle)) return null;
  for (const r of EFECTIVA) {
    if (r.tipos && !r.tipos.test(tipo)) continue;
    if (r.re.test(detalle)) return { clase: r.clase };
  }
  return null;
}

/**
 * Movimientos que registran la decisión efectiva de acumular, del más reciente al más viejo
 * (mismo orden que `movimiento[]`: fecha desc).
 * @param {Array<{fecha, tipo, detalle, url?}>} movs
 * @returns {Array<{fecha: Date|null, tipo, detalle, url, clase}>}
 */
function detectarAcumulacion(movs) {
  const out = [];
  for (const m of movs || []) {
    const c = clasificarMovimiento(m);
    if (!c) continue;
    const f = m.fecha ? new Date(m.fecha) : null;
    out.push({ fecha: f && !Number.isNaN(f.getTime()) ? f : null, tipo: m.tipo || null, detalle: m.detalle || null, url: m.url || null, clase: c.clase });
  }
  return out.sort((a, b) => (b.fecha ? b.fecha.getTime() : 0) - (a.fecha ? a.fecha.getTime() : 0));
}

module.exports = { detectarAcumulacion, clasificarMovimiento };
