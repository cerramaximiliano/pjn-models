/**
 * Modelo WorkerDailyStats
 * Registra estadísticas diarias de los workers por fuero
 * Permite monitorear el estado de las actualizaciones y detectar problemas
 */
const mongoose = require("mongoose");

// Schema para una ejecución individual del worker
const runSchema = new mongoose.Schema({
  startedAt: { type: Date, required: true },
  finishedAt: { type: Date },
  duration: { type: Number }, // milisegundos
  documentsProcessed: { type: Number, default: 0 },
  documentsSuccessful: { type: Number, default: 0 },
  documentsFailed: { type: Number, default: 0 },
  movimientosFound: { type: Number, default: 0 },
  status: {
    type: String,
    enum: ['running', 'completed', 'failed', 'interrupted'],
    default: 'running'
  },
  errorMessage: { type: String } // Si status = failed
}, { _id: true });

// Schema para errores individuales
const errorSchema = new mongoose.Schema({
  timestamp: { type: Date, default: Date.now },
  causaId: { type: mongoose.Schema.Types.ObjectId },
  number: { type: Number },
  year: { type: Number },
  errorType: {
    type: String,
    enum: [
      'captcha_failed',
      'login_failed',
      'timeout',
      'network_error',
      'parse_error',
      'not_found',
      'private_causa',
      'database_error',
      'unknown'
    ],
    default: 'unknown'
  },
  message: { type: String },
  stack: { type: String },
  retryCount: { type: Number, default: 0 }
}, { _id: true });

// Schema principal
const workerDailyStatsSchema = new mongoose.Schema({
  // Identificadores únicos del registro
  date: {
    type: String,
    required: true,
    index: true
  }, // Formato: YYYY-MM-DD

  fuero: {
    type: String,
    required: true,
    enum: ['CIV', 'COM', 'CNT', 'CSS', 'CAF', 'CCF', 'CNE', 'CPE', 'CFP', 'CCC', 'CSJ'],
    index: true
  },

  workerType: {
    type: String,
    required: true,
    enum: ['app-update', 'verify', 'recovery', 'stuck-documents', 'private-causas-update', 'mis-causas'],
    index: true
  },

  // Estadísticas acumuladas del día
  stats: {
    // Documentos
    totalToProcess: { type: Number, default: 0 },
    processed: { type: Number, default: 0 },
    successful: { type: Number, default: 0 },
    failed: { type: Number, default: 0 },
    skipped: { type: Number, default: 0 },

    // Movimientos
    movimientosFound: { type: Number, default: 0 },

    // Clasificación de causas
    privateCausas: { type: Number, default: 0 },
    publicCausas: { type: Number, default: 0 },

    // Captchas
    captchaAttempts: { type: Number, default: 0 },
    captchaSuccessful: { type: Number, default: 0 },
    captchaFailed: { type: Number, default: 0 },

    // Tiempo total de procesamiento (ms)
    totalProcessingTime: { type: Number, default: 0 }
  },

  // Ejecuciones del worker durante el día
  runs: [runSchema],

  // Últimos errores (máximo 100 por día)
  errors: {
    type: [errorSchema],
    validate: [arr => arr.length <= 100, 'Máximo 100 errores por registro']
  },

  // Estado general del día
  status: {
    type: String,
    enum: ['pending', 'in_progress', 'completed', 'partial', 'failed'],
    default: 'pending'
  },

  // Alertas activas
  alerts: [{
    type: {
      type: String,
      enum: ['high_error_rate', 'no_updates', 'slow_processing', 'captcha_issues']
    },
    message: { type: String },
    createdAt: { type: Date, default: Date.now },
    acknowledged: { type: Boolean, default: false }
  }],

  // Metadata
  lastUpdate: { type: Date, default: Date.now },
  createdAt: { type: Date, default: Date.now }
}, {
  collection: 'worker-daily-stats',
  timestamps: false, // Usamos nuestros propios campos
  suppressReservedKeysWarning: true // 'errors' es una palabra reservada pero la usamos intencionalmente
});

