/**
 * Modelo AppUpdateTanda
 *
 * Una "tanda" es una pasada del worker app-update por los documentos
 * elegibles de un fuero: arranca con el primer documento tomado y termina
 * cuando el fuero se queda sin elegibles (o cuando pasan GAP_CIERRE_MS sin
 * documentos, lo que ocurra primero).
 *
 * La primera tanda del día es la referencia limpia de capacidad: a la
 * apertura del horario todo el pool está vencido a la vez, así que su
 * duración mide cuánto tarda la flota en procesar el pool completo. Las
 * siguientes suelen ser "de goteo": los documentos vencen de a uno, al ritmo
 * al que se procesaron a la mañana, y la flota los sigue con elegibles ~0.
 * `elegiblesAlInicio` contra `pool` distingue una de otra.
 *
 * La escriben los workers (uno por proceso, incluidos los que ayudan a otro
 * fuero) con `registrarDocumento` / `cerrarSiSinElegibles`; la lee pjn-api
 * para la vista de capacidad. Todos los contadores son $inc atómicos; la
 * apertura concurrente la resuelve el índice único parcial sobre
 * {fuero, estado:'abierta'}.
 */
const mongoose = require("mongoose");

/** Sin documentos durante este lapso, la tanda se da por terminada. */
const GAP_CIERRE_MS = 10 * 60 * 1000;
/** Un documento que llega poco después del cierre pertenece a la misma tanda. */
const REAPERTURA_MS = 3 * 60 * 1000;

/** Tramos del histograma de segundos por documento (límite superior, exclusivo). */
const TRAMOS_SEGUNDOS = [10, 15, 20, 25, 30, 40, 60, 90, Infinity];

function fechaArgentina(d = new Date()) {
  const ar = new Date(d.getTime() - 3 * 60 * 60 * 1000);
  return ar.toISOString().slice(0, 10);
}

function tramoDe(segundos) {
  const idx = TRAMOS_SEGUNDOS.findIndex(lim => segundos < lim);
  const lim = TRAMOS_SEGUNDOS[idx];
  return lim === Infinity ? `ge${TRAMOS_SEGUNDOS[idx - 1]}` : `lt${lim}`;
}

const porProcesoSchema = new mongoose.Schema({
  // El proceso trabajaba para otro fuero (ayuda entre fueros)
  esAyuda: { type: Boolean, default: false },
  modoPropio: { type: String },
  docs: { type: Number, default: 0 },
  ok: { type: Number, default: 0 },
  fallidos: { type: Number, default: 0 },
  tiempoMs: { type: Number, default: 0 }
}, { _id: false });

const schema = new mongoose.Schema({
  // update_mode del fuero: civil | ss | trabajo | comercial | all
  fuero: { type: String, required: true, index: true },
  // Código de fuero del portal (CIV/CSS/CNT/COM) cuando aplica
  fueroCode: { type: String },
  // Día ART (YYYY-MM-DD) en que arrancó la tanda
  date: { type: String, required: true, index: true },
  // N-ésima tanda del día para este fuero (1 = la de apertura)
  numero: { type: Number, required: true },

  estado: { type: String, enum: ['abierta', 'cerrada'], default: 'abierta', index: true },
  inicio: { type: Date, required: true },
  // Momento del último documento registrado: es el fin real del trabajo
  ultimoDocAt: { type: Date, required: true },
  fin: { type: Date },
  duracionMs: { type: Number },
  motivoCierre: { type: String, enum: ['sin_elegibles', 'gap', 'cierre_horario', 'manual'] },

  // Foto al abrir: tamaño del pool (update:true) y cuántos estaban vencidos
  pool: { type: Number },
  elegiblesAlInicio: { type: Number },
  umbralHoras: { type: Number },

  procesados: { type: Number, default: 0 },
  ok: { type: Number, default: 0 },
  fallidos: { type: Number, default: 0 },
  // Accedidos pero no actualizables (privadas, sin captcha por balance…)
  omitidos: { type: Number, default: 0 },
  movimientosFound: { type: Number, default: 0 },

  // Costo unitario: suma/min/max + histograma de segundos por documento,
  // suficiente para p50/p90 sin guardar cada duración
  tiempos: {
    sumMs: { type: Number, default: 0 },
    count: { type: Number, default: 0 },
    minMs: { type: Number },
    maxMs: { type: Number },
    tramos: { type: Map, of: Number, default: {} }
  },

  // Load average (1 min) por CPU muestreado en cada documento
  load: {
    sum: { type: Number, default: 0 },
    count: { type: Number, default: 0 },
    max: { type: Number, default: 0 }
  },

  // Aporte de cada proceso (workerId → contadores); los helpers llevan esAyuda
  porProceso: { type: Map, of: porProcesoSchema, default: {} },
  // errorType → cantidad
  errores: { type: Map, of: Number, default: {} }
}, {
  collection: 'app-update-tandas',
  timestamps: true
});

schema.index({ fuero: 1, estado: 1 }, { unique: true, partialFilterExpression: { estado: 'abierta' } });
schema.index({ date: -1, fuero: 1, numero: 1 });
schema.index({ inicio: -1 });

