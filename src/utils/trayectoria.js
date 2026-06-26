/**
 * trayectoria.js — Lógica compartida de organismos / trayectoria judicial de causas PJN.
 *
 * Reemplaza y consolida el parseo de organismos que estaba duplicado en cada
 * repo (parse-organizacion.js en pjn-mis-causas, scraping-common.js en
 * pjn-workers/pjn-workers-scraping). Único hogar de:
 *
 *   - parseOrganismo(texto): clasifica un texto de dependencia/organismo en
 *       { tipo: 'juzgado'|'camara'|'corte'|'otro', juzgado, secretaria, sala,
 *         vocalia, organismo, textoCompleto }.
 *   - buildTrayectoria(movimientos): recorre los movimientos cronológicamente y
 *       arma la TRAYECTORIA: un timeline de tramos (stints) por organismo, con
 *       fechas desde/hasta, soportando revisitas (juzgado→cámara→juzgado…) y
 *       marcando el tramo ACTUAL.
 *   - deriveLegacyFields(trayectoria): deriva los campos legacy (juzgado,
 *       secretaria, sala, vocalia, tipoOrganizacion, organizacionTextoCompleto,
 *       instanciaOrigen/Revisora/Extraordinaria) DESDE la trayectoria, para que
 *       los workers los sigan persistiendo (la UI todавía lee de ahí).
 *
 * Mongoose-agnóstico: opera sobre arrays/objetos planos.
 */

// Tipos de movimiento cuyo `detalle` ES el organismo donde está el expediente.
// El resto (escritos, oficios, notas) menciona OTROS organismos en texto libre
// y NO debe usarse para inferir la ubicación (lección del backfill 2026-06).
const TIPOS_PASE = /^(RECEPCION PASE|RECEPCION DE EXPEDIENTE|PASE|RADICACION|RADICACI[OÓ]N|ASIGNACION|ASIGNACI[OÓ]N|ELEVACION|ELEVACI[OÓ]N|REMISION|REMISI[OÓ]N|INICIO)/i;

// Palabras que indican un ESTADO (no un organismo) — para descartar pases cuyo
// detalle no es realmente un lugar.
const ES_ESTADO = /^(EN DESPACHO|EN LETRA|A DESPACHO|AUTOS|PARA RESOLVER|EN ESTUDIO|RESERVADO|PARALIZAD|SUSPENDID)/i;

// Palabra-clave del fuero PROPIO de la causa (para distinguir un juzgado/cámara
// del fuero de la causa de uno foráneo visitado por exhorto/oficio).
const FUERO_KEYWORD = {
  CSS: /SEGURIDAD\s+SOCIAL/i, SS: /SEGURIDAD\s+SOCIAL/i, SEGSOC: /SEGURIDAD\s+SOCIAL/i,
  CIV: /\bCIVIL\b/i, CNT: /\bTRABAJO\b/i, COM: /\bCOMERCIAL\b/i,
};
// Marcadores de cualquier fuero conocido: si el organismo trae uno que NO es el
// propio de la causa, es foráneo → 'otro' (no es el juzgado/cámara de la causa).
const ALGUN_FUERO = /SEGURIDAD\s+SOCIAL|\bCIVIL\b|\bTRABAJO\b|\bCOMERCIAL\b|CRIMINAL|CORRECCIONAL|\bPENAL\b|INSTRUCCI[OÓ]N|GARANT[IÍ]AS|\bFAMILIA\b|MENORES|EJECUCI[OÓ]N\s+FISCAL|TRIBUTARI/i;

// ¿El texto de un organismo pertenece al fuero de la causa? true si matchea el
// propio, o si no trae ningún marcador de fuero (ambiguo → se asume propio).
function esFueroPropio(texto, fuero) {
  if (!fuero) return true; // sin contexto de fuero, no filtramos
  const own = FUERO_KEYWORD[String(fuero).toUpperCase()];
  if (own && own.test(texto)) return true;
  if (ALGUN_FUERO.test(texto)) return false; // trae un fuero, pero no el propio → foráneo
  return true; // sin marcador de fuero → ambiguo, se asume propio
}

