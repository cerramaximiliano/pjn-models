'use strict';

/**
 * plazos-bandeja.js — La bandeja de notificaciones del PJN (notif.pjn.gov.ar,
 * bandeja RECIBIDAS, sincronizada por pjn-mis-causas) como fuente de cédulas
 * para plazos automáticos.
 *
 * Cada notificación de la bandeja trae numeroCedula (14 dígitos), fecha exacta
 * de la notificación, expediente {numeracion "CNT 33132/2011", numero, anio} y
 * destinatarios [{nombre, cuit}], pero no el texto ni el PDF. El documento sale
 * del movimiento CEDULA de la causa, que trae "CEDULA N° <numeroCedula> -
 * NOTIFICADO EL ..." en el detalle.
 *
 *   vincularNotificacion(db, notif)  → causa de Atlas + movimiento (si ya llegó)
 *   registrarCedulaBandeja(...)      → upsert en plazos-notificaciones (Atlas):
 *       - con movimiento: MISMA clave que F1 (causaId, sourceId del movimiento),
 *         sumando el bloque `bandeja`: un solo registro por cédula.
 *       - sin movimiento todavía: clave (causaId, 'bandeja-ced-<numeroCedula>'),
 *         processingStatus 'esperando_documento'. Cuando el movimiento llega
 *         (F1 o una sincronización posterior), reconciliarConMovimiento le pone
 *         el sourceId del movimiento y lo pasa a 'pending'.
 *   reconciliarConMovimiento(col, causaId, mov) → lo usa también el detector F1.
 *
 * Trabaja con colecciones nativas (db.collection) para no depender de la
 * instancia de mongoose del worker que lo llama.
 */

const movementId = require('./movement-id');
const { FUEROS_PLAZOS, classifyTipoNotificacion, MAX_AGE_DAYS_DEFAULT } = require('./plazos-deteccion');

// Prefijo de numeración del portal (expediente.numeracion) → colección de causas.
const FUERO_COLLECTION = {
	CIV: 'causas-civil',
	COM: 'causas-comercial',
	CSS: 'causas-segsocial',
	CNT: 'causas-trabajo',
	CAF: 'causas_caf', CCF: 'causas_ccf', CNE: 'causas_cne', CPE: 'causas_cpe',
	CFP: 'causas_cfp', CCC: 'causas_ccc', CSJ: 'causas_csj', FSM: 'causas_fsm',
	CPF: 'causas_cpf', CPN: 'causas_cpn', FBB: 'causas_fbb', FCR: 'causas_fcr',
	FCB: 'causas_fcb', FCT: 'causas_fct', FGR: 'causas_fgr', FLP: 'causas_flp',
	FMP: 'causas_fmp', FMZ: 'causas_fmz', FPO: 'causas_fpo', FPA: 'causas_fpa',
	FRE: 'causas_fre', FSA: 'causas_fsa', FRO: 'causas_fro', FTU: 'causas_ftu',
};

const COLECCION_PLAZOS = 'plazos-notificaciones';
const COLECCION_MOVIMIENTOS = 'pjn-movements';

function soloDigitos(v) {
	return String(v ?? '').replace(/\D/g, '');
}

/** 'CNT' desde expediente.numeracion ("CNT 33132/2011"); null si no se reconoce. */
function fueroDeNotificacion(notif) {
	const m = /^\s*([A-Z]{3})\b/.exec(notif?.expediente?.numeracion || '');
	return m && FUERO_COLLECTION[m[1]] ? m[1] : null;
}

/** Número de cédula (10–16 dígitos) del detalle "CEDULA N° 25000123456789 - ...". */
function numeroCedulaDeDetalle(detalle) {
	const m = /C[EÉ]DULA\s*N[°º.:]*\s*(\d{10,16})/i.exec(detalle || '');
	return m ? m[1] : null;
}

function bandejaSourceId(numeroCedula) {
	return `bandeja-ced-${soloDigitos(numeroCedula)}`;
}

/** Día calendario en Argentina (UTC-3 fijo, sin DST) como 'YYYY-MM-DD'. */
function diaArgentina(date) {
	const d = new Date(date);
	if (Number.isNaN(d.getTime())) return null;
	return new Date(d.getTime() - 3 * 3600 * 1000).toISOString().slice(0, 10);
}

function esDeHoyArgentina(date, ahora = new Date()) {
	const dia = diaArgentina(date);
	return dia != null && dia === diaArgentina(ahora);
}

function destinatariosDeBandeja(notif) {
	const porCuit = new Map();
	for (const d of notif?.destinatarios || []) {
		const cuit = soloDigitos(d?.cuit);
		if (cuit.length !== 11 || porCuit.has(cuit)) continue;
		porCuit.set(cuit, {
			cuit,
			nombre: d?.nombre ? String(d.nombre).trim() || null : null,
			tipo: d?.tipoDescripcion || d?.tipo || null,
		});
	}
	return [...porCuit.values()];
}

