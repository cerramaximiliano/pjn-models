/**
 * Incidentes de scraping del portal "Mis Causas" del PJN (worker
 * pjn-mis-causas). Un documento por cada caso problemático detectado al
 * actualizar una causa: error de búsqueda, error de scraping, scrape
 * degradado (DOM sin renderizar → movimientos esqueleto), o una excepción
 * inesperada procesando la causa.
 *
 * A cada incidente se le adjunta un screenshot de Puppeteer + un snippet del
 * HTML subidos a S3, para que el admin pueda diagnosticar qué vio el worker
 * sin tener que reproducir el fallo a mano.
 *
 * Dedup: se agrupan por (worker, type, causaId, openedDay) — si el mismo
 * caso falla N veces en el mismo día se incrementa detectionCount en vez de
 * crear ruido. El screenshot/HTML se refrescan con la última captura.
 */
const mongoose = require("mongoose");

const TYPES = [
  "search_error",        // la búsqueda pública/listado de la causa falló
  "scraping_error",      // scrapeMovimientosConComparacion devolvió error
  "degraded_scrape",     // DOM degradado: movimientos esqueleto (guard activado)
  "processing_exception",// excepción no controlada procesando la causa
  "login_error",         // fallo de login/sesión (reservado)
  "empty_movements",     // scrape OK pero la causa no tiene movimientos (evidencia de causa vacía)
  "other",
];

const pjnScrapeIncidentSchema = new mongoose.Schema(
  {
    type: { type: String, enum: TYPES, required: true, index: true },
    worker: { type: String, default: "private-causas-update-worker" },

    // Contexto de la causa afectada.
    causaId: { type: mongoose.Schema.Types.ObjectId, index: true },
    causaType: { type: String, default: null },   // modelName: CausasCPE, etc.
    fuero: { type: String, default: null },
    number: { type: String, default: null },
    year: { type: String, default: null },
    caratula: { type: String, default: null },

    credentialsId: { type: mongoose.Schema.Types.ObjectId, default: null, index: true },
    runId: { type: mongoose.Schema.Types.ObjectId, default: null },

    pageUrl: { type: String, default: null },
    errorMessage: { type: String, default: null },

    // Evidencia en S3.
    s3Key: { type: String, default: null },
    screenshotUrl: { type: String, default: null },
    htmlSnippet: { type: String, default: null },

    // Dedup / agregación.
    openedDay: { type: String, index: true },      // YYYY-MM-DD (UTC)
    detectionCount: { type: Number, default: 1 },
    firstSeenAt: { type: Date, default: Date.now },
    lastSeenAt: { type: Date, default: Date.now },

    // Gestión desde la admin.
    resolved: { type: Boolean, default: false, index: true },
    resolvedAt: { type: Date, default: null },
    resolvedBy: { type: String, default: null },
  },
  {
    collection: "pjn-scrape-incidents",
    timestamps: true,
  }
);

// Listado por más recientes y filtro por resueltos.
pjnScrapeIncidentSchema.index({ resolved: 1, lastSeenAt: -1 });
// Soporte del upsert de dedup.
pjnScrapeIncidentSchema.index({ worker: 1, type: 1, causaId: 1, openedDay: 1 });

function dayKey(d = new Date()) {
  return new Date(d).toISOString().slice(0, 10);
}

/**
 * Registra un incidente con dedup diario. Idempotente dentro del día: si ya
 * existe uno del mismo (worker, type, causaId, openedDay) incrementa el
 * contador y refresca la evidencia/lastSeenAt; si no, lo crea.
 *
 * Nunca lanza: ante error devuelve null para no romper el flujo del worker.
 */
pjnScrapeIncidentSchema.statics.recordIncident = async function (data = {}) {
  try {
    const now = new Date();
    const openedDay = dayKey(now);
    const filter = {
      worker: data.worker || "private-causas-update-worker",
      type: data.type,
      causaId: data.causaId || null,
      openedDay,
    };
    const setOnInsert = {
      ...filter,
      causaType: data.causaType || null,
      fuero: data.fuero || null,
      number: data.number != null ? String(data.number) : null,
      year: data.year != null ? String(data.year) : null,
      caratula: data.caratula || null,
      credentialsId: data.credentialsId || null,
      runId: data.runId || null,
      firstSeenAt: now,
      resolved: false,
    };
    const set = {
      lastSeenAt: now,
      pageUrl: data.pageUrl || null,
      errorMessage: data.errorMessage || null,
    };
    // Solo pisar la evidencia si esta captura trajo screenshot.
    if (data.s3Key) set.s3Key = data.s3Key;
    if (data.screenshotUrl) set.screenshotUrl = data.screenshotUrl;
    if (data.htmlSnippet) set.htmlSnippet = data.htmlSnippet;

    const doc = await this.findOneAndUpdate(
      filter,
      { $set: set, $setOnInsert: setOnInsert, $inc: { detectionCount: 1 } },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );
    return doc;
  } catch (err) {
    return null;
  }
};

/**
 * Lista paginada con filtros para la vista admin.
 * @param {Object} opts
 * @param {number} opts.limit
 * @param {number} opts.skip
 * @param {string} opts.type        filtra por tipo
 * @param {string} opts.fuero       filtra por fuero
 * @param {boolean} opts.resolved   true/false/undefined
 * @param {Date}    opts.since      lastSeenAt >= since
 * @param {string}  opts.causaId
 */
pjnScrapeIncidentSchema.statics.listIncidents = async function (opts = {}) {
  const { limit = 50, skip = 0, type, fuero, resolved, since, causaId } = opts;
  const q = {};
  if (type) q.type = type;
  if (fuero) q.fuero = fuero;
  if (resolved === true) q.resolved = true;
  else if (resolved === false) q.resolved = false;
  if (since) q.lastSeenAt = { $gte: since };
  if (causaId) q.causaId = causaId;
  const [docs, total] = await Promise.all([
    this.find(q).sort({ lastSeenAt: -1 }).skip(skip).limit(limit).lean(),
    this.countDocuments(q),
  ]);
  return { docs, total };
};

module.exports =
  mongoose.models.PjnScrapeIncident ||
  mongoose.model("PjnScrapeIncident", pjnScrapeIncidentSchema);
