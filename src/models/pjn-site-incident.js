/**
 * Historial de caídas por mantenimiento del portal PJN.
 *
 * Un documento por cada ventana de mantenimiento detectada. Se abre cuando
 * un worker reporta el primer "Sitio en mantenimiento" (transición
 * healthy/unknown → maintenance) y se cierra cuando algún worker verifica
 * que el sitio volvió (transición maintenance → healthy).
 *
 * Permite responder:
 *   - ¿Cuántas caídas hubo este mes?
 *   - ¿Cuánto duró cada una?
 *   - ¿En qué horario suelen pasar?
 *   - ¿Qué worker detectó / resolvió cada incidente?
 */
const mongoose = require("mongoose");

const pjnSiteIncidentSchema = new mongoose.Schema(
  {
    startedAt: { type: Date, required: true, index: true },
    endedAt: { type: Date, default: null },           // null = en curso
    durationMs: { type: Number, default: null },      // se calcula al cerrar
    detectedBy: { type: String, default: null },      // ej: "update:CIV"
    resolvedBy: { type: String, default: null },      // ej: "update:CNT"
    message: { type: String, default: null },         // banner del PJN
    consecutiveDetections: { type: Number, default: 1 }
  },
  {
    collection: "pjn-site-incidents",
    timestamps: { createdAt: true, updatedAt: true }
  }
);

// Para ordenar por más recientes y filtrar por "abiertos".
pjnSiteIncidentSchema.index({ endedAt: 1, startedAt: -1 });

/**
 * Abre un incident nuevo. Idempotente: si ya hay uno abierto (endedAt:null),
 * lo retorna en lugar de crear duplicado. Esto cubre el caso en que dos
 * workers reporten la misma transición a maintenance casi en simultáneo.
 */
pjnSiteIncidentSchema.statics.openIncident = async function({ detectedBy, message, startedAt = new Date() } = {}) {
  const existing = await this.findOne({ endedAt: null }).sort({ startedAt: -1 });
  if (existing) {
    // Incident en curso — sólo refrescamos contador.
    existing.consecutiveDetections = (existing.consecutiveDetections || 0) + 1;
    if (!existing.detectedBy && detectedBy) existing.detectedBy = detectedBy;
    if (!existing.message && message) existing.message = message;
    await existing.save();
    return { incident: existing, created: false };
  }
  const incident = await this.create({
    startedAt,
    detectedBy: detectedBy || null,
    message: message || null,
    consecutiveDetections: 1
  });
  return { incident, created: true };
};

/**
 * Cierra el incident abierto más reciente. Si no hay ninguno abierto,
 * retorna null — significa que reportHealthy se llamó sin un open previo
 * (raro pero posible: arranque limpio sin transición real).
 */
pjnSiteIncidentSchema.statics.closeIncident = async function({ resolvedBy, endedAt = new Date() } = {}) {
  const open = await this.findOne({ endedAt: null }).sort({ startedAt: -1 });
  if (!open) return null;
  open.endedAt = endedAt;
  open.durationMs = endedAt.getTime() - new Date(open.startedAt).getTime();
  if (resolvedBy) open.resolvedBy = resolvedBy;
  await open.save();
  return open;
};

/**
 * Lista paginada de incidents.
 * @param {Object} opts
 * @param {number} opts.limit
 * @param {number} opts.skip
 * @param {boolean} opts.resolved   true=cerrados, false=abiertos, undefined=todos
 * @param {Date}    opts.since      sólo incidents iniciados después de esta fecha
 */
pjnSiteIncidentSchema.statics.listIncidents = async function({ limit = 50, skip = 0, resolved, since } = {}) {
  const q = {};
  if (resolved === true) q.endedAt = { $ne: null };
  else if (resolved === false) q.endedAt = null;
  if (since) q.startedAt = { ...(q.startedAt || {}), $gte: since };
  return this.find(q).sort({ startedAt: -1 }).skip(skip).limit(limit).lean();
};

module.exports = mongoose.models.PjnSiteIncident || mongoose.model("PjnSiteIncident", pjnSiteIncidentSchema);
