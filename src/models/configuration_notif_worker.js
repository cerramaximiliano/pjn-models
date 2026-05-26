/**
 * Modelo NotifWorkerConfig
 *
 * Configuración + estado del sistema pjn-notificaciones-laborales-worker — controla:
 *   - pjn-notif-manager        (cron + dispatcher de jobs)
 *   - pjn-notif-url-extractor  (consumer BullMQ: corre el aggregation $merge)
 *   - pjn-notif-pdf-processor  (consumer BullMQ: descarga PDF + OCR + clasifica + extrae)
 *
 * Singleton (un único doc) identificado por name='notif-worker'.
 *
 * Espejo del patrón de LiquidacionWorkerConfig con dos diferencias clave:
 *   1. Dos buckets de búsqueda (A=detalle directo, B=paquete documental indirecto).
 *   2. OCR habilitado por defecto (cartas documento y telegramas son ~75-100% escaneados).
 */
const mongoose = require("mongoose");

const workerHeartbeatSchema = new mongoose.Schema({
  name: { type: String, required: true },
  instanceId: { type: String },
  lastHeartbeatAt: { type: Date, default: Date.now },
  isRunning: { type: Boolean, default: false },
  metrics: { type: mongoose.Schema.Types.Mixed, default: {} }
}, { _id: false });

const lastRunResultSchema = new mongoose.Schema({
  startedAt: Date,
  finishedAt: Date,
  elapsedMs: Number,
  added: Number,
  addedBucketA: Number,
  addedBucketB: Number,
  enqueued: Number,
  error: String
}, { _id: false });

