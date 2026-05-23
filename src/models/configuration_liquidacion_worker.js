/**
 * Modelo LiquidacionWorkerConfig
 *
 * Configuración + estado del sistema pjn-liquidacion-worker — controla:
 *   - pjn-liq-manager        (cron + dispatcher de jobs)
 *   - pjn-liq-url-extractor  (consumer BullMQ: corre el aggregation $merge)
 *   - pjn-liq-pdf-processor  (consumer BullMQ: descarga PDF + clasifica + extrae)
 *
 * Singleton (un único doc) identificado por name='liquidacion-worker'.
 *
 * Espejo del patrón de ManagerConfig: el documento sirve tanto como
 * configuración (settings tunables vía pjn-api admin UI) como state
 * (heartbeats, stats, lastRun) que cada proceso reporta.
 */
const mongoose = require("mongoose");

// ── Sub-schemas ──────────────────────────────────────────────────────────────

const workerHeartbeatSchema = new mongoose.Schema({
  name: { type: String, required: true },     // p.ej. 'pjn-liq-manager'
  instanceId: { type: String },                // hostname:pid:randomId
  lastHeartbeatAt: { type: Date, default: Date.now },
  isRunning: { type: Boolean, default: false },
  // Métricas live opcionales
  metrics: { type: mongoose.Schema.Types.Mixed, default: {} }
}, { _id: false });

const lastRunResultSchema = new mongoose.Schema({
  startedAt: Date,
  finishedAt: Date,
  elapsedMs: Number,
  added: Number,
  enqueued: Number,
  error: String
}, { _id: false });

// ── Main schema ──────────────────────────────────────────────────────────────

const liquidacionWorkerConfigSchema = new mongoose.Schema({
  // Singleton — siempre 'liquidacion-worker'
  name: {
    type: String,
    default: 'liquidacion-worker',
    unique: true,
    required: true
  },

  // ════════════════════════════════════════════════════════════════════════
  // CONFIGURACIÓN (editable vía pjn-api admin UI)
  // ════════════════════════════════════════════════════════════════════════
  config: {
    // Toggle global del sistema. Si false → el manager no despacha jobs y los
    // workers idlean sin consumir.
    enabled: { type: Boolean, default: true },

    // Nombres PM2 (para que el manager pueda eventualmente restartearlos)
    workerNames: {
      manager:       { type: String, default: 'pjn-liq-manager' },
      urlExtractor:  { type: String, default: 'pjn-liq-url-extractor' },
      pdfProcessor:  { type: String, default: 'pjn-liq-pdf-processor' }
    },

    // ── Manager ──
    manager: {
      // Cada cuánto el manager refresca config desde Mongo (ms)
      configPollIntervalMs: { type: Number, default: 60_000 },
      // Cada cuánto reporta heartbeat (ms)
      heartbeatIntervalMs: { type: Number, default: 30_000 },
      // Horario activo (24h). null/null = sin restricción.
      workStartHour: { type: Number, default: null },
      workEndHour: { type: Number, default: null },
      // Días de la semana activos. Vacío = todos.
      workDays: { type: [Number], default: [] }
    },

    // ── URL Extractor (aggregation $merge sobre causas-segsocial) ──
    urlExtractor: {
      enabled: { type: Boolean, default: true },
      // Cron expression — cada cuánto el manager despacha un job de extracción
      cronExpression: { type: String, default: '0 */6 * * *' },
      // Si true, después del $merge encola TODOS los pdfStatus:pending (backfill).
      // Si false, solo encola los recién insertados (<24h, lastSeenAt = capturedAt).
      reenqueuePending: { type: Boolean, default: false },
      // Filtros de la aggregation (regex como strings)
      caratulaPattern: { type: String, default: 'reajustes varios' },
      movDetallePattern: { type: String, default: 'liquidac|haber.{0,8}caja|reajustad|retroactiv' },
      // Categorías que SE GUARDAN (el resto va a EXCLUIDA/OTRO y se descarta)
      categoriesAllowed: {
        type: [String],
        default: [
          'ACOMPANA', 'PRACTICA', 'ADJUNTA', 'ACREDITA', 'ACREDITA_PRACTICA',
          'AMPLIATORIA', 'IMPUGNA', 'CONTESTA_TRASLADO', 'LIQUIDACION_PURA',
          'MODIFICA', 'HABER_DIRECTO', 'PERITO_O_HISTORICO'
        ]
      },
      // Si se quiere acotar a un subset de causaTypes/fueros (vacío = sin filtro)
      fueros: { type: [String], default: ['CSS'] }
    },

    // ── PDF Processor (BullMQ consumer) ──
    pdfProcessor: {
      enabled: { type: Boolean, default: true },
      concurrency: { type: Number, default: 4, min: 1, max: 20 },
      downloadTimeoutMs: { type: Number, default: 30_000 },
      maxBytes: { type: Number, default: 25 * 1024 * 1024 },
      // Si chars/page < threshold → pdfStatus: 'ocr_needed' (defer a OCR worker v1.1)
      ocrCharsPerPageThreshold: { type: Number, default: 100 },
      retryAttempts: { type: Number, default: 3 },
      backoffDelayMs: { type: Number, default: 60_000 }
    },

    // ── Alertas ──
    alerts: {
      // Si la cola crece más de N items → alerta de backlog
      queueBacklogThreshold: { type: Number, default: 10_000 },
      // Si % de pdfStatus:'failed' supera N → alerta de fallos sistémicos
      failedRatioThreshold: { type: Number, default: 0.20 }
    }
  },

  // ════════════════════════════════════════════════════════════════════════
  // ESTADO ACTUAL (reportado por los procesos)
  // ════════════════════════════════════════════════════════════════════════
  currentState: {
    // Heartbeats por proceso (key = worker name)
    workers: { type: Map, of: workerHeartbeatSchema, default: () => ({}) },

    // Última corrida del URL extractor
    lastUrlExtractRun: { type: lastRunResultSchema, default: () => ({}) },

    // Estado live de la colección + cola
    collectionStats: {
      total: { type: Number, default: 0 },
      byStatus: { type: mongoose.Schema.Types.Mixed, default: {} },
      byCategory: { type: mongoose.Schema.Types.Mixed, default: {} },
      lastUpdatedAt: Date
    },
    queueStats: {
      // Cola del PDF processor (liq-process)
      liqProcess: {
        waiting: { type: Number, default: 0 },
        active: { type: Number, default: 0 },
        delayed: { type: Number, default: 0 },
        failed: { type: Number, default: 0 },
        completed: { type: Number, default: 0 }
      },
      // Cola del URL extractor (liq-url-extract)
      liqUrlExtract: {
        waiting: { type: Number, default: 0 },
        active: { type: Number, default: 0 },
        completed: { type: Number, default: 0 },
        failed: { type: Number, default: 0 }
      },
      lastUpdatedAt: Date
    }
  },

  // Alertas no reconocidas (las últimas 100)
  alerts: [{
    type: {
      type: String,
      enum: ['queue_backlog', 'high_failure_rate', 'worker_stopped', 'config_invalid']
    },
    message: String,
    target: String,    // worker name o queue name
    createdAt: { type: Date, default: Date.now },
    acknowledged: { type: Boolean, default: false }
  }],

  lastUpdate: { type: Date, default: Date.now },
  createdAt: { type: Date, default: Date.now }
}, {
  collection: 'liquidacion-worker-config',
  timestamps: false,
  minimize: false
});