// Índice compuesto único para evitar duplicados
workerDailyStatsSchema.index({ date: 1, fuero: 1, workerType: 1 }, { unique: true });

// Índice para consultas por rango de fechas
workerDailyStatsSchema.index({ date: -1, workerType: 1 });

// Índice para alertas activas
workerDailyStatsSchema.index({ 'alerts.acknowledged': 1, status: 1 });

/**
 * Obtiene o crea el registro del día para un fuero y worker
 */
workerDailyStatsSchema.statics.getOrCreateToday = async function(fuero, workerType) {
  const today = new Date().toISOString().split('T')[0]; // YYYY-MM-DD

  let stats = await this.findOne({ date: today, fuero, workerType });

  if (!stats) {
    stats = await this.create({
      date: today,
      fuero,
      workerType,
      status: 'pending'
    });
  }

  return stats;
};

/**
 * Registra el inicio de una ejecución
 */
workerDailyStatsSchema.statics.startRun = async function(fuero, workerType, totalToProcess = 0) {
  const stats = await this.getOrCreateToday(fuero, workerType);

  const run = {
    startedAt: new Date(),
    status: 'running',
    documentsProcessed: 0,
    documentsSuccessful: 0,
    documentsFailed: 0,
    movimientosFound: 0
  };

  stats.runs.push(run);
  stats.status = 'in_progress';

  if (totalToProcess > 0) {
    stats.stats.totalToProcess = totalToProcess;
  }

  stats.lastUpdate = new Date();
  await stats.save();

  return { stats, runId: stats.runs[stats.runs.length - 1]._id };
};

/**
 * Actualiza una ejecución en progreso
 */
workerDailyStatsSchema.statics.updateRun = async function(fuero, workerType, runId, updates) {
  const stats = await this.getOrCreateToday(fuero, workerType);

  const run = stats.runs.id(runId);
  if (run) {
    Object.assign(run, updates);
  }

  stats.lastUpdate = new Date();
  await stats.save();

  return stats;
};

/**
 * Finaliza una ejecución
 */
workerDailyStatsSchema.statics.finishRun = async function(fuero, workerType, runId, finalStats = {}) {
  const stats = await this.getOrCreateToday(fuero, workerType);

  const run = stats.runs.id(runId);
  if (run) {
    run.finishedAt = new Date();
    run.duration = run.finishedAt - run.startedAt;
    run.status = finalStats.status || 'completed';

    if (finalStats.documentsProcessed !== undefined) {
      run.documentsProcessed = finalStats.documentsProcessed;
    }
    if (finalStats.documentsSuccessful !== undefined) {
      run.documentsSuccessful = finalStats.documentsSuccessful;
    }
    if (finalStats.documentsFailed !== undefined) {
      run.documentsFailed = finalStats.documentsFailed;
    }
    if (finalStats.movimientosFound !== undefined) {
      run.movimientosFound = finalStats.movimientosFound;
    }
    if (finalStats.errorMessage) {
      run.errorMessage = finalStats.errorMessage;
    }
  }

  // Actualizar stats acumulados
  if (finalStats.documentsProcessed) {
    stats.stats.processed += finalStats.documentsProcessed;
  }
  if (finalStats.documentsSuccessful) {
    stats.stats.successful += finalStats.documentsSuccessful;
  }
  if (finalStats.documentsFailed) {
    stats.stats.failed += finalStats.documentsFailed;
  }
  if (finalStats.movimientosFound) {
    stats.stats.movimientosFound += finalStats.movimientosFound;
  }
  if (run && run.duration) {
    stats.stats.totalProcessingTime += run.duration;
  }

  // Determinar status del día
  const allRuns = stats.runs;
  const completedRuns = allRuns.filter(r => r.status === 'completed');
  const failedRuns = allRuns.filter(r => r.status === 'failed');

  if (failedRuns.length > 0 && completedRuns.length === 0) {
    stats.status = 'failed';
  } else if (failedRuns.length > 0) {
    stats.status = 'partial';
  } else if (stats.stats.processed >= stats.stats.totalToProcess && stats.stats.totalToProcess > 0) {
    stats.status = 'completed';
  }

  // Verificar si hay alertas
  await checkAndCreateAlerts(stats);

  stats.lastUpdate = new Date();
  await stats.save();

  return stats;
};

