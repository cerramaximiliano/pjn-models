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

  // ========== ESTADO DEL SITIO PJN ==========
  // Reportado por los workers cuando detectan que el portal PJN está
  // devolviendo la página de "Sitio en mantenimiento". Compartido entre los
  // 4 procesos (civil/ss/trabajo/comercial) — el primero que detecta marca,
  // el resto lee el flag y saltea sin abrir browser.
  pjnSiteStatus: {
    status: {
      type: String,
      enum: ['healthy', 'maintenance', 'unknown'],
      default: 'unknown'
    },
    message: { type: String, default: null },
    maintenanceSince: { type: Date, default: null },
    lastDetectedAt: { type: Date, default: null },
    lastDetectedBy: { type: String, default: null },
    lastHealthyAt: { type: Date, default: null },
    consecutiveDetections: { type: Number, default: 0 }
  },

  // ========== ALERTAS ==========
  alerts: [{
    type: {
      type: String,
      enum: ['high_cpu', 'high_memory', 'no_workers', 'high_pending', 'manager_stopped', 'site_maintenance']
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

// Nota: El índice único en 'name' ya está definido en el campo con unique: true

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

/**
 * Devuelve el sub-doc pjnSiteStatus actual (lean).
 * Si el doc no existe aún, retorna null.
 */
managerConfigSchema.statics.getSiteStatus = async function() {
  const doc = await this.findOne(
    { name: 'app-update-manager' },
    { pjnSiteStatus: 1 }
  ).lean();
  return doc?.pjnSiteStatus || null;
};

/**
 * Devuelve true si el sitio PJN está marcado como en mantenimiento y la
 * última detección no es más vieja que `maxAgeMs` (por defecto 5 min).
 * El maxAge evita que el flag quede pegado si por alguna razón nadie
 * reportó healthy: a los 5 min sin reconfirmar, dejamos que un worker
 * intente y descubra el estado real.
 */
managerConfigSchema.statics.isInMaintenance = async function({ maxAgeMs = 5 * 60 * 1000 } = {}) {
  const status = await this.getSiteStatus();
  if (!status || status.status !== 'maintenance') return false;
  if (!status.lastDetectedAt) return true;
  return (Date.now() - new Date(status.lastDetectedAt).getTime()) < maxAgeMs;
};

/**
 * Marca el sitio PJN como en mantenimiento.
 * Si ya estaba en mantenimiento, sólo refresca lastDetectedAt/By e incrementa
 * el contador. Si transiciona desde healthy/unknown, setea maintenanceSince.
 *
 * Retorna { transitioned, wasInMaintenance } para que el caller pueda
 * disparar notificación sólo en la transición.
 */
managerConfigSchema.statics.reportMaintenance = async function(fuero, message = null) {
  const now = new Date();
  const current = await this.findOne(
    { name: 'app-update-manager' },
    { 'pjnSiteStatus.status': 1, 'pjnSiteStatus.maintenanceSince': 1 }
  ).lean();

  const wasInMaintenance = current?.pjnSiteStatus?.status === 'maintenance';

  const setUpdate = {
    'pjnSiteStatus.status': 'maintenance',
    'pjnSiteStatus.message': message,
    'pjnSiteStatus.lastDetectedAt': now,
    'pjnSiteStatus.lastDetectedBy': fuero,
    lastUpdate: now
  };

  const updateOp = { $set: setUpdate };

  if (wasInMaintenance) {
    updateOp.$inc = { 'pjnSiteStatus.consecutiveDetections': 1 };
  } else {
    setUpdate['pjnSiteStatus.maintenanceSince'] = now;
    setUpdate['pjnSiteStatus.consecutiveDetections'] = 1;
  }

  await this.findOneAndUpdate(
    { name: 'app-update-manager' },
    updateOp,
    { upsert: true }
  );

  // Abrir un incident en el historial (idempotente — si ya hay uno abierto
  // sólo refresca el contador). Lazy require para no romper si PjnSiteIncident
  // no está disponible en versiones viejas que reusen este file.
  try {
    const PjnSiteIncident = require('./pjn-site-incident');
    await PjnSiteIncident.openIncident({ detectedBy: fuero, message, startedAt: now });
  } catch (err) {
    // No queremos romper el reporte de mantenimiento por un fallo del historial.
  }

  return {
    transitioned: !wasInMaintenance,
    wasInMaintenance,
    maintenanceSince: wasInMaintenance ? current?.pjnSiteStatus?.maintenanceSince : now
  };
};

/**
 * Marca el sitio PJN como healthy tras una verificación exitosa.
 * Si venía de mantenimiento, retorna transitioned=true para que el caller
 * dispare la notificación de "vuelta a la normalidad".
 */
managerConfigSchema.statics.reportHealthy = async function(fuero) {
  const now = new Date();
  const current = await this.findOne(
    { name: 'app-update-manager' },
    { 'pjnSiteStatus.status': 1, 'pjnSiteStatus.maintenanceSince': 1 }
  ).lean();

  const wasInMaintenance = current?.pjnSiteStatus?.status === 'maintenance';

  await this.findOneAndUpdate(
    { name: 'app-update-manager' },
    {
      $set: {
        'pjnSiteStatus.status': 'healthy',
        'pjnSiteStatus.lastHealthyAt': now,
        'pjnSiteStatus.maintenanceSince': null,
        'pjnSiteStatus.consecutiveDetections': 0,
        'pjnSiteStatus.message': null,
        'pjnSiteStatus.lastDetectedBy': fuero,
        lastUpdate: now
      }
    },
    { upsert: true }
  );

  // Cerrar el incident abierto en el historial. Solo tiene sentido si
  // veníamos de maintenance — si transitioned=false (ya estábamos healthy)
  // no debería haber incident abierto.
  if (wasInMaintenance) {
    try {
      const PjnSiteIncident = require('./pjn-site-incident');
      await PjnSiteIncident.closeIncident({ resolvedBy: fuero, endedAt: now });
    } catch (err) {
      // Idem reportMaintenance: no rompemos el flow principal.
    }
  }

  return {
    transitioned: wasInMaintenance,
    wasInMaintenance,
    previousMaintenanceSince: current?.pjnSiteStatus?.maintenanceSince || null
  };
};

module.exports = mongoose.models.ManagerConfig || mongoose.model("ManagerConfig", managerConfigSchema);