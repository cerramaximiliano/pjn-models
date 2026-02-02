/**
 * Modelo ConfiguracionExtraInfo
 * Configuración del Extra-Info Worker para extracción de intervinientes
 *
 * Este worker extrae partes y letrados de las causas desde el sitio web del PJN
 * y opcionalmente los sincroniza como contactos en los folders de los usuarios.
 */
const mongoose = require("mongoose");

const schema = new mongoose.Schema(
  {
    // ========== IDENTIFICACIÓN ==========
    worker_id: {
      type: String,
      required: true,
      default: 'extra_info_main'
    },
    name: {
      type: String,
      default: 'extra-info-worker',
      unique: true
    },

    // ========== CONFIGURACIÓN DE PROCESAMIENTO ==========
    processing_mode: {
      type: String,
      enum: ['all', 'civil', 'ss', 'trabajo', 'comercial'],
      default: 'all',
      required: true
    },
    batch_size: {
      type: Number,
      default: 5,
      min: 1,
      max: 20
    },
    // Intervalo entre documentos (ms)
    documentDelay: {
      type: Number,
      default: 2000,
      min: 1000,
      max: 10000
    },

    // ========== HABILITACIÓN ==========
    enabled: {
      type: Boolean,
      default: true
    },
    // Habilitar sincronización a contactos (global)
    // Nota: cada usuario también debe tener preferences.pjn.syncContactsFromIntervinientes = true
    syncContactsEnabled: {
      type: Boolean,
      default: true
    },

    // ========== HORARIO DE TRABAJO ==========
    schedule: {
      // Cron expression para el scheduler
      cronExpression: {
        type: String,
        default: '*/30 * * * *'  // Cada 30 minutos
      },
      // Hora de inicio (0-23)
      workStartHour: {
        type: Number,
        default: 8,
        min: 0,
        max: 23
      },
      // Hora de fin (0-23)
      workEndHour: {
        type: Number,
        default: 22,
        min: 0,
        max: 23
      },
      // Días de trabajo (0=Domingo, 1=Lunes, ..., 6=Sábado)
      workDays: {
        type: [Number],
        default: [1, 2, 3, 4, 5],  // Lunes a Viernes
        validate: {
          validator: function(arr) {
            return arr.every(d => d >= 0 && d <= 6);
          },
          message: 'Los días deben estar entre 0 (Domingo) y 6 (Sábado)'
        }
      },
      // Zona horaria
      timezone: {
        type: String,
        default: 'America/Argentina/Buenos_Aires'
      },
      // Respetar horario de trabajo (si es false, trabaja 24/7)
      respectWorkingHours: {
        type: Boolean,
        default: true
      }
    },

    // ========== CONFIGURACIÓN DE CAPTCHA ==========
    captcha: {
      apiKeys: {
        twocaptcha: {
          key: {
            type: String,
            default: ''
          },
          enabled: {
            type: Boolean,
            default: true
          }
        },
        capsolver: {
          key: {
            type: String,
            default: ''
          },
          enabled: {
            type: Boolean,
            default: false
          }
        }
      },
      defaultProvider: {
        type: String,
        enum: ['2captcha', 'capsolver'],
        default: '2captcha'
      },
      // Balance mínimo antes de alertar
      minBalanceAlert: {
        type: Number,
        default: 5.0
      }
    },

    // ========== CRITERIOS DE ELEGIBILIDAD ==========
    eligibility: {
      // Requiere verified = true
      requireVerified: {
        type: Boolean,
        default: true
      },
      // Requiere isValid = true
      requireValid: {
        type: Boolean,
        default: true
      },
      // Excluir documentos privados (isPrivate = true)
      excludePrivate: {
        type: Boolean,
        default: true
      },
      // Requiere lastUpdate existente
      requireLastUpdate: {
        type: Boolean,
        default: true
      },
      // Modo de prueba: solo procesar causas de usuarios específicos
      testMode: {
        enabled: {
          type: Boolean,
          default: true
        },
        // IDs de usuarios de prueba
        testUserIds: {
          type: [String],
          default: ['6850300d153bccaac42b37db']
        }
      }
    },

    // ========== ESTADÍSTICAS GLOBALES ==========
    stats: {
      documentsProcessed: {
        type: Number,
        default: 0
      },
      documentsSuccess: {
        type: Number,
        default: 0
      },
      documentsError: {
        type: Number,
        default: 0
      },
      intervinientesExtracted: {
        type: Number,
        default: 0
      },
      contactsSynced: {
        type: Number,
        default: 0
      },
      lastReset: {
        type: Date,
        default: Date.now
      }
    },

    // ========== ESTADÍSTICAS DE SESIÓN ACTUAL ==========
    currentSession: {
      startTime: { type: Date },
      documentsProcessed: { type: Number, default: 0 },
      documentsSuccess: { type: Number, default: 0 },
      documentsError: { type: Number, default: 0 },
      intervinientesExtracted: { type: Number, default: 0 },
      contactsSynced: { type: Number, default: 0 }
    },

    // ========== PROGRESO DEL PROCESAMIENTO ==========
    processingProgress: {
      totalEligible: { type: Number, default: 0 },
      processedToday: { type: Number, default: 0 },
      lastEligibleCalculation: { type: Date },
      currentCycleStart: { type: Date },
      completionPercentage: { type: Number, default: 0 }
    },

    // ========== ESTADO ==========
    state: {
      isRunning: {
        type: Boolean,
        default: false
      },
      isWithinWorkingHours: {
        type: Boolean,
        default: false
      },
      lastCycleAt: {
        type: Date
      },
      cycleCount: {
        type: Number,
        default: 0
      },
      lastError: {
        message: { type: String },
        timestamp: { type: Date },
        documentId: { type: mongoose.Schema.Types.ObjectId }
      }
    },

    // ========== ESTADÍSTICAS DIARIAS (HISTORIAL) ==========
    dailyStats: [{
      // Fecha del registro (solo fecha, sin hora) - formato YYYY-MM-DD
      date: {
        type: Date,
        required: true
      },
      // Documentos elegibles al inicio del día
      totalEligible: {
        type: Number,
        default: 0
      },
      // Documentos procesados ese día
      processed: {
        type: Number,
        default: 0
      },
      // Documentos procesados exitosamente
      success: {
        type: Number,
        default: 0
      },
      // Documentos con error
      errors: {
        type: Number,
        default: 0
      },
      // Documentos pendientes al final del día
      pending: {
        type: Number,
        default: 0
      },
      // Intervinientes extraídos ese día
      intervinientesExtracted: {
        type: Number,
        default: 0
      },
      // Contactos sincronizados ese día
      contactsSynced: {
        type: Number,
        default: 0
      },
      // Desglose por fuero
      byFuero: {
        civil: { type: Number, default: 0 },
        comercial: { type: Number, default: 0 },
        segsocial: { type: Number, default: 0 },
        trabajo: { type: Number, default: 0 }
      },
      // Ciclos ejecutados ese día
      cyclesRun: {
        type: Number,
        default: 0
      },
      // Cuando se creó el registro
      createdAt: {
        type: Date,
        default: Date.now
      },
      // Última actualización del registro
      updatedAt: {
        type: Date,
        default: Date.now
      }
    }],

    // ========== TIMESTAMPS LEGACY (compatibilidad) ==========
    last_check: {
      type: Date,
      default: new Date()
    },
    documents_processed: {
      type: Number,
      default: 0
    },
    documents_success: {
      type: Number,
      default: 0
    },
    documents_error: {
      type: Number,
      default: 0
    }
  },
  {
    collection: "configuracion-extra-info",
    timestamps: true
  }
);

