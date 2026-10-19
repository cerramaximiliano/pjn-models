'use strict';

/**
 * tipo-proceso.js — Detección del tipo de proceso de una causa (P21 de plazos
 * automáticos): 'ordinario' o 'sumario' (sumario y sumarísimo son el mismo
 * tipo: procesos de plazos reducidos respecto del ordinario).
 *
 * El tipo no está en el objeto de la causa: lo declara una resolución (la que
 * da curso a la demanda o imprime el trámite) o se infiere de un plazo
 * expreso que solo corresponde a un tipo. Señales, de más a menos fuerte:
 *   - 'expreso': frase que DECLARA el trámite ("tramitará según las normas del
 *     proceso ordinario", "imprímase el trámite de juicio sumarísimo",
 *     "corresponde a estas actuaciones el trámite de juicio ordinario").
 *     No cuenta la mención genérica ("las etapas del juicio ordinario" de las
 *     regulaciones de honorarios, citas del arancel).
 *   - 'plazo_demanda': traslado de la demanda por 15 días (ordinario) o 5
 *     (sumario/sumarísimo).
 *   - 'plazo_agravios': traslado de la expresión de agravios por 10 días
 *     (ordinario) o 5 (sumario), art. 265 CPCCN.
 * Gana la evidencia más reciente (un cambio de trámite posterior manda).
 *
 * Fueros: CIV, COM y CSS (CPCCN). CNT tiene su propio procedimiento (ley
 * 18.345) y sus reglas ya son específicas: no se detecta.
 *
 * Medido el 19/10 en 1.002 causas de usuarios: tipo detectado en el 34 % de
 * las civiles y el 21 % de las comerciales, sin contradicciones.
 */

const FUEROS_TIPO_PROCESO = ['CIV', 'COM', 'CSS'];

const N = '(?:quince|15|cinco|5|diez|10)';
const SENALES = [
	{
		fuente: 'expreso',
		re: /(?:tramitar[aá]n?|deber[aá]\s+tramitar|debe\s+tramitar|impr[ií]m[ae]se|imprimir|corresponde\s+(?:a\s+(?:estas|las\s+presentes)\s+actuaciones\s+)?(?:imprimir\s+)?el\s+tr[aá]mite|tr[aá]mite\s+correspondiente\s+al)[^.]{0,60}?\b(?:juicio|proceso|tr[aá]mite)\s+(?:de\s+)?(?:juicio\s+)?(ordinario|sumar[ií]simo|sumario)\b(?![^.]{0,15}etapa)/i,
		tipo: (v) => (/ordinario/i.test(v) ? 'ordinario' : 'sumario'),
	},
	{
		fuente: 'plazo_demanda',
		re: new RegExp(`traslado\\s+(?:de\\s+)?(?:la\\s+)?demanda[^.]{0,160}?\\b(${N})\\b[^.]{0,20}d[ií]as`, 'i'),
		tipo: (v) => (/quince|15/i.test(v) ? 'ordinario' : /cinco|5/i.test(v) ? 'sumario' : null),
	},
	{
		fuente: 'plazo_agravios',
		re: new RegExp(`(?:traslado[^.]{0,120}?agravios|agravios[^.]{0,120}?traslado)[^.]{0,120}?\\b(${N})\\b[^.]{0,20}d[ií]as`, 'i'),
		tipo: (v) => (/diez|10/i.test(v) ? 'ordinario' : /cinco|5/i.test(v) ? 'sumario' : null),
	},
];

/**
 * Busca el tipo de proceso en un texto (resolución, despacho o cédula).
 * @param {string} texto
 * @returns {{tipo: 'ordinario'|'sumario', fuente: string, frase: string}|null}
 */
function detectarEnTexto(texto) {
	if (!texto) return null;
	for (const s of SENALES) {
		const m = s.re.exec(texto);
		if (!m) continue;
		const tipo = s.tipo(m[1]);
		if (!tipo) continue;
		const frase = texto.slice(Math.max(0, m.index - 40), m.index + m[0].length + 20).replace(/\s+/g, ' ').trim();
		return { tipo, fuente: s.fuente, frase };
	}
	return null;
}

