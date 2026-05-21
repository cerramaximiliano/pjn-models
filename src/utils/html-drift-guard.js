/**
 * Guard de drift estructural del HTML del portal PJN.
 *
 * Diseñado para ser llamado **dentro de cada scraping** (en `extractExpedientDetails`
 * o equivalente) por los workers de los repos pjn-workers, pjn-workers-scraping y
 * pjn-mis-causas. Operación es cheap (validaciones in-memory + 1 escritura Mongo
 * solo cuando hay drift o sample).
 *
 * Dedup: 17 procesos PM2 viendo el mismo drift abren UN solo incidente gracias
 * al índice único (type, signature, openedDay) en PjnHtmlDriftIncident.
 *
 * Uso:
 *
 *   const { checkStructuralDrift, maybeRecordFingerprint } = require('pjn-models/src/utils/html-drift-guard');
 *
 *   const details = await extractExpedientDetails(page);
 *   await checkStructuralDrift(details, {
 *     sourceWorker: 'pjn-app-update-civil',
 *     causaRef: `${fuero} ${exp.number}/${exp.year}`,
 *   });
 *   await maybeRecordFingerprint(page, details, {
 *     sourceWorker: 'pjn-app-update-civil', fuero, causaRef,
 *   });
 */

const PjnHtmlDriftIncident = require('../models/pjn-html-drift-incident');
const PjnHtmlFingerprint = require('../models/pjn-html-fingerprint');

// Estados conocidos del portal PJN que ANTES caían en caratula por bug del 2026-05-21.
// Si vemos alguno de estos como `caratula`, sabemos que detailCover está leyendo
// el span equivocado.
const ESTADO_KEYWORDS = [
  'EN LETRA', 'LETRA',
  'EN DESPACHO', 'A DESPACHO', 'DESPACHO',
  'PARALIZADO', 'PARALIZADA',
  'PARA RESOLVER', 'PARA SENTENCIA',
  'ARCHIVO', 'EN ARCHIVO',
  'EN VISTA', 'VISTA',
  'EN ESTUDIO', 'ESTUDIO',
  'EN TRAMITE', 'EN TRÁMITE',
  'EN PROVEIDO', 'EN PROVEÍDO',
  'EN ACUERDO', 'CON ACUERDO',
  'EN SECRETARIA', 'EN SECRETARÍA',
  'EN CASILLERO', 'CASILLERO',
  'RESERVADO', 'RESERVADA', 'EN RESERVA',
];

const ESTADO_REGEX = new RegExp(
  `^(${ESTADO_KEYWORDS.map(k => k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})\\.?\\s*$`,
  'i'
);

// Una carátula bien extraída del PJN contiene el separador "C/" entre actor y
// demandado, y/o "S/" antes del objeto. Si no matchea ninguno, es sospechosa.
const CARATULA_SHAPE_REGEX = /\sC\/|\sS\/|\sVS\.?\s/i;

function isPlainObject(x) {
  return x !== null && typeof x === 'object' && !Array.isArray(x);
}

/**
 * Verifica que `details` (output de extractExpedientDetails con shape
 * { camara, dependencia, situacion, caratula }) cumple las invariantes
 * estructurales. Si algo falla, abre un PjnHtmlDriftIncident con dedup.
 *
 * Retorna { ok, drifts: [{ type, signature }] } por si el caller quiere
 * tomar decisiones (ej: no sobreescribir caratula si hubo drift).
 *
 * No throw — el objetivo es observabilidad, no romper el scraping.
 */