/**
 * Cierra una tanda. `fin` es el último documento registrado, no "ahora":
 * el tiempo ocioso hasta que alguien nota que no hay elegibles no es trabajo.
 */
schema.statics.cerrar = async function (tanda, motivo) {
  const fin = tanda.ultimoDocAt || tanda.inicio;
  return this.findOneAndUpdate(
    { _id: tanda._id, estado: 'abierta' },
    { $set: { estado: 'cerrada', fin, duracionMs: fin - tanda.inicio, motivoCierre: motivo } },
    { new: true }
  );
};

/**
 * Devuelve la tanda abierta del fuero, o abre una nueva. Si la abierta lleva
 * más de GAP_CIERRE_MS sin documentos, la cierra por gap y abre otra. Si la
 * última cerrada terminó hace menos de REAPERTURA_MS (un documento que otro
 * proceso tenía a medio hacer cuando se declaró "sin elegibles"), la reabre.
 *
 * @param {Object} ctx
 * @param {string} ctx.fuero - update_mode
 * @param {string} [ctx.fueroCode]
 * @param {number} [ctx.umbralHoras]
 * @param {() => Promise<number>} [ctx.contarElegibles] - vencidos AHORA (sin contar el ya tomado)
 * @param {() => Promise<number>} [ctx.contarPool]
 */
schema.statics.obtenerAbierta = async function (ctx, ahora = new Date()) {
  let abierta = await this.findOne({ fuero: ctx.fuero, estado: 'abierta' });
  if (abierta && ahora - abierta.ultimoDocAt > GAP_CIERRE_MS) {
    await this.cerrar(abierta, 'gap');
    abierta = null;
  }
  if (abierta) return abierta;

  const ultima = await this.findOne({ fuero: ctx.fuero, estado: 'cerrada' }).sort({ fin: -1 });
  if (ultima && ultima.fin && ahora - ultima.fin < REAPERTURA_MS) {
    const reabierta = await this.findOneAndUpdate(
      { _id: ultima._id, estado: 'cerrada' },
      { $set: { estado: 'abierta' }, $unset: { fin: 1, duracionMs: 1, motivoCierre: 1 } },
      { new: true }
    );
    if (reabierta) return reabierta;
  }

  const date = fechaArgentina(ahora);
  const numero = (await this.countDocuments({ fuero: ctx.fuero, date })) + 1;
  const [elegibles, pool] = await Promise.all([
    ctx.contarElegibles ? ctx.contarElegibles().catch(() => null) : null,
    ctx.contarPool ? ctx.contarPool().catch(() => null) : null,
  ]);
  try {
    return await this.create({
      fuero: ctx.fuero,
      fueroCode: ctx.fueroCode,
      date,
      numero,
      inicio: ahora,
      ultimoDocAt: ahora,
      pool,
      // +1: el documento que disparó la apertura ya está tomado (lock) y no cuenta como vencido
      elegiblesAlInicio: elegibles === null ? null : elegibles + 1,
      umbralHoras: ctx.umbralHoras,
    });
  } catch (err) {
    // Otro proceso abrió la tanda al mismo tiempo (índice único parcial)
    if (err && err.code === 11000) {
      return this.findOne({ fuero: ctx.fuero, estado: 'abierta' });
    }
    throw err;
  }
};

/**
 * Registra un documento procesado en la tanda abierta del fuero (abriéndola
 * si hace falta). Todo lo variable va por $inc; `porProceso` y `errores` son
 * Maps con clave dinámica.
 *
 * @param {Object} ctx - ver `obtenerAbierta`
 * @param {Object} doc
 * @param {string} doc.workerId
 * @param {string} [doc.modoPropio] - UPDATE_MODE del proceso (≠ fuero ⇒ ayuda)
 * @param {'ok'|'fallido'|'omitido'} doc.resultado
 * @param {number} doc.durationMs - costo total del documento (browser incluido)
 * @param {number} [doc.movimientosFound]
 * @param {string} [doc.errorType]
 * @param {number} [doc.loadPorCpu] - loadavg(1m) / cpus
 */
