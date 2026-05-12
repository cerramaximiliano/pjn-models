/**
 * Modelo CaptchaBalanceCache
 *
 * Cache compartido del balance de los servicios de captcha (Capsolver, 2captcha).
 * Antes, cada worker hacía un GET al endpoint de balance en cada iteración del
 * cron, generando ~240 calls/hora con N workers en paralelo y disparando
 * rate limit (429) constantemente.
 *
 * Con esta colección, todos los workers leen el balance cacheado y solo uno
 * (el primero que vea TTL vencido) refresca el valor desde la API.
 *
 * Un solo documento por provider.
 */
const mongoose = require('mongoose');

const captchaBalanceCacheSchema = new mongoose.Schema({
  provider: {
    type: String,
    enum: ['capsolver', '2captcha', 'captchaai'],
    required: true,
    unique: true
  },
  balance: {
    type: Number,
    required: true
  },
  lastChecked: {
    type: Date,
    required: true,
    default: Date.now
  },
  // Si el último intento de refresh falló, registrar para diagnóstico.
  lastError: {
    type: String,
    default: null
  }
}, {
  collection: 'captcha-balance-cache',
  timestamps: true
});

module.exports = mongoose.models.CaptchaBalanceCache || mongoose.model("CaptchaBalanceCache", captchaBalanceCacheSchema);