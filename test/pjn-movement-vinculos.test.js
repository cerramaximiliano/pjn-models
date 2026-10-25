'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { PjnMovement } = require('..');

test('pjn-movements tiene vinculos[] (Mixed, sin default) y conserva el contrato acordado con el MCP', () => {
    const p = PjnMovement.schema.path('vinculos');
    assert.ok(p, 'vinculos existe en el esquema');
    assert.equal(p.instance, 'Array');
    assert.equal(p.options.default, undefined, 'sin default: solo lo escribe el vinculador');
    const doc = new PjnMovement({
        _id: '6a2045a2fee8b7895c9caadd:mov-1',
        vinculos: [{
            tipo: 'proveido_por', movementId: '6a2045a2fee8b7895c9caadd:mov-2', metodo: 'texto', confianza: 0.95,
            version: 'vinculos-1', fecha: new Date('2026-10-11'), tipoMovimiento: 'FIRMA DESPACHO', detalle: 'Téngase presente',
            presentacion: '2026-10-11T14:32', parte: { n: 1, de: 3 },
        }],
    });
    const v = doc.toObject().vinculos[0];
    assert.equal(v.tipo, 'proveido_por');
    assert.equal(v.presentacion, '2026-10-11T14:32', 'Mixed: se guarda tal cual');
    assert.deepEqual(v.parte, { n: 1, de: 3 });
    assert.equal(new PjnMovement({ _id: 'x:y' }).toObject().vinculos, undefined, 'un movimiento sin vínculos no lleva el campo');
});
