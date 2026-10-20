'use strict';

/**
 * tipo-proceso.js — Detección del tipo de proceso de una causa (P21 de plazos
 * automáticos): 'ordinario', 'sumario' (sumario y sumarísimo son el mismo
 * tipo: procesos de plazos reducidos respecto del ordinario) o 'especial'
 * (ejecuciones, sucesiones, amparos, beneficios, quiebras, etc.: trámites
 * propios a los que la distinción no aplica; las reglas con variante por tipo
 * no se les aplican, pero tampoco quedan esperando un tipo que no va a llegar).
 *
 * El tipo lo declara una resolución (la que da curso a la demanda o imprime el
 * trámite), se infiere de un plazo expreso que solo corresponde a un tipo o lo
 * dice el objeto de la causa (Comercial, CCF y CNT suelen ponerlo ahí).
 * Señales, de más a menos fuerte:
 *   - 'operador': fijado desde la admin (gana siempre).
 *   - textos (gana el más reciente; un cambio de trámite posterior manda):
 *     - 'expreso': frase que DECLARA el trámite ("tramitará según las normas
 *       del proceso ordinario", "imprímase el trámite de juicio sumarísimo").
 *       No cuenta la mención genérica ("las etapas del juicio ordinario").
 *     - 'plazo_demanda': traslado de la demanda por 15 días (ordinario) o 5
 *       (sumario/sumarísimo); en CNT, 10 (ley 18.345, art. 68) o 5 (art. 498
 *       CPCCN, sumarísimos).
 *     - 'plazo_agravios': traslado de la expresión de agravios por 10 días
 *       (ordinario) o 5 (sumario), art. 265 CPCCN. No en CNT (3 días en los dos).
 *   - 'objeto' / 'objeto_especial': el objeto dice ORDINARIO, SUMARIO o
 *     SUMARISIMO, o es de un proceso especial.
 *   - 'norma': CNT sin otra señal = ordinario de la ley 18.345 (el
 *     procedimiento laboral no distingue tipos; los sumarísimos laborales, por
 *     art. 498 CPCCN, se detectan por objeto o texto); CSS sin otra señal =
 *     ordinario del CPCCN (reajustes y demás previsionales, indicado por el
 *     usuario el 20/10).
 * Por encima de los textos, la de un usuario que lo indicó en su carpeta
 * ('usuario', una por usuario; gana la más reciente) y, por encima de todo, la
 * del operador de la admin.
 * Además, sin tipo, una `sugerencia` por objeto (daños y perjuicios, cobro de
 * sumas…: típicamente ordinarios) que solo ve el operador: no habilita cálculo.
 *
 * Fueros: CIV, COM, CSS, CCF, CAF y los federales del interior (CPCCN) y CNT (ley 18.345 +
 * CPCCN supletorio).
 *
 * Medido el 19/10 en las causas de usuarios: por textos, 34 % de las civiles y
 * 21 % de las comerciales; CNT: traslado de demanda 10 días en las ordinarias,
 * 5 en las de objeto "JUICIO SUMARISIMO".
 */

// Federales del interior (FBB, FCB…): competencia civil por el CPCCN (desde el 20/10, P22).
const FUEROS_FEDERALES_INTERIOR = ['FBB', 'FCB', 'FCR', 'FCT', 'FGR', 'FLP', 'FMP', 'FMZ', 'FPA', 'FPO', 'FRE', 'FRO', 'FSA', 'FSM', 'FTU'];
const FUEROS_TIPO_PROCESO = ['CIV', 'COM', 'CSS', 'CCF', 'CAF', 'CNT', ...FUEROS_FEDERALES_INTERIOR];

// Colección de las causas de usuarios (Atlas) por fuero.
const COLECCION_CAUSAS = {
	CIV: 'causas-civil',
	COM: 'causas-comercial',
	CSS: 'causas-segsocial',
	CNT: 'causas-trabajo',
	CCF: 'causas_ccf',
	CAF: 'causas_caf',
	...Object.fromEntries(FUEROS_FEDERALES_INTERIOR.map((f) => [f, `causas_${f.toLowerCase()}`])),
};

