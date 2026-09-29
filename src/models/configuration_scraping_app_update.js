const mongoose = require("mongoose");

const schema = new mongoose.Schema(
  {
    fuero: {
      type: String,
      required: true,
      enum: ['CIV', 'CSS', 'CNT', 'COM']
    },
    worker_id: {
      type: String,
      required: true,
      default: 'app_update_main'
    },
    update_mode: {
      type: String,
      enum: ['all', 'civil', 'ss', 'trabajo', 'comercial'],
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
        enum: ['2captcha', 'capsolver', 'captchaai'],
        default: 'capsolver'
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
    },
    // Configuración de cooldown para documentos con errores consecutivos
    errorCooldown: {
      type: {
        // Número máximo de errores consecutivos antes de aplicar cooldown
        maxConsecutiveErrors: {
          type: Number,
          default: 3,
          min: 1,
          max: 10
        },
        // Horas de cooldown después de alcanzar el máximo de errores
        cooldownHours: {
          type: Number,
          default: 6,
          min: 1,
          max: 168 // máximo 1 semana
        },
        // Habilitar/deshabilitar el sistema de cooldown
        enabled: {
          type: Boolean,
          default: true
        }
      },
      required: false,
      default: {
        maxConsecutiveErrors: 3,
        cooldownHours: 6,
        enabled: true
      }
    },
    // Pestaña Vinculados del detalle público (lista de incidentes del principal).
    // Se captura con la página ya abierta, después del scraping de movimientos
    // y antes de cerrarla (0 captchas extra; +0,5 s la lista, +~3 s por página).
    // Apagado por defecto: encender tras validar la tanda de las 08:00 ART.
    vinculados: {
      type: {
        capturarEnAppUpdate: { type: Boolean, default: false },
        // Leer INCIDENTES seguidos entrando por su fila de Vinculados del principal: verify,
        // stuck-documents y app-update los incluyen en sus pools (pjn-workers
        // utils/incidente-vinculados.js). Basta con que un doc de la colección lo tenga.
        leerIncidentes: { type: Boolean, default: false },
        refreshDays: { type: Number, default: 3, min: 0, max: 60 },   // no releer si capturedAt es más nuevo
        maxPaginas: { type: Number, default: 4, min: 1, max: 20 }      // 15 filas por página
      },
      required: false,
      default: { capturarEnAppUpdate: false, leerIncidentes: false, refreshDays: 3, maxPaginas: 4 }
    },
    // Chromium que vive entre documentos en vez de uno por documento.
    // Lanzar un browser abre ~15-30 conexiones nuevas; es esa tasa (no la
    // concurrencia) lo que castiga al router y pierde el init.js del captcha.
    browserPersistente: {
      type: {
        enabled: { type: Boolean, default: true },
        maxUsos: { type: Number, default: 30, min: 1, max: 500 },   // docs por browser antes de reciclar
        maxEdadMin: { type: Number, default: 45, min: 1, max: 720 } // vida máxima en minutos
      },
      required: false,
      default: { enabled: true, maxUsos: 30, maxEdadMin: 45 }
    },
    updateProgress: {
      type: {
        // Documentos elegibles al inicio del día/ciclo
        totalEligible: {
          type: Number,
          default: 0
        },
        // Documentos ya procesados en el día/ciclo actual
        processedToday: {
          type: Number,
          default: 0
        },
        // Última vez que se calculó el total elegible
        lastEligibleCalculation: {
          type: Date,
          default: Date.now
        },
        // Inicio del ciclo actual (para saber cuándo resetear)
        currentCycleStart: {
          type: Date,
          default: Date.now
        },
        // Porcentaje de completitud
        completionPercentage: {
          type: Number,
          default: 0,
          min: 0,
          max: 100
        }
      },
      required: false,
      default: {
        totalEligible: 0,
        processedToday: 0,
        lastEligibleCalculation: new Date(),
        currentCycleStart: new Date(),
        completionPercentage: 0
      }
    }
  },
  {
    collection: "configuracion-app-update",
    timestamps: true
  }
);


  schema.index({ worker_id: 1 }, { unique: true });
  schema.index({ update_mode: 1, enabled: 1 });
  schema.index({ 'updateProgress.completionPercentage': 1 });
  schema.index({ 'updateProgress.currentCycleStart': 1 });

module.exports = mongoose.models.ConfiguracionAppUpdate || mongoose.model("ConfiguracionAppUpdate", schema);