"use strict";

/**
 * Facade compartido del estado del portal PJN.
 *
 * Hogar único de la lógica que antes estaba DUPLICADA (y divergiendo) entre
 * pjn-workers/src/utils/pjn-site-status.js y pjn-mis-causas/src/utils/pjn-site-status.js.
 * Vive en pjn-models junto a html-drift-guard porque lo consumen los repos que
 * scrapean el portal (pjn-workers, pjn-mis-causas, y potencialmente
 * pjn-workers-scraping).
 *
 * Responsabilidades:
 *   - detectMaintenancePage(page): detecta la página "Sitio en mantenimiento"
 *     sobre una página de Puppeteer ya cargada. Pura, sin dependencias.
 *   - shouldSkipScraping(): lee el flag compartido (cacheado 10s) y decide si
 *     saltear este ciclo. Ventana de re-probe: 5 min.
 *   - reportMaintenance()/reportHealthy(): persisten la transición vía el modelo
 *     ManagerConfig, y SOLO en la transición disparan email + alerta + broadcast.
 *
 * IMPORTANTE — mongoose-agnóstico:
 *   Este módulo NO hace `require('../models/manager-config')`. En algunos repos
 *   (pjn-mis-causas) pjn-models corre sobre una instancia de mongoose SEPARADA y
 *   sin conectar, por lo que el modelo del paquete tira buffering timeouts. Cada
 *   servicio inyecta su propio ManagerConfig (el registrado en SU conexión)
 *   mediante configure({ getManagerConfig }).
 *
 * Uso (una vez, al inicio del proceso):
 *
 *   const pjnSiteStatus = require('pjn-models/src/utils/pjn-site-status');
 *   pjnSiteStatus.configure({
 *     getManagerConfig: () => ManagerConfig,        // modelo en la conexión activa
 *     logger,                                       // pino/winston (default: console)
 *     sendEmail: async (to, subject, html, text, meta) => { ... },  // opcional
 *   });
 *
 * El email se manda SOLO en la transición de estado. Como el flag pjnSiteStatus
 * es compartido en Mongo, el modelo garantiza que únicamente el primer service
 * que detecta el cambio vea report.transitioned=true → exactamente un email por
 * transición, sin importar qué service (workers o mis-causas) la detecte primero.
 */

const DEFAULT_STALE_MS = 5 * 60 * 1000; // 5 min — ventana de re-probe
const CACHE_TTL_MS = 10 * 1000; // 10 s — cache local de lectura

// Configuración inyectada por cada servicio. Defaults seguros: sin
// getManagerConfig no persiste (fail-open); sin sendEmail no notifica.
const _cfg = {
  getManagerConfig: null,
  logger: console,
  sendEmail: null,
  recipient: () => process.env.ADMIN_EMAIL || "cerramaximiliano@gmail.com",
  notificationUrl: () => process.env.NOTIFICATION_SERVICE_URL,
  notificationToken: () => process.env.INTERNAL_SERVICE_TOKEN,
};

// Cache en proceso. Cada proceso tiene el suyo; se invalida al reportar.
let _cache = null;
let _cacheTs = 0;

/**
 * Configura las dependencias del facade. Llamar una vez al inicio del proceso.
 * @param {Object} opts
 * @param {Function} opts.getManagerConfig  () => Model | Promise<Model> | null
 * @param {Object}   [opts.logger]          logger con .info/.warn/.debug
 * @param {Function} [opts.sendEmail]       async (to, subject, html, text, meta)
 * @param {Function} [opts.recipient]       () => string (destinatario admin)
 * @param {Function} [opts.notificationUrl] () => string (base URL la-notification)
 * @param {Function} [opts.notificationToken] () => string (bearer interno)
 */
function configure(opts = {}) {
  Object.assign(_cfg, opts);
  return module.exports;
}

function _log() {
  return _cfg.logger || console;
}

async function _resolveModel() {
  if (typeof _cfg.getManagerConfig !== "function") return null;
  try {
    const M = await _cfg.getManagerConfig();
    return M || null;
  } catch (err) {
    _log().warn(`[pjnSiteStatus] getManagerConfig falló: ${err.message}`);
    return null;
  }
}

function _invalidateCache() {
  _cache = null;
  _cacheTs = 0;
}

async function _readStatusCached() {
  const now = Date.now();
  if (_cache !== null && now - _cacheTs < CACHE_TTL_MS) {
    return _cache;
  }
  const M = await _resolveModel();
  if (!M) {
    _cache = null;
    _cacheTs = now;
    return null;
  }
  try {
    _cache = await M.getSiteStatus();
  } catch (err) {
    _log().debug(`[pjnSiteStatus] read fail: ${err.message}`);
    _cache = null;
  }
  _cacheTs = now;
  return _cache;
}

/**
 * Detecta la página "Sitio en mantenimiento" del portal PJN sobre una página de
 * Puppeteer ya cargada. No lanza — sólo reporta.
 *
 * El PJN sirve esta página con título "Sistema de Escritos Electrónicos y
 * Notificaciones Electrónicas" y cuerpo con "Sitio en mantenimiento" /
 * "realizando tareas de mantenimiento".
 */