// Romanos → arábigos (para SALA III, etc.).
const ROMAN = { I: 1, V: 5, X: 10, L: 50, C: 100, D: 500, M: 1000 };
function romanToArabic(s) {
  s = String(s || '').toUpperCase().trim();
  if (!/^[IVXLCDM]+$/.test(s)) return parseInt(s, 10) || 0;
  let t = 0;
  for (let i = 0; i < s.length; i++) {
    const c = ROMAN[s[i]], n = ROMAN[s[i + 1]];
    t += n && c < n ? -c : c;
  }
  return t;
}
function toNum(v) {
  if (v == null) return 0;
  const s = String(v).trim();
  if (/^\d+$/.test(s)) return parseInt(s, 10);
  if (/^[IVXLCDM]+$/i.test(s)) return romanToArabic(s);
  const m = s.match(/\d+/);
  return m ? parseInt(m[0], 10) : 0;
}
function stripDesc(s) {
  return String(s || '').replace(/^\s*descripci[oó]n:\s*/i, '').trim();
}
// Último número 1..200 de un texto (el número del juzgado va al final del
// organismo; evita capturar el "1" de "1RA INSTANCIA" o años de fechas).
function lastNumberInRange(s) {
  const nums = (String(s).match(/\d{1,3}/g) || []).map((n) => parseInt(n, 10)).filter((n) => n >= 1 && n <= 200);
  return nums.length ? nums[nums.length - 1] : 0;
}

/**
 * Clasifica un texto de organismo. Devuelve null si el texto está vacío.
 * Se clasifica por la palabra-organismo con la que ARRANCA el texto (el portal
 * formatea la dependencia/pase con el tipo de organismo adelante).
 */
function parseOrganismo(textoRaw, fuero) {
  let txt = stripDesc(textoRaw);
  txt = txt.split('[')[0].trim(); // cortar "[Presentado dd/mm/yyyy]"
  if (!txt || ES_ESTADO.test(txt)) return null;

  const base = { juzgado: 0, secretaria: 0, sala: 0, vocalia: 0, organismo: txt.slice(0, 160), textoCompleto: txt.slice(0, 300) };

  // CORTE SUPREMA
  if (/^CORTE\s+SUPREMA/i.test(txt) || /CORTE\s+SUPREMA\s+DE\s+JUSTICIA/i.test(txt)) {
    const sec = txt.match(/SECRETAR[IÍ]A\s*(?:JUDICIAL\s*)?(?:N[°º]|NRO\.?|NÚM\.?)?\s*(\d{1,3})/i);
    return { ...base, tipo: 'corte', secretaria: sec ? parseInt(sec[1], 10) : 0 };
  }

  // CÁMARA / SALA → camara (sala + vocalía). Si es de otro fuero → 'otro'.
  if (/^C[AÁ]MARA/i.test(txt) || /^SALA\s+[IVXLCDM\d]/i.test(txt)) {
    if (!esFueroPropio(txt, fuero)) return { ...base, tipo: 'otro' };
    const m = txt.match(/SALA\s+([IVXLCDM]+|\d{1,3})(?:[^\d]*?VOCAL[IÍ]A[^\d]*?(\d{1,3}))?/i);
    return { ...base, tipo: 'camara', sala: m ? toNum(m[1]) : 0, vocalia: m && m[2] ? parseInt(m[2], 10) : 0 };
  }

  // JUZGADO → juzgado (+ secretaría). Si es de otro fuero (exhorto a un juzgado
  // criminal/civil/etc. ajeno) → 'otro'.
  if (/^JUZGADO\b/i.test(txt)) {
    if (/\bFERIA\b/i.test(txt)) return { ...base, tipo: 'otro' }; // juzgado de feria: sin número propio
    if (!esFueroPropio(txt, fuero)) return { ...base, tipo: 'otro' };
    const limpio = txt.replace(/\b\d+\s*(?:RA|DA|ER|TA|VA|MA)?\s*INSTANCIA/gi, ' ');
    const [juzPart, secPart] = limpio.split(/SECRETAR[IÍ]A/i);
    const juz = lastNumberInRange(juzPart);
    let sec = 0;
    if (secPart) { const sm = secPart.match(/\d{1,3}/); if (sm) sec = parseInt(sm[0], 10); }
    if (juz) return { ...base, tipo: 'juzgado', juzgado: juz, secretaria: sec };
    return { ...base, tipo: 'otro' };
  }

  // Otros organismos reconocibles (archivo, mesa, fiscalía, defensoría, tribunal,
  // oficina, ministerio…): se guardan como 'otro' con su texto completo.
  if (/^(ARCHIVO|MESA\s+DE\s+ENTRADA|FISCAL[IÍ]A|DEFENSOR[IÍ]A|TRIBUNAL|OFICINA|MINISTERIO|SECRETAR[IÍ]A|VOCAL[IÍ]A|JUZGADO)/i.test(txt)) {
    return { ...base, tipo: 'otro' };
  }
  return { ...base, tipo: 'otro' };
}

