const mongoose = require("mongoose");

/**
 * Prioridad de la causa para las colas de trabajo (app-update, pdf-backfill,
 * extractores RAG, OCR). Inyectada en causas-civil / causas-comercial /
 * causas-ss / causas-trabajo vía schema.add(require('../shared/prioridad-fields')).
 *
 * La calcula y escribe el HUB (law-analytics-server services/causaPriorityService.js:
 * cron horario + al vincular/archivar carpetas), porque es quien conoce carpetas,
 * usuarios, planes y add-ons. Los workers NO la calculan: ordenan por
 * `prioridad.score` (índice {prioridad.score:-1, lastUpdate:1}) y leen `nivel`.
 * Diseño: la-infra-docs/arquitectura/propuesta-cobertura-textos-y-prioridades.md §3.
 *
 * `manual` (0–100, fijado desde el admin) pisa a `score` mientras exista: el campo
 * efectivo para ordenar es `score`, que el hub ya guarda igual a `manual` cuando hay
 * override; `automatico` conserva el valor calculado.
 */
module.exports = {
    prioridad: {
        type: new mongoose.Schema(
            {
                // Puntaje efectivo 0–100 (= manual si hay override, si no = automatico).
                score: { type: Number, min: 0, max: 100 },
                // Puntaje calculado, sin override.
                automatico: { type: Number, min: 0, max: 100 },
                nivel: { type: String, enum: ["alta", "media", "baja", "archivo"] },
                // Qué sumó: 'carpeta_viva', 'plan_premium', 'addon_mcp', 'cuenta_prueba', 'usuarios_2', 'mov_7d', 'cola_12d'…
                motivos: { type: [String], default: undefined },
                // Desglose por componente { carpetas, plan, addon, prueba, usuarios, actividad, cola }.
                componentes: { type: mongoose.Schema.Types.Mixed },
                // Override desde el admin (null = sin override).
                manual: { type: Number, min: 0, max: 100, default: null },
                manualPor: { type: String },
                manualEn: { type: Date },
                manualNota: { type: String },
                computedAt: { type: Date },
                // Versión de la fórmula (para recalcular todo cuando cambie).
                version: { type: String },
            },
            { _id: false }
        ),
        default: undefined,
    },
};
