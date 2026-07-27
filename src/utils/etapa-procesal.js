/**
 * etapa-procesal.js — Derivación de la etapa procesal y su timeline desde los
 * movimientos de una causa PJN.
 *
 * Fundamento (auditoría 2026-07-25 sobre la DB local de worker_01): el ~99% de
 * las causas con movimientos de los 4 fueros grandes (CNT/CSS/CIV/COM) tiene
 * movimientos tipo "CAMBIO DE ESTADO DE EXPEDIENTE" cuyo `detalle` es la etapa
 * que asigna el propio Lex100 ("INICIO / DEMANDA", "TRABA DE LITIS: ...",
 * "PRUEBA...", "LLAMAMIENTO DE AUTOS A SENTENCIA", "EJECUCION DE SENTENCIA",
 * "ARCHIVESE", ...). Esta lib normaliza ese vocabulario (~32k strings crudos,
 * ~1.3k frecuentes que cubren el 99% del volumen) a una taxonomía canónica
 * progresiva y construye el timeline de etapas con desde/hasta por causa.
 *
 * API:
 *   - detectFamilia(fuero, objeto) → 'ordinario'|'sucesorio'|'concursal'|'ejecutivo'
 *   - classifyEstado(detalle, familia, fuero) → { categoria, etapa, rank } | null
 *   - deriveEtapaProcesal(movimientos, fuero, objeto) → {
 *       familia, timeline: [{ etapa, rank, desde, hasta, dias, retroceso? }],
 *       etapaActual, rankActual, fase, terminal, paralizado,
 *       asOf, eventosEstado, eventosClasificados, sinClasificar, confianza
 *     }
 *
 * Notas de diseño:
 *   - Las etapas son PROGRESIVAS (rank monotónico creciente). Retrocesos
 *     legítimos existen (reenvío de Cámara, desarchivo, nueva demanda tras
 *     incompetencia): se admiten solo entre días distintos y quedan marcados
 *     con `retroceso: true` — nunca se descartan en silencio.
 *   - Estados administrativos (EN LETRA, EN DESPACHO, EN CONFRONTE, SIN
 *     DEFINIR...) y de circulación (PASE, DEVOLUCION, ELEVACION...) NO son
 *     etapas: se ignoran para el timeline (la ubicación ya la resuelve
 *     trayectoria.js). PARALIZADO/ARCHIVO PROVISORIO suspenden sin cambiar
 *     etapa. Misma lección que el filtro ES_ESTADO de trayectoria.js.
 *   - deriveEtapaProcesal siempre responde "al fechaUltimoMovimiento" (asOf):
 *     los workers de discovery no actualizan causas, así que la etapa vigente
 *     hoy puede ser posterior.
 *
 * Mongoose-agnóstico: opera sobre arrays/objetos planos.
 */

// Versión de las reglas de clasificación. Subirla cuando cambie la taxonomía o
// el mapeo de forma que amerite recomputar el backfill (los docs guardan la
// versión con la que se computó su etapaProcesal).
// v2: agrega `resultado` (subtipo de terminación)
// v3: cura de retrocesos — un evento de etapa con rank menor al vigente se
//     descarta como actividad incidental (p.ej. "LLAMAMIENTO DE AUTOS" después
//     de la sentencia = auto para resolver un incidente, no vuelta de etapa).
//     Única excepción: reapertura desde etapa terminal (fin_litigio/archivo),
//     que sí abre segmento marcado retroceso. Los descartados se cuentan en
//     `retrocesosDescartados` para auditoría.
// v4: señal secundaria de sentencia — los movimientos tipo "PUBLICACION
//     SENTENCIA" cuentan como evento de etapa (resuelto por contexto:
//     1ra instancia → sentencia_primera, revisión → sentencia_camara). Cura el
//     gap observacional de fueros que no registran la sentencia como cambio de
//     estado (CSS: 0% de sentencia_primera pese a llegar a Cámara).
// v5: SENTENCIA FIRME deja de ser terminal y pasa a etapa propia (rank 85,
//     post-REX, pre-ejecución): la firmeza es el hito que HABILITA la
//     ejecución, no el fin de la causa — "sentencia firme → ejecución" es el
//     flujo normal previsional, no una reapertura.
// v6: señales de sentencia en movimientos comunes del tribunal (EVENTO /
//     FIRMA DESPACHO / MOVIMIENTO con detalle "SENTENCIA DEFINITIVA",
//     "SENTENCIA", "SENTENCIA DE PRIMERA INSTANCIA", "... DE CAMARA",
//     "... TRANCE Y REMATE") + señal de autos ("A SENTENCIA", "AUTOS A/PARA
//     SENTENCIA", "PASE A SENTENCIA"). Cura el gap de sentencia_primera de
//     CSS con FECHA REAL (hallazgo del caso JARA 6755/2019). Se excluyen
//     interlocutorias, sorteos y escritos de parte.
// v7: pulido de residuos — (a) la compactación diaria conserva señal contextual
//     Y evento concreto del mismo día (sentencia + pase a autos el mismo día ya
//     no pierde la sentencia); (b) en familia ejecutivo el estado "EJECUCION
//     FISCAL" es el inicio del proceso, no la etapa de ejecución; (c) las
//     señales secundarias no pueden reabrir una causa terminada (solo los
//     estados explícitos); (d) un hito terminal que llega con la causa ya
//     archivada se absorbe actualizando el subtipo de resultado.
// v8: (a) la SENTENCIA INTERLOCUTORIA es un HITO con flujo propio, no una
//     etapa: no cierra la instancia (se dicta antes de la definitiva o en
//     ejecución) y es apelable a Cámara y eventualmente Corte. Se captura en
//     `hitos[]` desde estados, publicaciones y movimientos comunes — y deja
//     de confundirse con sentencia definitiva en la señal de publicación.
//     (b) fin_litigio → ejecución es CONTINUACIÓN normal (ejecución del
//     acuerdo conciliatorio/homologado), no reapertura.
// v9: compactación diaria ORDENADA — un mismo día puede registrar una
//     progresión real (Lex100 carga "SENTENCIA DEFINITIVA" y "EJECUCION DE
//     SENTENCIA" juntas): se emiten TODOS los eventos de etapa del día en
//     orden de rank ascendente (dedupe por etapa) en vez de solo el máximo,
//     que perdía la sentencia. La cura de retrocesos sigue filtrando los
//     pares regresivos (ART 259 + INICIO TRAMITE).
// v10: patrón "inhabilidad de instancia" (caso ORTEGA c/ PROVINCIA, revisión
//     manual del usuario): (a) INHABILIDAD DE INSTANCIA / FALTA DE APTITUD
//     JURISDICCIONAL en cualquier movimiento = terminación anticipada que
//     trunca la demanda (fin_litigio con subtipo) + hito; (b) NO puede haber
//     etapa de ejecución sin sentencia o fin del litigio previos — esas
//     "ejecuciones" pertenecen al flujo del incidente y se descartan;
//     (c) la apelación/resolución de Cámara posteriores a una terminación
//     interlocutoria son flujo del incidente — no reabren el proceso
//     principal (solo lo reabre una etapa de primera instancia = revocación).
// v11: la DECLARACIÓN DE INCOMPETENCIA (E INHIBITORIA) recibe el mismo
//     tratamiento que la inhabilidad de instancia (patrón confirmado en
//     RUSCITTI c/ PREVENCION 1830/2021): demanda sin aptitud jurisdiccional,
//     apelación + confirmación de Cámara dentro del incidente, archivo. La
//     revocación (etapa de primera instancia posterior) sigue reabriendo.
// v12: REVOCACIÓN — cuando la Cámara rechaza lo determinado por la
//     interlocutoria (inhabilidad/incompetencia) la demanda pasa a la
//     siguiente etapa: la reapertura desde ese fin se marca `revocacion`
//     (continuación legítima, no anomalía), se limpia el resultado revocado y
//     la conformidad no la computa como reapertura. Confirmado en corpus:
//     ~3.5k causas fin(incompetencia) → autos/sentencia → Cámara.
const VERSION = 12;

