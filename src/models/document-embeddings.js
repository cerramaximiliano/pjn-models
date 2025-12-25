const mongoose = require("mongoose");

/**
 * Modelo para almacenar metadata de embeddings generados a partir de PDFs de movimientos
 * Los vectores se almacenan en Pinecone, este modelo mantiene la metadata y referencias
 */
const schema = new mongoose.Schema(
    {
        // ============================================
        // REFERENCIAS A LA CAUSA Y MOVIMIENTO
        // ============================================
        causaId: {
            type: mongoose.Schema.Types.ObjectId,
            required: true,
            index: true,
            ref: 'Causas'  // Referencia genérica, puede ser cualquier tipo de causa
        },
        causaType: {
            type: String,
            required: true,
            enum: ['CIV', 'COM', 'CNT', 'CSS', 'CPE', 'CNE', 'CSJ', 'CFP', 'CCF', 'CCC', 'CAF'],
            index: true
        },
        causaNumber: {
            type: Number,
            index: true
        },
        causaYear: {
            type: Number,
            index: true
        },

        // IDENTIFICACIÓN DEL MOVIMIENTO ESPECÍFICO
        movimientoIndex: {
            type: Number,
            required: true,
            comment: 'Índice del movimiento en el array de la causa'
        },
        movimientoFecha: {
            type: Date,
            index: true
        },
        movimientoTipo: {
            type: String
        },
        sourceUrl: {
            type: String,
            required: true,
            comment: 'URL del PDF original'
        },

        // ============================================
        // CONTENIDO EXTRAÍDO
        // ============================================
        fullText: {
            type: String,
            comment: 'Texto completo extraído del PDF (para regenerar embeddings si es necesario)'
        },

        // ============================================
        // CHUNKS (texto + referencias a Pinecone)
        // ============================================
        chunks: [{
            index: {
                type: Number,
                required: true
            },
            text: {
                type: String,
                required: true,
                comment: 'Texto del chunk'
            },
            pageNumber: {
                type: Number,
                comment: 'Número de página en el PDF'
            },
            tokenCount: {
                type: Number,
                comment: 'Cantidad de tokens en este chunk'
            },

            // ID único en Pinecone para este chunk
            pineconeId: {
                type: String,
                required: true,
                index: true,
                comment: 'ID del vector en Pinecone: {docEmbeddingId}_chunk_{index}'
            },

            // Metadata adicional del chunk
            startChar: { type: Number },
            endChar: { type: Number }
        }],

        // ============================================
        // METADATA DEL PDF
        // ============================================
        pdfMetadata: {
            fileName: { type: String },
            fileSize: {
                type: Number,
                comment: 'Tamaño del archivo en bytes'
            },
            totalPages: { type: Number },
            author: { type: String },
            title: { type: String },
            creationDate: { type: Date },
            pdfVersion: { type: String }
        },

        // ============================================
        // METADATA DEL PROCESAMIENTO
        // ============================================
        processingMetadata: {
            // Modelo de embeddings usado
            model: {
                type: String,
                required: true,
                comment: 'ej: text-embedding-3-small, text-embedding-ada-002, etc.'
            },

            vectorDimensions: {
                type: Number,
                required: true,
                comment: 'Dimensiones del vector (1536 para ada-002, 1024 para small, etc.)'
            },

            // Estrategia de chunking
            chunkingStrategy: {
                type: String,
                enum: ['fixed_size', 'semantic', 'sentence', 'paragraph'],
                default: 'fixed_size'
            },
            chunkSize: {
                type: Number,
                comment: 'Tamaño del chunk en tokens'
            },
            chunkOverlap: {
                type: Number,
                default: 0,
                comment: 'Overlap entre chunks en tokens'
            },

            // Estadísticas
            totalChunks: {
                type: Number,
                required: true
            },
            totalTokensUsed: {
                type: Number,
                comment: 'Total de tokens procesados (para cálculo de costos)'
            },
            processingTimeMs: {
                type: Number,
                comment: 'Tiempo de procesamiento en milisegundos'
            },
            processedAt: {
                type: Date,
                default: Date.now
            },

            // Worker que procesó
            workerId: { type: String },
            workerVersion: { type: String }
        },

        // ============================================
        // ESTADO Y SINCRONIZACIÓN
        // ============================================
        status: {
            type: String,
            enum: ['active', 'outdated', 'failed', 'deleted'],
            default: 'active',
            index: true,
            comment: 'active: vigente, outdated: hay versión más nueva, failed: falló el procesamiento'
        },

        pineconeStatus: {
            type: String,
            enum: ['synced', 'pending', 'failed', 'deleted'],
            default: 'pending',
            index: true,
            comment: 'Estado de sincronización con Pinecone'
        },

        pineconeNamespace: {
            type: String,
            comment: 'Namespace en Pinecone (si se usa organización por namespace)'
        },

        // ============================================
        // ERRORES Y DEBUGGING
        // ============================================
        error: {
            type: String,
            comment: 'Mensaje de error si el procesamiento falló'
        },
        errorCode: {
            type: String,
            comment: 'Código de error para categorización'
        },
        errorDetails: {
            type: Object,
            comment: 'Detalles adicionales del error'
        },

        attempts: {
            type: Number,
            default: 1,
            comment: 'Número de intentos de procesamiento'
        },

        lastAttemptAt: {
            type: Date
        },

        // ============================================
        // VERSIONING
        // ============================================
        version: {
            type: Number,
            default: 1,
            comment: 'Versión del embedding (para re-procesamiento)'
        },

        supersededBy: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'DocumentEmbedding',
            comment: 'ID del documento que reemplazó a este (si fue re-procesado)'
        }
    },
    {
        collection: "document-embeddings",
        timestamps: true,  // Agrega createdAt y updatedAt automáticamente
    }
);

