// Modelo para CCF - Cámara Nacional de Apelaciones en lo Civil y Comercial Federal
const mongoose = require('mongoose');
const Schema = mongoose.Schema;

const CausasCCFSchema = new Schema({
  // Identificación básica
  caratula: { type: String, required: true },
  number: { type: String, required: true, index: true },
  year: { type: String, required: true, index: true },
  fuero: { type: String, default: 'CCF', index: true },
  
  // Datos del juzgado
  juzgado: { type: Number, default: 0 },
  secretaria: { type: Number, default: 0 },
  
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
  
  // Origen de los datos
  source: { type: String, enum: ['scraping', 'scraping-unified', 'api', 'manual'], default: 'scraping-unified' },
  scrapingDate: { type: Date, default: Date.now },
  
  // Timestamps
  date: { type: Date, default: Date.now },
  lastUpdate: { type: Date, default: Date.now }
}, {
  timestamps: true,
  collection: 'causas_ccf'
});

// Índices compuestos
CausasCCFSchema.index({ number: 1, year: 1, fuero: 1 });
CausasCCFSchema.index({ juzgado: 1, secretaria: 1 });
CausasCCFSchema.index({ verified: 1, isError: 1 });

module.exports = mongoose.model('CausasCCF', CausasCCFSchema);