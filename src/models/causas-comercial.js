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
    movimiento: { type: Array },
    movimientosCount: {
      type: Number,
      default: 0
    },
    fechaUltimoMovimiento: { type: Date },
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
        enum: ['scraping', 'scraping-capsolver', 'app', 'api', 'manual'],
        required: true
      },
      movimientosAdded: { type: Number, default: 0 },
      movimientosTotal: { type: Number, default: 0 },
      updateType: { type: String, enum: ['create', 'update', 'verify', 'error'], required: true },
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
    isError: { type: Boolean }
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

module.exports = mongoose.model("CausasComercial", schema);