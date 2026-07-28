const mongoose = require("mongoose");

/**
 * PlazoNotificacion — notificaciones (cédulas) detectadas en movimientos
 * nuevos, cola de entrada del subsistema de plazos procesales.
 *
 * Capa 1 del pipeline: el update-movimientos-worker (pjn-workers-scraping)
 * detecta movimientos nuevos cuyo `tipo` contiene CEDULA y los persiste acá
 * con processingStatus 'pending' — idempotente por (causaId, sourceId), donde
 * sourceId es el id determinístico de movement-id.js (compatible con
 * PjnMovement/RagDocument).
 *
 * Solo movimientos NUEVOS (novedades): las cédulas históricas de causas
 * recién scrapeadas tienen plazos ya vencidos y no se capturan.
 *
 * Consumidores (capas siguientes):
 *   - Capa 2 (worker de lectura): descarga el PDF de la cédula, extrae texto
 *     (pdf-parse/OCR) y el plazo expreso si lo hay → campos `extraccion`.
 *   - Capa 3/4 (normativa + cómputo): resuelve el plazo aplicable (texto o
 *     norma subsidiaria) y computa el vencimiento con dias-habiles.js →
 *     campos `plazo`.
 *
 * Vive en la base LOCAL de worker_01 (default mongoose connection, igual que
 * las causas y que previsional-liquidacion-urls).
 */
const schema = new mongoose.Schema(
    {
        // ── Identidad de la causa (denormalizado, estilo SentenciaCapturada) ──
        causaId: { type: mongoose.Schema.Types.ObjectId, required: true, index: true },
        number: { type: Number },
        year: { type: Number },
        fuero: { type: String, required: true },
        caratula: { type: String },
        collection: { type: String }, // nombre de la colección de causas origen

        // ── Identidad del movimiento ──────────────────────────────────────────
        // sourceId determinístico (movement-id.js) — clave de dedup aun sin URL.
        sourceId: { type: String, required: true },
        movimiento: {
            fecha: { type: Date },
            tipo: { type: String },
            detalle: { type: String },
            url: { type: String, default: null },
        },

        // Subtipo derivado del `tipo` del movimiento.
        tipoNotificacion: {
            type: String,
            enum: [
                "cedula", // CEDULA
                "cedula_parte", // CEDULA ELECTRONICA PARTE
                "cedula_tribunal", // CEDULA ELECTRONICA TRIBUNAL
                "cedula_incorporada", // CEDULA INCORPORADA
                "retorno_cedula", // RETORNO CEDULA (acuse/devolución)
                "otro",
            ],
            default: "otro",
            index: true,
        },

        // ── Estado del pipeline ───────────────────────────────────────────────
        processingStatus: {
            type: String,
            enum: [
                "pending", // detectada, a la espera del worker de lectura
                "no_url", // sin URL de documento — solo cómputo por normativa
                "processing", // lockeada por un worker (ver processingLock)
                "downloading",
                "parsed", // texto extraído, sin plazo expreso todavía
                "extracted", // plazo expreso extraído, cómputo pendiente
                "ocr_needed",
                "ocr_processing",
                "failed",
                "not_pdf",
                "computed", // vencimiento calculado (capa 4)
            ],
            default: "pending",
            index: true,
        },
        retryCount: { type: Number, default: 0 },
        lastError: { type: String, default: null },
        processedAt: { type: Date, default: null },

        // Lock atómico del worker de lectura (patrón sentencias-worker).
        processingLock: {
            workerId: { type: String },
            lockedAt: { type: Date },
            expiresAt: { type: Date },
        },

        // Resultado de la lectura del documento (capa 2 — la puebla el worker
        // de lectura; Mixed a propósito hasta estabilizar el shape).
        extraccion: { type: mongoose.Schema.Types.Mixed, default: null },
        // Resultado del cómputo (capa 4): plazo aplicado, fuente (texto|norma),
        // vencimiento, diasComputados, version de dias-habiles.
        plazo: { type: mongoose.Schema.Types.Mixed, default: null },

        // ── Trazabilidad ──────────────────────────────────────────────────────
        detectedAt: { type: Date, default: Date.now },
        source: {
            worker: { type: String },
            collectionName: { type: String },
            collectedAt: { type: Date },
        },
    },
    {
        collection: "plazos-notificaciones",
        timestamps: true,
        versionKey: false,
    }
);

// Dedup: un doc por movimiento-cédula por causa.
schema.index({ causaId: 1, sourceId: 1 }, { unique: true });
// Cola de consumo de la capa 2.
schema.index({ processingStatus: 1, detectedAt: 1 });
schema.index({ fuero: 1, detectedAt: -1 });

module.exports = mongoose.models.PlazoNotificacion || mongoose.model("PlazoNotificacion", schema);
