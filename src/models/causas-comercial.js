const mongoose = require("mongoose");

const schema = new mongoose.Schema(
  {
    date: { type: Date, default: new Date() },
    year: { type: Number },
    number: { type: Number },
    caratula: { type: String },
    info: { type: String },
    fuero: { type: String, default: "COM" },
    objeto: {
      type: String,
      set: function (value) {
        if (!value) return value;
        return value
          .trim() // Eliminar espacios al inicio y final
          .replace(/\s+/g, ' ') // Reemplazar múltiples espacios por uno solo
          .replace(/[\.-]+$/, '') // Eliminar puntos y guiones al final
          .replace(/\n/g, '') // Eliminar saltos de línea
          .replace(/\s*\.\s*$/, ''); // Eliminar punto final y espacios alrededor
      }
    },
    juzgado: { type: Number },
    secretaria: { type: Number },
    juzgadoVerificado: { type: Boolean, default: false },
    juzgadoCorreccionMetodo: { 
      type: String, 
      enum: ['PDF_EXTRACTION', 'ORIGINAL_VALID'],
      required: false
    },
    
    // Agregar nuevos campos
    sala: { type: Number, default: 0 },
    vocalia: { type: Number, default: 0 },
    
    // Campo para identificar el tipo
    tipoOrganizacion: {
      type: String,
      enum: ['juzgado-secretaria', 'sala-vocalia', 'mixto'],
      default: 'juzgado-secretaria'
    },
    
    // Texto completo de la organización
    organizacionTextoCompleto: { type: String },
    movimiento: { type: Array },
    movimientosCount: {
      type: Number,
      default: 0
    },
    fechaUltimoMovimiento: { type: Date },

    // INSTANCIA ORIGEN
    instanciaOrigen: {
        tipo: { type: String },
        juzgado: { type: Number },
        secretaria: { type: Number },
        sala: { type: Number },
        vocalia: { type: Number },
        organismo: { type: String },
        textoCompleto: { type: String },
        fechaPrimerMovimiento: { type: Date },
        fuenteDatos: { type: String },
        movimientoFuente: {
            tipo: { type: String },
            fecha: { type: Date },
            url: { type: String }
        }
    },

    // INSTANCIA REVISORA
    instanciaRevisora: {
        tipo: { type: String },
        sala: { type: Number },
        vocalia: { type: Number },
        secretaria: { type: Number },
        organismo: { type: String },
        textoCompleto: { type: String },
        fechaPrimerMovimiento: { type: Date },
        fuenteDatos: { type: String },
        movimientoFuente: {
            tipo: { type: String },
            fecha: { type: Date },
            url: { type: String }
        }
    },

    // INSTANCIA EXTRAORDINARIA
    instanciaExtraordinaria: {
        tipo: { type: String },
        secretaria: { type: Number },
        organismo: { type: String },
        textoCompleto: { type: String },
        fechaPrimerMovimiento: { type: Date },
        fuenteDatos: { type: String },
        movimientoFuente: {
            tipo: { type: String },
            fecha: { type: Date },
            url: { type: String }
        }
    },

    // SISTEMA DE VERIFICACIÓN COMPLETO
    verificacionInstancias: {
        // Verificación por nivel
        origenVerificada: { type: Boolean },
        origenFecha: { type: Date },
        origenIntentos: { type: Number },

        revisoraVerificada: { type: Boolean },
        revisoraFecha: { type: Date },
        revisoraIntentos: { type: Number },
        revisoraPosible: { type: Boolean },

        extraordinariaVerificada: { type: Boolean },
        extraordinariaFecha: { type: Date },
        extraordinariaIntentos: { type: Number },
        extraordinariaPosible: { type: Boolean },

        // Configuración del expediente
        configuracionInstancias: {
            tipoInicio: { type: String },
            maxInstanciasPosibles: { type: Number },
            instanciasDetectadas: { type: Number },
            instanciasEsperadas: { type: Number }
        },

        // Estado de verificación
        completamenteVerificado: { type: Boolean },
        parcialmenteVerificado: { type: Boolean },
        verificacionCompleta: { type: Boolean },

        // Estado del expediente
        expedienteActivo: { type: Boolean },
        expedienteFinalizado: { type: Boolean },
        tieneRecursoExtraordinario: { type: Boolean },
        tieneApelacion: { type: Boolean },

        // Control de re-verificación
        requiereReVerificacion: { type: Boolean },
        motivoReVerificacion: { type: String },
        proximaVerificacion: { type: Date },

        // Metadata
        ultimaVerificacion: { type: Date },
        metodoVerificacion: { type: String },
        versionEsquema: { type: String }
    },
    lastUpdate: { type: Date, default: Date.now },
    max_number: { type: Number },
    balance: { type: Object },
    userCausaIds: [{ type: mongoose.Schema.Types.ObjectId, ref: 'UserCausa' }],
    folderIds: [{ type: mongoose.Schema.Types.ObjectId, ref: 'FolderId' }],
    source: {
      type: String,
      default: "scraping"
    },
    verified: {
      type: Boolean,
      default: false,
      index: true
    },
    isValid: {
      type: Boolean,
      default: null,
      index: true
    },
    update: {
      type: Boolean,
      default: false,
      index: true
    },
    userUpdatesEnabled: [{
      userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
      enabled: { type: Boolean, default: true }
    }],
    updateHistory: [{
      timestamp: { type: Date, required: true },
      source: {
        type: String,
        enum: ['scraping', 'scraping-capsolver', 'app', 'api', 'manual', 'error_verification_worker', 'recovery_worker', 'stuck_documents_worker', 'verify_worker_recovery', 'cache'],
        required: true
      },
      movimientosAdded: { type: Number, default: 0 },
      movimientosTotal: { type: Number, default: 0 },
      updateType: { type: String, enum: ['create', 'update', 'verify', 'error', 'recovery', 'stuck_fix', 'reset_for_reverification'], required: true },
      success: { type: Boolean, default: true },
      movimientosAdded: Number,
      movimientosTotal: Number,
      details: {
        number: String,
        year: String,
        fuero: String,
        juzgado: Number,
        captchaSkipped: Boolean,
        message: String,
        previousMovimientosCount: Number
      }
    }],
    emailsScraped: {
      type: Boolean,
      default: false,
      index: true
    },
    emailExtractionDate: {
      type: Date
    },
    emailsFound: {
      type: Boolean,
      default: false
    },
    emailExtractionError: {
      type: String
    },
    captchaSkipped: {
      type: Boolean,
      default: false
    },
    error: {
      type: {
        type: String,
        enum: ['captcha_failed', 'captcha_skipped', 'captcha_skipped_error', 'page_load_timeout', 'network_error',
          'navigation_error', 'data_extraction_error'],
        required: false
      },
      message: String,
      timestamp: Date,
      availableData: [mongoose.Schema.Types.Mixed] // Array para guardar cualquier dato disponible
    },
    isError: { type: Boolean },
    lastCheckedDate: { type: Date },
    dailyUpdateCount: { type: Number, default: 0 },

    scrapingProgress: {
      isComplete: {
        type: Boolean,
        default: false,
        required: false
      },
      totalExpected: {
        type: Number,
        default: 0,
        required: false
      },
      totalProcessed: {
        type: Number,
        default: 0,
        required: false
      },
      status: {
        type: String,
        enum: ['pending', 'in_progress', 'completed', 'partial', 'error', 'invalid'],
        default: 'pending',
        required: false
      }
    },

    // Bloqueo para procesamiento
    processingLock: {
      type: {
        workerId: {
          type: String,
          required: true
        },
        lockedAt: {
          type: Date,
          required: true,
          default: Date.now
        },
        expiresAt: {
          type: Date,
          required: true
        }
      },
      required: false,
      default: undefined
    }
  },
  {
    collection: "causas-comercial",
    timestamps: true
  }
);