// Identidad de un organismo (para detectar transiciones / colapsar repetidos).
function organismoKey(o) {
  if (!o) return '';
  if (o.tipo === 'juzgado') return `J:${o.juzgado}/${o.secretaria}`;
  if (o.tipo === 'camara') return `C:${o.sala}/${o.vocalia}`;
  if (o.tipo === 'corte') return 'CORTE';
  return `O:${(o.textoCompleto || '').toUpperCase().replace(/\s+/g, ' ').trim()}`;
}

/**
 * Construye la trayectoria (timeline de tramos) desde los movimientos.
 * @param {Array} movimientos - subdoc movimiento[] de la causa ({fecha,tipo,detalle,url}).
 * @param {Object} [opts]
 * @param {boolean} [opts.incluirOtros=true] - incluir organismos no clasificables.
 * @returns {Array} tramos cronológicos: { tipo, juzgado, secretaria, sala,
 *   vocalia, organismo, textoCompleto, desde, hasta, actual, fuenteDatos }.
 */
function buildTrayectoria(movimientos, opts = {}) {
  const incluirOtros = opts.incluirOtros !== false;
  const fuero = opts.fuero || null;
  if (!Array.isArray(movimientos) || !movimientos.length) return [];

  // Ordenar cronológicamente ascendente (más viejo primero).
  const sorted = movimientos
    .map((m) => ({ m, t: m && m.fecha ? new Date(m.fecha).getTime() : 0 }))
    .sort((a, b) => a.t - b.t)
    .map((x) => x.m);

  const tramos = [];
  for (const mov of sorted) {
    if (!mov || !TIPOS_PASE.test(String(mov.tipo || ''))) continue;
    const org = parseOrganismo(mov.detalle, fuero);
    if (!org) continue;
    if (org.tipo === 'otro' && !incluirOtros) continue;

    const key = organismoKey(org);
    const prev = tramos[tramos.length - 1];
    const fecha = mov.fecha ? new Date(mov.fecha) : null;

    if (prev && organismoKey(prev) === key) {
      // Mismo organismo consecutivo: solo extiende (no abre tramo nuevo).
      continue;
    }
    if (prev && !prev.hasta) prev.hasta = fecha; // cierra el tramo anterior
    tramos.push({
      tipo: org.tipo,
      juzgado: org.juzgado || 0,
      secretaria: org.secretaria || 0,
      sala: org.sala || 0,
      vocalia: org.vocalia || 0,
      organismo: org.organismo,
      textoCompleto: org.textoCompleto,
      desde: fecha,
      hasta: null,
      actual: false,
      fuenteDatos: 'movimientos',
    });
  }
  if (tramos.length) tramos[tramos.length - 1].actual = true; // último = donde está hoy
  return tramos;
}

