'use strict';
/**
 * Orden y vencimiento de las colas de causas PJN según `prioridad` (shared/prioridad-fields.js,
 * la escribe el hub). Lo usan pjn-workers (app-update, pdf-backfill) y puede usarlo pjn-api
 * para contar elegibles con el mismo criterio.
 *
 * - `umbralesPorNivel(config)`: horas de `lastUpdate` que vencen una causa según su nivel. Default:
 *   alta 6 h, archivo 72 h, media/baja = `last_update_threshold_hours` (general, 12). Se ajusta con
 *   `threshold_hours_por_nivel` en configuracion-app-update (null = general).
 * - `filtroLastUpdateVencido(config, now)`: `$or` para el filtro Mongo (causa sin `prioridad` → general).
 * - `ORDEN_COLA`: `prioridad.score` desc (las causas sin prioridad quedan al final), después la más
 *   atrasada. Hace juego con el índice {prioridad.score:-1, lastUpdate:1} de las causas.
 */
const NIVELES = ['alta', 'media', 'baja', 'archivo'];
const UMBRAL_DEFAULT = { alta: 6, media: null, baja: null, archivo: 72 };
const GENERAL_DEFAULT = 12;

function umbralesPorNivel(configuration) {
    const cfgGeneral = Number(configuration && configuration.last_update_threshold_hours);
    const general = Number.isFinite(cfgGeneral) && cfgGeneral > 0 ? cfgGeneral : GENERAL_DEFAULT;
    const cfg = (configuration && configuration.threshold_hours_por_nivel) || {};
    const out = { general };
    for (const n of NIVELES) {
        const crudo = cfg[n] != null ? Number(cfg[n]) : UMBRAL_DEFAULT[n];
        out[n] = Number.isFinite(crudo) && crudo > 0 ? crudo : general;
    }
    return out;
}

function filtroLastUpdateVencido(configuration, now = new Date()) {
    const u = umbralesPorNivel(configuration);
    const hace = (h) => new Date(now.getTime() - h * 3600 * 1000);
    return {
        $or: [
            { lastUpdate: { $exists: false } },
            ...NIVELES.map((n) => ({ 'prioridad.nivel': n, lastUpdate: { $lt: hace(u[n]) } })),
            // Sin prioridad (sin carpetas, o todavía no calculada): umbral general. $nin matchea el campo ausente.
            { 'prioridad.nivel': { $nin: NIVELES }, lastUpdate: { $lt: hace(u.general) } },
        ],
    };
}

const ORDEN_COLA = Object.freeze({ 'prioridad.score': -1, lastUpdate: 1, createdAt: 1 });

module.exports = { NIVELES, UMBRAL_DEFAULT, GENERAL_DEFAULT, umbralesPorNivel, filtroLastUpdateVencido, ORDEN_COLA };