async function checkStructuralDrift(details, ctx = {}) {
  const { sourceWorker = null, causaRef = null } = ctx;
  const drifts = [];

  // Guard básico: si details no es un objeto con shape esperada, es drift máximo.
  if (!isPlainObject(details)) {
    drifts.push({
      type: 'missing-selector',
      signature: 'details-not-object',
      severity: 'critical',
    });
  } else {
    // detailCover ausente o vacío
    if (!details.caratula || !details.caratula.trim()) {
      drifts.push({
        type: 'missing-selector',
        signature: 'detailCover-empty',
        severity: 'critical',
      });
    } else {
      // La caratula contiene un estado conocido (bug del 2026-05-21).
      if (ESTADO_REGEX.test(details.caratula.trim())) {
        drifts.push({
          type: 'caratula-is-state',
          signature: `state:${details.caratula.trim().toUpperCase()}`,
          severity: 'critical',
        });
      } else if (!CARATULA_SHAPE_REGEX.test(details.caratula)) {
        // No matchea shape típica de caratula judicial. Advertencia,
        // no critical: hay edge cases reales (ej. carátulas muy cortas).
        drifts.push({
          type: 'caratula-shape',
          signature: `no-c-s-vs:${details.caratula.slice(0, 50)}`,
          severity: 'warn',
        });
      }
    }

    // detailDependencia ausente
    if (!details.dependencia || !details.dependencia.trim()) {
      drifts.push({
        type: 'missing-selector',
        signature: 'detailDependencia-empty',
        severity: 'warn',
      });
    }
  }

  // Reportar cada drift (con dedup).
  const sample = isPlainObject(details) ? {
    caratula: details.caratula || null,
    dependencia: details.dependencia || null,
    situacion: details.situacion || null,
    idsPresentes: ['camara', 'dependencia', 'situacion', 'caratula']
      .filter(k => details[k] && details[k].trim()),
    causaRef,
  } : { causaRef };

  for (const d of drifts) {
    try {
      await PjnHtmlDriftIncident.openDrift({
        type: d.type,
        signature: d.signature,
        detectedBy: sourceWorker,
        severity: d.severity || 'critical',
        sample,
      });
    } catch (err) {
      // No quiero matar el scraping por un fallo del guard.
      // Loggear si hay logger global, sino silencio.
      if (typeof console !== 'undefined' && console.warn) {
        console.warn(`[html-drift-guard] Error abriendo drift ${d.signature}: ${err.message}`);
      }
    }
  }

  return { ok: drifts.length === 0, drifts };
}

/**
 * Persiste un fingerprint de la página actual con probabilidad 1/sampleRate.
 * Default 1/200 = ~0.5% de los scrapings, lo cual con ~10K scrapings/día da
 * ~50 fingerprints diarios — suficiente para análisis sin spam.
 *
 * Recibe la `page` de Puppeteer porque necesita contar spans / leer ids más
 * allá de lo que extractExpedientDetails devuelve.
 */
async function maybeRecordFingerprint(page, details, ctx = {}) {
  const { sourceWorker = null, fuero = null, causaRef = null, sampleRate = 200 } = ctx;

  // Sampling probabilístico.
  if (Math.random() * sampleRate >= 1) return null;

  let totalSpans = null;
  let idsPresentes = [];
  try {
    const data = await page.evaluate(() => {
      const spans = document.body.querySelectorAll('span');
      const detailIds = new Set();
      for (const el of spans) {
        const id = el.id || '';
        const m = id.match(/:([a-zA-Z]+)$/);
        if (m && m[1].startsWith('detail')) detailIds.add(m[1]);
      }
      return { totalSpans: spans.length, detailIds: Array.from(detailIds) };
    });
    totalSpans = data.totalSpans;
    idsPresentes = data.detailIds;
  } catch (err) {
    if (typeof console !== 'undefined' && console.warn) {
      console.warn(`[html-drift-guard] Error capturando fingerprint: ${err.message}`);
    }
    return null;
  }

  try {
    const doc = await PjnHtmlFingerprint.create({
      totalSpans,
      idsPresentes,
      situacionPresent: idsPresentes.includes('detailSituation'),
      hasCaratula: idsPresentes.includes('detailCover'),
      hasDependencia: idsPresentes.includes('detailDependencia'),
      hasCamara: idsPresentes.includes('detailCamera'),
      sourceWorker,
      fuero,
      causaRef,
    });
    return doc;
  } catch (err) {
    if (typeof console !== 'undefined' && console.warn) {
      console.warn(`[html-drift-guard] Error guardando fingerprint: ${err.message}`);
    }
    return null;
  }
}

module.exports = {
  checkStructuralDrift,
  maybeRecordFingerprint,
  // Exportar regex/constantes por si algún consumidor quiere chequeo offline.
  ESTADO_REGEX,
  CARATULA_SHAPE_REGEX,
};
