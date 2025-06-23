const mongoose = require("mongoose");


const schema = new mongoose.Schema(
    {
        date: { type: Date, default: new Date() },
        year: { type: Number },
        number: { type: Number },
        caratula: { type: String },
        info: { type: String },
        fuero: { type: String, default: "Civil" },
        objeto: {
            type: String,
            set: function (value) {
                if (!value) return value;
                return value
                    .trim() // Eliminar espacios al inicio y final
                    .replace(/\s+/g, ' ') // Reemplazar múltiples espacios por uno solo
                    .replace(/[\.-]+$/, '') // Eliminar puntos y guiones al final
                    .replace(/\n/g, '') // Eliminar saltos de línea
                    .replace(/\s*\.\s*$/, ''); // Eliminar punto final y espacios alrededor
            }
        },
        juzgado: { type: Number },
        secretaria: { type: Number },
        movimiento: { type: Array },
        movimientosCount: {
            type: Number,
            default: 0
        },
        fechaUltimoMovimiento: { type: Date },
        lastUpdate: { type: Date, default: Date.now },
        max_number: { type: Number },
        balance: { type: Object },
        userCausaIds: [{ type: mongoose.Schema.Types.ObjectId, ref: 'UserCausa' }],
        folderIds: [{ type: mongoose.Schema.Types.ObjectId, ref: 'FolderId' }],
        source: {
            type: String,
            default: "scraping"
        },
        verified: {
            type: Boolean,
            default: false,
            index: true
        },
        isValid: {
            type: Boolean,
            default: null,
            index: true
        },
        update: {
            type: Boolean,
            default: false,
            index: true
        },
        userUpdatesEnabled: [{
            userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
            enabled: { type: Boolean, default: true }
        }],
        updateHistory: [{
            timestamp: { type: Date, required: true },
            source: { type: String, required: true },
            movimientosAdded: { type: Number, default: 0 },
            movimientosTotal: { type: Number, default: 0 },
            updateType: { type: String, enum: ['create', 'update', 'verify'], required: true },
            success: { type: Boolean, default: true },
            details: { type: Object }
        }]
    },
    {
        collection: "causas-civil",
        timestamps: true,
    }
);

schema.pre('save', function (next) {
    try {
        if (this.isModified('movimiento') && this.movimiento && this.movimiento.length > 0) {
            this.movimientosCount = this.movimiento.length;
            const fechas = this.movimiento
                .filter(mov => mov && mov.fecha)
                .map(mov => new Date(mov.fecha));

            if (fechas.length > 0) {
                this.fechaUltimoMovimiento = new Date(Math.max(...fechas));
            }
        }
        next();
    } catch (error) {
        next(error); // Propaga el error
    }
});

schema.pre(['updateOne', 'findOneAndUpdate'], async function (next) {
    const update = this.getUpdate();
    if (update.movimiento || update.$set?.movimiento) {
        const movimiento = update.movimiento || update.$set.movimiento;
        this.set({ movimientosCount: movimiento.length });
    }
    next();
});
module.exports = mongoose.model("Causas", schema);