const notifWorkerConfigSchema = new mongoose.Schema({
  name: {
    type: String,
    default: 'notif-worker',
    unique: true,
    required: true
  },

  // ════════════════════════════════════════════════════════════════════════
  // CONFIGURACIÓN (editable vía pjn-api admin UI)
  // ════════════════════════════════════════════════════════════════════════
  config: {
    enabled: { type: Boolean, default: true },

    workerNames: {
      manager:       { type: String, default: 'pjn-notif-manager' },
      urlExtractor:  { type: String, default: 'pjn-notif-url-extractor' },
      pdfProcessor:  { type: String, default: 'pjn-notif-pdf-processor' }
    },

    manager: {
      configPollIntervalMs: { type: Number, default: 60_000 },
      heartbeatIntervalMs: { type: Number, default: 30_000 },
      workStartHour: { type: Number, default: null },
      workEndHour: { type: Number, default: null },
      workDays: { type: [Number], default: [] }
    },

    // ── URL Extractor (aggregation $merge sobre causas-trabajo) ──
    urlExtractor: {
      enabled: { type: Boolean, default: true },
      cronExpression: { type: String, default: '0 */6 * * *' },
      reenqueuePending: { type: Boolean, default: false },
      enqueueBatchSize: { type: Number, default: 500, min: 1 },
      enqueueBatchDelayMs: { type: Number, default: 2_000, min: 0 },

      // Bucket A — detalle del movimiento menciona explícitamente CD/telegrama
      movDetallePatternA: {
        type: String,
        default: 'carta documento|\\btelegrama|telegraf|colacionad|intercambio epistolar|\\bcd[\\s\\.\\-]|\\btcl[\\s\\.\\-]|\\bcd$'
      },
      // Bucket B — paquete documental (DEMANDA/CONTESTA/PRUEBA DOCUMENTAL)
      movDetallePatternB: {
        type: String,
        default: '^\\s*demanda(\\s+y\\s+documental)?\\s*$|^\\s*documental demanda|prueba documental|contestacion demanda.{0,60}documental|^\\s*contesta demanda'
      },
      // Si false, NO procesa Bucket B (solo Bucket A — alta señal, bajo volumen)
      processBucketB: { type: Boolean, default: false },

      categoriesAllowed: {
        type: [String],
        default: [
          'CARTA_DOCUMENTO', 'TELEGRAMA', 'INTERCAMBIO_TELEGRAFICO', 'INTERCAMBIO_EPISTOLAR',
          'CD_DESPIDO', 'TCL', 'BUCKET_B_DOCUMENTAL', 'INTIMACION'
        ]
      },

      // Subset de fueros — vacío = sin filtro. Default CNT (Trabajo) + CSS (algunos despidos llegan a CSS).
      fueroAllowed: { type: [String], default: ['CNT'] }
    },

    // ── PDF Processor (BullMQ consumer + OCR) ──
    pdfProcessor: {
      enabled: { type: Boolean, default: true },
      concurrency: { type: Number, default: 2, min: 1, max: 10 },
      downloadTimeoutMs: { type: Number, default: 30_000 },
      maxBytes: { type: Number, default: 50 * 1024 * 1024 },
      ocrCharsPerPageThreshold: { type: Number, default: 100 },
      retryAttempts: { type: Number, default: 3 },
      backoffDelayMs: { type: Number, default: 60_000 },
      requestDelayMs: { type: Number, default: 500, min: 0 },
      dailyLimit: { type: Number, default: 0, min: 0 },

      // ── OCR (pdftoppm + tesseract) ──
      ocrEnabled: { type: Boolean, default: true },
      ocrLang: { type: String, default: 'spa' },
      ocrDpi: { type: Number, default: 200 },
      ocrPageLimit: { type: Number, default: 30, min: 1 },          // Bucket A — todo el doc
      ocrPageLimitBucketB: { type: Number, default: 5, min: 1 },   // Bucket B — solo primeras N (paquetes grandes)
      ocrAbortIfNoMarkersPages: { type: Number, default: 3 }        // Bucket B: corta si en primeras N págs no aparecen markers
    },

    alerts: {
      queueBacklogThreshold: { type: Number, default: 10_000 },
      failedRatioThreshold: { type: Number, default: 0.20 }
    }
  },

  // ════════════════════════════════════════════════════════════════════════
  // ESTADO ACTUAL (reportado por los procesos)
  // ════════════════════════════════════════════════════════════════════════
  currentState: {
    workers: { type: Map, of: workerHeartbeatSchema, default: () => ({}) },

    lastUrlExtractRun: { type: lastRunResultSchema, default: () => ({}) },

    collectionStats: {
      total: { type: Number, default: 0 },
      byStatus: { type: mongoose.Schema.Types.Mixed, default: {} },
      byCategory: { type: mongoose.Schema.Types.Mixed, default: {} },
      byBucket: { type: mongoose.Schema.Types.Mixed, default: {} },
      bySubType: { type: mongoose.Schema.Types.Mixed, default: {} },
      causasWithPiecesCount: { type: Number, default: 0 },
      causasTotalCount: { type: Number, default: 0 },
      lastUpdatedAt: Date
    },

    dailyProcessed: {
      date: { type: String, default: null },
      count: { type: Number, default: 0 }
    },

    queueStats: {
      notifProcess: {
        waiting: { type: Number, default: 0 },
        active: { type: Number, default: 0 },
        delayed: { type: Number, default: 0 },
        failed: { type: Number, default: 0 },
        completed: { type: Number, default: 0 }
      },
      notifUrlExtract: {
        waiting: { type: Number, default: 0 },
        active: { type: Number, default: 0 },
        completed: { type: Number, default: 0 },
        failed: { type: Number, default: 0 }
      },
      lastUpdatedAt: Date
    }
  },

  alerts: [{
    type: {
      type: String,
      enum: ['queue_backlog', 'high_failure_rate', 'worker_stopped', 'config_invalid', 'ocr_failure_spike']
    },
    message: String,
    target: String,
    createdAt: { type: Date, default: Date.now },
    acknowledged: { type: Boolean, default: false }
  }],

  lastUpdate: { type: Date, default: Date.now },
  createdAt: { type: Date, default: Date.now }
}, {
  collection: 'notif-worker-config',
  timestamps: false,
  minimize: false
});

