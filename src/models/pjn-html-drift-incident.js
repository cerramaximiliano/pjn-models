/**
 * Incidentes de drift estructural del HTML del portal PJN.
 *
 * Distinto de PjnSiteIncident (que cubre caídas/mantenimiento): un drift
 * detecta cambios en la estructura del HTML que rompen o ponen en riesgo
 * la extracción de datos (carátula, dependencia, etc.).
 *
 * Ejemplo: el 2026-05-21 el portal agregó <span id=":detailSituation"> entre
 * dependencia y carátula. El bug se manifestó como caratulas guardadas como
 * "EN LETRA"/"EN DESPACHO". Con esta colección, el guard in-line abre un
 * incidente apenas detecta que `details.caratula` no matchea el shape esperado.
 *
 * El campo `signature` permite deduplicar: 17 procesos PM2 viendo el mismo
 * drift en paralelo abren UN solo incidente (índice único protege).
 */
const mongoose = require("mongoose");

const pjnHtmlDriftIncidentSchema = new mongoose.Schema(
  {
    // Tipo de drift detectado. Categorías:
    //   - 'missing-selector'        un id JSF esperado no aparece
    //   - 'caratula-shape'          details.caratula no matchea /[CS]\//
    //   - 'caratula-is-state'       caratula contiene un estado conocido (EN LETRA, etc.)
    //   - 'fingerprint-drift'       baseline de fingerprint cambió significativamente
    type: { type: String, required: true, index: true },

    // Firma estable del drift, para dedup. Ej: "missing-selector:detailCover"
    // o "caratula-shape:EN LETRA". Combinado con openedDay forma índice único.
    signature: { type: String, required: true },

    // Día UTC (YYYY-MM-DD) en que se abrió. Permite que el mismo drift se
    // reabra al día siguiente si persiste (visibilidad como evento "diario").
    openedDay: { type: String, required: true },

    startedAt: { type: Date, required: true, default: () => new Date() },
    endedAt:   { type: Date, default: null },           // null = en curso
    durationMs:{ type: Number, default: null },

    // Quién reportó el primer hit y quién lo resolvió.
    detectedBy: { type: String, default: null },        // ej: "pjn-app-update-civil"
    resolvedBy: { type: String, default: null },

    // Conteo de detecciones (todos los workers que vieron el drift).
    detectionCount: { type: Number, default: 1 },

    // Datos de muestra para diagnóstico (no spam — solo la primera detección).
    sample: {
      caratula:    { type: String, default: null },
      dependencia: { type: String, default: null },
      situacion:   { type: String, default: null },
      idsPresentes:{ type: [String], default: [] },
      totalSpans:  { type: Number, default: null },
      causaRef:    { type: String, default: null },     // "CIV 8772/2025"
    },

    severity: { type: String, enum: ['warn', 'critical'], default: 'critical' },
    notes:    { type: String, default: null },
  },
  {
    collection: "pjn-html-drift-incidents",
    timestamps: { createdAt: true, updatedAt: true }
  }
);

// Dedup: un incidente por (type, signature, día). Cuando un segundo worker
// intenta openDrift de lo mismo, recibe E11000 y solo incrementa el contador.
pjnHtmlDriftIncidentSchema.index(
  { type: 1, signature: 1, openedDay: 1 },
  { unique: true }
);
pjnHtmlDriftIncidentSchema.index({ endedAt: 1, startedAt: -1 });

function ymd(d = new Date()) {
  return d.toISOString().slice(0, 10);
}

/**
 * Abre un drift incident con dedup atómico. Si ya existe el (type, signature,
 * openedDay), incrementa detectionCount; si no, crea uno nuevo.
 *
 * Si la dedup arroja E11000 por race con otro worker, hacemos un update
 * subsidiario sobre el doc existente.
 */
pjnHtmlDriftIncidentSchema.statics.openDrift = async function({
  type,
  signature,
  detectedBy = null,
  sample = null,
  severity = 'critical',
  notes = null,
}) {
  if (!type || !signature) throw new Error('openDrift: type y signature son requeridos');
  const openedDay = ymd();
  const now = new Date();

  // findOneAndUpdate con upsert es atómico — gana 1, los demás incrementan.
  try {
    const res = await this.findOneAndUpdate(
      { type, signature, openedDay },
      {
        $setOnInsert: {
          type, signature, openedDay,
          startedAt: now,
          endedAt: null,
          detectedBy,
          sample: sample || {},
          severity,
          notes,
        },
        $inc: { detectionCount: 1 },
      },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );
    // No podemos saber barato si fue insert vs update — ambos suben el counter.
    return { incident: res, created: res.detectionCount === 1 };
  } catch (err) {
    if (err.code === 11000) {
      // Race muy ajustada (paralelo extremo). Fallback: leer el doc y subir counter.
      const incident = await this.findOneAndUpdate(
        { type, signature, openedDay },
        { $inc: { detectionCount: 1 } },
        { new: true }
      );
      return { incident, created: false };
    }
    throw err;
  }
};

/**
 * Cierra todos los drifts abiertos que matchean el filtro. Útil cuando
 * el cron detecta que el drift X ya no está activo (los últimos N
 * fingerprints son consistentes con la baseline correcta).
 */
pjnHtmlDriftIncidentSchema.statics.closeDrift = async function({ type, signature, resolvedBy = null } = {}) {
  const filter = { endedAt: null };
  if (type) filter.type = type;
  if (signature) filter.signature = signature;
  const now = new Date();
  const docs = await this.find(filter);
  for (const d of docs) {
    d.endedAt = now;
    d.durationMs = now.getTime() - new Date(d.startedAt).getTime();
    if (resolvedBy) d.resolvedBy = resolvedBy;
    await d.save();
  }
  return docs.length;
};

pjnHtmlDriftIncidentSchema.statics.listDrifts = async function({
  limit = 50, skip = 0, resolved, since, type,
} = {}) {
  const q = {};
  if (resolved === true) q.endedAt = { $ne: null };
  else if (resolved === false) q.endedAt = null;
  if (since) q.startedAt = { $gte: since };
  if (type) q.type = type;
  return this.find(q).sort({ startedAt: -1 }).skip(skip).limit(limit).lean();
};

module.exports =
  mongoose.models.PjnHtmlDriftIncident ||
  mongoose.model("PjnHtmlDriftIncident", pjnHtmlDriftIncidentSchema);
