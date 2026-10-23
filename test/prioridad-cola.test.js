'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { umbralesPorNivel, filtroLastUpdateVencido, ORDEN_COLA, NIVELES } = require('../src/utils/prioridad-cola');

const now = new Date('2026-10-23T12:00:00Z');
const hace = (h) => new Date(now.getTime() - h * 3600 * 1000);

test('umbrales por defecto: alta 6, archivo 72, media/baja = general', () => {
    assert.deepEqual(umbralesPorNivel({ last_update_threshold_hours: 12 }), { general: 12, alta: 6, media: 12, baja: 12, archivo: 72 });
    assert.deepEqual(umbralesPorNivel({}), { general: 12, alta: 6, media: 12, baja: 12, archivo: 72 });
    assert.deepEqual(umbralesPorNivel(null).general, 12);
});

test('umbrales configurados por nivel; null o inválido cae al general', () => {
    const u = umbralesPorNivel({ last_update_threshold_hours: 8, threshold_hours_por_nivel: { alta: 2, media: null, baja: 'x', archivo: 0 } });
    assert.deepEqual(u, { general: 8, alta: 2, media: 8, baja: 8, archivo: 8 });
});

test('filtro: una rama por nivel + sin prioridad + sin lastUpdate', () => {
    const f = filtroLastUpdateVencido({ last_update_threshold_hours: 12 }, now);
    assert.equal(f.$or.length, NIVELES.length + 2);
    assert.deepEqual(f.$or[0], { lastUpdate: { $exists: false } });
    assert.deepEqual(f.$or[1], { 'prioridad.nivel': 'alta', lastUpdate: { $lt: hace(6) } });
    assert.deepEqual(f.$or[4], { 'prioridad.nivel': 'archivo', lastUpdate: { $lt: hace(72) } });
    assert.deepEqual(f.$or[5], { 'prioridad.nivel': { $nin: NIVELES }, lastUpdate: { $lt: hace(12) } });
});

test('orden de cola: score desc, después la más atrasada', () => {
    assert.deepEqual(ORDEN_COLA, { 'prioridad.score': -1, lastUpdate: 1, createdAt: 1 });
});
