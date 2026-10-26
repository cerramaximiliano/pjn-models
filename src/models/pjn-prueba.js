const mongoose = require("mongoose");

// Cadenas de prueba de una causa ("completitud de la prueba"): ¿el oficio se
// contestó?, ¿la pericia se presentó?, ¿la audiencia se tomó? Una cadena agrupa
// los movimientos de una misma prueba (pedido → libramiento/DEO → reiteratorios
// → respuesta; designación → aceptación → dictamen → impugnación) y resume su
// estado. Las escribe pjn-rag-workers (etapa `vinculos`, a partir de
// pjn-movements.vinculos[] y de los textos extraídos); las lee el MCP
// (get_folder_detail resume por estado; list_folder_pruebas lista con filtros)
// y, más adelante, el front y plazos.
//
// Contrato acordado con el MCP el 26/10/2026 (la-infra-docs, evaluación
// integral del RAG §7.3). Colección aparte de la causa: se consulta por causa
// y por estado, y la causa ya es pesada.
//
// _id: string determinístico sha1 de {causaId|clase|clave|inicioMovementId}
// (lo arma el writer) — así el vínculo `parte_de_cadena` de cada movimiento
// puede escribirse en la misma pasada.

const CLASES = ["informativa", "pericial", "testimonial", "confesional", "documental"];

const ESTADOS = [
    "pendiente",   // iniciada, sin respuesta/dictamen/acta todavía
    "reiterada",   // pendiente y ya se reiteró al menos una vez
    "respondida",  // la respuesta / el dictamen / el acta llegó
    "impugnada",   // respondida pero impugnada u observada; esperando explicaciones
    "concluida",   // cerrada por el tribunal (desistida, caduca, agregada y consentida)
    "no_aplica",   // no espera respuesta (remisión de autos, embargo, comunicación)
];

const ROLES = [
    "pedido", "libramiento", "envio_deo", "reiteratorio", "diligenciamiento", "respuesta",
    "designacion", "aceptacion", "dictamen", "impugnacion", "explicaciones",
    "apertura", "fijacion", "acta", "otro",
];

const eventoSchema = new mongoose.Schema(
    {
        movementId: { type: String, required: true }, // "{causaId}:{sourceId}"
        rol: { type: String, enum: ROLES, required: true },
        fecha: { type: Date },
        // Denormalizados del movimiento (igual que en vinculos[]): la MCP muestra
        // la cadena sin leer cada movimiento.
        tipoMovimiento: { type: String },
        detalle: { type: String, maxlength: 120 },
        metodo: { type: String },    // cómo se asignó el evento: detalle | texto | deo_numero | vinculo
        confianza: { type: Number },
    },
    { _id: false }
);

const schema = new mongoose.Schema(
    {
        _id: { type: String },

        causaId: { type: mongoose.Schema.Types.ObjectId, required: true, index: true },
        causaType: { type: String },
        fuero: { type: String },
        source: { type: String }, // scrapingSource del movimiento de inicio (resolver el modelo/origen)

        clase: { type: String, enum: CLASES, required: true },
        // Destinatario normalizado (informativa: "BANCO NACION", "ARCA") o especialidad
        // (pericial: "contador", "medico"); testimonial/confesional: nombre del testigo o parte si se conoce.
        clave: { type: String, required: true },
        // Primer movimiento de la cadena: desambigua dos oficios al mismo destinatario.
        inicioMovementId: { type: String, required: true },

        titulo: { type: String, required: true }, // "Oficio a BANCO NACION (informativa)", "Pericia contable"
        estado: { type: String, enum: ESTADOS, required: true, index: true },

        eventos: { type: [eventoSchema], default: [] },
        fechaInicio: { type: Date },
        fechaUltimoEvento: { type: Date },
        ultimoEvento: { type: String, enum: ROLES },
        // Días desde el último pedido/libramiento sin respuesta, al momento del cálculo
        // (la MCP lo recalcula al leer: queda viejo entre recálculos).
        diasSinRespuesta: { type: Number },

        confianza: { type: Number }, // mínima de los eventos que definen el estado
        version: { type: String },   // 'pruebas-1'
    },
    {
        collection: "pjn-pruebas",
        timestamps: true,
        _id: false, // _id string determinístico, no ObjectId auto
    }
);

schema.index({ causaId: 1, clase: 1, clave: 1, inicioMovementId: 1 }, { unique: true });
schema.index({ causaId: 1, estado: 1 });
schema.index({ causaId: 1, clase: 1 });

const PjnPrueba = mongoose.models.PjnPrueba || mongoose.model("PjnPrueba", schema);
PjnPrueba.CLASES = CLASES;
PjnPrueba.ESTADOS = ESTADOS;
PjnPrueba.ROLES = ROLES;

module.exports = PjnPrueba;
