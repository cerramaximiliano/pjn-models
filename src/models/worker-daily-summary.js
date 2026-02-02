/**
 * Modelo WorkerDailySummary
 * Resumen consolidado diario de todos los workers y fueros
 * Diseñado para visualización rápida en admin UI
 */
const mongoose = require("mongoose");

/**
 * Helper para obtener fecha en zona horaria de Argentina (UTC-3)
 * Esto es importante porque las estadísticas deben agruparse por día local
 */
function getArgentinaDate() {
  const now = new Date();
  // Argentina es UTC-3 (no tiene horario de verano actualmente)
  const argentinaOffset = -3 * 60; // -180 minutos
  const utcMinutes = now.getUTCHours() * 60 + now.getUTCMinutes();
  const argentinaMinutes = utcMinutes + argentinaOffset;

  // Calcular si hay cambio de día
  let dayOffset = 0;
  if (argentinaMinutes < 0) {
    dayOffset = -1; // Día anterior en Argentina
  } else if (argentinaMinutes >= 24 * 60) {
    dayOffset = 1; // Día siguiente en Argentina
  }

  // Crear fecha ajustada
  const argentinaDate = new Date(now);
  argentinaDate.setUTCDate(argentinaDate.getUTCDate() + dayOffset);

  // Formatear fecha como YYYY-MM-DD
  const year = argentinaDate.getUTCFullYear();
  const month = String(argentinaDate.getUTCMonth() + 1).padStart(2, '0');
  const day = String(argentinaDate.getUTCDate()).padStart(2, '0');

  return `${year}-${month}-${day}`;
}

// Schema para estadísticas por fuero
const fueroStatsSchema = new mongoose.Schema({
  fuero: { type: String, required: true },

  // Documentos
  totalDocuments: { type: Number, default: 0 },      // Total en BD
  processed: { type: Number, default: 0 },
  successful: { type: Number, default: 0 },
  failed: { type: Number, default: 0 },
  pendingAtEnd: { type: Number, default: 0 },

  // Movimientos
  movimientosFound: { type: Number, default: 0 },

  // Rendimiento
  avgProcessingTimeMs: { type: Number, default: 0 },
  successRate: { type: Number, default: 0 },         // Porcentaje 0-100

  // Workers
  maxWorkers: { type: Number, default: 0 },
  avgWorkers: { type: Number, default: 0 },

  // Horas activas
  activeHours: [{ type: Number }],                   // [8, 9, 10, ...]
  peakHour: { type: Number },                        // Hora con más procesamiento
  peakHourProcessed: { type: Number }
}, { _id: false });

// Schema para distribución horaria
const hourlyDistributionSchema = new mongoose.Schema({
  hour: { type: Number, required: true },
  processed: { type: Number, default: 0 },
  successful: { type: Number, default: 0 },
  failed: { type: Number, default: 0 },
  movimientosFound: { type: Number, default: 0 },
  avgWorkers: { type: Number, default: 0 }
}, { _id: false });

const workerDailySummarySchema = new mongoose.Schema({
  // Identificador único
  date: {
    type: String,
    required: true,
    unique: true,
    index: true
  }, // Formato: YYYY-MM-DD

  workerType: {
    type: String,
    required: true,
    default: 'app-update',
    index: true
  },

  // Estadísticas globales del día
  totals: {
    // Documentos
    processed: { type: Number, default: 0 },
    successful: { type: Number, default: 0 },
    failed: { type: Number, default: 0 },

    // Movimientos
    movimientosFound: { type: Number, default: 0 },

    // Rendimiento
    avgProcessingTimeMs: { type: Number, default: 0 },
    successRate: { type: Number, default: 0 },

    // Tiempo de trabajo
    totalWorkingHours: { type: Number, default: 0 },
    firstActivityHour: { type: Number },
    lastActivityHour: { type: Number }
  },

  // Estadísticas por fuero
  byFuero: [fueroStatsSchema],

  // Distribución horaria (24 horas)
  hourlyDistribution: [hourlyDistributionSchema],

  // Top 10 causas con más actualizaciones del día
  topCausas: [{
    causaId: { type: mongoose.Schema.Types.ObjectId },
    fuero: { type: String },
    number: { type: Number },
    year: { type: Number },
    updateCount: { type: Number },
    movimientosFound: { type: Number }
  }],

  // Errores más frecuentes del día
  topErrors: [{
    errorType: { type: String },
    count: { type: Number },
    percentage: { type: Number },
    exampleMessage: { type: String }
  }],

  // Estado general
  status: {
    type: String,
    enum: ['pending', 'in_progress', 'completed', 'partial', 'failed'],
    default: 'pending'
  },

  // Alertas del día
  alertsCount: { type: Number, default: 0 },
  hasUnacknowledgedAlerts: { type: Boolean, default: false },

  // Comparación con día anterior
  comparison: {
    processedChange: { type: Number },          // Porcentaje de cambio
    movimientosChange: { type: Number },
    successRateChange: { type: Number },
    trend: { type: String, enum: ['up', 'down', 'stable'] }
  },

  // Metadata
  generatedAt: { type: Date },
  lastUpdate: { type: Date, default: Date.now },
  createdAt: { type: Date, default: Date.now }
}, {
  collection: 'worker-daily-summary',
  timestamps: false
});

