// Modelo para CAF - Cámara Nacional de Apelaciones en lo Contencioso Administrativo Federal
const mongoose = require('mongoose');
const Schema = mongoose.Schema;

const CausasCAFSchema = new Schema({
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
  fuero: { type: String, default: 'CAF', index: true },

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
  errorType: {
    type: String,
    enum: ['captcha_failed', 'captcha_skipped', 'page_load_timeout', 'network_error', 'navigation_error', 'data_extraction_error'],
    required: false
  },
  errorDetails: { type: Schema.Types.Mixed },

  // Movimientos
  movimiento: [{
    fecha: { type: Date },
    tipo: { type: String },
    url: { type: String },
    descripcion: { type: String },
    detalle: { type: String },

    // CAMPOS PARA TRACKING DE EMBEDDINGS
    embeddingDocId: {
      type: Schema.Types.ObjectId,
      ref: 'DocumentEmbedding',
      comment: 'Referencia al documento de embedding generado'
    },
    embeddingStatus: {
      type: String,
      enum: ['pending', 'completed', 'failed', 'skipped', 'no_url'],
      default: 'pending',
      comment: 'Estado del procesamiento de embeddings'
    },
    embeddingProcessedAt: {
      type: Date,
      comment: 'Fecha de procesamiento del embedding'
    }
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

  // ============================================
  // PROCESAMIENTO DE EMBEDDINGS
  // ============================================
  embeddingsProcessing: {
    // Contadores
    total: { type: Number, default: 0, comment: 'Total de movimientos' },
    eligible: { type: Number, default: 0, comment: 'Movimientos con URL válida (elegibles para embeddings)' },
    processed: { type: Number, default: 0, comment: 'Movimientos ya procesados' },
    failed: { type: Number, default: 0, comment: 'Movimientos que fallaron en el procesamiento' },

    // Estados generales
    hasEligible: { type: Boolean, default: false, comment: 'Indica si tiene al menos un movimiento elegible' },
    allProcessed: { type: Boolean, default: false, comment: 'Indica si todos los movimientos elegibles fueron procesados' },

    // Timestamps
    lastProcessedAt: { type: Date, comment: 'Última vez que se procesó un movimiento' },
    lastScanAt: { type: Date, comment: 'Última vez que se escaneó para elegibilidad' }
  },

  // Control de actualizaciones
  hash: { type: String },
  updateCount: { type: Number, default: 0 },
  lastCheckedDate: { type: Date },
  dailyUpdateCount: { type: Number, default: 0 },

  // Origen de los datos
  source: { type: String, enum: ['scraping', 'scraping-unified', 'api', 'manual', 'error_verification_worker', 'recovery_worker', 'cache'], default: 'scraping-unified' },
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
    }
  },

  // Timestamps
  date: { type: Date, default: Date.now },
  lastUpdate: { type: Date, default: Date.now },

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
}, {
  timestamps: true,
  collection: 'causas_caf'
});

// Índices compuestos
CausasCAFSchema.index({ number: 1, year: 1, fuero: 1 }, { unique: true });
CausasCAFSchema.index({ juzgado: 1, secretaria: 1 });
CausasCAFSchema.index({ verified: 1, isError: 1 });

// NUEVOS ÍNDICES para optimizar queries con processingLock
CausasCAFSchema.index({ 'processingLock.expiresAt': 1 });
CausasCAFSchema.index({ 'processingLock.workerId': 1 });

// Índice compuesto para la query principal del app-update-worker
CausasCAFSchema.index({
  source: 1,
  verified: 1,
  isValid: 1,
  update: 1,
  lastUpdate: 1,
  'processingLock.expiresAt': 1
});

// Método estático para manejar errores E11000 (duplicados)
CausasCAFSchema.statics.safeSave = async function(docData) {
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

module.exports = mongoose.model('CausasCAF', CausasCAFSchema);