async function detectMaintenancePage(page) {
  try {
    return await page.evaluate(() => {
      const title = (document.title || "").toLowerCase();
      const body = (document.body && document.body.innerText) ? document.body.innerText : "";

      const titleMatch = title.includes("escritos electr") && title.includes("notificaciones electr");
      const textMatch = /sitio\s+en\s+mantenimiento/i.test(body)
                     || /realizando\s+tareas\s+de\s+mantenimiento/i.test(body);

      if (titleMatch || textMatch) {
        const firstLine = body
          .split("\n")
          .map((l) => l.trim())
          .find((l) => /mantenimiento/i.test(l)) || "Sitio en mantenimiento";
        return { inMaintenance: true, message: firstLine.slice(0, 240) };
      }
      return { inMaintenance: false, message: null };
    });
  } catch (e) {
    return { inMaintenance: false, message: null };
  }
}

/**
 * ¿Saltear el scraping ahora? Lee el estado del sitio (cacheado).
 *
 * @param {Object} opts
 * @param {number} opts.staleMs  Cuánto debe haber pasado desde la última
 *                               detección para considerar "stale" y permitir un
 *                               reintento real. Default 5 min.
 * @returns {Promise<boolean>} true → saltear; false → procesar normalmente.
 */
async function shouldSkipScraping({ staleMs = DEFAULT_STALE_MS } = {}) {
  const status = await _readStatusCached();
  if (!status || status.status !== "maintenance") return false;
  if (!status.lastDetectedAt) return false;
  const ageMs = Date.now() - new Date(status.lastDetectedAt).getTime();
  return ageMs < staleMs;
}

/**
 * Devuelve el sub-doc pjnSiteStatus actual (cacheado).
 */
async function getStatus() {
  return _readStatusCached();
}

/**
 * Reporta que el sitio PJN está en mantenimiento. Persiste, invalida cache.
 * Si transiciona desde healthy/unknown, dispara email + alerta + broadcast.
 *
 * @param {string} source   Identificador del worker (e.g. "update:CIV", "mis-causas:login").
 * @param {string} message  Texto del banner del PJN, si se pudo extraer.
 */
async function reportMaintenance(source, message = null) {
  const M = await _resolveModel();
  if (!M) return { transitioned: false };

  let report;
  try {
    report = await M.reportMaintenance(source, message);
  } catch (err) {
    _log().warn(`[pjnSiteStatus] reportMaintenance failed: ${err.message}`);
    return { transitioned: false };
  }
  _invalidateCache();

  if (report.transitioned) {
    try {
      await M.addAlert({
        type: "site_maintenance",
        message: `PJN en mantenimiento: ${message || "sin texto"}`,
        fuero: source,
      });
    } catch (err) {
      _log().debug(`[pjnSiteStatus] addAlert failed: ${err.message}`);
    }
    await _notifyEnteringMaintenance({ source, message, detectedAt: new Date() });
    await _broadcastSocket({
      status: "maintenance",
      maintenanceSince: report.maintenanceSince,
      lastDetectedBy: source,
      message: message || null,
    });
  }
  return report;
}

/**
 * Reporta que el sitio PJN está operativo tras una verificación exitosa.
 * Si venía de mantenimiento, dispara email de "vuelta a la normalidad".
 *
 * @param {string} source Identificador del worker que lo verificó.
 */
async function reportHealthy(source) {
  const M = await _resolveModel();
  if (!M) return { transitioned: false };

  let report;
  try {
    report = await M.reportHealthy(source);
  } catch (err) {
    _log().warn(`[pjnSiteStatus] reportHealthy failed: ${err.message}`);
    return { transitioned: false };
  }
  _invalidateCache();

  if (report.transitioned) {
    await _notifyLeavingMaintenance({
      source,
      previousMaintenanceSince: report.previousMaintenanceSince,
      recoveredAt: new Date(),
    });
    await _broadcastSocket({
      status: "healthy",
      maintenanceSince: null,
      lastDetectedBy: source,
      message: null,
      previousMaintenanceSince: report.previousMaintenanceSince,
    });
  }
  return report;
}

// ---------- Notificaciones (privadas) ----------

function _fmtArg(date) {
  if (!date) return "—";
  try {
    return new Date(date).toLocaleString("es-AR", { timeZone: "America/Argentina/Buenos_Aires" });
  } catch {
    return String(date);
  }
}

function _fmtDuration(ms) {
  if (!ms || ms < 0) return "—";
  const min = Math.floor(ms / 60000);
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60);
  const m = min % 60;
  return `${h}h ${m}min`;
}