// Índice para búsqueda por rango de fechas
workerDailySummarySchema.index({ date: -1 });

/**
 * Genera o actualiza el resumen del día
 */
workerDailySummarySchema.statics.generateSummary = async function(date, workerType = 'app-update') {
  const WorkerDailyStats = mongoose.model('WorkerDailyStats');
  const WorkerHourlyStats = mongoose.model('WorkerHourlyStats');

  // Obtener stats diarios por fuero
  const dailyStats = await WorkerDailyStats.find({ date, workerType }).lean();

  // Obtener stats horarios
  const hourlyStats = await WorkerHourlyStats.find({ date, workerType }).lean();

  // Calcular totales
  const totals = {
    processed: 0,
    successful: 0,
    failed: 0,
    movimientosFound: 0,
    totalProcessingTime: 0,
    successRate: 0,
    totalWorkingHours: 0,
    firstActivityHour: null,
    lastActivityHour: null
  };

  const byFuero = [];
  const activeHoursSet = new Set();

  for (const stats of dailyStats) {
    totals.processed += stats.stats.processed || 0;
    totals.successful += stats.stats.successful || 0;
    totals.failed += stats.stats.failed || 0;
    totals.movimientosFound += stats.stats.movimientosFound || 0;
    totals.totalProcessingTime += stats.stats.totalProcessingTime || 0;

    // Calcular stats por fuero
    const fueroData = {
      fuero: stats.fuero,
      processed: stats.stats.processed || 0,
      successful: stats.stats.successful || 0,
      failed: stats.stats.failed || 0,
      movimientosFound: stats.stats.movimientosFound || 0,
      avgProcessingTimeMs: stats.stats.processed > 0
        ? Math.round(stats.stats.totalProcessingTime / stats.stats.processed)
        : 0,
      successRate: stats.stats.processed > 0
        ? Math.round((stats.stats.successful / stats.stats.processed) * 100)
        : 0,
      activeHours: [],
      maxWorkers: 0,
      avgWorkers: 0
    };

    byFuero.push(fueroData);
  }

  // Procesar datos horarios
  const hourlyDistribution = [];
  for (let h = 0; h < 24; h++) {
    const hourData = {
      hour: h,
      processed: 0,
      successful: 0,
      failed: 0,
      movimientosFound: 0,
      avgWorkers: 0
    };

    const hourStats = hourlyStats.filter(s => s.hour === h);
    for (const hs of hourStats) {
      hourData.processed += hs.stats.processed || 0;
      hourData.successful += hs.stats.successful || 0;
      hourData.failed += hs.stats.failed || 0;
      hourData.movimientosFound += hs.stats.movimientosFound || 0;
      hourData.avgWorkers = Math.max(hourData.avgWorkers, hs.stats.avgActiveWorkers || 0);
    }

    hourlyDistribution.push(hourData);

    if (hourData.processed > 0) {
      activeHoursSet.add(h);
      if (totals.firstActivityHour === null) totals.firstActivityHour = h;
      totals.lastActivityHour = h;
    }
  }

  totals.totalWorkingHours = activeHoursSet.size;
  totals.avgProcessingTimeMs = totals.processed > 0
    ? Math.round(totals.totalProcessingTime / totals.processed)
    : 0;
  totals.successRate = totals.processed > 0
    ? Math.round((totals.successful / totals.processed) * 100)
    : 0;

  // Encontrar peak hour por fuero
  for (const fuero of byFuero) {
    const fueroHourly = hourlyStats.filter(h => h.fuero === fuero.fuero);
    let peakProcessed = 0;
    let peakHour = null;

    for (const h of fueroHourly) {
      if ((h.stats.processed || 0) > peakProcessed) {
        peakProcessed = h.stats.processed;
        peakHour = h.hour;
      }
      if ((h.stats.processed || 0) > 0) {
        fuero.activeHours.push(h.hour);
      }
      fuero.maxWorkers = Math.max(fuero.maxWorkers, h.stats.maxActiveWorkers || 0);
    }

    fuero.peakHour = peakHour;
    fuero.peakHourProcessed = peakProcessed;
  }

  // Obtener comparación con día anterior
  const previousDate = getPreviousDate(date);
  const previousSummary = await this.findOne({ date: previousDate, workerType }).lean();

  let comparison = null;
  if (previousSummary) {
    comparison = {
      processedChange: previousSummary.totals.processed > 0
        ? Math.round(((totals.processed - previousSummary.totals.processed) / previousSummary.totals.processed) * 100)
        : 0,
      movimientosChange: previousSummary.totals.movimientosFound > 0
        ? Math.round(((totals.movimientosFound - previousSummary.totals.movimientosFound) / previousSummary.totals.movimientosFound) * 100)
        : 0,
      successRateChange: Math.round(totals.successRate - previousSummary.totals.successRate),
      trend: totals.processed > previousSummary.totals.processed ? 'up'
        : totals.processed < previousSummary.totals.processed ? 'down'
        : 'stable'
    };
  }

  // Contar alertas
  const alertsCount = dailyStats.reduce((acc, s) => acc + (s.alerts?.length || 0), 0);
  const hasUnacknowledgedAlerts = dailyStats.some(s =>
    s.alerts?.some(a => !a.acknowledged)
  );

  // Determinar status
  let status = 'pending';
  if (totals.processed > 0) {
    const failRate = totals.failed / totals.processed;
    if (failRate > 0.5) {
      status = 'failed';
    } else if (failRate > 0.1) {
      status = 'partial';
    } else {
      status = 'completed';
    }
  }
  if (activeHoursSet.size > 0 && getArgentinaDate() === date) {
    status = 'in_progress';
  }

  // Guardar o actualizar
  const summary = await this.findOneAndUpdate(
    { date, workerType },
    {
      $set: {
        totals,
        byFuero,
        hourlyDistribution,
        comparison,
        status,
        alertsCount,
        hasUnacknowledgedAlerts,
        generatedAt: new Date(),
        lastUpdate: new Date()
      },
      $setOnInsert: { createdAt: new Date() }
    },
    { upsert: true, new: true }
  );

  return summary;
};

