'use strict';

/**
 * update-flag-audit
 *
 * El flag `update` de una causa decide si entra al circuito de actualización
 * (update-movimientos-worker). Lo escriben media docena de lugares repartidos
 * en cuatro repos — el hub al vincular una carpeta, verify-worker al confirmar
 * una causa, el updater al terminar de procesarla, saij-workers al crear una
 * shell — y hasta ahora ninguno dejaba rastro de por qué. Cuando una causa
 * aparecía con `update: true` sin explicación no había forma de reconstruir
 * quién la había encendido.
 *
 * Este helper centraliza el cambio: escribe el flag y empuja en el mismo
 * updateOne una entrada de `updateHistory` con el valor anterior, el nuevo, el
 * motivo y el actor.
 *
 * Uso típico desde un worker:
 *
 *   await setUpdateFlag(CausasCivil, causa._id, {
 *     next: false,
 *     reason: 'procesada sin movimientos nuevos',
 *     actor: 'update-movimientos-worker[CIV]',
 *     source: 'update_movimientos_worker',
 *     previous: causa.update,
 *     extraSet: { lastUpdate: new Date() },
 *   });
 */

/**
 * Construye la entrada de `updateHistory` que documenta una transición del
 * flag `update`. Se exporta aparte porque hay call sites que ya están armando
 * un `$set` grande (o creando el documento) y sólo necesitan la entrada.
 *
 * @param {object}  opts
 * @param {boolean} [opts.previous]  - valor anterior del flag (undefined si se desconoce)
 * @param {boolean} opts.next        - valor nuevo
 * @param {string}  opts.reason      - por qué cambió, en castellano y legible
 * @param {string}  opts.actor       - worker/servicio, o "<email> (admin)" si fue una persona
 * @param {string}  opts.source      - valor del enum `source` de updateHistory
 * @param {string}  [opts.saijDocId] - id del fallo SAIJ, si el cambio viene de un apareo
 * @param {number}  [opts.movimientosTotal]
 * @returns {object} entrada lista para `$push: { updateHistory: entry }`
 */
function buildUpdateFlagEntry({
	previous,
	next,
	reason,
	actor,
	source = 'api',
	saijDocId,
	movimientosTotal = 0,
}) {
	if (typeof next !== 'boolean') throw new Error('buildUpdateFlagEntry: `next` debe ser boolean');
	if (!reason) throw new Error('buildUpdateFlagEntry: `reason` es obligatorio');
	if (!actor) throw new Error('buildUpdateFlagEntry: `actor` es obligatorio');

	return {
		timestamp: new Date(),
		source,
		updateType: 'update_flag',
		success: true,
		movimientosAdded: 0,
		movimientosTotal,
		details: {
			previousUpdate: typeof previous === 'boolean' ? previous : undefined,
			newUpdate: next,
			reason,
			actor,
			...(saijDocId ? { saijDocId: String(saijDocId) } : {}),
			message: `update: ${previous === undefined ? '?' : previous} → ${next} — ${reason}`,
		},
	};
}

/**
 * Escribe el flag `update` y su entrada de auditoría en una sola operación.
 *
 * Si `previous` no se pasa, se lee el valor actual antes de escribir para que
 * la entrada quede completa. Cuando el llamador ya tiene el documento en mano
 * conviene pasarlo y ahorrarse el round-trip.
 *
 * No hace nada si el flag ya está en el valor pedido y `force` es falso: evita
 * llenar el historial de transiciones que no ocurrieron.
 *
 * @param {import('mongoose').Model} Model
 * @param {any}     causaId
 * @param {object}  opts - los de buildUpdateFlagEntry, más:
 * @param {object}  [opts.extraSet] - campos adicionales para el mismo $set
 * @param {boolean} [opts.force]    - registrar aunque el valor no cambie
 * @returns {Promise<boolean>} true si escribió, false si no había nada que cambiar
 */
async function setUpdateFlag(Model, causaId, opts) {
	const { next, extraSet = {}, force = false } = opts;
	let { previous } = opts;

	if (previous === undefined) {
		const current = await Model.findById(causaId, { update: 1 }).lean();
		if (!current) return false;
		previous = current.update;
	}

	if (previous === next && !force) return false;

	const entry = buildUpdateFlagEntry({ ...opts, previous });

	await Model.updateOne(
		{ _id: causaId },
		{ $set: { update: next, ...extraSet }, $push: { updateHistory: entry } }
	);
	return true;
}

module.exports = { buildUpdateFlagEntry, setUpdateFlag };
