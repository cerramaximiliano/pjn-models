// Generación determinística de IDs estables para movimientos PJN.
//
// Este algoritmo replica EXACTAMENTE el de pjn-rag-workers (indexCausa.worker.js)
// para garantizar que PjnMovement._id y RagDocument.sourceId sean compatibles.
// No modificar sin coordinar con pjn-rag-workers — un cambio acá invalida los
// sourceIds existentes en RagDocument.

const crypto = require("crypto");

function md5(input) {
    return crypto.createHash("md5").update(String(input)).digest("hex");
}

// Devuelve el sourceId base de un movimiento (sin el prefijo de causaId).
// 3 tiers en orden de preferencia:
//   Tier 1: URL                       -> mov-url-{hash12}
//   Tier 2: fecha + tipo + detalle    -> mov-content-{hash12}
//   Tier 3: JSON.stringify fallback   -> mov-hash-{hash12}
function generateMovSourceId(mov) {
    const url = mov.url || mov.link;
    if (url) {
        return `mov-url-${md5(url).substring(0, 12)}`;
    }

    if (mov.fecha) {
        try {
            const fechaISO = new Date(mov.fecha).toISOString().split("T")[0];
            const tipo = (mov.tipo || "").trim();
            const detalle = (mov.detalle || mov.texto || "").trim().substring(0, 200);
            return `mov-content-${md5(`${fechaISO}|${tipo}|${detalle}`).substring(0, 12)}`;
        } catch {
            // fecha inválida, cae a tier 3
        }
    }

    return `mov-hash-${md5(JSON.stringify(mov)).substring(0, 12)}`;
}

// Devuelve el _id completo de un PjnMovement: "{causaId}:{sourceId}".
// El causaId garantiza unicidad global; el sourceId solo necesita ser único
// dentro de la causa (espacio chico, ~50-500 elementos).
function generatePjnMovementId(causaId, mov) {
    return `${String(causaId)}:${generateMovSourceId(mov)}`;
}

// Resuelve colisiones intra-causa sufijando con -2, -3, etc.
// Espejo de la lógica de indexCausa.worker.js (línea 164-169).
//
// usedSourceIds: Set<string> con los sourceIds ya asignados en esta causa.
// Devuelve un sourceId único, registrándolo en el Set.
function resolveCollision(sourceId, usedSourceIds) {
    if (!usedSourceIds.has(sourceId)) {
        usedSourceIds.add(sourceId);
        return sourceId;
    }
    let c = 2;
    while (usedSourceIds.has(`${sourceId}-${c}`)) c++;
    const finalId = `${sourceId}-${c}`;
    usedSourceIds.add(finalId);
    return finalId;
}

module.exports = {
    md5,
    generateMovSourceId,
    generatePjnMovementId,
    resolveCollision,
};