/**
 * Obtiene resumen de los últimos N días
 */
workerDailySummarySchema.statics.getLastNDays = async function(n = 7, workerType = 'app-update') {
  const todayStr = getArgentinaDate();
  const dates = [];

  // Parsear fecha de Argentina y generar lista de fechas hacia atrás
  const [year, month, day] = todayStr.split('-').map(Number);
  const baseDate = new Date(Date.UTC(year, month - 1, day));

  for (let i = 0; i < n; i++) {
    const d = new Date(baseDate);
    d.setUTCDate(d.getUTCDate() - i);
    const dateStr = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
    dates.push(dateStr);
  }

  return this.find({
    date: { $in: dates },
    workerType
  }).sort({ date: -1 }).lean();
};

/**
 * Obtiene datos para gráficos (últimos N días)
 */
workerDailySummarySchema.statics.getChartData = async function(n = 30, workerType = 'app-update') {
  const summaries = await this.getLastNDays(n, workerType);

  return summaries.map(s => ({
    date: s.date,
    processed: s.totals.processed,
    successful: s.totals.successful,
    failed: s.totals.failed,
    movimientosFound: s.totals.movimientosFound,
    successRate: s.totals.successRate,
    workingHours: s.totals.totalWorkingHours
  })).reverse();
};

/**
 * Función auxiliar para obtener fecha anterior
 */
function getPreviousDate(dateStr) {
  const [year, month, day] = dateStr.split('-').map(Number);
  const d = new Date(Date.UTC(year, month - 1, day));
  d.setUTCDate(d.getUTCDate() - 1);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
}

module.exports = mongoose.model("WorkerDailySummary", workerDailySummarySchema);