/**
 * Busca la causa de Atlas y el movimiento de la cédula.
 * @param {Db} db — base de causas (Atlas), driver nativo
 * @returns {Promise<{fuero, collectionName, causa, movimiento, motivo}>}
 *   motivo: 'vinculada' | 'sin_movimiento' | 'sin_causa' | 'fuero_desconocido' | 'datos_incompletos'
 */
async function vincularNotificacion(db, notif) {
	const fuero = fueroDeNotificacion(notif);
	if (!fuero) return { fuero: null, collectionName: null, causa: null, movimiento: null, motivo: 'fuero_desconocido' };
	const collectionName = FUERO_COLLECTION[fuero];
	const number = Number(notif?.expediente?.numero);
	const year = Number(notif?.expediente?.anio);
	const numeroCedula = soloDigitos(notif?.numeroCedula);
	if (!number || !year || !numeroCedula) return { fuero, collectionName, causa: null, movimiento: null, motivo: 'datos_incompletos' };

	// number/year se guardan como Number en las causas; algunas cargas viejas como String.
	const causas = await db.collection(collectionName)
		.find({ number: { $in: [number, String(number)] }, year: { $in: [year, String(year)] } })
		.project({ _id: 1, number: 1, year: 1, incidente: 1, caratula: 1, objeto: 1, movimiento: 1 })
		.limit(20)
		.toArray();
	if (!causas.length) return { fuero, collectionName, causa: null, movimiento: null, motivo: 'sin_causa' };

	// Incidentes comparten number/year: gana la causa que tiene el movimiento de la cédula.
	for (const c of causas) {
		const mov = (c.movimiento || []).find(m => numeroCedulaDeDetalle(m?.detalle) === numeroCedula);
		if (mov) return { fuero, collectionName, causa: sinMovimientos(c), movimiento: mov, motivo: 'vinculada' };
	}
	const principal = causas.find(c => !c.incidente) || causas[0];
	return { fuero, collectionName, causa: sinMovimientos(principal), movimiento: null, motivo: 'sin_movimiento' };
}

function sinMovimientos(c) {
	const { movimiento, ...resto } = c;
	return resto;
}

function camposMovimiento(mov) {
	return {
		movimiento: { fecha: mov.fecha || null, tipo: mov.tipo || null, detalle: mov.detalle || null, url: mov.url || null },
		tipoNotificacion: classifyTipoNotificacion(mov.tipo),
	};
}

/**
 * Escribe cedula.recepcion en el movimiento espejado (pjn-movements, _id
 * "causaId:sourceId"). Solo $set/$addToSet punteados: no toca los sub-bloques
 * de otros dueños (cedula.documento, cedula.resultado, cedula.plazo). Si el
 * movimiento todavía no está espejado no hace nada (devuelve false).
 */
async function escribirRecepcionEnMovimiento(db, causaId, sourceId, recepcion) {
	const addToSet = {};
	for (const k of ['userIds', 'credentialsIds', 'notificationIds']) {
		const vals = (recepcion[k] || []).filter(Boolean);
		if (vals.length) addToSet[`cedula.recepcion.${k}`] = { $each: vals };
	}
	const res = await db.collection(COLECCION_MOVIMIENTOS).updateOne(
		{ _id: `${causaId}:${sourceId}` },
		{
			$set: {
				'cedula.recepcion.numeroCedula': recepcion.numeroCedula ?? null,
				'cedula.recepcion.fechaNotificacion': recepcion.fechaNotificacion ?? null,
				'cedula.recepcion.destinatarios': recepcion.destinatarios || [],
				'cedula.recepcion.at': new Date(),
			},
			...(Object.keys(addToSet).length ? { $addToSet: addToSet } : {}),
		}
	);
	return res.matchedCount > 0;
}

function recepcionDeBandeja(b) {
	return {
		numeroCedula: b?.numeroCedula ?? null,
		fechaNotificacion: b?.fecha ?? null,
		destinatarios: b?.destinatarios || [],
		userIds: b?.userIds || [],
		credentialsIds: b?.credentialsIds || [],
		notificationIds: b?.notificationIds || [],
	};
}

/**
 * Si hay un registro de bandeja esperando documento para esta cédula, lo pasa
 * a la clave del movimiento. Devuelve true si reconcilió algo.
 * Si ya existía otro registro con la clave del movimiento (carrera F1/bandeja),
 * le suma el bloque `bandeja` y borra el de espera: siempre queda uno.
 *
 * @param {Collection} col — plazos-notificaciones (driver nativo o Model.collection)
 * @param {Db} [db] — base de pjn-movements; si falta se toma de Model.collection.conn.db
 */