// ---------------------------------------------------------------------------
// Taxonomía canónica
// ---------------------------------------------------------------------------

// Ranks compartidos entre familias. La semántica del eje: 10-59 primera
// instancia, 60-69 resolución de mérito, 70-89 revisión, 90-94 ejecución,
// 95-100 terminada. Cada familia usa el subconjunto que le aplica.
const ETAPAS = {
    // — tronco ordinario —
    demanda: { rank: 10, label: "Demanda / inicio" },
    traba_litis: { rank: 20, label: "Traba de la litis" },
    prueba: { rank: 30, label: "Prueba" },
    alegatos: { rank: 40, label: "Alegatos" },
    puro_derecho: { rank: 45, label: "Declaración de puro derecho" },
    autos_sentencia: { rank: 50, label: "Autos para sentencia" },
    sentencia_primera: { rank: 60, label: "Sentencia de primera instancia" },
    segunda_instancia: { rank: 70, label: "Recurso / segunda instancia" },
    sentencia_camara: { rank: 75, label: "Sentencia / resolución de Cámara" },
    recurso_extraordinario: { rank: 80, label: "Recurso extraordinario" },
    sentencia_firme: { rank: 85, label: "Sentencia firme" },
    ejecucion: { rank: 90, label: "Ejecución de sentencia" },
    fin_litigio: { rank: 95, label: "Fin del litigio" },
    archivo: { rank: 100, label: "Archivo" },

    // — familia sucesorio (CIV, objeto SUCESION*) —
    apertura_sucesion: { rank: 10, label: "Apertura de la sucesión" },
    edictos: { rank: 30, label: "Publicación de edictos" },
    declaratoria: { rank: 60, label: "Declaratoria de herederos / aprobación de testamento" },
    inscripcion: { rank: 90, label: "Inscripción de declaratoria" },

    // — familia concursal (COM, objeto CONCURSO/QUIEBRA) —
    apertura_concurso: { rank: 20, label: "Apertura del concurso" },
    verificacion: { rank: 30, label: "Verificación de créditos" },
    informe_general: { rank: 40, label: "Informe general" },
    categorizacion: { rank: 45, label: "Categorización de acreedores" },
    acuerdo: { rank: 50, label: "Período de exclusividad / mayorías" },
    homologacion: { rank: 60, label: "Homologación del acuerdo" },

    // — familia ejecutivo (EJECUCION*/EJECUTIVO, todos los fueros) —
    sentencia_remate: { rank: 60, label: "Sentencia de remate" },
};

// Agrupación gruesa para UI / Folder.currentPhase.
function faseDeRank(rank) {
    if (rank == null) return null;
    if (rank < 60) return "primera_instancia";
    if (rank < 70) return "sentencia";
    if (rank < 90) return "revision";
    if (rank < 95) return "ejecucion";
    return "terminada";
}

// ---------------------------------------------------------------------------
// Detección de familia procesal
// ---------------------------------------------------------------------------

// El objeto llega normalizado (mayúsculas) o crudo; normalizamos igual.
function detectFamilia(fuero, objeto) {
    const o = norm(objeto || "");
    if (/SUCESION/.test(o)) return "sucesorio";
    if (/QUIEBRA|CONCURSO|LIQUIDACION JUDICIAL/.test(o)) return "concursal";
    if (/^EJECUTIVO\b|EJECUCION|^EJEC\b|APREMIO/.test(o)) return "ejecutivo";
    return "ordinario";
}

// ---------------------------------------------------------------------------
// Clasificador de detalles de CAMBIO DE ESTADO
// ---------------------------------------------------------------------------

// Normaliza: mayúsculas, sin tildes, espacios colapsados, sin el prefijo
// "DETALLE:"/"DESCRIPCION:" que algunos scrapers dejan pegado.
function norm(s) {
    return String(s || "")
        .normalize("NFD").replace(/[̀-ͯ]/g, "")
        .toUpperCase()
        .replace(/\s+/g, " ")
        .trim()
        .replace(/^(DETALLE|DESCRIPCION):\s*/, "");
}

