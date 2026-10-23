'use strict';
// node --test test/
const test = require('node:test');
const assert = require('node:assert/strict');
const { clasificarMovimiento, etapaDuenaEscrito, claseEscrito, CATEGORIAS } = require('../src/utils/clasificar-movimiento');

const URL = 'https://scw.pjn.gov.ar/scw/viewer.seam?id=abc';

test('sin URL es sin_cuerpo', () => {
    assert.equal(clasificarMovimiento({ tipo: 'DESPACHO', detalle: 'x' }), 'sin_cuerpo');
    assert.equal(clasificarMovimiento({}), 'sin_cuerpo');
    assert.equal(clasificarMovimiento(null), 'sin_cuerpo');
});

test('documentos del organismo son resolucion (criterio esDocumentoOrganismo)', () => {
    assert.equal(clasificarMovimiento({ tipo: 'SENTENCIA DEFINITIVA', url: URL }), 'resolucion');
    assert.equal(clasificarMovimiento({ tipo: 'DESPACHO', link: URL }), 'resolucion');
    assert.equal(clasificarMovimiento({ tipo: 'OFICIO', url: URL }), 'resolucion');
});

test('cédulas y DEO por tipo o por url', () => {
    assert.equal(clasificarMovimiento({ tipo: 'CEDULA ELECTRONICA TRIBUNAL', url: URL }), 'cedula');
    assert.equal(clasificarMovimiento({ tipo: 'CEDULA ELECTRONICA PARTE', url: URL }), 'cedula');
    assert.equal(clasificarMovimiento({ tipo: 'CEDULA', url: URL }), 'cedula');
    assert.equal(clasificarMovimiento({ tipo: 'NOTIFICACION', url: `${URL}&tipoDoc=cedula` }), 'cedula');
    assert.equal(clasificarMovimiento({ tipo: 'DEO', url: URL }), 'deo');
    assert.equal(clasificarMovimiento({ tipo: 'OFICIO', url: `${URL}&tipoDoc=deo&x=1` }), 'deo');
});

test('escritos de parte: escrito vs diligenciada (etapa dueña)', () => {
    assert.equal(clasificarMovimiento({ tipo: 'ESCRITO AGREGADO', detalle: 'CONTESTA DEMANDA', url: URL }), 'escrito');
    assert.equal(clasificarMovimiento({ tipo: 'ESCRITO INCORPORADO', detalle: 'SOLICITA SE LIBRE CEDULA', url: URL }), 'escrito');
    assert.equal(clasificarMovimiento({ tipo: 'ESCRITO AGREGADO', detalle: 'ACOMPAÑA OFICIO DILIGENCIADO', url: URL }), 'escrito');
    assert.equal(clasificarMovimiento({ tipo: 'ESCRITO AGREGADO', detalle: 'CEDULAS DIGITALIZADAS', url: URL }), 'diligenciada');
    assert.equal(clasificarMovimiento({ tipo: 'ESCRITO INCORPORADO', detalle: 'CEDULA [Presentado el 02/03/2026]', url: URL }), 'diligenciada');
    assert.equal(clasificarMovimiento({ tipo: 'ESCRITO AGREGADO', detalle: 'MANDAMIENTO DILIGENCIADO', url: URL }), 'diligenciada');
    assert.equal(clasificarMovimiento({ tipo: 'ESCRITO AGREGADO', detalle: 'CEDULA LEY 22.172', url: URL }), 'diligenciada');
    // Cédula en papel devuelta por la Oficina de Notificaciones: resultado de diligencia, no cédula electrónica.
    assert.equal(clasificarMovimiento({ tipo: 'RETORNO CEDULA', detalle: 'DESTINATARIO: X - FECHA DE NOTIFICACION: 01/02/2016', url: URL }), 'diligenciada');
});

test('etapaDuenaEscrito y claseEscrito coinciden con pjn-rag', () => {
    assert.equal(etapaDuenaEscrito({ detalle: 'CONTESTA DEMANDA' }), 'escritos');
    assert.equal(etapaDuenaEscrito({ detalle: 'SOLICITA SE LIBRE CEDULA' }), 'escritos');
    assert.equal(etapaDuenaEscrito({ detalle: 'ACOMPAÑA CEDULA DILIGENCIADA' }), 'resultados');
    assert.equal(claseEscrito('SOLICITA SE LIBRE CEDULA'), 'pedido');
    assert.equal(claseEscrito('CEDULA'), 'proyecto');
    assert.equal(claseEscrito('OFICIO DILIGENCIADO'), null);
    assert.equal(claseEscrito('DEVUELVE CEDULA'), 'resultado');
});

test('CATEGORIAS', () => {
    assert.deepEqual(CATEGORIAS, ['resolucion', 'cedula', 'escrito', 'diligenciada', 'deo', 'sin_cuerpo']);
});
