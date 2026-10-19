'use strict';

/**
 * plazos-deteccion.js — Capa 1 del subsistema de plazos procesales.
 *
 * Detecta notificaciones (cédulas) entre los movimientos NUEVOS de una causa
 * y las persiste en `plazos-notificaciones` (modelo PlazoNotificacion) con
 * processingStatus 'pending', para que el plazos-worker (capa 2) las procese.
 *
 * Mismo código, dos bases:
 *   - caché (rs0, laboratorio): update-movimientos-worker de
 *     pjn-workers-scraping, con el modelo de la conexión por defecto.
 *   - usuarios (Atlas, producción): app-update-worker (pjn-workers) y
 *     private-causas-update-worker (pjn-mis-causas), también sobre su
 *     conexión por defecto (Atlas), con origen 'usuario'.
 *
 * Mismo patrón que detectAndSaveSentencias: filtro por `tipo` + bulkWrite
 * upsert idempotente + $setOnInsert. Diferencias deliberadas:
 *   - NO exige URL: una cédula sin documento igual dispara cómputo por
 *     normativa subsidiaria (queda en status 'no_url').
 *   - Dedup por (causaId, sourceId) con el id determinístico de
 *     movement-id.js — estable aunque el movimiento no tenga URL.
 *   - Solo movimientos nuevos (novedades): las cédulas históricas tienen
 *     plazos ya vencidos y no se capturan. `maxAgeDays` (default 5) descarta
 *     además las cédulas viejas que llegan como "nuevas" (causa retomada tras
 *     meses); null = sin ventana.
 *   - `primeraSync: true` (causa recién agregada, 1.ª población): se detectan
 *     igual con la ventana de 5 días y quedan con `source.primeraSync`; la
 *     entrega (plazos-folders-worker) exige para ellas vencimiento > hoy
 *     (decisión del usuario 19/10, P17).
 *
 * Movido desde pjn-workers-scraping/src/utils/notificaciones-plazos.js
 * (que queda como re-export).
 *
 * El caller debe envolver en try/catch o .catch(): nunca romper el ciclo.
 */

const movementId = require('./movement-id');

// Ventana por defecto: cédulas con fecha de hace más de N días no se procesan.
const MAX_AGE_DAYS_DEFAULT = 5;

// Fueros con reglas de plazo (plazos-normativa).
const FUEROS_PLAZOS = ['CIV', 'CSS', 'CNT', 'COM'];

// Tipos de movimiento que son notificación. Vocabulario observado en
// producción (5 valores con CEDULA); el \bCEDULA\b cubre variantes nuevas.
const RE_CEDULA = /\bCEDULA\b/;

const TIPO_NOTIFICACION = [
	[/RETORNO\s+CEDULA/, 'retorno_cedula'],
	[/CEDULA\s+ELECTRONICA\s+PARTE/, 'cedula_parte'],
	[/CEDULA\s+ELECTRONICA\s+TRIBUNAL/, 'cedula_tribunal'],
	[/CEDULA\s+INCORPORADA/, 'cedula_incorporada'],
	[/^CEDULA$/, 'cedula'],
];

function isNotificacion(mov) {
	return RE_CEDULA.test((mov.tipo || '').toUpperCase());
}

function classifyTipoNotificacion(tipo) {
	const t = (tipo || '').toUpperCase().trim();
	for (const [re, val] of TIPO_NOTIFICACION) {
		if (re.test(t)) return val;
	}
	return 'otro';
}

/**
 * Persiste las notificaciones detectadas en los movimientos nuevos.
 *
 * @param {Object} opts
 * @param {Object} [opts.model] — modelo PlazoNotificacion a usar (default: el de la conexión por defecto)
 * @param {Object} opts.causa — doc de la causa (necesita _id, number, year, caratula)
 * @param {Array}  opts.movimientos — movimientos NUEVOS ({fecha, tipo, detalle, url})
 * @param {string} opts.fuero — CIV | CSS | CNT | COM (otros fueros se ignoran)
 * @param {string} opts.collectionName — colección de causas origen
 * @param {string} [opts.worker='update-movimientos']
 * @param {string} [opts.origen] — 'cache' | 'usuario' (sin valor = caché, docs previos al campo)
 * @param {number|null} [opts.maxAgeDays=5] — descarta cédulas con fecha anterior a N días (null = sin ventana)
 * @returns {Promise<number>} cantidad de notificaciones realmente nuevas
 */
async function detectAndSavePlazoNotificaciones({
	model,
	causa,
	movimientos,
	fuero,
	collectionName,
	worker = 'update-movimientos',
	origen,
	maxAgeDays = MAX_AGE_DAYS_DEFAULT,
	primeraSync = false,
}) {
	if (!FUEROS_PLAZOS.includes(fuero)) return 0;

	const now = new Date();
	const desde = maxAgeDays ? now.getTime() - maxAgeDays * 24 * 60 * 60 * 1000 : null;
	const detectadas = (movimientos || []).filter(mov => {
		if (!isNotificacion(mov)) return false;
		if (desde === null) return true;
		const t = mov.fecha ? new Date(mov.fecha).getTime() : NaN;
		return !Number.isNaN(t) && t >= desde;
	});
	if (detectadas.length === 0) return 0;

	const Model = model || require('../models/plazo-notificacion');

	// Si la cédula ya entró por la bandeja del PJN y esperaba el documento, ese
	// registro pasa a la clave del movimiento antes del upsert: queda uno solo
	// (y el $setOnInsert de abajo no lo pisa). Require diferido: plazos-bandeja
	// importa este módulo.
	const { reconciliarConMovimiento } = require('./plazos-bandeja');
	if (Model.collection) {
		for (const mov of detectadas) {
			await reconciliarConMovimiento(Model.collection, causa._id, mov);
		}
	}

	const ops = detectadas.map(mov => {
		const sourceId = movementId.generateMovSourceId(mov);
		return {
			updateOne: {
				filter: { causaId: causa._id, sourceId },
				update: {
					$setOnInsert: {
						causaId: causa._id,
						number: causa.number,
						year: causa.year,
						fuero,
						objeto: causa.objeto || null,
						caratula: causa.caratula,
						collection: collectionName,
						sourceId,
						movimiento: {
							fecha: mov.fecha || null,
							tipo: mov.tipo || null,
							detalle: mov.detalle || null,
							url: mov.url || null,
						},
						tipoNotificacion: classifyTipoNotificacion(mov.tipo),
						processingStatus: mov.url ? 'pending' : 'no_url',
						detectedAt: now,
						...(origen ? { origen } : {}),
						source: { worker, collectionName, collectedAt: now, ...(primeraSync ? { primeraSync: true } : {}) },
					},
				},
				upsert: true,
			},
		};
	});

	const result = await Model.bulkWrite(ops, { ordered: false });
	return result.upsertedCount ?? 0;
}

module.exports = { detectAndSavePlazoNotificaciones, isNotificacion, classifyTipoNotificacion, FUEROS_PLAZOS, MAX_AGE_DAYS_DEFAULT };
