const mongoose = require("mongoose");

const schema = new mongoose.Schema(
  {
    fuero: { 
      type: String, 
      required: true,
      enum: ['CIV', 'CSS', 'CNT'] 
    },
    year: { 
      type: Number, 
      required: true 
    },
    number: { 
      type: Number, 
      required: true 
    },
    max_number: { 
      type: Number, 
      required: true 
    },
    consecutive_not_found: { 
      type: Number, 
      default: 0 
    },
    last_check: { 
      type: Date 
    },
    worker_id: {
      type: String,
      required: true,
      default: 'main'
    },
    range_start: {
      type: Number,
      default: 1
    },
    range_end: {
      type: Number
    },
    enabled: {
      type: Boolean,
      default: true
    },
    completionEmailSent: {
      type: Boolean,
      default: false
    },
    balance: {
      twoCaptcha: { 
        type: Boolean, 
        default: true 
      },
      startOfDay: {
        type: Number,
        default: 0
      },
      current: {
        type: Number,
        default: 0
      },
      lastUpdate: {
        type: Date
      },
      provider: {
        type: String,
        enum: ['2captcha', 'capsolver'],
        default: '2captcha'
      },
      capsolver: {
        type: Boolean,
        default: false
      }
    },
    capsolver: {
      dailySpent: {
        type: Number,
        default: 0
      },
      dailyCaptchas: {
        type: Number,
        default: 0
      },
      totalSpent: {
        type: Number,
        default: 0
      },
      totalCaptchas: {
        type: Number,
        default: 0
      },
      totalCaptchasAttempted: {
        type: Number,
        default: 0
      },
      totalCaptchasFailed: {
        type: Number,
        default: 0
      },
      costPer1000: {
        current: {
          type: Number,
          default: 0
        },
        history: [{
          milestone: Number,  // En qué número de captcha exitoso se calculó
          totalSpentAtMilestone: Number,  // Gasto total hasta ese momento
          successfulCaptchas: Number,  // Captchas exitosos hasta ese momento
          attemptedCaptchas: Number,  // Captchas intentados hasta ese momento
          costPer1000Successful: Number,  // Costo por 1000 exitosos
          costPer1000Real: Number,  // Costo real incluyendo fallidos
          timestamp: {
            type: Date,
            default: Date.now
          }
        }],
        lastUpdated: {
          type: Date
        }
      }
    }
  },
  {
    collection: "configuracion-scraping",
    timestamps: true // Añade createdAt y updatedAt automáticamente
  }
);

module.exports = mongoose.model("ConfiguracionScraping", schema);