async function reconciliarConMovimiento(col, causaId, mov, db = null) {
	const numeroCedula = numeroCedulaDeDetalle(mov?.detalle);
	if (!numeroCedula) return false;
	const espera = await col.findOne({ causaId, sourceId: bandejaSourceId(numeroCedula) });
	if (!espera) return false;

	const sourceId = movementId.generateMovSourceId(mov);
	const { movimiento, tipoNotificacion } = camposMovimiento(mov);
	const status = movimiento.url ? 'pending' : 'no_url';
	try {
		await col.updateOne(
			{ _id: espera._id },
			{
				$set: {
					sourceId, movimiento, tipoNotificacion,
					...(espera.processingStatus === 'esperando_documento' ? { processingStatus: status } : {}),
					'bandeja.reconciliadaAt': new Date(),
					updatedAt: new Date(),
				},
			}
		);
	} catch (err) {
		if (err?.code !== 11000) throw err;
		// Ya existe el registro del movimiento: sumarle la bandeja y borrar el de espera.
		// (la recepción se escribe en el movimiento más abajo, en los dos casos)
		const b = espera.bandeja || {};
		await col.updateOne(
			{ causaId, sourceId },
			{
				$addToSet: {
					'bandeja.userIds': { $each: b.userIds || [] },
					'bandeja.credentialsIds': { $each: b.credentialsIds || [] },
					'bandeja.notificationIds': { $each: b.notificationIds || [] },
				},
				$set: {
					'bandeja.numeroCedula': b.numeroCedula ?? null,
					'bandeja.fecha': b.fecha ?? null,
					'bandeja.destinatarios': b.destinatarios || [],
					'bandeja.reconciliadaAt': new Date(),
					updatedAt: new Date(),
				},
			}
		);
		await col.deleteOne({ _id: espera._id });
	}
	// La recepción de la bandeja pasa al movimiento espejado (registro único de la cédula).
	if (espera.bandeja) {
		const dbMov = db || col.conn?.db || null;
		if (dbMov) await escribirRecepcionEnMovimiento(dbMov, causaId, sourceId, recepcionDeBandeja(espera.bandeja)).catch(() => false);
	}
	return true;
}

/**
 * Registra una cédula de la bandeja en plazos-notificaciones (Atlas).
 *
 * @param {Object} opts
 * @param {Db}     opts.db — base Atlas (causas + plazos-notificaciones), driver nativo
 * @param {Object} opts.notif — item de la API (o doc de pjn-notifications)
 * @param {*}      opts.userId, opts.credentialsId, opts.notificationId — ObjectIds de la app
 * @param {number} [opts.maxAgeDays=5] — ventana: cédulas con fecha de hasta N días (decisión del usuario
 *           19/10; antes solo las de HOY). Las que no son de hoy quedan con `bandeja.tardia` y la entrega
 *           (plazos-folders-worker) exige para ellas vencimiento > hoy, igual que `source.primeraSync`.
 * @param {boolean} [opts.soloHoy=false] — regla anterior (solo HOY, ART), por si hay que volver atrás
 * @returns {Promise<{accion: string, plazoId?: *, fuero?: string}>}
 *   accion: 'creada' | 'actualizada' | 'reconciliada' | 'esperando_documento' |
 *           'no_es_de_hoy' | 'fuera_de_ventana' | 'sin_causa' | 'fuero_sin_reglas' | 'fuero_desconocido' | 'datos_incompletos'
 */
