'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { CausasCivil, CausasComercial, CausasSegSoc, CausasTrabajo } = require('..');

test('las cuatro causas PJN tienen prioridad.score e índice por score', () => {
    for (const M of [CausasCivil, CausasComercial, CausasSegSoc, CausasTrabajo]) {
        assert.ok(M.schema.path('prioridad.score'), `${M.modelName}: prioridad.score`);
        assert.equal(M.schema.path('prioridad.manual').options.default, null);
        assert.ok(M.schema.indexes().some(([k]) => k['prioridad.score'] === -1 && k.lastUpdate === 1), `${M.modelName}: índice`);
    }
});