schema.statics.registrarDocumento = async function (ctx, doc) {
  const ahora = new Date();
  const tanda = await this.obtenerAbierta(ctx, ahora);
  if (!tanda) return null;

  const inc = { procesados: 1 };
  if (doc.resultado === 'ok') inc.ok = 1;
  else if (doc.resultado === 'fallido') inc.fallidos = 1;
  else inc.omitidos = 1;
  if (doc.movimientosFound) inc.movimientosFound = doc.movimientosFound;

  const ms = Math.max(0, doc.durationMs || 0);
  inc['tiempos.sumMs'] = ms;
  inc['tiempos.count'] = 1;
  inc[`tiempos.tramos.${tramoDe(ms / 1000)}`] = 1;

  const set = { ultimoDocAt: ahora };
  const min = {}, max = {};
  if (ms > 0) { min['tiempos.minMs'] = ms; max['tiempos.maxMs'] = ms; }
  if (typeof doc.loadPorCpu === 'number') {
    inc['load.sum'] = doc.loadPorCpu;
    inc['load.count'] = 1;
    max['load.max'] = doc.loadPorCpu;
  }

  const wid = String(doc.workerId || 'desconocido').replace(/[.$]/g, '_');
  const esAyuda = Boolean(doc.modoPropio && doc.modoPropio !== ctx.fuero && doc.modoPropio !== 'all');
  inc[`porProceso.${wid}.docs`] = 1;
  if (inc.ok) inc[`porProceso.${wid}.ok`] = 1;
  if (inc.fallidos) inc[`porProceso.${wid}.fallidos`] = 1;
  inc[`porProceso.${wid}.tiempoMs`] = ms;
  set[`porProceso.${wid}.esAyuda`] = esAyuda;
  if (doc.modoPropio) set[`porProceso.${wid}.modoPropio`] = doc.modoPropio;
  if (doc.errorType) inc[`errores.${String(doc.errorType).replace(/[.$]/g, '_')}`] = 1;

  const update = { $inc: inc, $set: set };
  if (Object.keys(min).length) update.$min = min;
  if (Object.keys(max).length) update.$max = max;
  return this.findOneAndUpdate({ _id: tanda._id }, update, { new: true });
};

/**
 * Un proceso encontró el fuero sin elegibles: cierra la tanda abierta, salvo
 * que otro proceso todavía tenga un documento tomado (`enProceso` > 0) — en
 * ese caso el cierre lo hará el siguiente "sin elegibles".
 */
schema.statics.cerrarSiSinElegibles = async function (fuero, { enProceso = 0 } = {}) {
  const abierta = await this.findOne({ fuero, estado: 'abierta' });
  if (!abierta) return null;
  if (enProceso > 0 && Date.now() - abierta.ultimoDocAt < GAP_CIERRE_MS) return abierta;
  return this.cerrar(abierta, 'sin_elegibles');
};

/** Cierre de todas las abiertas (fin de horario laboral). */
schema.statics.cerrarAbiertas = async function (motivo = 'cierre_horario') {
  const abiertas = await this.find({ estado: 'abierta' });
  const cerradas = [];
  for (const t of abiertas) cerradas.push(await this.cerrar(t, motivo));
  return cerradas;
};

/**
 * Derivadas de una tanda (o de un lean): promedio, p50/p90 aproximados por
 * histograma, docs/min, load medio, cuánto aportaron los helpers.
 */
schema.statics.resumir = function (t) {
  const tramos = t.tiempos?.tramos instanceof Map ? Object.fromEntries(t.tiempos.tramos) : (t.tiempos?.tramos || {});
  const count = t.tiempos?.count || 0;
  const percentil = (p) => {
    if (!count) return null;
    let acumulado = 0;
    for (const lim of TRAMOS_SEGUNDOS) {
      const clave = lim === Infinity ? `ge${TRAMOS_SEGUNDOS[TRAMOS_SEGUNDOS.length - 2]}` : `lt${lim}`;
      acumulado += tramos[clave] || 0;
      if (acumulado / count >= p) return lim === Infinity ? TRAMOS_SEGUNDOS[TRAMOS_SEGUNDOS.length - 2] : lim;
    }
    return null;
  };
  const fin = t.fin || t.ultimoDocAt;
  const duracionMs = t.duracionMs ?? (fin && t.inicio ? fin - t.inicio : null);
  const porProceso = t.porProceso instanceof Map ? Object.fromEntries(t.porProceso) : (t.porProceso || {});
  const procesos = Object.entries(porProceso);
  const docsAyuda = procesos.filter(([, p]) => p.esAyuda).reduce((s, [, p]) => s + (p.docs || 0), 0);
  return {
    duracionMs,
    duracionMin: duracionMs === null ? null : Math.round(duracionMs / 60000),
    segPorDocPromedio: count ? Math.round((t.tiempos.sumMs / count) / 100) / 10 : null,
    segPorDocP50: percentil(0.5),
    segPorDocP90: percentil(0.9),
    docsPorMin: duracionMs > 0 ? Math.round((t.procesados / (duracionMs / 60000)) * 10) / 10 : null,
    tasaExito: (t.ok + t.fallidos) ? Math.round((t.ok / (t.ok + t.fallidos)) * 1000) / 10 : null, // los omitidos (no accesibles) no cuentan
    loadPromedio: t.load?.count ? Math.round((t.load.sum / t.load.count) * 100) / 100 : null,
    loadMax: t.load?.max ?? null,
    procesos: procesos.length,
    procesosAyuda: procesos.filter(([, p]) => p.esAyuda).length,
    docsAyuda,
    // Tanda de apertura (todo el pool vencido) vs de goteo
    esDeApertura: t.pool ? (t.elegiblesAlInicio || 0) >= t.pool * 0.5 : t.numero === 1,
    umbralCubierto: t.umbralHoras && duracionMs !== null ? duracionMs <= t.umbralHoras * 3600e3 : null,
  };
};

schema.statics.GAP_CIERRE_MS = GAP_CIERRE_MS;
schema.statics.TRAMOS_SEGUNDOS = TRAMOS_SEGUNDOS;

module.exports = mongoose.model("AppUpdateTanda", schema);
