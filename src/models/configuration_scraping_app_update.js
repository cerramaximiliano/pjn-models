const mongoose = require("mongoose");

const schema = new mongoose.Schema(
  {
    fuero: {
      type: String,
      required: true,
      enum: ['CIV', 'CSS', 'CNT']
    },
    worker_id: {
      type: String,
      required: true,
      default: 'app_update_main'
    },
    update_mode: {
      type: String,
      enum: ['all', 'civil', 'ss', 'trabajo'],
      default: 'all',
      required: true
    },
    last_check: {
      type: Date,
      default: new Date()
    },
    documents_updated: {
      type: Number,
      default: 0
    },
    documents_checked: {
      type: Number,
      default: 0
    },
    documents_failed: {
      type: Number,
      default: 0
    },
    enabled: {
      type: Boolean,
      default: true
    },
    balance: {
      twoCaptcha: {
        type: Boolean,
        default: true
      }
    },
    batch_size: {
      type: Number,
      default: 5,
      min: 1,
      max: 20
    },
    last_update_threshold_hours: {
      type: Number,
      default: 12, // Actualizar documentos más antiguos de 12 horas por defecto
      min: 1
    },
    captcha: {
      defaultProvider: {
        type: String,
        enum: ['2captcha', 'capsolver'],
        default: '2captcha'
      }
    }
  },
  {
    collection: "configuracion-app-update",
    timestamps: true
  }
);

module.exports = mongoose.model("ConfiguracionAppUpdate", schema);