// ========== MÉTODOS ESTÁTICOS ==========

/**
 * Obtiene o crea la configuración del worker
 */
schema.statics.getOrCreate = async function(workerId = 'extra_info_main') {
  let config = await this.findOne({ worker_id: workerId });

  if (!config) {
    config = await this.create({
      worker_id: workerId,
      name: `extra-info-${workerId}`
    });
  }

  return config;
};

/**
 * Obtiene la configuración principal (solo valores de config)
 */
schema.statics.getConfig = async function() {
  const doc = await this.findOne({ worker_id: 'extra_info_main' }).lean();
  return doc || null;
};

/**
 * Actualiza valores de configuración
 */
schema.statics.updateConfig = async function(configUpdates) {
  const now = new Date();
  const updateObj = { ...configUpdates, updatedAt: now };

  return this.findOneAndUpdate(
    { worker_id: 'extra_info_main' },
    { $set: updateObj },
    { upsert: true, new: true }
  );
};

/**
 * Verifica si está dentro del horario de trabajo
 */
schema.statics.isWithinWorkingHours = async function() {
  const config = await this.findOne({ worker_id: 'extra_info_main' }).lean();

  if (!config) return false;
  if (!config.schedule?.respectWorkingHours) return true;

  const now = new Date();

  // Convertir a zona horaria configurada
  const options = { timeZone: config.schedule.timezone || 'America/Argentina/Buenos_Aires' };
  const localTimeStr = now.toLocaleString('en-US', options);
  const localTime = new Date(localTimeStr);

  const currentHour = localTime.getHours();
  const currentDay = localTime.getDay();

  const { workStartHour, workEndHour, workDays } = config.schedule;

  // Verificar día
  if (!workDays.includes(currentDay)) {
    return false;
  }

  // Verificar hora
  if (currentHour < workStartHour || currentHour >= workEndHour) {
    return false;
  }

  return true;
};

