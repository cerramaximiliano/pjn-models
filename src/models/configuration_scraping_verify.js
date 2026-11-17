const mongoose = require("mongoose");

const schema = new mongoose.Schema(
  {
    fuero: {
      type: String,
      required: true,
      // 'OTROS' = la config del modo 'otros' (todos los fueros sin worker propio)
      enum: ['CIV', 'CSS', 'CNT', 'COM', 'OTROS']
    },
    worker_id: {
      type: String,
      required: true,
      default: 'verify_main'
    },
    verification_mode: {
      type: String,
      // 'otros' = todos los fueros que no son civil/ss/trabajo/comercial (pjn-workers utils/fueros-pjn.js)
      enum: ['all', 'civil', 'ss', 'trabajo', 'comercial', 'ccf', 'caf', 'otros'],
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
        },
        captchaai: {
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
        enum: ['2captcha', 'capsolver', 'captchaai'],
        default: '2captcha'
      }
    }
  },
  {
    collection: "configuracion-verificacion",
    timestamps: true
  }
);

module.exports = mongoose.models.ConfiguracionVerificacion || mongoose.model("ConfiguracionVerificacion", schema);