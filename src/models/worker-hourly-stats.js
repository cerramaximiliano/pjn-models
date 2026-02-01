/**
 * Modelo WorkerHourlyStats
 * Registra estadísticas por hora de los workers por fuero
 * Permite ver patrones de actividad y carga durante el día
 */
const mongoose = require("mongoose");

const workerHourlyStatsSchema = new mongoose.Schema({
  // Identificadores únicos del registro
  date: {
    type: String,
    required: true,
    index: true
  }, // Formato: YYYY-MM-DD

  hour: {
    type: Number,
    required: true,
    min: 0,
    max: 23,
    index: true
  },

  fuero: {
    type: String,
    required: true,
    enum: ['CIV', 'COM', 'CNT', 'CSS', 'CAF', 'CCF', 'CNE', 'CPE', 'CFP', 'CCC', 'CSJ', 'ALL'],
    index: true
  },

  workerType: {
    type: String,
    required: true,
    enum: ['app-update', 'verify', 'recovery', 'stuck-documents', 'private-causas-update', 'mis-causas'],
    index: true
  },

  // Estadísticas de la hora
  stats: {
    // Documentos procesados
    processed: { type: Number, default: 0 },
    successful: { type: Number, default: 0 },
    failed: { type: Number, default: 0 },
    skipped: { type: Number, default: 0 },

    // Movimientos encontrados
    movimientosFound: { type: Number, default: 0 },

    // Tiempos (en ms)
    totalProcessingTime: { type: Number, default: 0 },
    avgProcessingTime: { type: Number, default: 0 },
    minProcessingTime: { type: Number },
    maxProcessingTime: { type: Number },

    // Workers activos durante la hora
    maxActiveWorkers: { type: Number, default: 0 },
    avgActiveWorkers: { type: Number, default: 0 },

    // Pendientes al inicio y fin de la hora
    pendingAtStart: { type: Number },
    pendingAtEnd: { type: Number }
  },

  // Ciclos del manager durante esta hora
  managerCycles: { type: Number, default: 0 },

  // Scaling events durante esta hora
  scalingEvents: [{
    timestamp: { type: Date },
    action: { type: String, enum: ['scale_up', 'scale_down', 'no_change'] },
    from: { type: Number },
    to: { type: Number },
    reason: { type: String }
  }],

  // Errores más frecuentes de la hora
  topErrors: [{
    errorType: { type: String },
    count: { type: Number },
    lastMessage: { type: String }
  }],

  // Metadata
  lastUpdate: { type: Date, default: Date.now },
  createdAt: { type: Date, default: Date.now }
}, {
  collection: 'worker-hourly-stats',
  timestamps: false
});

// Índice compuesto único
workerHourlyStatsSchema.index({ date: 1, hour: 1, fuero: 1, workerType: 1 }, { unique: true });

// Índice para consultas por rango de tiempo
workerHourlyStatsSchema.index({ date: -1, hour: -1 });

/**
 * Obtiene o crea el registro de la hora actual para un fuero y worker
 */
workerHourlyStatsSchema.statics.getOrCreateCurrent = async function(fuero, workerType) {
  const now = new Date();
  const date = now.toISOString().split('T')[0]; // YYYY-MM-DD
  const hour = now.getHours();

  let stats = await this.findOne({ date, hour, fuero, workerType });

  if (!stats) {
    stats = await this.create({
      date,
      hour,
      fuero,
      workerType
    });
  }

  return stats;
};

/**
 * Incrementa contadores de forma atómica
 */
workerHourlyStatsSchema.statics.incrementStats = async function(fuero, workerType, increments) {
  const now = new Date();
  const date = now.toISOString().split('T')[0];
  const hour = now.getHours();

  const incObj = {};
  const setObj = { lastUpdate: new Date() };

  for (const [key, value] of Object.entries(increments)) {
    if (value !== undefined && value !== 0) {
      incObj[`stats.${key}`] = value;
    }
  }

  // Actualizar min/max si se proporciona processingTime
  if (increments.processingTime) {
    const existing = await this.findOne({ date, hour, fuero, workerType });
    if (existing) {
      if (!existing.stats.minProcessingTime || increments.processingTime < existing.stats.minProcessingTime) {
        setObj['stats.minProcessingTime'] = increments.processingTime;
      }
      if (!existing.stats.maxProcessingTime || increments.processingTime > existing.stats.maxProcessingTime) {
        setObj['stats.maxProcessingTime'] = increments.processingTime;
      }
    }
  }

  return this.findOneAndUpdate(
    { date, hour, fuero, workerType },
    {
      $inc: incObj,
      $set: setObj,
      $setOnInsert: { date, hour, fuero, workerType, createdAt: new Date() }
    },
    { upsert: true, new: true }
  );
};