/**
 * Actualiza el estado actual del worker
 */
schema.statics.updateState = async function(stateData) {
  const now = new Date();

  return this.findOneAndUpdate(
    { worker_id: 'extra_info_main' },
    {
      $set: {
        'state.isRunning': stateData.isRunning ?? true,
        'state.isWithinWorkingHours': stateData.isWithinWorkingHours,
        'state.lastCycleAt': now,
        last_check: now
      },
      $inc: {
        'state.cycleCount': 1
      }
    },
    { upsert: true, new: true }
  );
};

/**
 * Registra un error
 */
schema.statics.logError = async function(error, documentId = null) {
  return this.findOneAndUpdate(
    { worker_id: 'extra_info_main' },
    {
      $set: {
        'state.lastError': {
          message: error.message || String(error),
          timestamp: new Date(),
          documentId: documentId
        }
      },
      $inc: {
        'stats.documentsError': 1,
        'currentSession.documentsError': 1,
        documents_error: 1
      }
    }
  );
};

/**
 * Registra un documento procesado exitosamente
 */
schema.statics.logSuccess = async function(intervinientesCount = 0, contactsSynced = 0) {
  return this.findOneAndUpdate(
    { worker_id: 'extra_info_main' },
    {
      $inc: {
        'stats.documentsProcessed': 1,
        'stats.documentsSuccess': 1,
        'stats.intervinientesExtracted': intervinientesCount,
        'stats.contactsSynced': contactsSynced,
        'currentSession.documentsProcessed': 1,
        'currentSession.documentsSuccess': 1,
        'currentSession.intervinientesExtracted': intervinientesCount,
        'currentSession.contactsSynced': contactsSynced,
        'processingProgress.processedToday': 1,
        documents_processed: 1,
        documents_success: 1
      },
      $set: {
        last_check: new Date()
      }
    }
  );
};

/**
 * Inicia una nueva sesión
 */
schema.statics.startSession = async function() {
  return this.findOneAndUpdate(
    { worker_id: 'extra_info_main' },
    {
      $set: {
        'currentSession.startTime': new Date(),
        'currentSession.documentsProcessed': 0,
        'currentSession.documentsSuccess': 0,
        'currentSession.documentsError': 0,
        'currentSession.intervinientesExtracted': 0,
        'currentSession.contactsSynced': 0,
        'state.isRunning': true
      }
    },
    { upsert: true, new: true }
  );
};

/**
 * Finaliza la sesión actual
 */
schema.statics.endSession = async function() {
  return this.findOneAndUpdate(
    { worker_id: 'extra_info_main' },
    {
      $set: {
        'state.isRunning': false
      }
    }
  );
};

/**
 * Resetea estadísticas globales
 */
schema.statics.resetStats = async function() {
  return this.findOneAndUpdate(
    { worker_id: 'extra_info_main' },
    {
      $set: {
        'stats.documentsProcessed': 0,
        'stats.documentsSuccess': 0,
        'stats.documentsError': 0,
        'stats.intervinientesExtracted': 0,
        'stats.contactsSynced': 0,
        'stats.lastReset': new Date(),
        documents_processed: 0,
        documents_success: 0,
        documents_error: 0
      }
    }
  );
};

/**
 * Obtiene resumen de estadísticas
 */
schema.statics.getStatsSummary = async function() {
  const config = await this.findOne({ worker_id: 'extra_info_main' }).lean();

  if (!config) return null;

  return {
    global: config.stats,
    session: config.currentSession,
    progress: config.processingProgress,
    state: config.state,
    schedule: config.schedule,
    eligibility: config.eligibility
  };
};

// ========== MÉTODOS PARA ESTADÍSTICAS DIARIAS ==========

/**
 * Obtiene la fecha de hoy normalizada (sin hora) en zona horaria de Argentina
 */
