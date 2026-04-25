const mongoose = require("mongoose");

/**
 * Configuración del worker pjn-privacy-checker.
 *
 * Singleton orquestado por el manager de pjn-workers. El privacy-checker
 * lee `folder.accessFailureCount` (que escribe app-update-worker en cada
 * scrape de folders individuales con source !== 'pjn-login') y decide
 * transiciones de causa.isPrivate:
 *   - counter ≥ consecutive_strikes_threshold → marca privada (causa + folder).
 *   - counter < threshold y folder.causaIsPrivate=true → reset (causa + folder).
 *
 * Solo aplica a folders con source !== 'pjn-login'. Las causas accedidas
 * vía pjn-mis-causas tienen otro canal (login) y no participan de este
 * tracking público.
 */
const schema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: true,
      default: "pjn-privacy-checker",
      unique: true
    },
    enabled: {
      type: Boolean,
      default: true
    },
    /**
     * Cron del worker. Default: 3 AM y 3 PM (dos veces al día en horarios
     * no invasivos para el resto de los workers de scraping).
     */
    cron_expression: {
      type: String,
      default: "0 3,15 * * *"
    },
    /**
     * Cantidad de fallos consecutivos en `folder.accessFailureCount` para
     * confirmar que la causa pasó a privada. 3 evita falsos positivos por
     * glitches transitorios (captcha, 5xx, sesión expirada).
     */
    consecutive_strikes_threshold: {
      type: Number,
      default: 3,
      min: 1,
      max: 10
    },
    /**
     * Habilitación selectiva por fuero (PJN tiene 4 fueros principales).
     */
    per_fuero: {
      CIV: { enabled: { type: Boolean, default: true } },
      CSS: { enabled: { type: Boolean, default: true } },
      CNT: { enabled: { type: Boolean, default: true } },
      COM: { enabled: { type: Boolean, default: true } }
    },
    /**
     * Última corrida del worker. Lo escribe el propio worker al terminar.
     */
    last_run: {
      type: Date
    },
    /**
     * Estadísticas acumuladas del worker.
     */
    stats: {
      causas_marked_private: { type: Number, default: 0 },
      causas_reset_public: { type: Number, default: 0 },
      folders_synced: { type: Number, default: 0 },
      total_runs: { type: Number, default: 0 }
    }
  },
  {
    collection: "configuracion-privacy-checker",
    timestamps: true
  }
);

// Singleton helpers — patrón usado por el resto de las configuraciones del repo.
schema.statics.getConfig = async function () {
  let doc = await this.findOne({ name: "pjn-privacy-checker" });
  if (!doc) {
    doc = await this.create({ name: "pjn-privacy-checker" });
  }
  return doc;
};

schema.statics.getOrCreate = async function () {
  return this.getConfig();
};

module.exports = mongoose.model("ConfiguracionPrivacyChecker", schema);
