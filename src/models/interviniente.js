const mongoose = require("mongoose");

/**
 * Modelo para almacenar intervinientes (partes y letrados) de expedientes
 * Cada documento representa un contacto individual vinculado a una causa
 */
const schema = new mongoose.Schema(
    {
        // Referencia a la causa
        causaId: {
            type: mongoose.Schema.Types.ObjectId,
            required: true,
            index: true
        },

        // Información del expediente (desnormalizada para búsquedas)
        expediente: {
            number: { type: Number, required: true },
            year: { type: Number, required: true },
            fuero: { type: String, required: true },
            caratula: { type: String }
        },

        // Tipo de interviniente
        tipoInterviniente: {
            type: String,
            enum: ['PARTE', 'LETRADO'],
            required: true,
            index: true
        },

        // Datos de la parte (si tipoInterviniente = 'PARTE')
        parte: {
            tipo: { type: String },        // ACTOR, DEMANDADO, TERCERO, etc.
            nombre: { type: String },
            tomoFolio: { type: String },
            iej: { type: String },
            // Solo los trae la API del SCW nuevo (GET /intervinientes/{id}); null si la fuente es el SCW clásico.
            idScw: { type: Number },                 // id del interviniente en el SCW
            documento: { type: String },
            dni: { type: String },
            personaJuridica: { type: Boolean },
            identidadReservada: { type: Boolean }
        },

        // Datos del letrado (si tipoInterviniente = 'LETRADO')
        letrado: {
            tipo: { type: String },        // LETRADO APODERADO, LETRADO PATROCINANTE, etc.
            nombre: { type: String },
            matricula: { type: String },   // Tomo: X Folio: Y - COLEGIO
            estadoIej: { type: String },   // CONSTITUIDO, NO CONSTITUIDO
            iej: { type: String },         // Identificador Electrónico Judicial del letrado
            // Solo los trae la API del SCW nuevo; el CUIT viene aunque no haya domicilio electrónico constituido.
            idScw: { type: Number },
            cuitcuil: { type: String },
            domicilioElectronicoConstituido: { type: Boolean },
            principal: { type: Boolean },
            defensoria: { type: String },  // nombre del defensor/a en defensorías y asesorías (sin tomo/folio)
            federal: { type: Boolean },
            tomo: { type: String },
            folio: { type: String },
            parteRepresentada: {           // Referencia a la parte que representa (retrocompatibilidad)
                intervinienteId: { type: mongoose.Schema.Types.ObjectId, ref: 'Interviniente' },
                tipo: { type: String },
                nombre: { type: String }
            },
            // Array para soportar letrados que representan múltiples partes
            partesRepresentadas: [{
                intervinienteId: { type: mongoose.Schema.Types.ObjectId, ref: 'Interviniente' },
                tipo: { type: String },    // ACTOR, DEMANDADO, TERCERO
                nombre: { type: String }
            }]
        },

        // Nombre normalizado para búsquedas
        nombreNormalizado: {
            type: String,
            index: true
        },

        // Metadata
        fechaExtraccion: {
            type: Date,
            default: Date.now
        },
        source: {
            type: String,
            default: 'extra-info-worker'
        },
        // De dónde salió la lectura: 'scw-clasico' (HTML) o 'scw-api'. Sin valor = clásico (docs anteriores).
        origen: {
            type: String,
            enum: ['scw-clasico', 'scw-api']
        }
    },
    {
        collection: "intervinientes",
        timestamps: true
    }
);

// Índices compuestos para búsquedas eficientes
schema.index({ causaId: 1, tipoInterviniente: 1 });
schema.index({ 'expediente.number': 1, 'expediente.year': 1, 'expediente.fuero': 1 });
schema.index({ 'parte.nombre': 1 });
schema.index({ 'letrado.nombre': 1 });
schema.index({ 'letrado.iej': 1 });
schema.index({ 'letrado.cuitcuil': 1 });
schema.index({ 'letrado.parteRepresentada.intervinienteId': 1 });
schema.index({ 'letrado.partesRepresentadas.intervinienteId': 1 });
schema.index({ nombreNormalizado: 'text' });

// Pre-save hook para normalizar nombre
schema.pre('save', function(next) {
    if (this.tipoInterviniente === 'PARTE' && this.parte?.nombre) {
        this.nombreNormalizado = this.parte.nombre.toLowerCase().trim();
    } else if (this.tipoInterviniente === 'LETRADO' && this.letrado?.nombre) {
        this.nombreNormalizado = this.letrado.nombre.toLowerCase().trim();
    }
    next();
});

// Método estático para buscar intervinientes por causa
schema.statics.findByCausa = function(causaId) {
    return this.find({ causaId }).sort({ tipoInterviniente: 1, 'parte.tipo': 1 });
};

// Método estático para buscar por nombre
schema.statics.findByNombre = function(nombre) {
    const nombreNorm = nombre.toLowerCase().trim();
    return this.find({
        $or: [
            { 'parte.nombre': { $regex: nombre, $options: 'i' } },
            { 'letrado.nombre': { $regex: nombre, $options: 'i' } },
            { nombreNormalizado: { $regex: nombreNorm } }
        ]
    });
};

module.exports = mongoose.models.Interviniente || mongoose.model("Interviniente", schema);