// Reglas ordenadas — la primera que matchea gana. `familias` limita la regla a
// esas familias (ausente = todas). `fueros` idem por fuero canónico (CNT/CSS/
// CIV/COM/...). Formato: [regex, categoria, etapa|null, opts]
//
// Categorías:
//   etapa          entra a una etapa procesal (progresiva)
//   terminal       hito que pone fin al litigio (etapa fin_litigio/archivo)
//   administrativo estado de despacho, no procesal — se ignora
//   traslado       circulación física del expediente — se ignora (trayectoria.js)
//   suspension     paraliza sin cambiar etapa
//   reanudacion    levanta la suspensión
//   incidental     incidente/cuestión accesoria (honorarios, aclaratoria) — no
//                  mueve la etapa principal
//   contextual     ambiguo, se resuelve en deriveEtapaProcesal según la etapa
//                  vigente (p.ej. "TRASLADO": de demanda en 1ra instancia, del
//                  art. 259 o del REX en 2da — no avanza si ya está en revisión)
const REGLAS = [
    // ===== familia-específicas primero (le ganan a las genéricas) =====
    // sucesorio
    [/^SUCESION\.?\s*APERTURA|^DECLARA ABIERTA LA SUCESION|^APERTURA DE (LA )?SUCESION/, "etapa", "apertura_sucesion", { familias: ["sucesorio"] }],
    [/^CERTIFICACION (DE )?EDICTOS|^EDICTOS|^SUCESION\.?\s*PUBLICACION DE EDICTOS/, "etapa", "edictos", { familias: ["sucesorio"] }],
    [/DECLARATORIA DE HEREDEROS|^SUCESION\.?\s*DECLARATORIA|^APROBACION DE TESTAMENTO|^SUCESION\.?\s*TESTAMENTO/, "etapa", "declaratoria", { familias: ["sucesorio"] }],
    [/^SUCESION\.?\s*INSCRIPCION|INSCRIPCION DE (LA )?DECLARATORIA|^SUCESION EN TRAMITES PARA INSCRIBIR/, "etapa", "inscripcion", { familias: ["sucesorio"] }],
    [/^PROTOCOLIZACION DE TESTAMENTO/, "etapa", "declaratoria", { familias: ["sucesorio"] }],
    // concursal
    [/^QUIEBRA: CLAUSURA/, "terminal", "fin_litigio", { familias: ["concursal"] }],
    [/^PEDIDO DE QUIEBRA.*(RESOLUCION - QUIEBRA|: QUIEBRA$)/, "etapa", "apertura_concurso", { familias: ["concursal"] }],
    [/^PEDIDO DE QUIEBRA/, "etapa", "demanda", { familias: ["concursal"] }],
    [/^PEDIDO DE RECAUDOS/, "etapa", "apertura_concurso", { familias: ["concursal"] }],
    [/^INFORME INDIVIDUAL|^RESOLUCION VERIFICATORIA/, "etapa", "verificacion", { familias: ["concursal"] }],
    [/^INFORME GENERAL/, "etapa", "informe_general", { familias: ["concursal"] }],
    [/^RESOLUCION DE CATEGORIZACION/, "etapa", "categorizacion", { familias: ["concursal"] }],
    [/^RESOLUCION OBTENCION DE MAYORIAS/, "etapa", "acuerdo", { familias: ["concursal"] }],
    [/^HOMOLOGACION/, "etapa", "homologacion", { familias: ["concursal"] }],
    // ejecutivo
    [/^SE(N?)TENCIA DE TRANCE Y REMATE|^SENTENCIA EJECUCION FISCAL|^SENTENCIA DE REMATE/, "etapa", "sentencia_remate", { familias: ["ejecutivo"] }],
    // En familia ejecutivo el estado "EJECUCION FISCAL" marca el INICIO del
    // proceso (la causa ES una ejecución), no la etapa post-sentencia.
    [/^EJECUCION FISCAL/, "etapa", "demanda", { familias: ["ejecutivo"] }],
    [/^EJECUTIVO\.?\s*(CITACION DEL DEUDOR|MANDAMIENTO|INTIMACION)/, "etapa", "traba_litis", { familias: ["ejecutivo"] }],

    // ===== administrativos (alto volumen — cortar temprano) =====
    [/^(EN LETRA|EN DESPACHO|A DESPACHO|EN CONFRONTE|CONFRONTE|EN ESTUDIO|SIN DEFINIR|PRIMER DESPACHO|ESCRITO A DESPACHO|A LA FIRMA|PARA NOTIFICAR|PARA DECRETAR|A LA OFICINA|NOTIFICACION POR SECRETARIA|NOTIFICACION DE LA JUEZ|CONFECCION CEDULA|OFICIO\b|CIRCULACION DE LA CAUSA|CASILLERO|READJUDICACION|ACUMULA|RESERVADO|EN CAJA DE SEGURIDAD|PRESTAMO|EN PRESTAMO|EXPEDIENTE PRESTADO|PROVIDENCIAS VARIAS|NOTIFICACION BAJO RESPONSABILIDAD|O R D I N A R I O|PREPAR PARA PASES)/, "administrativo", null],

    // ===== circulación / ubicación (lo resuelve trayectoria.js) =====
    [/^(DEVOLUCION|ELEVACION|REMISION|REINGRESO|INGRESO DE OTRO (JUZGADO|FUERO)|RECEPCION|EXPEDIENTE RESUELTO (REMIT|INGRE)|DEVOLUCION DE EXHORTO|PASE\b|DEX\b|REMIT\.)/, "traslado", null],

    // ===== suspensión / reanudación =====
    [/^(SACADO DE PARALIZADO|DESARCHIV|EXPEDIENTE DESPARALIZADO)/, "reanudacion", null],
    [/^(PARALIZADO|EXPTE\.? PARALIZADO|EXPEDIENTE PARALIZADO|ARCHIVO PROVISORIO)/, "suspension", null],

    // ===== incidentales (no mueven la etapa principal) =====
    [/^APERTURA RECURSO:? HONORARIOS/, "incidental", null],
    [/^FINALIZACION ETAPA - SENTENCIA INTERLOCUTORIA/, "incidental", null],
    [/^(ACLARATORIA|MEDIDAS PRECAUTORIAS|MEDIDA CAUTELAR|PAGO |BENEFICIO DE LITIGAR|EXHIBICION DE LIBROS|PRUEBA ANTICIPADA|DILIGENCIAS PRELIMINARES|RECURSO DE REPOSICION|VUELTA A MEDIACION|VISTA FISCAL|HONORARIOS|RECUSACION|REMOCION DE PERITO|RESOLUCION NO DEFINITIVA|TASA SATISFECHA|IMPUGNACION PERICIA|INTERVENCION DE TERCEROS)/, "incidental", null],
    // FINALIZACION ETAPA con sufijos estadísticos (COMPUTABLE / NO COMPUTABLE /
    // DEVOLUCION / DESISTIMIENTO) — marcadores internos de Lex100, no etapa.
    [/^FINALIZACION ETAPA - (COMPUTABLE|NO COMPUTABLE|DEVOLUCION|DESISTIMIENTO)/, "incidental", null],

    // ===== terminales =====
    [/^RESOL\.? QUE PONE FIN AL LITIGIO|^RESOLUCION QUE FINALIZA EL LITIGIO/, "terminal", "fin_litigio"],
    [/^(ACUERDO TRANSACCIONAL HOMOLOGADO|HOMOLOGACION ACUERDO|HOMOLOGACION$|ACUERDO$|CONCILIACION)/, "terminal", "fin_litigio"],
    // SENTENCIA FIRME es etapa (rank 85), no terminal: habilita la ejecución.
    [/^SENTENCIA FIRME/, "etapa", "sentencia_firme"],
    [/^(OBJETO CUMPLIDO|COSA JUZGADA|DESISTIM|DECLARACION DE INCOMPETENCIA|TRANSACCION)/, "terminal", "fin_litigio"],
    [/^(ARCHIVESE|ARCHIVO\b|ARCHIVADO|REMISION AL ARCHIVO|JUICIO TERMINADO)/, "terminal", "archivo"],

    // ===== etapas del tronco ordinario =====
    [/^(INICIO ?\/ ?DEMANDA|INICIO TRAMITE|INICIO$|INICIA$|INICIO -|PRIMERA PROVIDENCIA|INTIMACIONES PREVIAS|DEMANDA$|EJECUTIVO INICIACION|ENDEREZA DEMANDA)/, "etapa", "demanda"],
    [/^(TRABA DE LITIS|TRASLADO DE (LA )?DEMANDA|TRASLADO - .*DEMANDA|DEMANDA\.)/, "etapa", "traba_litis"],
    [/^(CONTESTACION (DE )?DEMANDA|CONTESTACION CITADA EN GARANTIA|CONTESTA TRASLADO|EXCEPCIONES PREVIAS|INTEGRACION DE LITIS|ART\.? ?547)/, "etapa", "traba_litis"],
    [/^TRASLADO - .*LIQUIDACI/, "etapa", "ejecucion"],
    [/^TRASLADO - .*PURO DERECHO/, "etapa", "puro_derecho"],
    [/^(PRUEBA|AUDIENCIA PRELIMINAR|AUDIENCIA ART\.? ?360|AUDIENCIA DE VISTA DE CAUSA|APERTURA A PRUEBA|PRODUCCION DE PRUEBA|PRESENTACION DEL INFORME PERICIAL|CLAUSURA PRUEBA|CLAUSURA DE(L PERIODO DE)? PRUEBA|JUICIO RECIBIDO A PRUEBA|AUDIENCIA CONCILIACION PREVIA)/, "etapa", "prueba"],
    [/^(ALEGATOS|CONCLUSION DE LA CAUSA PARA DEFINITIVA)/, "etapa", "alegatos"],
    [/^DECLARAC(\.|ION)? ?(DE )?PURO DERECHO/, "etapa", "puro_derecho"],
    [/^(LLAMAMIENTO DE AUTOS|LLAMADO DE AUTOS|AUTOS PARA SENTENCIA|AUTOS$)/, "etapa", "autos_sentencia"],
    [/^(FINALIZACION ETAPA - SENTENCIA DEFINITIVA|FINALIZACION ETAPA$|SENTENCIA DE PRIMERA INSTANCIA|SENTENCIA$|SENTENCIA DEFINITIVA|SENTENCIA \(INCLUIDAS|FALLO)/, "etapa", "sentencia_primera"],
    // Traslados con sufijo inequívoco de segunda instancia (contestación de
    // agravios art. 265, expresión de agravios).
    [/^TRASLADO - .*(265|AGRAVIOS)/, "etapa", "segunda_instancia"],
    // "TRASLADO" a secas es ambiguo por contexto (muy frecuente en CSS): en
    // primera instancia es el traslado de la demanda; en segunda puede ser el
    // del art. 259 o el del recurso extraordinario. Se resuelve en
    // deriveEtapaProcesal según la etapa vigente al momento del evento:
    // etapa temprana (rank < prueba) → traba_litis; posterior → actividad
    // dentro de la etapa vigente (no avanza).
    [/^TRASLADO( - |$)/, "contextual", "traslado"],
    [/^(APERTURA RECURSO|MEMORIAL|ART\.? ?259|CONCESION DEL RECURSO|RECURSO DE APELACION|EXPRESION DE AGRAVIOS|APELACION|EXPEDIENTE ELEVACION A CAMARA|PLANTEO DEL RECURSO)/, "etapa", "segunda_instancia"],
    [/^(SENTENCIA DE CAMARA|RESOLUCION DE CAMARA|FALLO DE CAMARA)/, "etapa", "sentencia_camara"],
    [/^(RECURSO EXTRAORDINARIO|QUEJA|RECURSO DE QUEJA|REX\b)/, "etapa", "recurso_extraordinario"],
    [/^(EJECUCION DE SENTENCIA|EN ETAPA DE EJECUCION|INTIMACION CUMPLIMIENTO|EJECUCION FISCAL$|LIQUIDACION$|APROBACION DE LIQUIDACION|SUBASTA)/, "etapa", "ejecucion"],
];

/**
 * Clasifica el detalle de un movimiento CAMBIO DE ESTADO.
 * @returns {{categoria: string, etapa: string|null, rank: number|null}|null}
 *          null si no matchea ninguna regla (desconocido).
 */
function classifyEstado(detalle, familia, fuero) {
    const d = norm(detalle);
    if (!d) return null;
    const f = familia || "ordinario";
    const fu = fuero ? norm(fuero) : null;
    for (const [re, categoria, etapa, opts] of REGLAS) {
        if (opts && opts.familias && !opts.familias.includes(f)) continue;
        if (opts && opts.fueros && (!fu || !opts.fueros.includes(fu))) continue;
        if (re.test(d)) {
            const rank = etapa && ETAPAS[etapa] ? ETAPAS[etapa].rank : null;
            return { categoria, etapa: etapa || null, rank };
        }
    }
    return null;
}

// ---------------------------------------------------------------------------
// Timeline
// ---------------------------------------------------------------------------

const RE_TIPO_ESTADO = /CAMBIO DE ESTADO/i;
// Señal secundaria (v4): el tipo de movimiento "PUBLICACION SENTENCIA" marca
// que se dictó sentencia aunque el juzgado no haya cargado el cambio de estado.
const RE_TIPO_PUBLICACION_SENTENCIA = /PUBLICACION SENTENCIA/i;
// Señales v6: movimientos comunes DEL TRIBUNAL (nunca escritos de parte) cuyo
// detalle registra el dictado de la sentencia o el pase a autos.
const RE_TIPO_COMUN = /^(EVENTO|FIRMA DESPACHO|MOVIMIENTO)$/i;

// Clasifica el detalle de un movimiento común. Devuelve la señal o null.
// Patrones ANCLADOS al inicio para excluir referencias de terceros
// ("APELA SENTENCIA", "CONCEDE RECURSO ... SENTENCIA", "NOTIFICA SENTENCIA").
function detectarSenalComun(detalle) {
    const d = norm(detalle);
    if (!d) return null;
    // Inhabilidad de instancia (v10): terminación anticipada — trunca la demanda.
    if (/INHABILIDAD DE (LA )?INSTANCIA|FALTA DE APTITUD JURISDICCIONAL/.test(d)) return "inhabilidad";
    // Interlocutoria: hito con flujo propio (no cierra instancia) — v8.
    if (/^SENTENCIA INTERLOCUTORIA|^FINALIZACION ETAPA - SENTENCIA INTERLOCUTORIA/.test(d)) return "interlocutoria";
    if (/INTERLOCUTORIA/.test(d)) return null; // otras menciones: ni etapa ni hito
    // Pase a autos para sentencia (antes que las de sentencia: "A SENTENCIA").
    if (/^(A SENTENCIA|AUTOS (A|PARA) SENTENCIA|PASE A SENTENCIA|VPN A SENTENCIA)/.test(d)) return "autos";
    if (/^SORTEO|^INFORME SORTEO|^EXPEDIENTE A DESPACHO/.test(d)) return null;
    if (/^SENTENCIA( DEFINITIVA)? DE PRIMERA INSTANCIA/.test(d)) return "sentencia-primera";
    if (/^SENTENCIA DE C[AÁ]?MARA/.test(d)) return "sentencia-camara";
    if (/^(SE DICTA )?SENTENCIA (DE )?(TRANCE Y REMATE|TRANCE|VENTA|REMATE)/.test(d)) return "sentencia-remate";
    if (/^SENTENCIAS? DEF/.test(d)) return "sentencia"; // DEFINITIVA + typo DEFINTIVA
    if (/^SENTENCIA$/.test(d)) return "sentencia";
    return null;
}

// Resolución de señales directas (no contextuales) del tribunal.
const SENAL_DIRECTA = {
    "sentencia-primera": "sentencia_primera",
    "sentencia-camara": "sentencia_camara",
    "sentencia-remate": "sentencia_remate",
    autos: "autos_sentencia",
};
const DAY = 24 * 60 * 60 * 1000;

function dayKey(d) {
    return d.toISOString().slice(0, 10);
}

// Extrae los eventos CAMBIO DE ESTADO con fecha válida en orden cronológico
// ascendente (empate de fecha: orden inverso al del array original — el portal
// lista de más nuevo a más viejo) y el asOf (último movimiento de CUALQUIER
// tipo — hasta cuándo "sabemos").
function buildEventos(movimientos) {
    const eventos = [];
    let asOf = null;
    (movimientos || []).forEach((m, i) => {
        const f = m && m.fecha ? new Date(m.fecha) : null;
        if (!f || isNaN(f)) return;
        if (!asOf || f > asOf) asOf = f;
        if (RE_TIPO_ESTADO.test(m.tipo || "")) {
            eventos.push({ fecha: f, detalle: m.detalle || "", idx: i });
        } else if (RE_TIPO_PUBLICACION_SENTENCIA.test(m.tipo || "")) {
            eventos.push({ fecha: f, detalle: m.detalle || "", idx: i, senal: "publicacion-sentencia" });
        } else if (RE_TIPO_COMUN.test((m.tipo || "").trim())) {
            const s = detectarSenalComun(m.detalle);
            if (s) eventos.push({ fecha: f, detalle: m.detalle || "", idx: i, senal: s });
        }
    });
    eventos.sort((a, b) => (a.fecha - b.fecha) || (b.idx - a.idx));
    return { eventos, asOf };
}

// Motor común de derive/update: procesa `eventos` (ya ordenados) partiendo del
// estado `seed` y devuelve el estado final + los segmentos nuevos creados.
// Compacta por día (dentro de un mismo día solo cuenta el evento de etapa de
// mayor rank — evita falsos retrocesos por pares tipo "ART 259" + "INICIO
// TRAMITE" cargados juntos) y aplica progresividad: un rank menor en día
// posterior abre segmento marcado retroceso: true (nunca se descarta).
function runEngine(eventos, familia, fu, seed) {
    const st = {
        cur: seed.cur || null, // segmento abierto {etapa, rank, desde, hasta}
        terminal: !!seed.terminal,
        resultado: seed.resultado || null,
        retrocesosDescartados: 0,
        hitos: [],
        hitosVistos: new Set(seed.hitosVistos || []),
        paralizado: !!seed.paralizado,
        paralizadoDesde: seed.paralizadoDesde || null,
        suspensiones: [],   // suspensiones CERRADAS durante esta corrida
        nuevos: [],         // segmentos creados en esta corrida
        curCerrado: false,  // true si el segmento seed quedó cerrado
        eventos: 0,
        clasificados: 0,
        sinClasificar: new Map(),
    };

    // 1. Clasificar; suspensiones inline; compactar etapas por día.
    const porDia = new Map();
    for (const ev of eventos) {
        st.eventos++;
        // Inhabilidad de instancia (v10): terminación anticipada que trunca la
        // demanda — cualquier fuente. Registra hito + evento terminal.
        const dNormEv = norm(ev.detalle);
        if (ev.senal === "inhabilidad" || /INHABILIDAD DE (LA )?INSTANCIA|FALTA DE APTITUD JURISDICCIONAL/.test(dNormEv)) {
            st.clasificados++;
            const keyIn = `inhabilidad:${dayKey(ev.fecha)}`;
            if (!st.hitosVistos.has(keyIn)) {
                st.hitosVistos.add(keyIn);
                st.hitos.push({ tipo: "inhabilidad_instancia", fecha: ev.fecha, detalle: dNormEv.slice(0, 60), fuente: ev.senal ? "comun" : "estado" });
            }
            const k = dayKey(ev.fecha);
            const slot = porDia.get(k) || { fecha: ev.fecha, evs: new Map() };
            if (!slot.evs) slot.evs = new Map();
            if (!slot.evs.has("fin_litigio")) {
                slot.evs.set("fin_litigio", { fecha: ev.fecha, etapa: "fin_litigio", rank: ETAPAS.fin_litigio.rank, categoria: "terminal", detalle: ev.detalle, esSenal: false });
            }
            porDia.set(k, slot);
            continue;
        }
        // HITO sentencia interlocutoria (v8): no cierra instancia ni mueve la
        // etapa — se registra en hitos[] con su fuente, venga de un estado,
        // una publicación o un movimiento común. Dedupe por día.
        if (ev.senal === "interlocutoria" || /SENTENCIA INTERLOCUTORIA/.test(dNormEv)) {
            st.clasificados++;
            const key = `interlocutoria:${dayKey(ev.fecha)}`;
            if (!st.hitosVistos.has(key)) {
                st.hitosVistos.add(key);
                st.hitos.push({
                    tipo: "sentencia_interlocutoria",
                    fecha: ev.fecha,
                    detalle: dNormEv.slice(0, 60),
                    fuente: ev.senal === "interlocutoria" ? "comun" : ev.senal ? "publicacion" : "estado",
                });
            }
            continue;
        }
        // Señales secundarias: PUBLICACION SENTENCIA y "sentencia" genérica de
        // movimientos comunes son contextuales (la instancia se resuelve en el
        // fold); las específicas (1ra instancia / cámara / remate / autos) son
        // eventos de etapa directos.
        let c;
        if (ev.senal === "publicacion-sentencia" || ev.senal === "sentencia") {
            c = { categoria: "contextual", etapa: "publicacion_sentencia", rank: null };
        } else if (ev.senal && SENAL_DIRECTA[ev.senal]) {
            const et = SENAL_DIRECTA[ev.senal];
            c = { categoria: "etapa", etapa: et, rank: ETAPAS[et].rank };
        } else {
            c = classifyEstado(ev.detalle, familia, fu);
        }
        if (!c) {
            const k = norm(ev.detalle).slice(0, 80);
            st.sinClasificar.set(k, (st.sinClasificar.get(k) || 0) + 1);
            continue;
        }
        st.clasificados++;
        if (c.categoria === "suspension") {
            if (!st.paralizado) { st.paralizado = true; st.paralizadoDesde = ev.fecha; }
            continue;
        }
        if (c.categoria === "reanudacion") {
            if (st.paralizado) {
                st.suspensiones.push({ desde: st.paralizadoDesde, hasta: ev.fecha });
                st.paralizado = false; st.paralizadoDesde = null;
            }
            continue;
        }
        if (c.categoria === "contextual") {
            // Ambiguo (p.ej. "TRASLADO" a secas, señal de sentencia): se
            // resuelve en el fold según la etapa vigente. Convive con el
            // evento concreto del mismo día en un slot aparte — un "pase a
            // autos" y la señal de sentencia el mismo día no se pisan.
            const k = dayKey(ev.fecha);
            const slot = porDia.get(k) || { fecha: ev.fecha, etapa: null, rank: null, categoria: null };
            if (!slot.ctx || c.etapa === "publicacion_sentencia") slot.ctx = { etapa: c.etapa, esSenal: !!ev.senal };
            porDia.set(k, slot);
            continue;
        }
        if (c.categoria !== "etapa" && c.categoria !== "terminal") continue;
        const k = dayKey(ev.fecha);
        const slot = porDia.get(k) || { fecha: ev.fecha, evs: new Map() };
        if (!slot.evs) slot.evs = new Map();
        // Dedupe por etapa dentro del día (se conserva el primero).
        if (!slot.evs.has(c.etapa)) {
            slot.evs.set(c.etapa, { fecha: ev.fecha, etapa: c.etapa, rank: c.rank, categoria: c.categoria, detalle: ev.detalle, esSenal: !!ev.senal });
        }
        porDia.set(k, slot);
    }

    // 2. Fold cronológico de los días compactados sobre el segmento vigente.
    //    Cada día aporta hasta dos sub-eventos: el concreto primero y la señal
    //    contextual después (así "pase a autos" + señal de sentencia el mismo
    //    día produce autos → sentencia, sin perder ninguna).
    const dias = [...porDia.values()].sort((a, b) => a.fecha - b.fecha);
    const subEventos = [];
    for (const d of dias) {
        if (d.evs && d.evs.size) {
            // Progresión del día: eventos concretos en orden de rank ascendente.
            for (const e of [...d.evs.values()].sort((a, b) => (a.rank || 0) - (b.rank || 0))) subEventos.push(e);
        }
        if (d.ctx) subEventos.push({ fecha: d.fecha, categoria: "contextual", contextual: d.ctx.etapa, esSenal: d.ctx.esSenal, detalle: "" });
    }
    for (const ev of subEventos) {
        if (ev.categoria === "contextual") {
            if (ev.contextual === "publicacion_sentencia") {
                // Sentencia dictada (señal PUBLICACION SENTENCIA): en primera
                // instancia → sentencia_primera; en revisión → sentencia_camara;
                // más allá (REX/ejecución/terminal) la cura de retrocesos la
                // absorbe como incidental.
                const rankCur = st.cur ? st.cur.rank || 0 : 0;
                if (rankCur < ETAPAS.segunda_instancia.rank) {
                    ev.etapa = "sentencia_primera";
                    ev.rank = ETAPAS.sentencia_primera.rank;
                } else {
                    ev.etapa = "sentencia_camara";
                    ev.rank = ETAPAS.sentencia_camara.rank;
                }
                ev.categoria = "etapa";
            } else {
                // "TRASLADO" a secas: en etapa temprana es el traslado de la
                // demanda → traba_litis; en revisión o posterior es el del
                // art. 259 / del REX → actividad de la etapa vigente, no mueve.
                if (st.cur && (st.cur.rank || 0) >= ETAPAS.prueba.rank) continue;
                ev.etapa = "traba_litis";
                ev.rank = ETAPAS.traba_litis.rank;
                ev.categoria = "etapa";
            }
        }
        if (st.cur && ev.etapa === st.cur.etapa) continue; // repetición de la misma etapa
        if (ev.etapa === "ejecucion" && (!st.cur || (st.cur.rank || 0) < 60)) {
            // No puede haber ejecución sin sentencia (o fin del litigio)
            // previa — es actividad del flujo de un incidente (v10).
            st.retrocesosDescartados++;
            continue;
        }
        if (st.cur && (ev.rank || 0) < (st.cur.rank || 0)) {
            if ((st.cur.rank || 0) < ETAPAS.fin_litigio.rank) {
                // Retroceso dentro del trámite: actividad incidental (p.ej.
                // autos para resolver honorarios tras la sentencia). NO altera
                // la progresión — se cuenta para auditoría y se descarta.
                st.retrocesosDescartados++;
                continue;
            }
            // La causa está terminada:
            if (ev.esSenal) {
                // Las señales secundarias (publicación, movimientos comunes)
                // no reabren una causa terminada — solo un estado explícito.
                st.retrocesosDescartados++;
                continue;
            }
            if (ev.categoria === "terminal") {
                // Hito terminal tras el archivo (RESOL. FIN llega después del
                // ARCHIVESE): se absorbe actualizando el subtipo de resultado.
                if (ev.etapa !== "archivo" || !st.resultado) {
                    st.resultado = { etapa: ev.etapa, detalle: norm(ev.detalle).slice(0, 80) };
                }
                st.terminal = true;
                continue;
            }
            if (st.resultado && /INHABILIDAD|INTERLOCUTORIA|INCOMPETENCIA/.test(st.resultado.detalle || "") && (ev.rank || 0) >= 70 && (ev.rank || 0) < 95) {
                // Terminación por interlocutoria (inhabilidad, incompetencia
                // e inhibitoria — v11, patrón confirmado en RUSCITTI): la
                // apelación y la resolución de Cámara posteriores son FLUJO
                // DEL INCIDENTE — no reabren el proceso principal. Solo una
                // etapa de primera instancia (revocación) lo reabre.
                st.retrocesosDescartados++;
                continue;
            }
            if (st.cur.etapa === "fin_litigio" && ev.etapa === "ejecucion" && !(st.resultado && /INHABILIDAD|INCOMPETENCIA/.test(st.resultado.detalle || ""))) {
                // Ejecución del acuerdo conciliatorio/homologado: continuación
                // NORMAL del proceso, no reapertura — sin marca de retroceso.
                st.cur.hasta = ev.fecha;
                if (st.nuevos.indexOf(st.cur) === -1) st.curCerrado = true;
                const segEj = { etapa: ev.etapa, rank: ev.rank, desde: ev.fecha, hasta: null };
                st.nuevos.push(segEj);
                st.cur = segEj;
                st.terminal = false;
                continue;
            }
            // Estado explícito de etapa: reapertura real → abre segmento ⟲.
        }
        if (st.cur) {
            st.cur.hasta = ev.fecha;
            if (st.nuevos.indexOf(st.cur) === -1) st.curCerrado = true;
        }
        const seg = { etapa: ev.etapa, rank: ev.rank, desde: ev.fecha, hasta: null };
        // Solo llega acá un rank menor si la causa estaba terminada.
        if (st.cur && (ev.rank || 0) < (st.cur.rank || 0)) {
            if (st.resultado && /INHABILIDAD|INTERLOCUTORIA|INCOMPETENCIA/.test(st.resultado.detalle || "")) {
                // REVOCACIÓN (v12): la Cámara rechazó la interlocutoria — la
                // demanda continúa a la siguiente etapa. No es anomalía; el
                // resultado revocado se limpia.
                seg.revocacion = true;
                st.resultado = null;
            } else {
                seg.retroceso = true;
            }
        }
        st.nuevos.push(seg);
        st.cur = seg;
        // un evento de etapa posterior "desconfirma" el cierre (p.ej. desarchivo)
        st.terminal = ev.categoria === "terminal";
        if (ev.categoria === "terminal") {
            // Resultado = CÓMO terminó la causa. El subtipo interesante es el
            // del hito de fin de litigio (conciliación/caducidad/desistimiento/
            // sentencia firme...); un ARCHIVESE posterior es solo el archivo
            // físico y no lo pisa.
            if (ev.etapa !== "archivo" || !st.resultado) {
                st.resultado = { etapa: ev.etapa, detalle: norm(ev.detalle).slice(0, 80) };
            }
        } else {
            st.resultado = null; // reapertura/desarchivo: la causa siguió
        }
    }
    return st;
}

// Calcula `dias` de cada segmento (los abiertos se miden contra asOf, no
// contra hoy — la causa puede estar desactualizada) y arma el objeto final.
function assemble(familia, timeline, st, suspensiones, asOf, counters) {
    const retrocesosDescartados = (counters.retrocesosPrevios || 0) + (st.retrocesosDescartados || 0);
    for (const seg of timeline) {
        const fin = seg.hasta || asOf;
        seg.dias = fin && seg.desde ? Math.max(0, Math.round((fin - seg.desde) / DAY)) : null;
    }
    const last = timeline[timeline.length - 1] || null;
    return {
        familia,
        timeline,
        etapaActual: last ? last.etapa : null,
        rankActual: last ? last.rank : null,
        fase: last ? faseDeRank(last.rank) : null,
        terminal: st.terminal,
        // Cómo terminó (solo si terminal): {etapa: fin_litigio|archivo, detalle:
        // subtipo normalizado, ej "RESOL. QUE PONE FIN AL LITIGIO: CONCILIACION..."}
        resultado: st.terminal ? st.resultado : null,
        paralizado: st.paralizado,
        suspensiones,
        // Eventos de etapa con rank menor al vigente descartados por la cura
        // v3 (incidentes post-etapa). Auditoría del criterio de progresividad.
        retrocesosDescartados,
        // Hitos del proceso (v8): sentencias interlocutorias — no cierran
        // instancia ni mueven la etapa; tienen flujo propio (apelables).
        hitos: (counters.hitos || []).slice(0, 50),
        asOf,
        eventosEstado: counters.eventos,
        eventosClasificados: counters.clasificados,
        sinClasificar: counters.sinClasificar,
        confianza: counters.eventos ? +(counters.clasificados / counters.eventos).toFixed(3) : 0,
        version: VERSION,
    };
}

/**
 * Deriva el timeline de etapas procesales de una causa desde cero.
 *
 * @param {Array} movimientos  array movimiento[] de la causa ({tipo, detalle, fecha})
 * @param {string} fuero       código canónico (CNT/CSS/CIV/COM/...) o alias
 * @param {string} objeto      objeto de la causa (para detectar familia)
 * @returns objeto con familia, timeline con desde/hasta/dias, etapaActual, etc.
 */
function deriveEtapaProcesal(movimientos, fuero, objeto) {
    const familia = detectFamilia(fuero, objeto);
    const fu = fuero ? norm(fuero) : null;
    const { eventos, asOf } = buildEventos(movimientos);
    const st = runEngine(eventos, familia, fu, {});
    const suspensiones = st.suspensiones.slice();
    if (st.paralizado) suspensiones.push({ desde: st.paralizadoDesde, hasta: null });
    return assemble(familia, st.nuevos, st, suspensiones, asOf, {
        eventos: st.eventos,
        clasificados: st.clasificados,
        sinClasificar: [...st.sinClasificar.entries()].map(([detalle, n]) => ({ detalle, n })),
        hitos: st.hitos,
    });
}

/**
 * Actualización INCREMENTAL: completa el timeline persistido con los eventos
 * posteriores a `prev.asOf` en vez de reprocesar toda la causa. Cae
 * automáticamente a recomputo completo (deriveEtapaProcesal) cuando el
 * incremental no es seguro:
 *   - sin precomputo previo o sin asOf            (motivo: sin-precomputo)
 *   - reglas más nuevas que las del precomputo    (motivo: version)
 *   - cambió la familia (objeto corregido)        (motivo: familia)
 *   - aparecieron eventos de estado en días <= asOf que el precomputo no vio
 *     (re-scrape que descubrió movimientos viejos / VER HISTÓRICAS / merge) —
 *     un fold incremental daría un timeline erróneo (motivo: eventos-retroactivos)
 *
 * El corte es por DÍA: eventos nuevos en el mismo día que asOf también fuerzan
 * recomputo (la compactación por día debe rehacerse). El estado necesario para
 * retomar (último segmento abierto, suspensión abierta, terminal, contadores)
 * sale del propio subdoc persistido.
 *
 * @param {Object} prev        subdoc etapaProcesal persistido (plain object o
 *                             doc Mongoose — se normaliza)
 * @param {Array}  movimientos array movimiento[] COMPLETO actual de la causa
 * @param {string} fuero
 * @param {string} objeto
 * @returns mismo shape que deriveEtapaProcesal + { modo: 'incremental'|'full',
 *          motivo } (campos informativos — el schema no los persiste)
 */
function updateEtapaProcesal(prev, movimientos, fuero, objeto) {
    const full = (motivo) =>
        Object.assign(deriveEtapaProcesal(movimientos, fuero, objeto), { modo: "full", motivo });

    if (prev && typeof prev.toObject === "function") prev = prev.toObject();
    if (!prev || !prev.asOf) return full("sin-precomputo");
    if (prev.version !== VERSION) return full("version");

    const familia = detectFamilia(fuero, objeto);
    if (prev.familia && prev.familia !== familia) return full("familia");
    const fu = fuero ? norm(fuero) : null;

    const { eventos, asOf } = buildEventos(movimientos);
    const corte = dayKey(new Date(prev.asOf));
    const viejos = eventos.filter((e) => dayKey(e.fecha) <= corte);
    // Si la cantidad de eventos hasta el corte no coincide con lo que vio el
    // precomputo, aparecieron (o desaparecieron) eventos retroactivos.
    if (viejos.length !== prev.eventosEstado) return full("eventos-retroactivos");
    const nuevos = eventos.filter((e) => dayKey(e.fecha) > corte);

    // Seed desde el estado persistido.
    const prevTimeline = (prev.timeline || []).map((s) => ({
        etapa: s.etapa,
        rank: s.rank,
        desde: s.desde ? new Date(s.desde) : null,
        hasta: s.hasta ? new Date(s.hasta) : null,
        ...(s.retroceso ? { retroceso: true } : {}),
        ...(s.revocacion ? { revocacion: true } : {}),
    }));
    const lastSeg = prevTimeline[prevTimeline.length - 1] || null;
    const prevSusp = (prev.suspensiones || []).map((s) => ({
        desde: s.desde ? new Date(s.desde) : null,
        hasta: s.hasta ? new Date(s.hasta) : null,
    }));
    const abierta = prevSusp.find((s) => !s.hasta) || null;

    const prevHitos = (prev.hitos || []).map((h) => ({ tipo: h.tipo, fecha: new Date(h.fecha), detalle: h.detalle, fuente: h.fuente }));
    const st = runEngine(nuevos, familia, fu, {
        cur: lastSeg,
        terminal: prev.terminal,
        resultado: prev.resultado ? { etapa: prev.resultado.etapa, detalle: prev.resultado.detalle } : null,
        paralizado: !!abierta,
        paralizadoDesde: abierta ? abierta.desde : null,
        hitosVistos: prevHitos.map((h) => `interlocutoria:${dayKey(h.fecha)}`),
    });

    // Ensamblar: timeline previo (el último segmento pudo cerrarse en el fold)
    // + segmentos nuevos; suspensiones cerradas previas + resultado del fold.
    const timeline = prevTimeline.concat(st.nuevos);
    const suspensiones = prevSusp.filter((s) => s.hasta).concat(st.suspensiones);
    if (st.paralizado) suspensiones.push({ desde: st.paralizadoDesde, hasta: null });

    const prevSin = new Map((prev.sinClasificar || []).map((x) => [x.detalle, x.n]));
    for (const [k, n] of st.sinClasificar) prevSin.set(k, (prevSin.get(k) || 0) + n);

    const nuevoAsOf = asOf && prev.asOf ? (asOf > new Date(prev.asOf) ? asOf : new Date(prev.asOf)) : (asOf || new Date(prev.asOf));
    const resultado = assemble(familia, timeline, st, suspensiones, nuevoAsOf, {
        eventos: (prev.eventosEstado || 0) + st.eventos,
        clasificados: (prev.eventosClasificados || 0) + st.clasificados,
        sinClasificar: [...prevSin.entries()].map(([detalle, n]) => ({ detalle, n })),
        retrocesosPrevios: prev.retrocesosDescartados || 0,
        hitos: prevHitos.concat(st.hitos).sort((a, b) => a.fecha - b.fecha).slice(0, 50),
    });
    return Object.assign(resultado, { modo: "incremental", motivo: null });
}

// ---------------------------------------------------------------------------
// Conformidad contra el patrón maestro (conformance checking)
// ---------------------------------------------------------------------------

// Prerrequisitos por familia: si la etapa (key) está presente en el timeline,
// al menos UNA de las alternativas debe estar también. La primera alternativa
// es la "canónica" — es la que se reporta como faltante (candidata a inferirse
// desde los movimientos en la Fase 2).
const PRERREQUISITOS = {
    ordinario: {
        segunda_instancia: ["sentencia_primera"],
        sentencia_camara: ["sentencia_primera"],
        recurso_extraordinario: ["sentencia_camara", "segunda_instancia"],
        ejecucion: ["sentencia_primera", "sentencia_camara", "sentencia_firme", "sentencia_remate", "fin_litigio"],
    },
    sucesorio: {
        inscripcion: ["declaratoria"],
    },
    concursal: {},
    ejecutivo: {
        ejecucion: ["sentencia_remate", "sentencia_primera", "fin_litigio"],
    },
};

/**
 * Clasifica una causa TERMINADA contra el patrón maestro de su familia.
 * El orden ya está garantizado por construcción (cura v3) — lo que se evalúa
 * es la COMPLETITUD: qué etapas presentes presuponen otras que no se
 * registraron (gap observacional del Lex100, inferible en Fase 2).
 *
 * @param {Object} ep  subdoc etapaProcesal (con timeline y familia)
 * @returns {{conformidad: string, faltantes: string[]}|null}
 *   - 'con-merito'  llegó a resolución de mérito (rank 60-69) sin gaps
 *   - 'anticipada'  terminó (conciliación/caducidad/archivo) sin mérito — legítima
 *   - 'gap'         etapas presentes presuponen otras no registradas (faltantes)
 *   - 'reapertura'  contiene segmentos retroceso (reapertura desde terminal)
 */
function clasificarConformidad(ep) {
    const tl = (ep && ep.timeline) || [];
    if (!tl.length) return null;
    const familia = ep.familia || "ordinario";
    const present = new Set(tl.map((s) => s.etapa));
    const reglas = PRERREQUISITOS[familia] || PRERREQUISITOS.ordinario;

    const faltantes = new Set();
    for (const etapa of present) {
        const alts = reglas[etapa];
        if (alts && !alts.some((a) => present.has(a))) faltantes.add(alts[0]);
    }
    // Las revocaciones (Cámara rechaza la interlocutoria y la demanda sigue)
    // son continuación legítima — no cuentan como reapertura.
    if (tl.some((s) => s.retroceso)) return { conformidad: "reapertura", faltantes: [...faltantes] };
    if (faltantes.size) return { conformidad: "gap", faltantes: [...faltantes] };
    const merito = [...present].some((e) => ETAPAS[e] && ETAPAS[e].rank >= 60 && ETAPAS[e].rank < 70);
    return { conformidad: merito ? "con-merito" : "anticipada", faltantes: [] };
}

module.exports = {
    VERSION,
    ETAPAS,
    REGLAS,
    PRERREQUISITOS,
    clasificarConformidad,
    detectFamilia,
    classifyEstado,
    deriveEtapaProcesal,
    updateEtapaProcesal,
    faseDeRank,
    _norm: norm,
};