/**
 * Tipo vigente a partir de las evidencias de una causa: la más reciente gana;
 * una fijada por un operador gana sobre las detectadas.
 * @param {Array<{tipo, fuente, fecha}>} evidencias
 * @returns {{tipo, fuente, fecha, ...}|null}
 */
function resolverTipo(evidencias) {
	const lista = (evidencias || []).filter((e) => e && e.tipo);
	if (!lista.length) return null;
	const operador = lista.filter((e) => e.fuente === 'operador');
	const base = operador.length ? operador : lista;
	return base.reduce((a, b) => (new Date(b.fecha || 0) >= new Date(a.fecha || 0) ? b : a));
}

const MAX_EVIDENCIAS = 10;

/**
 * Suma una evidencia a la causa y recalcula el tipo vigente (upsert). Sirve
 * para el pipeline (evidencia detectada) y para la admin (fuente 'operador').
 * Idempotente: la misma evidencia (fuente + movementId) no se repite.
 * @param {Collection|Model} coleccion — causas-tipo-proceso (driver nativo o modelo)
 * @param {Object} opts — { causaId (ObjectId), fuero, evidencia: {tipo, fuente, movementId, fecha, frase, operador} }
 * @returns {Promise<{tipo, cambio: boolean, conflicto: boolean}>}
 */
async function registrarEvidencia(coleccion, { causaId, fuero, evidencia }) {
	const c = coleccion && coleccion.collection && typeof coleccion.collection.find === 'function' ? coleccion.collection : coleccion;
	const previo = await c.findOne({ _id: causaId });
	const lista = (previo?.evidencias || []).filter(
		(e) => !(e.fuente === evidencia.fuente && (e.movementId || null) === (evidencia.movementId || null))
	);
	lista.push({ movementId: null, frase: null, operador: null, ...evidencia, fecha: evidencia.fecha ? new Date(evidencia.fecha) : new Date() });
	lista.sort((a, b) => new Date(a.fecha || 0) - new Date(b.fecha || 0));
	// La del operador no se recorta nunca (gana siempre en resolverTipo).
	const operador = lista.filter((e) => e.fuente === 'operador').slice(-1);
	const detectadas = lista.filter((e) => e.fuente !== 'operador');
	const evidencias = [...detectadas.slice(-(MAX_EVIDENCIAS - operador.length)), ...operador];
	const vigente = resolverTipo(evidencias);
	const conflicto = new Set(evidencias.map((e) => e.tipo)).size > 1;
	const now = new Date();
	await c.updateOne(
		{ _id: causaId },
		{
			$set: {
				fuero,
				tipo: vigente?.tipo || null,
				fuente: vigente?.fuente || null,
				movementId: vigente?.movementId || null,
				fecha: vigente?.fecha || null,
				frase: vigente?.frase || null,
				evidencias,
				conflicto,
				updatedAt: now,
			},
			$setOnInsert: { createdAt: now },
		},
		{ upsert: true }
	);
	return { tipo: vigente?.tipo || null, cambio: (previo?.tipo || null) !== (vigente?.tipo || null), conflicto };
}

/**
 * Cuando el tipo de una causa se conoce o cambia: vuelve a `pending` sus
 * cédulas que esperaban el tipo y las computadas con una variante por tipo
 * todavía no entregadas, para que plazos-worker las recalcule.
 * @param {Collection|Model} plazos — plazos-notificaciones
 * @param {ObjectId} causaId
 * @returns {Promise<number>} cédulas re-encoladas
 */
async function reencolarCausa(plazos, causaId) {
	const c = plazos && plazos.collection && typeof plazos.collection.find === 'function' ? plazos.collection : plazos;
	const r = await c.updateMany(
		{
			causaId,
			$or: [
				{ processingStatus: 'requiere_tipo_proceso' },
				{ processingStatus: 'computed', 'plazo.norma.tipoProceso': { $ne: null }, 'validacion.estado': { $in: [null, undefined] } },
			],
		},
		{ $set: { processingStatus: 'pending', retryCount: 0 }, $unset: { processingLock: '' } }
	);
	return r.modifiedCount || 0;
}

module.exports = { FUEROS_TIPO_PROCESO, detectarEnTexto, resolverTipo, registrarEvidencia, reencolarCausa };