schema.pre('save', function (next) {
  try {
    if (this.isModified('movimiento') && this.movimiento && this.movimiento.length > 0) {
      this.movimientosCount = this.movimiento.length;
      const fechas = this.movimiento
        .filter(mov => mov && mov.fecha)
        .map(mov => new Date(mov.fecha));

      if (fechas.length > 0) {
        this.fechaUltimoMovimiento = new Date(Math.max(...fechas));
      }
    }
    next();
  } catch (error) {
    logger.error(`Error en pre-save middleware: ${error}`);
    next(error); // Propaga el error
  }
});

schema.pre(['updateOne', 'findOneAndUpdate'], async function (next) {
  const update = this.getUpdate();
  if (update.movimiento || update.$set?.movimiento) {
    const movimiento = update.movimiento || update.$set.movimiento;
    this.set({ movimientosCount: movimiento.length });
  }
  next();
});

// Índices compuestos
schema.index({ number: 1, year: 1, fuero: 1 }, { unique: true });
schema.index({ 'processingLock.expiresAt': 1 });
schema.index({ 'processingLock.workerId': 1 });

// Índice compuesto para la query principal del app-update-worker
schema.index({
    source: 1,
    verified: 1,
    isValid: 1,
    update: 1,
    lastUpdate: 1,
    'processingLock.expiresAt': 1
});

// Método estático para manejar errores E11000 (duplicados)
schema.statics.safeSave = async function(docData) {
    try {
        const newDoc = new this(docData);
        return await newDoc.save();
    } catch (error) {
        if (error.code === 11000) {
            // Error de clave duplicada - actualizar documento existente
            const { number, year, fuero } = docData;
            return await this.findOneAndUpdate(
                { number, year, fuero },
                { $set: docData },
                { new: true, upsert: true }
            );
        }
        throw error;
    }
};

module.exports = mongoose.model("CausasComercial", schema);