async function _sendEmail(to, subject, html, text, meta) {
  if (typeof _cfg.sendEmail !== "function") {
    _log().debug("[pjnSiteStatus] sendEmail no configurado — sin email");
    return;
  }
  try {
    await _cfg.sendEmail(to, subject, html, text, meta);
    _log().info(`📧 Email enviado: ${meta.event} (${to})`);
  } catch (err) {
    _log().warn(`No se pudo enviar email de ${meta.event}: ${err.message}`);
  }
}

async function _notifyEnteringMaintenance({ source, message, detectedAt }) {
  const to = _cfg.recipient();
  const subject = `🛠️ PJN en mantenimiento — scraping pausado (${_fmtArg(detectedAt)})`;
  const safeMsg = message ? String(message).replace(/[<>]/g, "") : "(sin texto)";
  const html = `
    <h2>Sitio PJN en mantenimiento</h2>
    <p>Un worker detectó que el portal del PJN está devolviendo la página de mantenimiento. Todos los workers de scraping (update, verify, stuck-documents, recovery, extra-info, mis-causas) pausan automáticamente para no consumir captchas ni recursos.</p>
    <ul>
      <li><strong>Detectado por:</strong> ${source}</li>
      <li><strong>Detectado en:</strong> ${_fmtArg(detectedAt)}</li>
      <li><strong>Mensaje del PJN:</strong> ${safeMsg}</li>
    </ul>
    <p>Cada 5 minutos un worker intenta una verificación real para detectar si el sitio volvió. Cuando vuelva, recibirás un segundo email.</p>
  `;
  const text = `Sitio PJN en mantenimiento\n\nDetectado por: ${source}\nDetectado en: ${_fmtArg(detectedAt)}\nMensaje del PJN: ${message || "(sin texto)"}\n\nTodos los workers pausan el scraping hasta que el sitio vuelva.`;
  await _sendEmail(to, subject, html, text, {
    event: "maintenance_start",
    source,
    message: message || null,
  });
}

async function _notifyLeavingMaintenance({ source, previousMaintenanceSince, recoveredAt }) {
  const to = _cfg.recipient();
  const duration = previousMaintenanceSince
    ? recoveredAt.getTime() - new Date(previousMaintenanceSince).getTime()
    : null;

  const subject = `✅ PJN operativo — scraping reanudado (${_fmtArg(recoveredAt)})`;
  const html = `
    <h2>Sitio PJN operativo nuevamente</h2>
    <p>El portal del PJN volvió a responder con normalidad. Todos los workers retoman el scraping en el próximo ciclo.</p>
    <ul>
      <li><strong>Verificado por:</strong> ${source}</li>
      <li><strong>Recuperado en:</strong> ${_fmtArg(recoveredAt)}</li>
      <li><strong>Inicio del mantenimiento:</strong> ${_fmtArg(previousMaintenanceSince)}</li>
      <li><strong>Duración:</strong> ${_fmtDuration(duration)}</li>
    </ul>
  `;
  const text = `Sitio PJN operativo nuevamente\n\nVerificado por: ${source}\nRecuperado en: ${_fmtArg(recoveredAt)}\nInicio mantenimiento: ${_fmtArg(previousMaintenanceSince)}\nDuración: ${_fmtDuration(duration)}`;
  await _sendEmail(to, subject, html, text, {
    event: "maintenance_end",
    source,
    previousMaintenanceSince: previousMaintenanceSince || null,
    durationMs: duration,
  });
}

/**
 * Notifica a la-notification para que broadcast el cambio de estado vía
 * socket.io. Fail-safe: si el endpoint no responde, sólo log — el email + la BD
 * ya dejaron registro persistente. Usa global fetch (Node 18+) para no agregar
 * dependencias a pjn-models.
 */
async function _broadcastSocket(payload) {
  const baseUrl = _cfg.notificationUrl();
  const token = _cfg.notificationToken();

  if (!baseUrl || !token) {
    _log().debug("[pjnSiteStatus] NOTIFICATION_SERVICE_URL/INTERNAL_SERVICE_TOKEN no configurados — sin broadcast");
    return;
  }
  if (typeof fetch !== "function") {
    _log().debug("[pjnSiteStatus] global fetch no disponible — sin broadcast");
    return;
  }

  try {
    const res = await fetch(`${baseUrl}/api/system-status/broadcast`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ type: "PJN_SITE_STATUS", payload }),
      signal: typeof AbortSignal !== "undefined" && typeof AbortSignal.timeout === "function"
        ? AbortSignal.timeout(5000)
        : undefined,
    });
    const data = await res.json().catch(() => ({}));
    if (data && data.emitted) {
      _log().info(`📡 Socket broadcast emitido: PJN_SITE_STATUS (${payload.status})`);
    } else {
      _log().debug(`[pjnSiteStatus] broadcast aceptado pero no emitido: ${JSON.stringify(data)}`);
    }
  } catch (err) {
    _log().warn(`[pjnSiteStatus] broadcast falló: ${err.message}`);
  }
}

module.exports = {
  configure,
  detectMaintenancePage,
  shouldSkipScraping,
  reportMaintenance,
  reportHealthy,
  getStatus,
  DEFAULT_STALE_MS,
};
