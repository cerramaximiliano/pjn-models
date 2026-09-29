// node scripts/test-acumulacion.js — sin DB. Casos reales relevados en Atlas (29-09-2026).
const assert = require("assert");
const { detectarAcumulacion, clasificarMovimiento } = require("../src/utils/acumulacion");
const si = [
  ["EVENTO", "ACUMULA LA CAUSA A OTRA", "evento"],
  ["CAMBIO DE ESTADO DE EXPEDIENTE", "ACUMULACION DE ACCIONES - ACUMULACION  TIPO:N", "cambio_estado"],
  ["MOVIMIENTO", "ACUMULACION DE ACCIONES", "cambio_estado"],
  ["CAMBIO DE ESTADO DE EXPEDIENTE", "INTEGRACION DE LITIS - ACUMULADOR DEL EXPEDIENTE", "cambio_estado"],
  ["FIRMA DESPACHO", "SE AGREGA AL PRINCIPAL", "despacho"],
  ["FIRMA DESPACHO", "ORDENA ACUMULAR RECURSO DE QUEJA A LA CAUSA PRINCIPAL", "despacho"],
  ["FIRMA DESPACHO", "ORDENA EFECTIVIZAR ACUMULACION DIGITAL", "despacho"],
  ["FIRMA DESPACHO", "POR DEVUELTOS - RESUELVE ACUMULACIÓN", "despacho"],
  ["FIRMA DESPACHO", "SE RESUELVE ACUMULACION.", "despacho"],
  ["FIRMA DESPACHO", "POR CONTESTADOS LOS AGRAVIOS. ACUMULA AL EXPT PRINCIPAL", "despacho"],
];
const no = [
  ["ESCRITO AGREGADO", "SOLICITA ACUMULACION [Presentado 15/05/2024"],
  ["FIRMA DESPACHO", "POR DEVUELTOS. RECHAZA ACUMULACION"],
  ["ESCRITO AGREGADO", "SE RESUELVA PEDIDO DE DESACUMULACION"],
  ["INFORMACION", "CONEXIDAD INFORMATIVA: CONEX.INFORMADA C/EXP."],
  ["INFORMACION", "CONEXIDAD DETECTADA: CONEX.DETECTADA C/EXP.N°"],
  ["MOVIMIENTO", "READJUDICACION POR NO EXISTIR CONEXIDAD"],
  ["FIRMA DESPACHO", "CONTESTA ACUMULACION"],
  ["ESCRITO INCORPORADO", "MANIFIESTA SOBRE ACUMULACION"],
  ["FIRMA DESPACHO", "SE REMITE POR PLANTEO DE ACUMULACION"],
  ["MOVIMIENTO", "EN LETRA"],
  ["EVENTO", "ACUMULACION"], // evento sin la frase del sistema
];
for (const [tipo, detalle, clase] of si) assert.deepStrictEqual(clasificarMovimiento({ tipo, detalle }), { clase }, `${tipo} | ${detalle}`);
for (const [tipo, detalle] of no) assert.strictEqual(clasificarMovimiento({ tipo, detalle }), null, `${tipo} | ${detalle}`);
const r = detectarAcumulacion([
  { fecha: "2026-07-07T00:00:00Z", tipo: "DESPACHO INCORPORADO", detalle: "POR RECIBIDO. PROCÉDASE AL CIERRE DEL INCIDENTE" },
  { fecha: "2026-06-24T00:00:00Z", tipo: "EVENTO", detalle: "ACUMULA LA CAUSA A OTRA", url: "u1" },
  { fecha: "2026-06-24T00:00:00Z", tipo: "FIRMA DESPACHO", detalle: "SE AGREGA AL PRINCIPAL", url: "u2" },
  { fecha: "2026-06-01T00:00:00Z", tipo: "ESCRITO AGREGADO", detalle: "SOLICITA ACUMULACION" },
]);
assert.strictEqual(r.length, 2);
assert.strictEqual(r[0].clase, "evento"); assert.strictEqual(r[0].url, "u1");
assert.strictEqual(r[0].fecha.toISOString(), "2026-06-24T00:00:00.000Z");
assert.deepStrictEqual(detectarAcumulacion([]), []); assert.deepStrictEqual(detectarAcumulacion(null), []);
console.log(`test-acumulacion: OK (${si.length} efectivas, ${no.length} descartes)`);