/**
 * Incrementa contadores de forma atómica
 */
workerDailyStatsSchema.statics.incrementStats = async function(fuero, workerType, increments) {
  const today = new Date().toISOString().split('T')[0];

  const incObj = {};

  for (const [key, value] of Object.entries(increments)) {
    if (value !== undefined && value !== 0) {
      incObj[`stats.${key}`] = value;
    }
  }

  return this.findOneAndUpdate(
    { date: today, fuero, workerType },
    {
      $inc: incObj,
      $set: { lastUpdate: new Date() },
      $setOnInsert: { date: today, fuero, workerType, createdAt: new Date() }
    },
    { upsert: true, new: true }
  );
};

/**
 * Registra un error
 */
workerDailyStatsSchema.statics.logError = async function(fuero, workerType, errorData) {
  const stats = await this.getOrCreateToday(fuero, workerType);

  // Limitar a 100 errores
  if (stats.errors.length >= 100) {
    stats.errors.shift(); // Eliminar el más antiguo
  }

  stats.errors.push({
    timestamp: new Date(),
    causaId: errorData.causaId,
    number: errorData.number,
    year: errorData.year,
    errorType: errorData.errorType || 'unknown',
    message: errorData.message,
    stack: errorData.stack,
    retryCount: errorData.retryCount || 0
  });

  stats.stats.failed += 1;
  stats.lastUpdate = new Date();

  await stats.save();

  return stats;
};

/**
 * Obtiene resumen del día actual
 */
workerDailyStatsSchema.statics.getTodaySummary = async function(workerType = null) {
  const today = new Date().toISOString().split('T')[0];

  const query = { date: today };
  if (workerType) {
    query.workerType = workerType;
  }

  return this.find(query).lean();
};

/**
 * Obtiene stats por rango de fechas
 */
workerDailyStatsSchema.statics.getByDateRange = async function(fromDate, toDate, fuero = null, workerType = null) {
  const query = {
    date: { $gte: fromDate, $lte: toDate }
  };

  if (fuero) query.fuero = fuero;
  if (workerType) query.workerType = workerType;

  return this.find(query).sort({ date: -1, fuero: 1 }).lean();
};

/**
 * Obtiene alertas activas (no reconocidas)
 */
workerDailyStatsSchema.statics.getActiveAlerts = async function() {
  const today = new Date().toISOString().split('T')[0];

  return this.find({
    date: today,
    'alerts.acknowledged': false
  }).select('date fuero workerType alerts status').lean();
};

/**
 * Función auxiliar para verificar y crear alertas
 */
async function checkAndCreateAlerts(stats) {
  const alerts = [];

  // Alta tasa de errores (>10%)
  if (stats.stats.processed > 10) {
    const errorRate = stats.stats.failed / stats.stats.processed;
    if (errorRate > 0.1) {
      alerts.push({
        type: 'high_error_rate',
        message: `Tasa de errores del ${(errorRate * 100).toFixed(1)}% (${stats.stats.failed}/${stats.stats.processed})`
      });
    }
  }

  // Problemas con captchas (>20% fallidos)
  if (stats.stats.captchaAttempts > 5) {
    const captchaFailRate = stats.stats.captchaFailed / stats.stats.captchaAttempts;
    if (captchaFailRate > 0.2) {
      alerts.push({
        type: 'captcha_issues',
        message: `${(captchaFailRate * 100).toFixed(1)}% de captchas fallidos`
      });
    }
  }

  // Agregar nuevas alertas (evitar duplicados del mismo tipo)
  for (const alert of alerts) {
    const exists = stats.alerts.some(a => a.type === alert.type && !a.acknowledged);
    if (!exists) {
      stats.alerts.push(alert);
    }
  }
}

module.exports = mongoose.model("WorkerDailyStats", workerDailyStatsSchema);