// ── Statics ──────────────────────────────────────────────────────────────────

notifWorkerConfigSchema.statics.getOrCreate = async function () {
  let doc = await this.findOne({ name: 'notif-worker' });
  if (!doc) doc = await this.create({ name: 'notif-worker' });
  return doc;
};

notifWorkerConfigSchema.statics.getConfig = async function () {
  const doc = await this.findOne({ name: 'notif-worker' }).lean();
  return doc?.config || null;
};

notifWorkerConfigSchema.statics.updateConfig = async function (updates) {
  const setOp = {};
  for (const [key, value] of Object.entries(updates)) {
    setOp[`config.${key}`] = value;
  }
  setOp.lastUpdate = new Date();
  return this.findOneAndUpdate(
    { name: 'notif-worker' },
    { $set: setOp },
    { upsert: true, new: true }
  );
};

notifWorkerConfigSchema.statics.heartbeat = async function (workerName, payload = {}) {
  const now = new Date();
  return this.findOneAndUpdate(
    { name: 'notif-worker' },
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

notifWorkerConfigSchema.statics.reportUrlExtractRun = async function (result) {
  return this.findOneAndUpdate(
    { name: 'notif-worker' },
    { $set: { 'currentState.lastUrlExtractRun': result, lastUpdate: new Date() } },
    { upsert: true, new: true }
  );
};

notifWorkerConfigSchema.statics.reportStats = async function ({ collectionStats, queueStats }) {
  const set = { lastUpdate: new Date() };
  if (collectionStats) set['currentState.collectionStats'] = { ...collectionStats, lastUpdatedAt: new Date() };
  if (queueStats) set['currentState.queueStats'] = { ...queueStats, lastUpdatedAt: new Date() };
  return this.findOneAndUpdate(
    { name: 'notif-worker' },
    { $set: set },
    { upsert: true, new: true }
  );
};

notifWorkerConfigSchema.statics.addAlert = async function (alert) {
  return this.findOneAndUpdate(
    { name: 'notif-worker' },
    {
      $push: { alerts: { $each: [alert], $slice: -100 } },
      $set: { lastUpdate: new Date() }
    },
    { upsert: true, new: true }
  );
};

notifWorkerConfigSchema.statics.incrementDailyProcessed = async function () {
  const today = new Date().toISOString().slice(0, 10);
  const updated = await this.findOneAndUpdate(
    { name: 'notif-worker', 'currentState.dailyProcessed.date': today },
    { $inc: { 'currentState.dailyProcessed.count': 1 }, $set: { lastUpdate: new Date() } },
    { new: true, projection: { 'currentState.dailyProcessed': 1 } }
  ).lean();
  if (updated) return updated.currentState.dailyProcessed;
  const reset = await this.findOneAndUpdate(
    { name: 'notif-worker' },
    { $set: { 'currentState.dailyProcessed': { date: today, count: 1 }, lastUpdate: new Date() } },
    { new: true, upsert: true, projection: { 'currentState.dailyProcessed': 1 } }
  ).lean();
  return reset.currentState.dailyProcessed;
};

notifWorkerConfigSchema.statics.getTodayProcessedCount = async function () {
  const today = new Date().toISOString().slice(0, 10);
  const doc = await this.findOne(
    { name: 'notif-worker' },
    { 'currentState.dailyProcessed': 1 }
  ).lean();
  const dp = doc?.currentState?.dailyProcessed;
  if (!dp || dp.date !== today) return { date: today, count: 0 };
  return dp;
};

notifWorkerConfigSchema.statics.markStopped = async function (workerName) {
  return this.findOneAndUpdate(
    { name: 'notif-worker' },
    {
      $set: {
        [`currentState.workers.${workerName}.isRunning`]: false,
        lastUpdate: new Date()
      }
    }
  );
};

module.exports = mongoose.models.NotifWorkerConfig ||
  mongoose.model("NotifWorkerConfig", notifWorkerConfigSchema);
