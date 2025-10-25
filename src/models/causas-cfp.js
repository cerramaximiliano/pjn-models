// Modelo para CFP - Cámara Criminal y Correccional Federal
const mongoose = require('mongoose');
const Schema = mongoose.Schema;

const CausasCFPSchema = new Schema({
  // Identificación básica
  caratula: { type: String, required: true },
  number: { type: String, required: true, index: true },
  year: { type: String, required: true, index: true },
  fuero: { type: String, default: 'CFP', index: true },
  
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
  
  // Campos específicos para causas penales
  imputado: { type: String },
  delito: { type: String },
  estado_procesal: { type: String },
  fiscalia: { type: String },
  defensor: { type: String },
  
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
  source: { type: String, enum: ['scraping', 'scraping-unified', 'api', 'manual', 'error_verification_worker', 'recovery_worker'], default: 'scraping-unified' },
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
      enum: ['pending', 'in_progress', 'completed', 'partial', 'error'],
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
  },
  
  // Control de actualizaciones
  update: { type: Boolean, default: true }
}, {
  timestamps: true,
  collection: 'causas_cfp'
});

// Índices compuestos
CausasCFPSchema.index({ number: 1, year: 1, fuero: 1 }, { unique: true });
CausasCFPSchema.index({ juzgado: 1, secretaria: 1 });
CausasCFPSchema.index({ verified: 1, isError: 1 });
CausasCFPSchema.index({ 'processingLock.expiresAt': 1 });
CausasCFPSchema.index({ 'processingLock.workerId': 1 });

// Índice compuesto para la query principal del app-update-worker
CausasCFPSchema.index({
    source: 1,
    verified: 1,
    isValid: 1,
    update: 1,
    lastUpdate: 1,
    'processingLock.expiresAt': 1
});

// Método estático para manejar errores E11000 (duplicados)
CausasCFPSchema.statics.safeSave = async function(docData) {
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

module.exports = mongoose.model('CausasCFP', CausasCFPSchema);