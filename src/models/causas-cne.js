// Modelo para CNE - Cámara Nacional Electoral
const mongoose = require('mongoose');
const Schema = mongoose.Schema;

const CausasCNESchema = new Schema({
  // Identificación básica
  caratula: { type: String, required: true },

  // PARTES PROCESALES (extraídas de carátula)
  partes: {
      actor: { type: String },
      demandado: { type: String },
      actorPlural: { type: Boolean, default: false },
      demandadoPlural: { type: Boolean, default: false },
      causante: { type: String },
      esSucesion: { type: Boolean, default: false },
      tipoSucesion: { type: String },
      tienePartes: { type: Boolean, default: false },
      fechaExtraccion: { type: Date },
      nombres: [{ type: String }]  // Array para búsqueda indistinta actor/demandado/causante
  },

  number: { type: String, required: true, index: true },
  year: { type: String, required: true, index: true },
  fuero: { type: String, default: 'CNE', index: true },
  
  // Datos del juzgado
  juzgado: { type: Number, default: 0 },
  secretaria: { type: Number, default: 0 },
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
  
  // Información del expediente
  objeto: { type: String },
  info: { type: String },
  
  // Estado del documento
  isValid: { type: Boolean, default: true },
  verified: { type: Boolean, default: false },
  isError: { type: Boolean, default: false },
  // Indica si la causa es privada (solo accesible con login)
  // null = no verificado aún, true = privada, false = pública
  isPrivate: { type: Boolean, default: null, index: true },
  // Indica si la causa está archivada (todos los movimientos en VER HISTÓRICAS)
  // null = no verificado aún, true = archivada, false = activa
  isArchived: { type: Boolean, default: null, index: true },
  archivedDetectedAt: { type: Date },
  // Credenciales PJN vinculadas (usuarios que tienen acceso a esta causa via login)
  linkedCredentials: [{
    credentialsId: { type: mongoose.Schema.Types.ObjectId, ref: 'PjnCredentials', required: true },
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    linkedAt: { type: Date, default: Date.now },
    source: { type: String, enum: ['sync', 'manual'], default: 'sync' }
  }],

  // Campos para vinculación de folders
  folderIds: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Folder' }],
  userCausaIds: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
  userUpdatesEnabled: [{
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    enabled: { type: Boolean, default: true }
  }],
  updateHistory: [{
    timestamp: { type: Date, required: true },
    source: {
      type: String,
      enum: ['scraping', 'scraping-capsolver', 'app', 'api', 'manual', 'admin_manual', 'error_verification_worker', 'recovery_worker', 'stuck_documents_worker', 'verify_worker_recovery', 'cache'],
      required: true
    },
    movimientosAdded: { type: Number, default: 0 },
    movimientosTotal: { type: Number, default: 0 },
    updateType: { type: String, enum: ['create', 'update', 'verify', 'error', 'recovery', 'stuck_fix', 'reset_for_reverification', 'link', 'unlink', 'privacy_change', 'privacy_reset'], required: true },
    success: { type: Boolean, default: true },
    movimientosDetails: [{
      fecha: Date,
      detalle: String
    }],
    details: {
      number: String,
      year: String,
      fuero: String,
      juzgado: Number,
      captchaSkipped: Boolean,
      message: String,
      previousMovimientosCount: Number,
      documentId: String,
      folderId: String,
      userId: String,
      caratulaUpdated: Boolean,
      objetoUpdated: Boolean,
      juzgadoUpdated: Boolean,
      secretariaUpdated: Boolean
    }
  }],

  errorType: {
    type: String,
    enum: ['captcha_failed', 'captcha_skipped', 'page_load_timeout', 'network_error', 'navigation_error', 'data_extraction_error'],
    required: false
  },
  errorDetails: { type: Schema.Types.Mixed },
  
  // Movimientos
  movimiento: [{
    fecha: { type: Date },
    descripcion: { type: String }
  }],

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
  
  // Control de actualizaciones
  hash: { type: String },
  updateCount: { type: Number, default: 0 },
  lastCheckedDate: { type: Date },
  dailyUpdateCount: { type: Number, default: 0 },
  
  // Origen de los datos
  source: { type: String, enum: ['scraping', 'scraping-unified', 'api', 'manual', 'error_verification_worker', 'recovery_worker', 'cache', 'pjn-login'], default: 'scraping-unified' },
  scrapingDate: { type: Date, default: Date.now },

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
    },
    // Campos para sistema de cooldown de errores
    consecutiveErrors: {
      type: Number,
      default: 0,
      required: false
    },
    lastErrorType: {
      type: String,
      required: false
    },
    lastErrorAt: {
      type: Date,
      required: false
    },
    skipUntil: {
      type: Date,
      required: false
    }
  },

  // ESTADÍSTICAS DE ACTUALIZACIÓN (liviano, por documento)
  updateStats: {
    count: { type: Number, default: 0 },      // Total actualizaciones (all time)
    errors: { type: Number, default: 0 },     // Total errores
    newMovs: { type: Number, default: 0 },    // Total movimientos encontrados
    avgMs: { type: Number, default: 0 },      // Duración promedio en ms
    last: { type: Date },                     // Última actualización
    today: {
      date: { type: String },               // "2026-02-01"
      count: { type: Number, default: 0 },
      hours: [{ type: Number }]             // [8, 11, 14]
    }
  },

  // Timestamps
  date: { type: Date, default: Date.now },
  lastUpdate: { type: Date, default: Date.now },

  // Bloqueo para procesamiento
  processingLock: {
    workerId: { type: String },
    lockedAt: { type: Date, default: Date.now },
    expiresAt: { type: Date }
  },
  
  // Control de actualizaciones
  update: { type: Boolean, default: true }
}, {
  timestamps: true,
  collection: 'causas_cne'
});

// Índices compuestos
CausasCNESchema.index({ number: 1, year: 1, fuero: 1 }, { unique: true });
CausasCNESchema.index({ juzgado: 1, secretaria: 1 });
CausasCNESchema.index({ verified: 1, isError: 1 });
CausasCNESchema.index({ 'processingLock.expiresAt': 1 });
CausasCNESchema.index({ 'processingLock.workerId': 1 });

// Índice compuesto para la query principal del app-update-worker
CausasCNESchema.index({
    source: 1,
    verified: 1,
    isValid: 1,
    update: 1,
    lastUpdate: 1,
    'processingLock.expiresAt': 1
});

// Índice para el sistema de cooldown de errores
CausasCNESchema.index({ 'scrapingProgress.skipUntil': 1 });

// Método estático para manejar errores E11000 (duplicados)
CausasCNESchema.statics.safeSave = async function(docData) {
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

module.exports = mongoose.model('CausasCNE', CausasCNESchema);