/**
 * Registra un ciclo del manager
 */
workerHourlyStatsSchema.statics.recordManagerCycle = async function(fuero, workerType, cycleData) {
  const now = new Date();
  const date = now.toISOString().split('T')[0];
  const hour = now.getHours();

  const update = {
    $inc: { managerCycles: 1 },
    $set: { lastUpdate: new Date() },
    $setOnInsert: { date, hour, fuero, workerType, createdAt: new Date() }
  };

  // Actualizar workers activos
  if (cycleData.activeWorkers !== undefined) {
    const existing = await this.findOne({ date, hour, fuero, workerType });
    if (existing) {
      const newMax = Math.max(existing.stats.maxActiveWorkers || 0, cycleData.activeWorkers);
      const cycleCount = existing.managerCycles || 0;
      const currentAvg = existing.stats.avgActiveWorkers || 0;
      const newAvg = ((currentAvg * cycleCount) + cycleData.activeWorkers) / (cycleCount + 1);

      update.$set['stats.maxActiveWorkers'] = newMax;
      update.$set['stats.avgActiveWorkers'] = Math.round(newAvg * 100) / 100;
    } else {
      update.$set['stats.maxActiveWorkers'] = cycleData.activeWorkers;
      update.$set['stats.avgActiveWorkers'] = cycleData.activeWorkers;
    }
  }

  // Registrar pending
  if (cycleData.pending !== undefined) {
    update.$set['stats.pendingAtEnd'] = cycleData.pending;
  }

  // Registrar scaling event si hubo
  if (cycleData.scalingAction && cycleData.scalingAction !== 'no_change') {
    update.$push = {
      scalingEvents: {
        timestamp: new Date(),
        action: cycleData.scalingAction,
        from: cycleData.workersFrom,
        to: cycleData.workersTo,
        reason: cycleData.scalingReason
      }
    };
  }

  return this.findOneAndUpdate(
    { date, hour, fuero, workerType },
    update,
    { upsert: true, new: true }
  );
};

/**
 * Obtiene estadísticas de las últimas N horas
 */
workerHourlyStatsSchema.statics.getLastNHours = async function(n = 24, fuero = null, workerType = null) {
  const now = new Date();
  const results = [];

  for (let i = 0; i < n; i++) {
    const time = new Date(now.getTime() - (i * 60 * 60 * 1000));
    const date = time.toISOString().split('T')[0];
    const hour = time.getHours();

    const query = { date, hour };
    if (fuero) query.fuero = fuero;
    if (workerType) query.workerType = workerType;

    const stats = await this.find(query).lean();
    results.push({ date, hour, stats });
  }

  return results.reverse(); // Orden cronológico
};

/**
 * Obtiene resumen del día agrupado por hora
 */
workerHourlyStatsSchema.statics.getDaySummary = async function(date, fuero = null, workerType = null) {
  const query = { date };
  if (fuero) query.fuero = fuero;
  if (workerType) query.workerType = workerType;

  const stats = await this.find(query).sort({ hour: 1 }).lean();

  // Agrupar por hora
  const byHour = {};
  for (let h = 0; h < 24; h++) {
    byHour[h] = {
      processed: 0,
      successful: 0,
      failed: 0,
      movimientosFound: 0,
      avgWorkers: 0
    };
  }

  for (const s of stats) {
    byHour[s.hour].processed += s.stats.processed || 0;
    byHour[s.hour].successful += s.stats.successful || 0;
    byHour[s.hour].failed += s.stats.failed || 0;
    byHour[s.hour].movimientosFound += s.stats.movimientosFound || 0;
    if (s.stats.avgActiveWorkers) {
      byHour[s.hour].avgWorkers = Math.max(byHour[s.hour].avgWorkers, s.stats.avgActiveWorkers);
    }
  }

  return byHour;
};

module.exports = mongoose.model("WorkerHourlyStats", workerHourlyStatsSchema);