const FUENTES_TEXTO = ['expreso', 'plazo_demanda', 'plazo_agravios'];

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
		noEn: ['CNT'],
	},
];
// CNT: el traslado de la demanda (o "de la acción") es de 10 días en el
// ordinario de la ley 18.345 y de 5 en los sumarísimos (art. 498 CPCCN).
const SENAL_DEMANDA_CNT = {
	fuente: 'plazo_demanda',
	re: new RegExp(`traslado\\s+(?:de\\s+)?(?:la\\s+)?(?:demanda|acci[oó]n)[^.]{0,160}?\\b(${N})\\b[^.]{0,20}d[ií]as`, 'i'),
	tipo: (v) => (/diez|10/i.test(v) ? 'ordinario' : /cinco|5/i.test(v) ? 'sumario' : null),
};

/**
 * Busca el tipo de proceso en un texto (resolución, despacho o cédula).
 * @param {string} texto
 * @param {string} [fuero] — en CNT cambian las señales de plazo
 * @returns {{tipo: 'ordinario'|'sumario', fuente: string, frase: string}|null}
 */
function detectarEnTexto(texto, fuero = null) {
	if (!texto) return null;
	const senales = fuero === 'CNT'
		? SENALES.filter((s) => !(s.noEn || []).includes('CNT')).map((s) => (s.fuente === 'plazo_demanda' ? SENAL_DEMANDA_CNT : s))
		: SENALES;
	for (const s of senales) {
		const m = s.re.exec(texto);
		if (!m) continue;
		const tipo = s.tipo(m[1]);
		if (!tipo) continue;
		const frase = texto.slice(Math.max(0, m.index - 40), m.index + m[0].length + 20).replace(/\s+/g, ' ').trim();
		return { tipo, fuente: s.fuente, frase };
	}
	return null;
}

const sinTildes = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase();

// Procesos con trámite propio (la distinción ordinario/sumario no aplica).
const RE_ESPECIAL = /EJECUCI|EJECUTIV|SUCESI|BENEFICIO DE LITIGAR|HOMOLOGACI|AMPARO|HABEAS|QUIEBRA|CONCURSO|VERIFICACION DE CREDITO|DIVORCIO|ALIMENTOS|VIOLENCIA|ACUERDO TRANSACCIONAL|MEDIDAS? (?:PRECAUTORIA|CAUTELAR)|PRUEBA ANTICIPADA|DILIGENCIA PRELIMINAR|OFICIOS LEY|INTERRU\w* (?:DE )?(?:LA )?PRESCRIPCI|EXPROPIACI|RECURSO LEY 27\.?348|LIQUIDACION JUDICIAL/;
// Típicamente ordinarios: solo sugerencia para el operador.
const RE_SUGERENCIA_ORDINARIO = /DANOS Y PERJUICIOS|COBRO DE SUMAS|INCUMPLIMIENTO DE CONTRATO|RESPONSABILIDAD|DESPIDO|DIFERENCIAS DE SALARIOS|ACCIDENTE/;

/**
 * Tipo por el objeto de la causa.
 * @param {string} objeto
 * @returns {{tipo, fuente: 'objeto'|'objeto_especial', frase}|null}
 */
function detectarEnObjeto(objeto) {
	const o = sinTildes(objeto);
	if (!o) return null;
	if (RE_ESPECIAL.test(o)) return { tipo: 'especial', fuente: 'objeto_especial', frase: String(objeto).trim() };
	if (/\bSUMARI(?:SIM)?[OA]\b/.test(o)) return { tipo: 'sumario', fuente: 'objeto', frase: String(objeto).trim() };
	if (/\bORDINARI[OA]\b/.test(o)) return { tipo: 'ordinario', fuente: 'objeto', frase: String(objeto).trim() };
	return null;
}

/** Tipo por la norma del fuero (CNT: ordinario de la ley 18.345). */
function tipoPorNorma(fuero) {
	if (fuero === 'CNT') return { tipo: 'ordinario', fuente: 'norma', frase: 'Procedimiento laboral (ley 18.345)' };
	if (fuero === 'CSS') return { tipo: 'ordinario', fuente: 'norma', frase: 'Previsional: proceso ordinario (CPCCN)' };
	return null;
}

/** Sugerencia por objeto para el operador (no es evidencia). */
function sugerirPorObjeto(objeto) {
	const o = sinTildes(objeto);
	if (o && RE_SUGERENCIA_ORDINARIO.test(o)) return { tipo: 'ordinario', motivo: `Objeto típicamente ordinario: ${String(objeto).trim()}` };
	return null;
}

// Rango de cada fuente en resolverTipo (mayor gana; a igual rango, la más reciente).
const RANGO = { operador: 4, usuario: 3, expreso: 2, plazo_demanda: 2, plazo_agravios: 2, objeto: 1, objeto_especial: 1, norma: 0 };

