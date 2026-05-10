/**
 * Tracking de visitas del sentencias-collector-worker sobre cada causa.
 *
 * El collector usa un cursor por _id por fuero (no marca causas individualmente),
 * por lo que sin estos campos no hay forma de saber cuándo fue escaneada una
 * causa puntual ni cuántas sentencias se le encontraron.
 *
 * Estos campos los escribe el sentencias-collector al terminar de procesar
 * cada causa de un batch. Permiten:
 *   - Trazabilidad/debugging por causa.
 *   - Re-elegibilidad selectiva (ej. forzar re-scan de una sola causa).
 *   - Decisiones de freshness (priorizar causas que hace mucho no se miran).
 *
 * Se aplican vía schema.add(require('../shared/sentencias-scan-fields'))
 * en cada causas-*.js para mantener una sola fuente de verdad.
 */
module.exports = {
    sentenciasScan: {
        // Timestamp del último scan del collector sobre esta causa.
        // null = nunca escaneada (o pre-backfill).
        lastAt: {
            type: Date,
            default: null,
            index: true
        },
        // Cantidad de sentencias capturables detectadas en el último scan.
        // Refleja el estado del movimiento[] al momento del scan.
        foundOnLast: {
            type: Number,
            default: 0
        },
        // Total acumulado de sentencias INSERTADAS para esta causa a lo largo
        // del tiempo (solo se incrementa con upserts nuevos, no con re-scans
        // que vuelven a ver las mismas sentencias).
        totalFound: {
            type: Number,
            default: 0
        }
    }
};
