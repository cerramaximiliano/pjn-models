/**
 * Modelo ManagerConfig
 * Configuración y estado del App Update Manager
 * Permite centralizar configuración y monitorear el estado de los workers
 */
const mongoose = require("mongoose");

// Schema para snapshot de estado
const stateSnapshotSchema = new mongoose.Schema({
  timestamp: { type: Date, default: Date.now },
  workers: {
    civil: { type: Number, default: 0 },
    ss: { type: Number, default: 0 },
    trabajo: { type: Number, default: 0 },
    comercial: { type: Number, default: 0 }
  },
  pending: {
    civil: { type: Number, default: 0 },
    ss: { type: Number, default: 0 },
    trabajo: { type: Number, default: 0 },
    comercial: { type: Number, default: 0 }
  },
  systemResources: {
    cpuUsage: { type: Number },
    memoryUsage: { type: Number },
    freeMemoryMB: { type: Number }
  }
}, { _id: false });

const managerConfigSchema = new mongoose.Schema({
  // Identificador único (solo debe haber un documento)
  name: {
    type: String,
    default: 'app-update-manager',
    unique: true,
    required: true
  },

  // ========== CONFIGURACIÓN ==========
  config: {
    // Intervalo de verificación (ms)
    checkInterval: { type: Number, default: 60000 },

    // Límites de workers
    maxWorkers: { type: Number, default: 3 },
    minWorkers: { type: Number, default: 0 },

    // Umbrales de escalado
    scaleThreshold: { type: Number, default: 500 },
    scaleDownThreshold: { type: Number, default: 50 },

    // Threshold de actualización (horas)
    updateThresholdHours: { type: Number, default: 12 },

    // Límites de recursos
    cpuThreshold: { type: Number, default: 0.75 },
    memoryThreshold: { type: Number, default: 0.80 },

    // Horario de trabajo
    workStartHour: { type: Number, default: 8 },
    workEndHour: { type: Number, default: 22 },
    workDays: { type: [Number], default: [1, 2, 3, 4, 5] }, // Lun-Vie

    // Nombres de workers en PM2
    workerNames: {
      civil: { type: String, default: 'pjn-app-update-civil' },
      ss: { type: String, default: 'pjn-app-update-ss' },
      trabajo: { type: String, default: 'pjn-app-update-trabajo' },
      comercial: { type: String, default: 'pjn-app-update-comercial' }
    }
  },

  // ========== ESTADO ACTUAL ==========
  currentState: {
    // Workers activos por fuero
    workers: {
      civil: { type: Number, default: 0 },
      ss: { type: Number, default: 0 },
      trabajo: { type: Number, default: 0 },
      comercial: { type: Number, default: 0 }
    },

    // Documentos pendientes por fuero
    pending: {
      civil: { type: Number, default: 0 },
      ss: { type: Number, default: 0 },
      trabajo: { type: Number, default: 0 },
      comercial: { type: Number, default: 0 }
    },

    // Workers óptimos calculados
    optimalWorkers: {
      civil: { type: Number, default: 0 },
      ss: { type: Number, default: 0 },
      trabajo: { type: Number, default: 0 },
      comercial: { type: Number, default: 0 }
    },

    // Recursos del sistema
    systemResources: {
      cpuUsage: { type: Number },
      memoryUsage: { type: Number },
      freeMemoryMB: { type: Number },
      totalMemoryMB: { type: Number }
    },

    // Estado del manager
    isRunning: { type: Boolean, default: false },
    isWithinWorkingHours: { type: Boolean, default: false },
    lastCycleAt: { type: Date },
    cycleCount: { type: Number, default: 0 }
  },

  // ========== HISTORIAL ==========
  // Últimos N snapshots para monitoreo
  history: {
    type: [stateSnapshotSchema],
    validate: [arr => arr.length <= 1440, 'Máximo 1440 snapshots (24h con intervalos de 1min)']
  },

  // ========== ALERTAS ==========
  alerts: [{
    type: {
      type: String,
      enum: ['high_cpu', 'high_memory', 'no_workers', 'high_pending', 'manager_stopped']
    },
    message: { type: String },
    fuero: { type: String },
    createdAt: { type: Date, default: Date.now },
    acknowledged: { type: Boolean, default: false }
  }],

  // ========== METADATA ==========
  lastUpdate: { type: Date, default: Date.now },
  createdAt: { type: Date, default: Date.now }
}, {
  collection: 'manager-config',
  timestamps: false
});