function currentFromTrayectoria(tray) {
  if (!Array.isArray(tray) || !tray.length) return null;
  return tray.find((t) => t.actual) || tray[tray.length - 1];
}

// Mapea tipo de trayectoria → enum legacy tipoOrganizacion.
function tipoLegacy(tipo) {
  if (tipo === 'juzgado') return 'juzgado-secretaria';
  if (tipo === 'camara') return 'sala-vocalia';
  return 'mixto';
}
function instanciaFromTramo(tramo) {
  if (!tramo) return undefined;
  return {
    tipo: tramo.tipo === 'juzgado' ? 'JUZGADO' : tramo.tipo === 'camara' ? 'CAMARA' : tramo.tipo === 'corte' ? 'CORTE' : 'OTRO',
    juzgado: tramo.juzgado || 0,
    secretaria: tramo.secretaria || 0,
    sala: tramo.sala || 0,
    vocalia: tramo.vocalia || 0,
    organismo: tramo.organismo,
    textoCompleto: tramo.textoCompleto,
    fechaPrimerMovimiento: tramo.desde || null,
    fuenteDatos: 'trayectoria',
  };
}

/**
 * Deriva los campos LEGACY desde la trayectoria, para que los workers los sigan
 * persistiendo (la UI lee de ahí). Devuelve solo lo que pudo derivar; el worker
 * mergea con $set. Pensado para NO pisar con vacío: si no hay dato, no se incluye.
 */
function deriveLegacyFields(tray) {
  const out = {};
  if (!Array.isArray(tray) || !tray.length) return out;
  const actual = currentFromTrayectoria(tray);
  const juzgados = tray.filter((t) => t.tipo === 'juzgado');
  const origen = tray[0];                                          // primer organismo = origen real
  const origenJuzgado = juzgados[0];                               // primer juzgado (instancia de origen)
  const actualJuzgado = juzgados[juzgados.length - 1];             // ÚLTIMO juzgado del fuero propio
  const revisora = tray.find((t) => t.tipo === 'camara' && t.sala > 0) || tray.find((t) => t.tipo === 'camara');
  const extraordinaria = tray.find((t) => t.tipo === 'corte');
  const ultimaCamara = [...tray].reverse().find((t) => t.tipo === 'camara' && t.sala > 0);

  // juzgado/secretaria legacy = juzgado ACTUAL del fuero propio (el último al que
  // pasó). Coincide con el de origen salvo transferencias laterales entre juzgados.
  if (actualJuzgado) { out.juzgado = actualJuzgado.juzgado; if (actualJuzgado.secretaria) out.secretaria = actualJuzgado.secretaria; }
  // sala/vocalia = cámara más reciente con sala identificada.
  if (ultimaCamara) { out.sala = ultimaCamara.sala; out.vocalia = ultimaCamara.vocalia; }
  // ubicación actual (texto + tipo).
  if (actual) {
    out.organizacionTextoCompleto = actual.textoCompleto;
    if (actual.tipo === 'juzgado' || actual.tipo === 'camara') out.tipoOrganizacion = tipoLegacy(actual.tipo);
  }
  // instancias estructuradas (compat con el modelo de 3 instancias).
  if (origenJuzgado) out.instanciaOrigen = instanciaFromTramo(origenJuzgado);
  else if (origen) out.instanciaOrigen = instanciaFromTramo(origen);
  if (revisora) out.instanciaRevisora = instanciaFromTramo(revisora);
  if (extraordinaria) out.instanciaExtraordinaria = instanciaFromTramo(extraordinaria);
  return out;
}

module.exports = {
  parseOrganismo,
  buildTrayectoria,
  currentFromTrayectoria,
  deriveLegacyFields,
  romanToArabic,
};
