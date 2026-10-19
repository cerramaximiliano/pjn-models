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
 * Mismo código, dos bases (default mongoose connection en cada caso):
 *   - caché (rs0, laboratorio): cédulas de las causas de la caché.
 *   - usuarios (Atlas, producción): cédulas de las causas de los usuarios,
 *     con origen 'usuario' (app-update-worker / private-causas-update-worker).
 */
const schema = new mongoose.Schema(
    {
        // ── Identidad de la causa (denormalizado, estilo SentenciaCapturada) ──
        causaId: { type: mongoose.Schema.Types.ObjectId, required: true, index: true },
        number: { type: Number },
        year: { type: Number },
        fuero: { type: String, required: true },
        // Objeto del juicio (denormalizado de la causa) — las reglas de
        // normativa pueden discriminar plazo por objeto además de fuero.
        objeto: { type: String, default: null },
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

        // Base de origen de la cédula. Sin valor = caché (docs previos al campo).
        // En Atlas se filtra siempre por 'usuario' (la colección residual del
        // espejo apagado el 25/08 quedó renombrada, pero el filtro no depende de eso).
        origen: { type: String, enum: ["cache", "usuario"] },
        // Quién creó el registro: sin valor = movimientos (F1 / update-movimientos);
        // 'bandeja' = la bandeja de notificaciones del PJN (pjn-mis-causas).
        fuente: { type: String, enum: ["movimientos", "bandeja"] },
        // Datos de la bandeja de notificaciones del PJN (notif.pjn.gov.ar) cuando la
        // cédula llegó (también) por ahí: fecha exacta de la notificación y
        // destinatarios con CUIT, más qué usuarios/credenciales la recibieron.
        bandeja: {
            type: new mongoose.Schema(
                {
                    userIds: [mongoose.Schema.Types.ObjectId],
                    credentialsIds: [mongoose.Schema.Types.ObjectId],
                    notificationIds: [mongoose.Schema.Types.ObjectId],
                    numeroCedula: String,
                    fecha: Date,
                    destinatarios: [{ _id: false, cuit: String, nombre: String, tipo: String }],
                    reconciliadaAt: Date,
                },
                { _id: false }
            ),
            default: undefined,
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
                // Casos que requieren criterio humano (NO computables
                // automáticamente): cédula física digitalizada (fecha real
                // manuscrita al dorso — RETORNO CEDULA / PDF escaneado) o
                // plazo diferido (la carga de notificar es de la parte: el
                // plazo corre desde una notificación futura por cédula/oficio
                // que confecciona el notificado, no desde esta cédula).
                "revision_manual",
                // Cédula de la bandeja del PJN sin movimiento (documento) todavía:
                // el plazos-worker no la toma; pasa a pending cuando el
                // movimiento llega (plazos-bandeja.reconciliarConMovimiento).
                "esperando_documento",
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

        // Validación/populado a carpetas de usuarios (plazos-folders-worker):
        // marca que el vencimiento fue validado y sincronizado a las carpetas
        // de las cuentas habilitadas (en Atlas, vía el endpoint interno del hub).
        validacion: {
            // rechazada = el hub devolvió 400 (payload inválido): no se reintenta.
            estado: { type: String, enum: [null, "validada", "sin_carpeta", "rechazada"], default: null, index: true },
            syncedAt: { type: Date, default: null },
            folders: { type: [{ folderId: mongoose.Schema.Types.ObjectId, userId: mongoose.Schema.Types.ObjectId }], default: undefined },
            // Respuesta del hub por carpeta (source 'atlas'): [{folderId, userId,
            // accion, eventId, notificationId}] — ver contrato de plazos.
            resultados: { type: mongoose.Schema.Types.Mixed, default: undefined },
            error: { type: String, default: undefined },
        },

        // ── Trazabilidad ──────────────────────────────────────────────────────
        detectedAt: { type: Date, default: Date.now },
        source: {
            worker: { type: String },
            collectionName: { type: String },
            collectedAt: { type: Date },
            // Detectada en la 1.ª población de una causa recién agregada (P17):
            // la entrega exige vencimiento > hoy.
            primeraSync: { type: Boolean, default: undefined },
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
// Cola del plazos-worker-usuarios (PLAZOS_TARGET=usuarios): filtra por origen.
schema.index(
    { origen: 1, processingStatus: 1, detectedAt: 1 },
    { partialFilterExpression: { origen: "usuario" } }
);

module.exports = mongoose.models.PlazoNotificacion || mongoose.model("PlazoNotificacion", schema);
