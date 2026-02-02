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

module.exports = mongoose.model("ConfiguracionExtraInfo", schema);