// Índice único para el nombre
managerConfigSchema.index({ name: 1 }, { unique: true });

/**
 * Obtiene o crea la configuración del manager
 */
managerConfigSchema.statics.getOrCreate = async function() {
  let config = await this.findOne({ name: 'app-update-manager' });

  if (!config) {
    config = await this.create({ name: 'app-update-manager' });
  }

  return config;
};

/**
 * Actualiza el estado actual del manager
 */
managerConfigSchema.statics.updateCurrentState = async function(stateData) {
  const now = new Date();

  return this.findOneAndUpdate(
    { name: 'app-update-manager' },
    {
      $set: {
        'currentState.workers': stateData.workers,
        'currentState.pending': stateData.pending,
        'currentState.optimalWorkers': stateData.optimalWorkers,
        'currentState.systemResources': stateData.systemResources,
        'currentState.isRunning': true,
        'currentState.isWithinWorkingHours': stateData.isWithinWorkingHours,
        'currentState.lastCycleAt': now,
        lastUpdate: now
      },
      $inc: {
        'currentState.cycleCount': 1
      }
    },
    { upsert: true, new: true }
  );
};

/**
 * Agrega un snapshot al historial
 */
managerConfigSchema.statics.addSnapshot = async function(snapshotData) {
  const config = await this.findOne({ name: 'app-update-manager' });

  if (!config) {
    return null;
  }

  // Agregar snapshot
  config.history.push({
    timestamp: new Date(),
    workers: snapshotData.workers,
    pending: snapshotData.pending,
    systemResources: snapshotData.systemResources
  });

  // Mantener solo los últimos 1440 snapshots (24h)
  if (config.history.length > 1440) {
    config.history = config.history.slice(-1440);
  }

  config.lastUpdate = new Date();
  await config.save();

  return config;
};

/**
 * Obtiene la configuración (solo los valores de config)
 */
managerConfigSchema.statics.getConfig = async function() {
  const doc = await this.findOne({ name: 'app-update-manager' }).lean();
  return doc?.config || null;
};

/**
 * Actualiza valores de configuración
 */
managerConfigSchema.statics.updateConfig = async function(configUpdates) {
  const updateObj = {};

  for (const [key, value] of Object.entries(configUpdates)) {
    updateObj[`config.${key}`] = value;
  }

  updateObj.lastUpdate = new Date();

  return this.findOneAndUpdate(
    { name: 'app-update-manager' },
    { $set: updateObj },
    { upsert: true, new: true }
  );
};

/**
 * Marca el manager como detenido
 */
managerConfigSchema.statics.markStopped = async function() {
  return this.findOneAndUpdate(
    { name: 'app-update-manager' },
    {
      $set: {
        'currentState.isRunning': false,
        lastUpdate: new Date()
      }
    }
  );
};

/**
 * Obtiene historial por rango de tiempo
 */
managerConfigSchema.statics.getHistory = async function(hoursBack = 24) {
  const config = await this.findOne({ name: 'app-update-manager' }).lean();

  if (!config || !config.history) {
    return [];
  }

  const cutoff = new Date(Date.now() - hoursBack * 60 * 60 * 1000);
  return config.history.filter(s => new Date(s.timestamp) >= cutoff);
};

/**
 * Agrega una alerta
 */
managerConfigSchema.statics.addAlert = async function(alertData) {
  return this.findOneAndUpdate(
    { name: 'app-update-manager' },
    {
      $push: {
        alerts: {
          $each: [alertData],
          $slice: -100 // Mantener solo las últimas 100 alertas
        }
      },
      $set: { lastUpdate: new Date() }
    },
    { upsert: true, new: true }
  );
};

/**
 * Obtiene alertas activas (no reconocidas)
 */
managerConfigSchema.statics.getActiveAlerts = async function() {
  const config = await this.findOne({ name: 'app-update-manager' }).lean();

  if (!config || !config.alerts) {
    return [];
  }

  return config.alerts.filter(a => !a.acknowledged);
};

module.exports = mongoose.model("ManagerConfig", managerConfigSchema);