/**
 * Tipo vigente a partir de las evidencias de una causa: la del operador gana;
 * después, la de un usuario (la más reciente); después, la más reciente de los
 * textos; después, el objeto; al final, la norma.
 * @param {Array<{tipo, fuente, fecha}>} evidencias
 * @returns {{tipo, fuente, fecha, ...}|null}
 */
function resolverTipo(evidencias) {
	const lista = (evidencias || []).filter((e) => e && e.tipo);
	if (!lista.length) return null;
	const top = Math.max(...lista.map((e) => RANGO[e.fuente] ?? 2));
	const base = lista.filter((e) => (RANGO[e.fuente] ?? 2) === top);
	return base.reduce((a, b) => (new Date(b.fecha || 0) >= new Date(a.fecha || 0) ? b : a));
}

// Conflicto: señales de tipos distintos sin contar la norma (que es el piso por defecto).
const hayConflicto = (evidencias) => new Set((evidencias || []).filter((e) => e.fuente !== 'norma').map((e) => e.tipo)).size > 1;

const MAX_EVIDENCIAS = 10;
const FIJAS = ['operador', 'usuario', 'objeto', 'objeto_especial', 'norma'];
const CON_FECHA = (f) => !FIJAS.includes(f) || f === 'operador' || f === 'usuario';
// Una sola evidencia por "lugar": cada texto (fuente + movimiento), el objeto, la norma, el operador, cada usuario.
const lugar = (e) => (e.fuente === 'objeto' || e.fuente === 'objeto_especial' ? 'objeto'
	: e.fuente === 'usuario' ? `usuario:${e.operador || ''}`
		: FIJAS.includes(e.fuente) ? e.fuente : `${e.fuente}:${e.movementId || ''}`);

/**
 * Suma una evidencia a la causa y recalcula el tipo vigente (upsert). Sirve
 * para el pipeline (evidencia detectada) y para la admin (fuente 'operador').
 * Idempotente: la misma evidencia (mismo lugar) se reemplaza, no se repite.
 * @param {Collection|Model} coleccion — causas-tipo-proceso (driver nativo o modelo)
 * @param {Object} opts — { causaId (ObjectId), fuero, evidencia: {tipo, fuente, movementId, fecha, frase, operador}, sugerencia }
 * @returns {Promise<{tipo, fuente, fecha, cambio: boolean, conflicto: boolean}>}
 */
async function registrarEvidencia(coleccion, { causaId, fuero, evidencia, sugerencia }) {
	const c = coleccion && coleccion.collection && typeof coleccion.collection.find === 'function' ? coleccion.collection : coleccion;
	const previo = await c.findOne({ _id: causaId });
	const nueva = { movementId: null, frase: null, operador: null, ...evidencia };
	// Objeto y norma no tienen fecha (no compiten por fecha con los textos: rango propio).
	const anterior = (previo?.evidencias || []).find((e) => lugar(e) === lugar(nueva));
	if (CON_FECHA(nueva.fuente)) nueva.fecha = nueva.fecha ? new Date(nueva.fecha) : new Date();
	else nueva.fecha = null;
	const lista = (previo?.evidencias || []).filter((e) => lugar(e) !== lugar(nueva));
	lista.push(nueva);
	lista.sort((a, b) => new Date(a.fecha || 0) - new Date(b.fecha || 0));
	// Las fijas (operador, usuarios, objeto, norma) no se recortan nunca.
	const fijas = lista.filter((e) => FIJAS.includes(e.fuente));
	const textos = lista.filter((e) => !FIJAS.includes(e.fuente));
	const evidencias = [...textos.slice(-(MAX_EVIDENCIAS - fijas.length)), ...fijas];
	const vigente = resolverTipo(evidencias);
	const conflicto = hayConflicto(evidencias);
	const igual = anterior && anterior.tipo === nueva.tipo && (anterior.frase || null) === (nueva.frase || null)
		&& String(anterior.fecha) === String(nueva.fecha)
		&& (sugerencia === undefined || JSON.stringify(previo.sugerencia ?? null) === JSON.stringify(vigente?.tipo ? null : sugerencia));
	if (igual) return { tipo: previo.tipo || null, fuente: previo.fuente || null, fecha: previo.fecha || null, cambio: false, conflicto: !!previo.conflicto };
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
				...(sugerencia !== undefined ? { sugerencia: vigente?.tipo ? null : sugerencia } : {}),
				updatedAt: now,
			},
			$setOnInsert: { createdAt: now },
		},
		{ upsert: true }
	);
	return {
		tipo: vigente?.tipo || null,
		fuente: vigente?.fuente || null,
		fecha: vigente?.fecha || null,
		cambio: (previo?.tipo || null) !== (vigente?.tipo || null) || (previo?.fuente || null) !== (vigente?.fuente || null),
		conflicto,
	};
}

