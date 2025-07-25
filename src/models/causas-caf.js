// Modelo para CAF - Cámara Nacional de Apelaciones en lo Contencioso Administrativo Federal
const mongoose = require('mongoose');
const Schema = mongoose.Schema;

const CausasCAFSchema = new Schema({
  // Identificación básica
  caratula: { type: String, required: true },
  number: { type: String, required: true, index: true },
  year: { type: String, required: true, index: true },
  fuero: { type: String, default: 'CAF', index: true },

  // Datos del juzgado
  juzgado: { type: Number, default: 0 },
  secretaria: { type: Number, default: 0 },

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
    descripcion: { type: String }
  }],

  // Control de actualizaciones
  hash: { type: String },
  updateCount: { type: Number, default: 0 },
  lastCheckedDate: { type: Date },
  dailyUpdateCount: { type: Number, default: 0 },

  // Origen de los datos
  source: { type: String, enum: ['scraping', 'scraping-unified', 'api', 'manual'], default: 'scraping-unified' },
  scrapingDate: { type: Date, default: Date.now },

  // Timestamps
  date: { type: Date, default: Date.now },
  lastUpdate: { type: Date, default: Date.now }
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

module.exports = mongoose.model('CausasCAF', CausasCAFSchema);