async function registrarCedulaBandeja({ db, notif, userId, credentialsId, notificationId, soloHoy = false, maxAgeDays = Number(process.env.PLAZOS_DETECCION_MAX_DIAS) || MAX_AGE_DAYS_DEFAULT, vinculo = null }) {
	const deHoy = esDeHoyArgentina(notif?.fecha);
	if (soloHoy && !deHoy) return { accion: 'no_es_de_hoy' };
	const t = notif?.fecha ? new Date(notif.fecha).getTime() : NaN;
	if (!deHoy && (Number.isNaN(t) || (maxAgeDays && Date.now() - t > maxAgeDays * 24 * 60 * 60 * 1000))) return { accion: 'fuera_de_ventana' };

	const v = vinculo || await vincularNotificacion(db, notif);
	if (!v.causa) return { accion: v.motivo, fuero: v.fuero };
	if (!FUEROS_PLAZOS.includes(v.fuero)) return { accion: 'fuero_sin_reglas', fuero: v.fuero };

	const col = db.collection(COLECCION_PLAZOS);
	const now = new Date();
	const numeroCedula = soloDigitos(notif.numeroCedula);
	const fecha = new Date(notif.fecha);
	const addToSet = {
		...(userId ? { 'bandeja.userIds': userId } : {}),
		...(credentialsId ? { 'bandeja.credentialsIds': credentialsId } : {}),
		...(notificationId ? { 'bandeja.notificationIds': notificationId } : {}),
	};
	const bandejaUpdate = {
		...(Object.keys(addToSet).length ? { $addToSet: addToSet } : {}),
		$set: {
			'bandeja.numeroCedula': numeroCedula,
			'bandeja.fecha': fecha,
			'bandeja.destinatarios': destinatariosDeBandeja(notif),
			updatedAt: now,
		},
	};
	const base = {
		causaId: v.causa._id,
		number: v.causa.number,
		year: v.causa.year,
		fuero: v.fuero,
		objeto: v.causa.objeto || null,
		caratula: v.causa.caratula,
		collection: v.collectionName,
		origen: 'usuario',
		fuente: 'bandeja',
		retryCount: 0,
		detectedAt: now,
		createdAt: now,
		source: { worker: 'bandeja', collectionName: v.collectionName, collectedAt: now },
		// Levantada después de su día: solo se entrega si vence mañana o después.
		...(deHoy ? {} : { 'bandeja.tardia': true }),
	};

	if (v.movimiento) {
		// Un registro previo de espera (llegó la bandeja antes que el movimiento) pasa a la clave del movimiento.
		const reconciliada = await reconciliarConMovimiento(col, v.causa._id, v.movimiento, db);
		const sourceId = movementId.generateMovSourceId(v.movimiento);
		const { movimiento, tipoNotificacion } = camposMovimiento(v.movimiento);
		const res = await col.findOneAndUpdate(
			{ causaId: v.causa._id, sourceId },
			{
				...bandejaUpdate,
				$setOnInsert: { ...base, sourceId, movimiento, tipoNotificacion, processingStatus: movimiento.url ? 'pending' : 'no_url' },
			},
			{ upsert: true, returnDocument: 'after', includeResultMetadata: true }
		);
		const creada = res?.lastErrorObject?.upserted != null;
		return { accion: reconciliada ? 'reconciliada' : creada ? 'creada' : 'actualizada', plazoId: res?.value?._id, fuero: v.fuero };
	}

	// Sin movimiento todavía: queda esperando el documento.
	const sourceId = bandejaSourceId(numeroCedula);
	const res = await col.findOneAndUpdate(
		{ causaId: v.causa._id, sourceId },
		{
			...bandejaUpdate,
			$setOnInsert: { ...base, sourceId, movimiento: null, tipoNotificacion: 'cedula', processingStatus: 'esperando_documento' },
		},
		{ upsert: true, returnDocument: 'after', includeResultMetadata: true }
	);
	return { accion: 'esperando_documento', plazoId: res?.value?._id, fuero: v.fuero };
}

/**
 * Procesa una notificación de la bandeja (cualquier fecha):
 *   1. la vincula con su causa y su movimiento;
 *   2. si el movimiento está espejado, escribe cedula.recepcion en pjn-movements
 *      (registro único de la cédula, todas las fechas);
 *   3. si la cédula tiene hasta 5 días y es de un fuero con reglas, registra el plazo
 *      (registrarCedulaBandeja); las que no son de hoy quedan con `bandeja.tardia`.
 * @returns {Promise<{vinculo: {estado, fuero, causaId, movementId, espejado, at}, plazo: {accion, plazoId?}}>}
 *   vinculo.estado: 'vinculada' | 'sin_movimiento' | 'sin_causa' | 'fuero_desconocido' | 'datos_incompletos'
 */
async function procesarNotificacionBandeja({ db, notif, userId, credentialsId, notificationId }) {
	const v = await vincularNotificacion(db, notif);
	const vinculo = { estado: v.motivo, fuero: v.fuero, causaId: v.causa?._id || null, movementId: null, espejado: false, at: new Date() };
	if (v.causa && v.movimiento) {
		const sourceId = movementId.generateMovSourceId(v.movimiento);
		vinculo.movementId = `${v.causa._id}:${sourceId}`;
		vinculo.espejado = await escribirRecepcionEnMovimiento(db, v.causa._id, sourceId, {
			numeroCedula: soloDigitos(notif.numeroCedula),
			fechaNotificacion: notif.fecha ? new Date(notif.fecha) : null,
			destinatarios: destinatariosDeBandeja(notif),
			userIds: [userId],
			credentialsIds: [credentialsId],
			notificationIds: [notificationId],
		});
	}
	const plazo = await registrarCedulaBandeja({ db, notif, userId, credentialsId, notificationId, vinculo: v });
	return { vinculo, plazo };
}

module.exports = {
	FUERO_COLLECTION,
	fueroDeNotificacion,
	numeroCedulaDeDetalle,
	bandejaSourceId,
	diaArgentina,
	esDeHoyArgentina,
	destinatariosDeBandeja,
	vincularNotificacion,
	reconciliarConMovimiento,
	registrarCedulaBandeja,
	escribirRecepcionEnMovimiento,
	procesarNotificacionBandeja,
};