/**
 * Quita la evidencia del operador y recalcula el tipo con las detectadas.
 * @param {Collection|Model} coleccion — causas-tipo-proceso
 * @param {ObjectId} causaId
 * @returns {Promise<{tipo, fuente, fecha, cambio: boolean, conflicto: boolean}|null>} null si la causa no tiene documento
 */
async function quitarOperador(coleccion, causaId) {
	return quitarEvidencia(coleccion, causaId, (e) => e.fuente === 'operador');
}

/**
 * Quita la indicación de un usuario (la que fijó desde su carpeta) y recalcula.
 * @param {Collection|Model} coleccion — causas-tipo-proceso
 * @param {ObjectId} causaId
 * @param {string} userId
 */
async function quitarUsuario(coleccion, causaId, userId) {
	return quitarEvidencia(coleccion, causaId, (e) => e.fuente === 'usuario' && e.operador === String(userId));
}

async function quitarEvidencia(coleccion, causaId, quitar) {
	const c = coleccion && coleccion.collection && typeof coleccion.collection.find === 'function' ? coleccion.collection : coleccion;
	const previo = await c.findOne({ _id: causaId });
	if (!previo) return null;
	const evidencias = (previo.evidencias || []).filter((e) => !quitar(e));
	const vigente = resolverTipo(evidencias);
	const conflicto = hayConflicto(evidencias);
	await c.updateOne({ _id: causaId }, {
		$set: {
			tipo: vigente?.tipo || null, fuente: vigente?.fuente || null, movementId: vigente?.movementId || null, fecha: vigente?.fecha || null,
			frase: vigente?.frase || null, evidencias, conflicto, updatedAt: new Date(),
		},
	});
	return {
		tipo: vigente?.tipo || null,
		fuente: vigente?.fuente || null,
		fecha: vigente?.fecha || null,
		cambio: (previo.tipo || null) !== (vigente?.tipo || null) || (previo.fuente || null) !== (vigente?.fuente || null),
		conflicto,
	};
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

/**
 * Copia el tipo vigente a la causa (`tipoProceso`) y a sus carpetas
 * (`judFolder.tipoProceso`), para mostrarlo en la UI y usarlo al clasificar.
 * Solo escribe si cambió. Las carpetas sin judFolder no se tocan.
 * @param {Db} db — base de usuarios (Atlas)
 * @param {Object} opts — { causaId, fuero, tipo, fuente, fecha }
 * @returns {Promise<{causa: number, carpetas: number}>}
 */
async function propagarTipo(db, { causaId, fuero, tipo, fuente, fecha }) {
	const col = COLECCION_CAUSAS[fuero];
	const valor = tipo ? { tipo, fuente: fuente || null, fecha: fecha || null, actualizadoAt: new Date() } : null;
	const distinto = (campo) => ({ $or: [{ [`${campo}.tipo`]: { $ne: tipo || null } }, { [`${campo}.fuente`]: { $ne: fuente || null } }] });
	const r1 = col
		? await db.collection(col).updateOne({ _id: causaId, ...distinto('tipoProceso') }, { $set: { tipoProceso: valor } })
		: { modifiedCount: 0 };
	const r2 = await db.collection('folders').updateMany(
		{ causaId, judFolder: { $type: 'object' }, ...distinto('judFolder.tipoProceso') },
		{ $set: { 'judFolder.tipoProceso': valor } }
	);
	return { causa: r1.modifiedCount || 0, carpetas: r2.modifiedCount || 0 };
}

module.exports = {
	FUEROS_TIPO_PROCESO,
	COLECCION_CAUSAS,
	FUENTES_TEXTO,
	detectarEnTexto,
	detectarEnObjeto,
	tipoPorNorma,
	sugerirPorObjeto,
	resolverTipo,
	registrarEvidencia,
	quitarOperador,
	quitarUsuario,
	reencolarCausa,
	propagarTipo,
};