schema.statics.getTodayDate = function() {
  const now = new Date();
  const argentinaTime = new Date(now.toLocaleString('en-US', { timeZone: 'America/Argentina/Buenos_Aires' }));
  // Normalizar a medianoche UTC para comparaciones consistentes
  return new Date(Date.UTC(argentinaTime.getFullYear(), argentinaTime.getMonth(), argentinaTime.getDate()));
};

/**
 * Obtiene o crea el registro de estadísticas del día actual
 */
schema.statics.getOrCreateDailyStat = async function(initialEligible = null) {
  const today = this.getTodayDate();

  const config = await this.findOne({ worker_id: 'extra_info_main' });
  if (!config) return null;

  // Buscar si ya existe un registro para hoy
  let todayStat = config.dailyStats.find(stat =>
    stat.date && new Date(stat.date).getTime() === today.getTime()
  );

  if (!todayStat) {
    // Crear nuevo registro para hoy
    todayStat = {
      date: today,
      totalEligible: initialEligible || 0,
      processed: 0,
      success: 0,
      errors: 0,
      pending: initialEligible || 0,
      intervinientesExtracted: 0,
      contactsSynced: 0,
      byFuero: { civil: 0, comercial: 0, segsocial: 0, trabajo: 0 },
      cyclesRun: 0,
      createdAt: new Date(),
      updatedAt: new Date()
    };

    await this.findOneAndUpdate(
      { worker_id: 'extra_info_main' },
      { $push: { dailyStats: todayStat } }
    );
  }

  return todayStat;
};

/**
 * Actualiza las estadísticas del día actual después de procesar un documento
 */
schema.statics.updateDailyStat = async function(data = {}) {
  const today = this.getTodayDate();

  const updateFields = {
    'dailyStats.$.updatedAt': new Date()
  };

  const incFields = {};

  if (data.processed) incFields['dailyStats.$.processed'] = data.processed;
  if (data.success) incFields['dailyStats.$.success'] = data.success;
  if (data.errors) incFields['dailyStats.$.errors'] = data.errors;
  if (data.intervinientesExtracted) incFields['dailyStats.$.intervinientesExtracted'] = data.intervinientesExtracted;
  if (data.contactsSynced) incFields['dailyStats.$.contactsSynced'] = data.contactsSynced;
  if (data.cyclesRun) incFields['dailyStats.$.cyclesRun'] = data.cyclesRun;

  // Actualizar por fuero si se proporciona
  if (data.fuero) {
    const fueroKey = `dailyStats.$.byFuero.${data.fuero}`;
    incFields[fueroKey] = 1;
  }

  const updateObj = { $set: updateFields };
  if (Object.keys(incFields).length > 0) {
    updateObj.$inc = incFields;
  }

  // Buscar y actualizar el registro de hoy
  const result = await this.findOneAndUpdate(
    {
      worker_id: 'extra_info_main',
      'dailyStats.date': today
    },
    updateObj,
    { new: true }
  );

  // Si no existe el registro de hoy, crearlo primero
  if (!result) {
    await this.getOrCreateDailyStat();
    return this.findOneAndUpdate(
      {
        worker_id: 'extra_info_main',
        'dailyStats.date': today
      },
      updateObj,
      { new: true }
    );
  }

  return result;
};

/**
 * Actualiza el total de documentos elegibles y pendientes para hoy
 */
schema.statics.updateDailyEligible = async function(totalEligible, pending = null) {
  const today = this.getTodayDate();

  // Primero asegurar que existe el registro de hoy
  await this.getOrCreateDailyStat(totalEligible);

  return this.findOneAndUpdate(
    {
      worker_id: 'extra_info_main',
      'dailyStats.date': today
    },
    {
      $set: {
        'dailyStats.$.totalEligible': totalEligible,
        'dailyStats.$.pending': pending !== null ? pending : totalEligible,
        'dailyStats.$.updatedAt': new Date()
      }
    },
    { new: true }
  );
};

/**
 * Incrementa el contador de ciclos para hoy
 */
schema.statics.incrementDailyCycles = async function() {
  const today = this.getTodayDate();

  // Asegurar que existe el registro de hoy
  await this.getOrCreateDailyStat();

  return this.findOneAndUpdate(
    {
      worker_id: 'extra_info_main',
      'dailyStats.date': today
    },
    {
      $inc: { 'dailyStats.$.cyclesRun': 1 },
      $set: { 'dailyStats.$.updatedAt': new Date() }
    },
    { new: true }
  );
};

