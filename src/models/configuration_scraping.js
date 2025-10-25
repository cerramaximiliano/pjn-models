const mongoose = require("mongoose");

const schema = new mongoose.Schema(
  {
    fuero: {
      type: String,
      required: true,
      enum: ['CIV', 'CSS', 'CNT', 'COM']
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
    // Estadísticas para 2captcha
    twoCaptcha: {
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
      totalCost: {
        type: Number,
        default: 0
      },
      totalCostFailed: {
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
          milestone: Number,
          totalSpentAtMilestone: Number,
          successfulCaptchas: Number,
          attemptedCaptchas: Number,
          costPer1000Successful: Number,
          costPer1000Real: Number,
          timestamp: {
            type: Date,
            default: Date.now
          }
        }],
        lastUpdated: {
          type: Date
        }
      },
      lastReset: {
        type: Date
      }
    },
    // Estadísticas para capsolver
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
      totalCost: {
        type: Number,
        default: 0
      },
      totalCostFailed: {
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
          milestone: Number,
          totalSpentAtMilestone: Number,
          successfulCaptchas: Number,
          attemptedCaptchas: Number,
          costPer1000Successful: Number,
          costPer1000Real: Number,
          timestamp: {
            type: Date,
            default: Date.now
          }
        }],
        lastUpdated: {
          type: Date
        }
      },
      lastReset: {
        type: Date
      }
    },
    proxy: {
      enabled: {
        type: Boolean,
        default: false
      },
      // Donde se aplica el proxy
      applyTo: {
        puppeteer: {
          type: Boolean,
          default: false
        },
        captchaService: {
          type: Boolean,
          default: false
        }
      },
      // Configuración del proxy
      service: {
        name: {
          type: String,
          enum: ['bright_data', 'custom', 'none'],
          default: 'none'
        },
        host: {
          type: String
        },
        port: {
          type: Number
        },
        username: {
          type: String
        },
        password: {
          type: String
        },
        protocol: {
          type: String,
          enum: ['http', 'https', 'socks5'],
          default: 'http'
        }
      },
      // Configuración específica para servicios de captcha
      captchaConfig: {
        // Para 2captcha
        twoCaptcha: {
          proxy: String,      // formato: "login:password@123.123.123.123:3128"
          proxytype: {        // tipo de proxy para 2captcha
            type: String,
            enum: ['HTTP', 'HTTPS', 'SOCKS4', 'SOCKS5'],
            default: 'HTTP'
          }
        },
        // Para Capsolver
        capsolver: {
          type: {
            type: String,
            enum: ['ReCaptchaV2Task', 'ReCaptchaV2TaskProxyLess'],
            default: 'ReCaptchaV2TaskProxyLess'
          },
          proxy: String  // formato: "http://user:password@host:port"
        }
      }
    },
    notification: {
      startupEmail: {
        type: Boolean,
        default: false,
      }
    },
    captcha: {
      skipResolution: {
        type: Boolean,
        default: false
      },
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
      },
      minimumBalance: {
        type: Number,
        default: 0.5
      },
      fallbackEnabled: {
        type: Boolean,
        default: false
      }
    },
    // Estadísticas de verificación de documentos
    verification: {
      totalAttempted: {
        type: Number,
        default: 0
      },
      totalVerified: {
        type: Number,
        default: 0
      },
      totalValid: {
        type: Number,
        default: 0
      },
      totalInvalid: {
        type: Number,
        default: 0
      },
      totalVerificationFailed: {
        type: Number,
        default: 0
      },
      totalCaptchaFailed: {
        type: Number,
        default: 0
      },
      lastVerificationDate: {
        type: Date
      },
      lastFailureDate: {
        type: Date
      },
      statsStartDate: {
        type: Date
      },
      lastReset: {
        type: Date
      }
    },
    rangeHistory: [{
      version: {
        type: Number,
        required: true
      },
      range_start: {
        type: Number,
        required: true
      },
      range_end: {
        type: Number,
        required: true
      },
      year: {
        type: String,
        required: true
      },
      completedAt: {
        type: Date,
        required: true
      },
      lastProcessedNumber: {
        type: Number,
        required: true
      },
      documentsProcessed: {
        type: Number,
        default: 0
      },
      documentsFound: {
        type: Number,
        default: 0
      },
      enabled: {
        type: Boolean,
        default: false
      },
      completionEmailSent: {
        type: Boolean,
        default: false
      },
      captchaStats: {
        totalCaptchas: Number,
        totalCaptchasFailed: Number,
        totalCost: Number,
        provider: String
      },
      startedAt: {
        type: Date
      },
      duration: {
        type: String
      }
    }],
    // Flags para retry worker - prevenir avance de número
    skipNumberUpdate: {
      type: Boolean,
      default: false
    },
    isRetryWorker: {
      type: Boolean,
      default: false
    }
  },
  {
    collection: "configuracion-scraping",
    timestamps: true // Añade createdAt y updatedAt automáticamente
  }
);

module.exports = mongoose.model("ConfiguracionScraping", schema);