// ============================================
// ÍNDICES
// ============================================

// Índice único: Una causa + movimiento solo puede tener un embedding activo
schema.index(
    { causaId: 1, movimientoIndex: 1, status: 1 },
    {
        unique: true,
        partialFilterExpression: { status: 'active' },
        name: 'unique_active_embedding_per_movement'
    }
);

// Índice para búsqueda por chunks de Pinecone
schema.index({ 'chunks.pineconeId': 1 });

// Índice compuesto para queries del worker
schema.index({
    causaType: 1,
    status: 1,
    pineconeStatus: 1
});

// Índice para búsqueda por causa
schema.index({
    causaNumber: 1,
    causaYear: 1,
    causaType: 1
});

// Índice para tracking de procesamiento
schema.index({
    'processingMetadata.processedAt': -1
});

// Índice para cleanup de documentos outdated
schema.index({
    status: 1,
    createdAt: 1
});

// ============================================
// MÉTODOS ESTÁTICOS
// ============================================

/**
 * Encuentra el embedding activo para un movimiento específico
 */
schema.statics.findActiveByMovement = async function(causaId, movimientoIndex) {
    return this.findOne({
        causaId,
        movimientoIndex,
        status: 'active'
    });
};

/**
 * Encuentra todos los embeddings activos de una causa
 */
schema.statics.findActiveByCausa = async function(causaId) {
    return this.find({
        causaId,
        status: 'active'
    }).sort({ movimientoIndex: 1 });
};

/**
 * Marca un embedding como outdated y crea referencia al nuevo
 */
schema.statics.markAsOutdated = async function(oldDocId, newDocId) {
    return this.findByIdAndUpdate(
        oldDocId,
        {
            status: 'outdated',
            supersededBy: newDocId
        },
        { new: true }
    );
};

/**
 * Encuentra embeddings pendientes de sincronización con Pinecone
 */
schema.statics.findPendingSync = async function(limit = 100) {
    return this.find({
        status: 'active',
        pineconeStatus: 'pending'
    })
    .limit(limit)
    .sort({ createdAt: 1 });
};

/**
 * Obtiene estadísticas de procesamiento
 */
schema.statics.getStats = async function() {
    const stats = await this.aggregate([
        {
            $group: {
                _id: '$status',
                count: { $sum: 1 },
                totalChunks: { $sum: '$processingMetadata.totalChunks' },
                totalTokens: { $sum: '$processingMetadata.totalTokensUsed' }
            }
        }
    ]);

    return stats;
};

// ============================================
// MÉTODOS DE INSTANCIA
// ============================================

/**
 * Genera el ID de Pinecone para un chunk específico
 */
schema.methods.getPineconeId = function(chunkIndex) {
    return `${this._id}_chunk_${chunkIndex}`;
};

/**
 * Verifica si todos los chunks están sincronizados en Pinecone
 */
schema.methods.isFullySynced = function() {
    return this.pineconeStatus === 'synced' && this.status === 'active';
};

/**
 * Obtiene metadata mínima para Pinecone
 */
schema.methods.getPineconeMetadata = function() {
    return {
        causaId: this.causaId.toString(),
        causaNumber: this.causaNumber,
        causaYear: this.causaYear,
        causaType: this.causaType,
        movimientoIndex: this.movimientoIndex,
        movimientoFecha: this.movimientoFecha?.toISOString(),
        movimientoTipo: this.movimientoTipo,
        mongoDocId: this._id.toString()
    };
};

// ============================================
// MIDDLEWARE
// ============================================

// Pre-save: Validar que chunks tengan pineconeId
schema.pre('save', function(next) {
    if (this.isModified('chunks')) {
        const missingIds = this.chunks.filter(chunk => !chunk.pineconeId);
        if (missingIds.length > 0) {
            // Auto-generar IDs si faltan
            this.chunks.forEach((chunk, index) => {
                if (!chunk.pineconeId) {
                    chunk.pineconeId = this.getPineconeId(chunk.index || index);
                }
            });
        }

        // Actualizar totalChunks
        if (this.processingMetadata) {
            this.processingMetadata.totalChunks = this.chunks.length;
        }
    }
    next();
});

module.exports = mongoose.model("DocumentEmbedding", schema);