/**
 * Obtiene estadísticas diarias con filtros
 * @param {Object} options - Opciones de filtrado
 * @param {Date} options.startDate - Fecha de inicio
 * @param {Date} options.endDate - Fecha de fin
 * @param {Number} options.limit - Límite de registros
 * @param {String} options.sort - 'asc' o 'desc'
 */
schema.statics.getDailyStats = async function(options = {}) {
  const { startDate, endDate, limit = 30, sort = 'desc' } = options;

  const config = await this.findOne({ worker_id: 'extra_info_main' }).lean();
  if (!config || !config.dailyStats) return [];

  let stats = [...config.dailyStats];

  // Filtrar por rango de fechas
  if (startDate) {
    const start = new Date(startDate);
    stats = stats.filter(s => new Date(s.date) >= start);
  }
  if (endDate) {
    const end = new Date(endDate);
    stats = stats.filter(s => new Date(s.date) <= end);
  }

  // Ordenar
  stats.sort((a, b) => {
    const dateA = new Date(a.date);
    const dateB = new Date(b.date);
    return sort === 'desc' ? dateB - dateA : dateA - dateB;
  });

  // Limitar
  if (limit > 0) {
    stats = stats.slice(0, limit);
  }

  return stats;
};

/**
 * Obtiene resumen de estadísticas por período
 * @param {Number} days - Número de días a considerar
 */
schema.statics.getDailyStatsSummary = async function(days = 30) {
  const config = await this.findOne({ worker_id: 'extra_info_main' }).lean();
  if (!config || !config.dailyStats) {
    return {
      period: days,
      daysWithActivity: 0,
      totals: {
        processed: 0,
        success: 0,
        errors: 0,
        intervinientesExtracted: 0,
        contactsSynced: 0,
        cyclesRun: 0
      },
      averages: {
        processedPerDay: 0,
        successRate: 0,
        intervinientesPerDoc: 0
      },
      byFuero: {
        civil: 0,
        comercial: 0,
        segsocial: 0,
        trabajo: 0
      }
    };
  }

  // Filtrar últimos N días
  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - days);

  const recentStats = config.dailyStats.filter(s =>
    new Date(s.date) >= cutoffDate
  );

  // Calcular totales
  const totals = recentStats.reduce((acc, stat) => ({
    processed: acc.processed + (stat.processed || 0),
    success: acc.success + (stat.success || 0),
    errors: acc.errors + (stat.errors || 0),
    intervinientesExtracted: acc.intervinientesExtracted + (stat.intervinientesExtracted || 0),
    contactsSynced: acc.contactsSynced + (stat.contactsSynced || 0),
    cyclesRun: acc.cyclesRun + (stat.cyclesRun || 0)
  }), {
    processed: 0,
    success: 0,
    errors: 0,
    intervinientesExtracted: 0,
    contactsSynced: 0,
    cyclesRun: 0
  });

  // Calcular totales por fuero
  const byFuero = recentStats.reduce((acc, stat) => ({
    civil: acc.civil + (stat.byFuero?.civil || 0),
    comercial: acc.comercial + (stat.byFuero?.comercial || 0),
    segsocial: acc.segsocial + (stat.byFuero?.segsocial || 0),
    trabajo: acc.trabajo + (stat.byFuero?.trabajo || 0)
  }), { civil: 0, comercial: 0, segsocial: 0, trabajo: 0 });

  const daysWithActivity = recentStats.filter(s => s.processed > 0).length;

  return {
    period: days,
    daysWithActivity,
    totals,
    averages: {
      processedPerDay: daysWithActivity > 0 ? Math.round(totals.processed / daysWithActivity) : 0,
      successRate: totals.processed > 0 ? Math.round((totals.success / totals.processed) * 100) : 0,
      intervinientesPerDoc: totals.success > 0 ? Math.round((totals.intervinientesExtracted / totals.success) * 10) / 10 : 0
    },
    byFuero,
    latestDate: recentStats.length > 0 ?
      new Date(Math.max(...recentStats.map(s => new Date(s.date)))).toISOString() : null
  };
};

/**
 * Limpia estadísticas antiguas (mantiene solo los últimos N días)
 * @param {Number} keepDays - Días a mantener
 */
schema.statics.cleanupOldDailyStats = async function(keepDays = 90) {
  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - keepDays);

  return this.findOneAndUpdate(
    { worker_id: 'extra_info_main' },
    {
      $pull: {
        dailyStats: { date: { $lt: cutoffDate } }
      }
    },
    { new: true }
  );
};

module.exports = mongoose.model("ConfiguracionExtraInfo", schema);
