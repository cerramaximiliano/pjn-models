'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { PjnPrueba } = require('..');

test('pjn-pruebas: cadenas de prueba por causa con el contrato acordado con el MCP (26/10/2026)', () => {
    assert.equal(PjnPrueba.collection.name, 'pjn-pruebas');
    assert.deepEqual(PjnPrueba.ESTADOS, ['pendiente', 'reiterada', 'respondida', 'impugnada', 'concluida', 'no_aplica']);
    assert.ok(PjnPrueba.CLASES.includes('informativa') && PjnPrueba.CLASES.includes('pericial'));
    const idx = PjnPrueba.schema.indexes();
    assert.ok(idx.some(([k, o]) => o.unique && k.causaId === 1 && k.clase === 1 && k.clave === 1 && k.inicioMovementId === 1), 'clave única');
    assert.ok(idx.some(([k]) => k.causaId === 1 && k.estado === 1), 'índice causa+estado');
    assert.ok(idx.some(([k]) => k.causaId === 1 && k.clase === 1), 'índice causa+clase');
    const doc = new PjnPrueba({
        _id: 'abc123', causaId: '6a2045a2fee8b7895c9caadd', clase: 'informativa', clave: 'BANCO NACION', inicioMovementId: '6a2045a2fee8b7895c9caadd:m1',
        titulo: 'Oficio a BANCO NACION (informativa)', estado: 'reiterada', version: 'pruebas-1',
        eventos: [{ movementId: '6a2045a2fee8b7895c9caadd:m1', rol: 'envio_deo', fecha: new Date('2026-01-10'), tipoMovimiento: 'DEO', detalle: 'ENVIO DEO: 1 - BANCO NACION' }, { movementId: '6a2045a2fee8b7895c9caadd:m2', rol: 'reiteratorio', fecha: new Date('2026-03-10'), tipoMovimiento: 'DEO', detalle: 'ENVIO DEO: 2 - BANCO NACION' }],
        fechaInicio: new Date('2026-01-10'), fechaUltimoEvento: new Date('2026-03-10'), ultimoEvento: 'reiteratorio', diasSinRespuesta: 40,
    });
    assert.equal(doc.validateSync(), undefined);
    const malo = new PjnPrueba({ _id: 'x', causaId: '6a2045a2fee8b7895c9caadd', clase: 'otra', clave: 'k', inicioMovementId: 'y', titulo: 't', estado: 'raro' });
    const err = malo.validateSync();
    assert.ok(err.errors.clase && err.errors.estado, 'clase y estado son enum cerrados');
});
