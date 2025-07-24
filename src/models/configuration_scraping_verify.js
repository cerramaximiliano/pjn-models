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
      default: 'verify_main'
    },
    verification_mode: {
      type: String,
      enum: ['all', 'civil', 'ss', 'trabajo'],
      default: 'all',
      required: true
    },
    last_check: {
      type: Date,
      default: new Date()
    },
    documents_verified: {
      type: Number,
      default: 0
    },
    documents_valid: {
      type: Number,
      default: 0
    },
    documents_invalid: {
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
    captcha: {
      defaultProvider: {
        type: String,
        enum: ['2captcha', 'capsolver'],
        default: '2captcha'
      }
    }
  },
  {
    collection: "configuracion-verificacion",
    timestamps: true
  }
);

module.exports = mongoose.model("ConfiguracionVerificacion", schema);