'use strict';
/**
 * Clasificación de un movimiento PJN por tipo de documento. Fuente única para
 * los flags de cobertura de texto (admin) y, después, para las prioridades.
 *
 * Reúne criterios que hasta ahora vivían repartidos:
 *   - pjn-workers `pjn-movement-service.esDocumentoOrganismo` (resolución = con
 *     URL, ni escrito de parte ni notificación);
 *   - pjn-rag-workers `etapas.js` (tipos de cada etapa) y
 *     `seleccion.etapaDuenaEscrito` + pjn-rag-shared `clasificarEscrito`
 *     (escrito de parte vs. cédula/mandamiento diligenciado).
 * Si se cambia algo acá hay que mirar esos tres lugares (y la copia del hub,
 * law-analytics-server/utils/clasificarMovimiento.js, mientras el hub tenga
 * pjn-models clavado en 1.13.x).
 *
 * Categorías:
 *   resolucion   documento del organismo (proveído, sentencia, oficio del juzgado…): texto al bajar el PDF (pjn-workers)
 *   cedula       cédula electrónica (tribunal/parte): RAG etapa `cedulas`
 *   escrito      escrito de parte: RAG etapa `escritos`
 *   diligenciada resultado de notificación en papel (cédula/mandamiento devuelto, digitalizado, RETORNO CEDULA): RAG etapa `resultados`
 *   deo          oficio electrónico: RAG etapa `deo`
 *   sin_cuerpo   movimiento sin URL: no hay documento
 */

const CATEGORIAS = ['resolucion', 'cedula', 'escrito', 'diligenciada', 'deo', 'sin_cuerpo'];

const RE_ESCRITO_PARTE = /^ESCRITO/i;
const RE_TIPO_CEDULA = /^CEDULA/i;
// Cédula en papel que vuelve diligenciada por la Oficina de Notificaciones (detalle «DESTINATARIO: … - FECHA DE
// NOTIFICACION: …»): aporta el resultado de la diligencia, como las digitalizadas de la etapa `resultados` (RAG, 2026-10-23).
const RE_TIPO_RETORNO = /^RETORNO CEDULA/i;
const RE_TIPO_DEO = /^DEO$/i;
const RE_URL_CEDULA = /tipoDoc=cedula\b/i;
const RE_URL_DEO = /tipoDoc=deo\b/i;

// Prefiltro de la etapa `resultados` (pjn-rag-workers etapas.js) y clasificador
// fino (pjn-rag-shared resultadoNotificacion.clasificarEscrito), copiados tal cual.
const RE_DETALLE_RESULTADOS = /C[EÉ]DULA|MANDAMIENTO|DILIGENCIAMIENTO/i;
const RE_RESULTADO = new RegExp([
    'C[EÉ]DULAS?\\s+(?:DE\\s+NOTIFICACI[OÓ]N\\s+)?(?:DIGITALIZADAS?|DEVUELTAS?|DILIGENCIADAS?|SIN\\s+NOTIFICAR|POSITIVAS?|NEGATIVAS?|NOTIFICADAS?)',
    'DIGITALIZACI[OÓ]N\\s+(?:DE\\s+(?:LA\\s+)?)?C[EÉ]DULA',
    'DEVOLUCI[OÓ]N\\s+(?:DE\\s+(?:LA\\s+)?)?C[EÉ]DULA',
    'RESULTADO\\s+(?:DE\\s+(?:LA\\s+)?)?C[EÉ]DULA',
    'DEVUELVE\\s+(?:LA\\s+)?C[EÉ]DULA',
    'DIGITALIZACI[OÓ]N\\s+RES\\.?\\s+C[EÉ]DULA',
    '(?:ACOMPA[ÑN]A|ADJUNT[AO]|AGREGA)\\s+(?:NUEVAS?\\s+)?C[EÉ]DULAS?',
    '(?:ACOMPA[ÑN]A|ADJUNT[AO])\\s+MANDAMIENTO',
    'RETORNO\\s+DE\\s+(?:LA\\s+)?C[EÉ]DULA',
    'ACREDITA\\s+(?:EL\\s+)?(?:DILIGENCIAMIENTO|C[EÉ]DULA|NOTIFICACI[OÓ]N)',
    '(?:ACOMPA[ÑN]A|ADJUNTA|AGREGA|ACOMPA[ÑN]O)\\s+(?:LA\\s+)?C[EÉ]DULA',
    'SE\\s+DIGITALIZA\\s+(?:LA\\s+)?C[EÉ]DULA',
    'DIGIT\\.?\\s*PIEZAS\\s*:?\\s*C[EÉ]DULA',
    'MANDAMIENTO\\s+(?:DIGITALIZADO|DEVUELTO|DILIGENCIADO)',
    'DIGITALIZACI[OÓ]N\\s+DE\\s+MANDAMIENTO',
].join('|'), 'i');
const RE_PEDIDO = /SOLICITA\s+(?:SE\s+LIBRE|NUEVA|C[EÉ]DULA\s+BAJO)|SE\s+LIBRE|CONFRONTE|LISTADO\s+DE\s+C[EÉ]DULAS|BAJO\s+RESPONSABILIDAD/i;
const RE_PROYECTO = /^\s*(?:C[EÉ]DULAS?|MANDAMIENTO)\b/i;
const RE_LEY22172 = /LEY\s*(?:N[°º]?\s*)?22\.?172|LEY\s+BOSI/i;
const RE_OFICIO = /\bOFICIOS?\b|\bEXHORTOS?\b|TESTIMONIO/i;