// ── Statics ──────────────────────────────────────────────────────────────────

liquidacionWorkerConfigSchema.statics.getOrCreate = async function () {
  let doc = await this.findOne({ name: 'liquidacion-worker' });
  if (!doc) doc = await this.create({ name: 'liquidacion-worker' });
  return doc;
};

liquidacionWorkerConfigSchema.statics.getConfig = async function () {
  const doc = await this.findOne({ name: 'liquidacion-worker' }).lean();
  return doc?.config || null;
};

/**
 * Actualiza valores de configuración. Acepta paths anidados (ej: 'manager.workStartHour').
 * Devuelve el doc actualizado.
 */
liquidacionWorkerConfigSchema.statics.updateConfig = async function (updates) {
  const setOp = {};
  for (const [key, value] of Object.entries(updates)) {
    setOp[`config.${key}`] = value;
  }
  setOp.lastUpdate = new Date();
  return this.findOneAndUpdate(
    { name: 'liquidacion-worker' },
    { $set: setOp },
    { upsert: true, new: true }
  );
};

/**
 * Heartbeat de un worker (manager, extractor o processor).
 * @param {string} workerName — clave del PM2 process
 * @param {object} payload — { instanceId, metrics }
 */
liquidacionWorkerConfigSchema.statics.heartbeat = async function (workerName, payload = {}) {
  const now = new Date();
  return this.findOneAndUpdate(
    { name: 'liquidacion-worker' },
    {
      $set: {
        [`currentState.workers.${workerName}`]: {
          name: workerName,
          instanceId: payload.instanceId,
          lastHeartbeatAt: now,
          isRunning: true,
          metrics: payload.metrics || {}
        },
        lastUpdate: now
      }
    },
    { upsert: true, new: true }
  );
};

/**
 * Reporta el resultado de la última corrida del URL extractor.
 */
liquidacionWorkerConfigSchema.statics.reportUrlExtractRun = async function (result) {
  return this.findOneAndUpdate(
    { name: 'liquidacion-worker' },
    { $set: { 'currentState.lastUrlExtractRun': result, lastUpdate: new Date() } },
    { upsert: true, new: true }
  );
};

/**
 * Reporta stats de la colección + colas (lo llama el manager periódicamente).
 */
liquidacionWorkerConfigSchema.statics.reportStats = async function ({ collectionStats, queueStats }) {
  const set = { lastUpdate: new Date() };
  if (collectionStats) {
    set['currentState.collectionStats'] = { ...collectionStats, lastUpdatedAt: new Date() };
  }
  if (queueStats) {
    set['currentState.queueStats'] = { ...queueStats, lastUpdatedAt: new Date() };
  }
  return this.findOneAndUpdate(
    { name: 'liquidacion-worker' },
    { $set: set },
    { upsert: true, new: true }
  );
};

/**
 * Agrega una alerta (mantiene las últimas 100).
 */
liquidacionWorkerConfigSchema.statics.addAlert = async function (alert) {
  return this.findOneAndUpdate(
    { name: 'liquidacion-worker' },
    {
      $push: { alerts: { $each: [alert], $slice: -100 } },
      $set: { lastUpdate: new Date() }
    },
    { upsert: true, new: true }
  );
};

/**
 * Marca un worker como detenido (lo llama el proceso en SIGTERM si puede).
 */
liquidacionWorkerConfigSchema.statics.markStopped = async function (workerName) {
  return this.findOneAndUpdate(
    { name: 'liquidacion-worker' },
    {
      $set: {
        [`currentState.workers.${workerName}.isRunning`]: false,
        lastUpdate: new Date()
      }
    }
  );
};

module.exports = mongoose.models.LiquidacionWorkerConfig ||
  mongoose.model("LiquidacionWorkerConfig", liquidacionWorkerConfigSchema);
