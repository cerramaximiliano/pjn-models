const mongoose = require("mongoose");

/**
 * Campo embebido `etapaProcesal` que se inyecta en todos los causa-models vía
 * schema.add(require('../shared/etapa-procesal-fields')).
 *
 * Lo escribe el backfill/worker de etapa procesal ejecutando
 * `etapaProcesal.deriveEtapaProcesal(causa.movimiento, fuero, objeto)`
 * (src/utils/etapa-procesal.js) y persistiendo el resultado + computedAt.
 *
 * IMPORTANTE: todo el bloque responde "al asOf" (fecha del último movimiento
 * conocido), NO a hoy — los workers de discovery no actualizan causas, así que
 * la etapa vigente real puede ser posterior. `version` guarda la versión de
 * las reglas de clasificación con la que se computó (VERSION exportada por la
 * lib) para poder recomputar selectivamente cuando el mapeo evolucione.
 */

const TimelineSegmentSchema = new mongoose.Schema(
    {
        // Etapa canónica (key de ETAPAS en utils/etapa-procesal.js).
        etapa: { type: String },
        // Rank progresivo (10=demanda ... 100=archivo).
        rank: { type: Number },
        desde: { type: Date },
        // null = segmento vigente al asOf.
        hasta: { type: Date, default: null },
        // Duración en días (los segmentos abiertos se miden contra asOf).
        dias: { type: Number, default: null },
        // true si el segmento abrió con rank menor al anterior (reenvío,
        // desarchivo, nueva demanda tras incompetencia). Nunca se descartan.
        retroceso: { type: Boolean },
        // true si la reapertura vino de una REVOCACIÓN (la Cámara rechazó la
        // interlocutoria de inhabilidad/incompetencia y la demanda continúa).
        // Continuación legítima — no cuenta como reapertura en conformidad.
        revocacion: { type: Boolean },
    },
    { _id: false }
);

const SuspensionSchema = new mongoose.Schema(
    {
        desde: { type: Date },
        hasta: { type: Date, default: null }, // null = sigue paralizada
    },
    { _id: false }
);

module.exports = {
    etapaProcesal: {
        // Familia procesal detectada por (fuero, objeto):
        // ordinario | sucesorio | concursal | ejecutivo
        familia: { type: String, default: null },

        // Última etapa del timeline (denormalizado para queries/UI).
        etapaActual: { type: String, default: null, index: true },
        rankActual: { type: Number, default: null },
        // primera_instancia | sentencia | revision | ejecucion | terminada
        fase: { type: String, default: null },

        // true si el último evento clasificado pone fin al litigio/archiva.
        terminal: { type: Boolean, default: null },
        // Cómo terminó (solo si terminal=true): etapa terminal + subtipo
        // normalizado del hito (conciliación/caducidad/desistimiento/...).
        // Un ARCHIVESE posterior al fin del litigio no pisa el subtipo.
        resultado: {
            type: new mongoose.Schema({ etapa: String, detalle: String }, { _id: false }),
            default: null,
        },
        // true si el último estado de suspensión sigue abierto (PARALIZADO /
        // ARCHIVO PROVISORIO sin SACADO/DESARCHIVO posterior).
        paralizado: { type: Boolean, default: null },

        // Timeline completo de etapas con desde/hasta/días.
        timeline: { type: [TimelineSegmentSchema], default: undefined },
        // Hitos del proceso (v8): sentencias interlocutorias — no cierran
        // instancia ni mueven la etapa; flujo propio (apelables a Cámara/Corte).
        hitos: {
            type: [new mongoose.Schema({ tipo: String, fecha: Date, detalle: String, fuente: String }, { _id: false })],
            default: undefined,
        },
        suspensiones: { type: [SuspensionSchema], default: undefined },

        // Eventos de etapa con rank menor al vigente, descartados por la cura
        // de retrocesos (v3): incidentes post-etapa, no vueltas de etapa.
        retrocesosDescartados: { type: Number, default: null },

        // Fecha del último movimiento conocido — el "hasta cuándo sabemos".
        asOf: { type: Date, default: null },

        // Métricas de clasificación (auditoría del mapeo).
        eventosEstado: { type: Number, default: null },
        eventosClasificados: { type: Number, default: null },
        confianza: { type: Number, default: null },
        sinClasificar: {
            type: [new mongoose.Schema({ detalle: String, n: Number }, { _id: false })],
            default: undefined,
        },

        // Metadatos del cómputo.
        computedAt: { type: Date, default: null },
        version: { type: Number, default: null },
    },
};