/**
 * Clase de un escrito por su `detalle`: 'resultado' (escaneo de lo diligenciado),
 * 'proyecto' (la cédula/mandamiento que presenta la parte), 'pedido' (pide que se
 * libre/confronte: no es una cédula) o null (cualquier otro escrito).
 * Igual a pjn-rag-shared `clasificarEscrito(detalle).clase`.
 */
function claseEscrito(detalle) {
    const d = String(detalle || '').replace(/\[Presentado[^\]]*\]/i, '').trim();
    if (RE_OFICIO.test(d) && !/C[EÉ]DULA|MANDAMIENTO/i.test(d)) return null;
    if (RE_RESULTADO.test(d)) return 'resultado';
    if (RE_PEDIDO.test(d)) return 'pedido';
    if (RE_PROYECTO.test(d) || RE_LEY22172.test(d)) return 'proyecto';
    return null;
}

/**
 * Etapa RAG dueña de un escrito de parte: 'resultados' o 'escritos'. Igual a
 * pjn-rag-workers `seleccion.etapaDuenaEscrito`: es de 'resultados' el que pasa
 * el prefiltro de detalle y cuya clase no es 'pedido' ni null.
 */
function etapaDuenaEscrito(mov) {
    const detalle = (mov && mov.detalle) || '';
    if (!RE_DETALLE_RESULTADOS.test(detalle)) return 'escritos';
    const clase = claseEscrito(detalle);
    return clase && clase !== 'pedido' ? 'resultados' : 'escritos';
}

/**
 * @param {{tipo?:string, detalle?:string, url?:string, link?:string}} mov
 *   subdoc `movimiento[]` de la causa o doc de `pjn-movements` (mismos campos).
 * @returns {'resolucion'|'cedula'|'escrito'|'diligenciada'|'deo'|'sin_cuerpo'}
 */
function clasificarMovimiento(mov) {
    const url = (mov && (mov.url || mov.link)) || '';
    if (!url) return 'sin_cuerpo';
    const tipo = String((mov && mov.tipo) || '').trim();
    if (RE_TIPO_DEO.test(tipo) || RE_URL_DEO.test(url)) return 'deo';
    if (RE_TIPO_RETORNO.test(tipo)) return 'diligenciada';
    if (RE_TIPO_CEDULA.test(tipo) || RE_URL_CEDULA.test(url)) return 'cedula';
    if (RE_ESCRITO_PARTE.test(tipo)) return etapaDuenaEscrito(mov) === 'resultados' ? 'diligenciada' : 'escrito';
    return 'resolucion';
}

module.exports = { CATEGORIAS, clasificarMovimiento, etapaDuenaEscrito, claseEscrito };
