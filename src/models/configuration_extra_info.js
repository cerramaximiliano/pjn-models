const mongoose = require("mongoose");

const schema = new mongoose.Schema(
  {
    worker_id: {
      type: String,
      required: true,
      default: 'extra_info_main'
    },
    processing_mode: {
      type: String,
      enum: ['all', 'civil', 'ss', 'trabajo', 'comercial'],
      default: 'all',
      required: true
    },
    last_check: {
      type: Date,
      default: new Date()
    },
    documents_processed: {
      type: Number,
      default: 0
    },
    documents_success: {
      type: Number,
      default: 0
    },
    documents_error: {
      type: Number,
      default: 0
    },
    enabled: {
      type: Boolean,
      default: true
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
        }
      },
      defaultProvider: {
        type: String,
        enum: ['2captcha', 'capsolver'],
        default: '2captcha'
      }
    },
    // Estadísticas de la sesión actual
    currentSession: {
      startTime: { type: Date },
      documentsProcessed: { type: Number, default: 0 },
      documentsSuccess: { type: Number, default: 0 },
      documentsError: { type: Number, default: 0 }
    },
    // Progreso del procesamiento
    processingProgress: {
      totalEligible: { type: Number, default: 0 },
      processedToday: { type: Number, default: 0 },
      lastEligibleCalculation: { type: Date },
      currentCycleStart: { type: Date },
      completionPercentage: { type: Number, default: 0 }
    }
  },
  {
    collection: "configuracion-extra-info",
    timestamps: true
  }
);

module.exports = mongoose.model("ConfiguracionExtraInfo", schema);
