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
 * NO cuentan (planteos, rechazos, avisos): SOLICITA/PIDE/MANIFIESTA/CONTESTA/PLANTEO ACUMULACION,
 * RECHAZA/DESESTIMA ACUMULACION, DESACUMULACION, CONEXIDAD INFORMATIVA/DETECTADA, READJUDICACION
 * POR NO EXISTIR CONEXIDAD, cualquier ESCRITO (las partes no deciden) y los sustantivos sueltos
 * ("FIRMA DESPACHO | ACUMULACION", "ACUMULACION POR CONEXIDAD", "CONSTANCIA/REGISTRO DE
 * ACUMULACION"): no dicen si se decidió.
 *
 * Relevamiento rs0 29-09 (scripts/acumulacion/explorar-acumulaciones.js de pjn-workers-scraping):
 * "EVENTO | ACUMULA LA CAUSA A OTRA" está en 26.003 causas (casi todas CNT) y CIERRA la historia de
 * la causa absorbida (mediana 1 movimiento posterior; 12.681 sin ninguno).
 */

const normalizar = (t) => String(t || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toUpperCase().replace(/\s+/g, " ").trim();

// Planteos/rechazos: la palabra tiene que referirse a la acumulación ("CONTESTA ACUMULACION",
// "PEDIDO DE ACUMULACION"), no a otra cosa del mismo despacho ("POR CONTESTADOS LOS
// AGRAVIOS. ACUMULA AL EXPT…" sí es decisión efectiva).
const EXCLUIR = /\b(?:SOLICIT\w*|MANIFIEST\w*|CONTEST\w*|PLANTEO|PLANTEA|PEDIDO|PIDE|RECHAZ\w*|DESESTIM\w*|REQUERIMIENTO|BUSQUEDA)\s+(?:(?:SOBRE|DE|DEL|LA|EL|POR|CAUSA|PARA)\s+){0,2}(?:DES)?ACUMUL|DESACUMUL|NO EXISTIR|INFORMATIV|DETECTAD|SE RESUELVA/;
// Las partes no deciden: sus escritos nunca son la decisión de acumular.
const TIPO_ESCRITO = /^ESCRITO\b/;

const EFECTIVA = [
  // Evento del sistema de gestión (la señal más limpia).
  { re: /^ACUMULA LA CAUSA A OTRA\b/, tipos: /^EVENTO$/, clase: "evento" },
  // Comercial: mismo evento con otra redacción (675 causas en el rs0, 29-09).
  { re: /^ACUMULACION JURIDICA A OTRA\b/, tipos: /^EVENTO$/, clase: "evento" },
  { re: /\bACUMULACION DE ACCIONES\b/, tipos: /^(CAMBIO DE ESTADO DE EXPEDIENTE|MOVIMIENTO)$/, clase: "cambio_estado" },
  { re: /\bINTEGRACION DE LITIS - ACUMULADOR\b/, tipos: /^CAMBIO DE ESTADO DE EXPEDIENTE$/, clase: "cambio_estado" },
  // Despachos que la ordenan o la resuelven.
  { re: /\bORDENA (EFECTIVIZAR (LA )?)?ACUMUL/, tipos: null, clase: "despacho" },
  { re: /\b(SE )?RESUELVE (LA )?ACUMULACION\b/, tipos: null, clase: "despacho" },
  { re: /\bACUMULA AL (EXPT|EXPTE|EXPEDIENTE|PRINCIPAL)\b/, tipos: null, clase: "despacho" },
  { re: /\bSE AGREGA AL PRINCIPAL\b/, tipos: null, clase: "despacho" },
  // Variantes relevadas en el rs0 (29-09): "ACUMULA A CAUSA #/#", "ACUMULADO A EXPTE.",
  // "SE ACUMULA AL EXPEDIENTE", "ACUMULESE", "DISPONE ACUMULACION", "HACE SABER ACUMULACION DE LA
  // PRESENTE CAUSA…", "ACUMULACION EFECTIVA", "ACUMULA CAUSA N° #/#".
  { re: /\bACUMULAD[OA]S? (A|AL|CON) (LA |EL )?(CAUSA|EXPTE|EXPEDIENTE|EXP|AUTOS|PRINCIPAL)\b/, tipos: null, clase: "despacho" },
  { re: /\bACUMULAR? (A |AL |CON )?(LA |EL )?(CAUSA|EXPTE|EXPEDIENTE|EXP|AUTOS|PRINCIPAL|INCIDENTE)\b/, tipos: null, clase: "despacho" },
  { re: /\bSE ACUMULA\b/, tipos: null, clase: "despacho" },
  { re: /\bACUMULAD[OA]S? (A|AL) (N[°ºRO.]*\s*)?\d/, tipos: null, clase: "despacho" },
  { re: /\bACUMUL[EE]N?SE\b|\bACUMULENSE\b/, tipos: null, clase: "despacho" },
  { re: /\bDISPONE (LA )?ACUMULACION\b/, tipos: null, clase: "despacho" },
  { re: /\bHACE SABER (LA )?ACUMULACION\b/, tipos: null, clase: "despacho" },
  { re: /\bACUMULACION EFECTIVA\b/, tipos: null, clase: "despacho" },
];

// ── Rol y otra causa ────────────────────────────────────────────────────────────────
// Validado contra pares reales del rs0 (29-09): el ROL deducido del texto del despacho no es
// confiable (18 bien / 6 mal / 14 indeterminados de 38: "SE ACUMULA EL EXPEDIENTE X AL Y",
// "ACUMULA EXPTE X" se usan en las dos direcciones). Solo el EVENTO del sistema ("ACUMULA LA
// CAUSA A OTRA" / "ACUMULACION JURIDICA A OTRA") afirma el rol: marca a la ACUMULADA y cierra su
// historia. El NÚMERO de la otra causa sí es confiable (0 errores; en 8 pares cada una nombra a
// la otra) y sirve para vincularlas sin afirmar quién absorbió a quién.
const NUMEROS = /(\d{1,6})\s*\/\s*(\d{4})\b/g;

/**
 * Rol de ESTA causa (solo con el evento del sistema) y números de expediente que trae el texto.
 * `otra` = el primero; `otras` = todos ("SE ACUMULA EL EXPEDIENTE <propia> AL <otra>" nombra
 * primero a la propia: resumirAcumulacion elige el primero que no sea el propio).
 */
function rolYOtra(tipo, detalle, clase) {
  const otras = [...normalizar(detalle).matchAll(NUMEROS)].map((m) => ({ number: Number(m[1]), year: Number(m[2]) }));
  return { rol: clase === "evento" ? "acumulada" : null, otra: otras[0] || null, otras };
}

/**
 * @param {{tipo?:string, detalle?:string}} mov
 * @returns {null | {clase:'evento'|'cambio_estado'|'despacho'}}
 */
function clasificarMovimiento(mov) {
  if (!mov) return null;
  const tipo = normalizar(mov.tipo);
  const detalle = normalizar(mov.detalle);
  if (!detalle || EXCLUIR.test(detalle) || TIPO_ESCRITO.test(tipo)) return null;
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
    const { rol, otra, otras } = rolYOtra(m.tipo, m.detalle, c.clase);
    out.push({ fecha: f && !Number.isNaN(f.getTime()) ? f : null, tipo: m.tipo || null, detalle: m.detalle || null, url: m.url || null, clase: c.clase, rol, otra, otras });
  }
  return out.sort((a, b) => (b.fecha ? b.fecha.getTime() : 0) - (a.fecha ? a.fecha.getTime() : 0));
}

/**
 * Resumen para la causa `propia` ({number, year}): rol (el de la decisión más reciente que lo
 * tenga) y la otra causa (el número más reciente que no sea el propio, de cualquier fila
 * efectiva: el evento del sistema no trae número y el despacho del mismo día sí).
 */
function resumirAcumulacion(eventos, propia = {}) {
  if (!eventos || !eventos.length) return null;
  const esPropia = (o) => o && Number(o.number) === Number(propia.number) && Number(o.year) === Number(propia.year);
  const conRol = eventos.find((e) => e.rol);
  let otra = null;
  for (const e of eventos) {
    const cand = (e.otras && e.otras.length ? e.otras : e.otra ? [e.otra] : []).find((o) => !esPropia(o));
    if (cand) { otra = cand; break; }
  }
  return { decision: eventos[0], rol: conRol ? conRol.rol : null, otra };
}

module.exports = { detectarAcumulacion, clasificarMovimiento, rolYOtra, resumirAcumulacion };
