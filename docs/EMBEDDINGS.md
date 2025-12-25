# 🔍 Infraestructura de Embeddings para Búsqueda Vectorial

Esta documentación describe la infraestructura de embeddings implementada en los modelos de causas para procesar documentos PDF y realizar búsquedas vectoriales.

## 📋 Tabla de Contenidos

- [Visión General](#-visión-general)
- [Arquitectura](#-arquitectura)
- [Modelo DocumentEmbedding](#-modelo-documentembedding)
- [Modelos de Causas Actualizados](#-modelos-de-causas-actualizados)
- [Flujo de Procesamiento](#-flujo-de-procesamiento)
- [Ejemplos de Uso](#-ejemplos-de-uso)
- [Consideraciones de Escalabilidad](#-consideraciones-de-escalabilidad)

---

## 🎯 Visión General

La infraestructura permite:

- ✅ Procesar PDFs desde URLs en movimientos de causas
- ✅ Generar embeddings vectoriales para búsqueda semántica
- ✅ Almacenar metadata en MongoDB y vectores en Pinecone
- ✅ Tracking completo del estado de procesamiento
- ✅ Manejo de errores y reintentos

### Escala del Sistema

- **300,000+ causas** válidas
- **~2-3 millones** de movimientos con PDFs
- **~50-150 millones** de vectores potenciales

---

## 🏗️ Arquitectura

### MongoDB + Pinecone (Arquitectura Híbrida)

```
┌─────────────────────────────────────────────────────────────┐
│                         CAUSAS                               │
│  ┌──────────────────────────────────────────────────┐       │
│  │ movimiento: [{                                   │       │
│  │   url: "http://...",                            │       │
│  │   embeddingDocId: ObjectId,                     │       │
│  │   embeddingStatus: "completed"                  │       │
│  │ }]                                               │       │
│  │                                                  │       │
│  │ embeddingsProcessing: {                         │       │
│  │   total: 50,                                    │       │
│  │   eligible: 30,                                 │       │
│  │   processed: 25                                 │       │
│  │ }                                                │       │
│  └──────────────────────────────────────────────────┘       │
└─────────────────────────────────────────────────────────────┘
                            │
                            │ referencia
                            ▼
┌─────────────────────────────────────────────────────────────┐
│                  DOCUMENT EMBEDDINGS (MongoDB)               │
│  ┌──────────────────────────────────────────────────┐       │
│  │ causaId: ObjectId                                │       │
│  │ movimientoIndex: 5                               │       │
│  │ fullText: "texto completo del PDF..."           │       │
│  │                                                  │       │
│  │ chunks: [{                                       │       │
│  │   text: "chunk de texto...",                    │       │
│  │   pineconeId: "67a1b2c3_chunk_0"               │       │
│  │ }]                                               │       │
│  │                                                  │       │
│  │ processingMetadata: {                           │       │
│  │   model: "text-embedding-3-small",             │       │
│  │   totalChunks: 20,                              │       │
│  │   totalTokensUsed: 5000                         │       │
│  │ }                                                │       │
│  └──────────────────────────────────────────────────┘       │
└─────────────────────────────────────────────────────────────┘
                            │
                            │ sincroniza vectores
                            ▼
┌─────────────────────────────────────────────────────────────┐
│                      PINECONE (Vector DB)                    │
│  ┌──────────────────────────────────────────────────┐       │
│  │ id: "67a1b2c3_chunk_0"                          │       │
│  │ values: [0.123, -0.456, 0.789, ...]            │       │
│  │                                                  │       │
│  │ metadata: {                                      │       │
│  │   causaId: "67a1b2c3",                          │       │
│  │   causaType: "CIV",                             │       │
│  │   movimientoIndex: 5,                           │       │
│  │   mongoDocId: "67a1b2c3"                        │       │
│  │ }                                                │       │
│  └──────────────────────────────────────────────────┘       │
└─────────────────────────────────────────────────────────────┘
```

### División de Responsabilidades

| Sistema    | Almacena                          | Propósito                    |
|------------|-----------------------------------|------------------------------|
| **MongoDB**| Metadata + Texto + Referencias    | Source of truth              |
| **Pinecone**| Vectores + Metadata mínima       | Búsqueda vectorial rápida    |

---

## 📦 Modelo DocumentEmbedding

### Ubicación
`src/models/document-embeddings.js`

### Schema Principal

```javascript
{
  // Referencias
  causaId: ObjectId,              // Ref a la causa
  causaType: String,              // 'CIV', 'COM', 'CNT', etc.
  causaNumber: Number,
  causaYear: Number,

  // Movimiento específico
  movimientoIndex: Number,        // Índice en el array
  movimientoFecha: Date,
  movimientoTipo: String,
  sourceUrl: String,              // URL del PDF original

  // Contenido
  fullText: String,               // Texto completo del PDF

  chunks: [{
    index: Number,
    text: String,
    pineconeId: String,           // ID en Pinecone
    pageNumber: Number,
    tokenCount: Number,
    startChar: Number,
    endChar: Number
  }],

  // Metadata del PDF
  pdfMetadata: {
    fileName: String,
    fileSize: Number,             // bytes
    totalPages: Number,
    author: String,
    title: String
  },

  // Metadata del procesamiento
  processingMetadata: {
    model: String,                // 'text-embedding-3-small', etc.
    vectorDimensions: Number,     // 1536, 1024, etc.
    chunkingStrategy: String,     // 'fixed_size', 'semantic'
    chunkSize: Number,
    totalChunks: Number,
    totalTokensUsed: Number,
    processingTimeMs: Number
  },

  // Estado
  status: String,                 // 'active', 'outdated', 'failed'
  pineconeStatus: String,         // 'synced', 'pending', 'failed'

  // Errores
  error: String,
  errorCode: String,
  attempts: Number
}
```

### Índices

```javascript
// Único: un embedding activo por movimiento
{ causaId: 1, movimientoIndex: 1, status: 1 }

// Búsqueda por Pinecone IDs
{ 'chunks.pineconeId': 1 }

// Queries del worker
{ causaType: 1, status: 1, pineconeStatus: 1 }

// Por causa
{ causaNumber: 1, causaYear: 1, causaType: 1 }
```

### Métodos Estáticos

#### `findActiveByMovement(causaId, movimientoIndex)`
Encuentra el embedding activo de un movimiento específico.

```javascript
const embedding = await DocumentEmbedding.findActiveByMovement(
  '507f1f77bcf86cd799439011',
  5
);
```

#### `findActiveByCausa(causaId)`
Obtiene todos los embeddings activos de una causa.

```javascript
const embeddings = await DocumentEmbedding.findActiveByCausa(
  '507f1f77bcf86cd799439011'
);
// Retorna array ordenado por movimientoIndex
```

#### `findPendingSync(limit)`
Encuentra embeddings pendientes de sincronización con Pinecone.

```javascript
const pending = await DocumentEmbedding.findPendingSync(100);
// Retorna hasta 100 documentos con pineconeStatus: 'pending'
```

#### `getStats()`
Obtiene estadísticas agregadas de procesamiento.

```javascript
const stats = await DocumentEmbedding.getStats();
/*
[
  { _id: 'active', count: 15000, totalChunks: 300000, totalTokens: 5000000 },
  { _id: 'failed', count: 50, totalChunks: 0, totalTokens: 0 }
]
*/
```

### Métodos de Instancia

#### `getPineconeId(chunkIndex)`
Genera el ID para Pinecone de un chunk específico.

```javascript
const doc = await DocumentEmbedding.findById('...');
const pineconeId = doc.getPineconeId(0);
// "507f1f77bcf86cd799439011_chunk_0"
```

#### `getPineconeMetadata()`
Obtiene metadata mínima para almacenar en Pinecone.

```javascript
const metadata = doc.getPineconeMetadata();
/*
{
  causaId: "507f1f77bcf86cd799439011",
  causaNumber: 12345,
  causaYear: 2024,
  causaType: "CIV",
  movimientoIndex: 5,
  movimientoFecha: "2024-03-15T00:00:00.000Z",
  movimientoTipo: "Sentencia",
  mongoDocId: "507f1f77bcf86cd799439011"
}
*/
```

#### `isFullySynced()`
Verifica si el documento está completamente sincronizado.

```javascript
if (doc.isFullySynced()) {
  console.log('Listo para búsquedas');
}
```

---

## 🔄 Modelos de Causas Actualizados

### Modelos Modificados (11 total)

- `causas-civil.js` (CIV)
- `causas-comercial.js` (COM)
- `causas-trabajo.js` (CNT)
- `causas-ss.js` (CSS)
- `causas-cpe.js` (CPE)
- `causas-cne.js` (CNE)
- `causas-csj.js` (CSJ)
- `causas-cfp.js` (CFP)
- `causas-ccf.js` (CCF)
- `causas-ccc.js` (CCC)
- `causas-caf.js` (CAF)

### Cambios en el Array `movimiento`

**Antes:**
```javascript
movimiento: { type: Array }
```

**Después:**
```javascript
movimiento: [{
  // Campos existentes
  fecha: { type: Date },
  tipo: { type: String },
  url: { type: String },
  detalle: { type: String },

  // NUEVOS: Tracking de embeddings
  embeddingDocId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'DocumentEmbedding'
  },
  embeddingStatus: {
    type: String,
    enum: ['pending', 'completed', 'failed', 'skipped', 'no_url'],
    default: 'pending'
  },
  embeddingProcessedAt: { type: Date }
}]
```

### Campo de Resumen `embeddingsProcessing`

**Nuevo campo a nivel de documento:**

```javascript
embeddingsProcessing: {
  // Contadores
  total: Number,              // Total de movimientos
  eligible: Number,           // Con URL válida
  processed: Number,          // Ya procesados
  failed: Number,             // Fallidos

  // Estados
  hasEligible: Boolean,       // Tiene movimientos elegibles
  allProcessed: Boolean,      // Todos procesados

  // Timestamps
  lastProcessedAt: Date,      // Última vez procesado
  lastScanAt: Date           // Último escaneo de elegibilidad
}
```

### Overhead de Tamaño

Para un documento con **200 movimientos**:

- Campos de tracking por movimiento: **~50 bytes**
- Campo de resumen: **~100 bytes**
- **Total adicional: ~10 KB** (perfectamente manejable)

---

## 🔄 Flujo de Procesamiento

### 1. Escaneo de Elegibilidad

```javascript
const { CausasCivil } = require('pjn-models');

// Encontrar causas con movimientos no procesados
const causas = await CausasCivil.find({
  'movimiento.url': { $exists: true, $ne: null },
  'movimiento.embeddingStatus': 'pending'
}).limit(100);

for (const causa of causas) {
  // Contar movimientos elegibles
  const eligible = causa.movimiento.filter(m => m.url && m.url.trim());

  // Actualizar contadores
  causa.embeddingsProcessing.eligible = eligible.length;
  causa.embeddingsProcessing.lastScanAt = new Date();
  causa.embeddingsProcessing.hasEligible = eligible.length > 0;

  await causa.save();
}
```

### 2. Procesamiento de PDFs

```javascript
const { DocumentEmbedding } = require('pjn-models');

async function procesarMovimiento(causa, movimientoIndex) {
  const movimiento = causa.movimiento[movimientoIndex];

  try {
    // 1. Descargar y extraer texto del PDF
    const pdfText = await descargarYExtraerPDF(movimiento.url);

    // 2. Dividir en chunks
    const chunks = dividirEnChunks(pdfText, {
      chunkSize: 512,
      overlap: 50
    });

    // 3. Generar embeddings (OpenAI, Cohere, etc.)
    const embeddings = await generarEmbeddings(chunks);

    // 4. Crear documento en MongoDB
    const docEmbedding = await DocumentEmbedding.create({
      causaId: causa._id,
      causaType: causa.fuero,
      causaNumber: causa.number,
      causaYear: causa.year,
      movimientoIndex: movimientoIndex,
      movimientoFecha: movimiento.fecha,
      movimientoTipo: movimiento.tipo,
      sourceUrl: movimiento.url,
      fullText: pdfText,
      chunks: chunks.map((chunk, i) => ({
        index: i,
        text: chunk.text,
        pineconeId: `${docEmbedding._id}_chunk_${i}`,
        pageNumber: chunk.page,
        tokenCount: chunk.tokens
      })),
      processingMetadata: {
        model: 'text-embedding-3-small',
        vectorDimensions: 1536,
        chunkingStrategy: 'fixed_size',
        chunkSize: 512,
        totalChunks: chunks.length,
        totalTokensUsed: chunks.reduce((sum, c) => sum + c.tokens, 0),
        processingTimeMs: Date.now() - startTime
      },
      status: 'active'
    });

    // 5. Upsert en Pinecone
    await pinecone.upsert({
      vectors: embeddings.map((emb, i) => ({
        id: docEmbedding.chunks[i].pineconeId,
        values: emb.vector,
        metadata: {
          ...docEmbedding.getPineconeMetadata(),
          chunkIndex: i,
          pageNumber: chunks[i].page
        }
      }))
    });

    // 6. Actualizar estado en Pinecone
    docEmbedding.pineconeStatus = 'synced';
    await docEmbedding.save();

    // 7. Actualizar movimiento en causa
    movimiento.embeddingDocId = docEmbedding._id;
    movimiento.embeddingStatus = 'completed';
    movimiento.embeddingProcessedAt = new Date();

    // 8. Actualizar contadores
    causa.embeddingsProcessing.processed++;
    causa.embeddingsProcessing.lastProcessedAt = new Date();
    causa.embeddingsProcessing.allProcessed =
      causa.embeddingsProcessing.processed >= causa.embeddingsProcessing.eligible;

    await causa.save();

    console.log(`✅ Procesado movimiento ${movimientoIndex} de causa ${causa.number}`);

  } catch (error) {
    // Manejo de errores
    movimiento.embeddingStatus = 'failed';
    causa.embeddingsProcessing.failed++;
    await causa.save();

    console.error(`❌ Error procesando movimiento:`, error);
  }
}
```

### 3. Búsqueda Vectorial

```javascript
async function buscarSimilares(queryText, filtros = {}) {
  // 1. Generar embedding de la query
  const queryEmbedding = await generarEmbedding(queryText);

  // 2. Buscar en Pinecone
  const results = await pinecone.query({
    vector: queryEmbedding,
    topK: 20,
    filter: {
      causaType: { $eq: filtros.fuero || 'CIV' },
      causaYear: { $gte: filtros.yearDesde || 2020 }
    },
    includeMetadata: true
  });

  // 3. Obtener documentos completos de MongoDB
  const mongoDocIds = [...new Set(
    results.matches.map(m => m.metadata.mongoDocId)
  )];

  const documentos = await DocumentEmbedding.find({
    _id: { $in: mongoDocIds }
  }).populate('causaId');

  // 4. Combinar resultados
  const resultadosEnriquecidos = results.matches.map(match => {
    const doc = documentos.find(d => d._id.toString() === match.metadata.mongoDocId);
    return {
      score: match.score,
      chunk: doc.chunks.find(c => c.pineconeId === match.id),
      documento: doc,
      causa: doc.causaId
    };
  });

  return resultadosEnriquecidos;
}

// Uso
const resultados = await buscarSimilares(
  'sentencia sobre daños y perjuicios',
  { fuero: 'CIV', yearDesde: 2023 }
);

resultados.forEach(r => {
  console.log(`Score: ${r.score}`);
  console.log(`Causa: ${r.causa.caratula}`);
  console.log(`Texto: ${r.chunk.text.substring(0, 200)}...`);
  console.log('---');
});
```

---

## 📊 Ejemplos de Uso

### Ejemplo 1: Verificar Estado de Procesamiento

```javascript
const { CausasCivil } = require('pjn-models');

async function verificarEstado() {
  const causa = await CausasCivil.findOne({ number: 12345, year: 2024 });

  console.log('Estado de embeddings:');
  console.log(`Total movimientos: ${causa.embeddingsProcessing.total}`);
  console.log(`Elegibles: ${causa.embeddingsProcessing.eligible}`);
  console.log(`Procesados: ${causa.embeddingsProcessing.processed}`);
  console.log(`Fallidos: ${causa.embeddingsProcessing.failed}`);
  console.log(`Completado: ${causa.embeddingsProcessing.allProcessed ? 'Sí' : 'No'}`);

  // Ver movimientos específicos
  causa.movimiento.forEach((mov, i) => {
    console.log(`Movimiento ${i}:`);
    console.log(`  URL: ${mov.url ? 'Sí' : 'No'}`);
    console.log(`  Estado: ${mov.embeddingStatus}`);
    console.log(`  Procesado: ${mov.embeddingProcessedAt || 'Pendiente'}`);
  });
}
```

### Ejemplo 2: Obtener Embeddings de una Causa

```javascript
const { DocumentEmbedding } = require('pjn-models');

async function obtenerEmbeddingsCausa(causaId) {
  const embeddings = await DocumentEmbedding.findActiveByCausa(causaId);

  console.log(`Total embeddings: ${embeddings.length}`);

  embeddings.forEach(emb => {
    console.log(`\nMovimiento ${emb.movimientoIndex}:`);
    console.log(`  URL: ${emb.sourceUrl}`);
    console.log(`  Chunks: ${emb.chunks.length}`);
    console.log(`  Tokens usados: ${emb.processingMetadata.totalTokensUsed}`);
    console.log(`  Modelo: ${emb.processingMetadata.model}`);
    console.log(`  Estado Pinecone: ${emb.pineconeStatus}`);
  });
}
```

### Ejemplo 3: Regenerar Embeddings (Nueva Versión)

```javascript
async function regenerarEmbedding(causaId, movimientoIndex) {
  // 1. Marcar el anterior como outdated
  const oldDoc = await DocumentEmbedding.findActiveByMovement(causaId, movimientoIndex);

  if (oldDoc) {
    // 2. Procesar nuevo embedding
    const newDoc = await procesarMovimiento(causa, movimientoIndex);

    // 3. Marcar el anterior como outdated
    await DocumentEmbedding.markAsOutdated(oldDoc._id, newDoc._id);

    console.log(`✅ Embedding regenerado. Versión anterior: ${oldDoc._id}`);
  }
}
```

### Ejemplo 4: Estadísticas Globales

```javascript
const { DocumentEmbedding, CausasCivil } = require('pjn-models');

async function estadisticasGlobales() {
  // Stats de embeddings
  const embeddingStats = await DocumentEmbedding.getStats();
  console.log('Estadísticas de Embeddings:', embeddingStats);

  // Stats de causas
  const totalCausas = await CausasCivil.countDocuments();
  const conEmbeddings = await CausasCivil.countDocuments({
    'embeddingsProcessing.processed': { $gt: 0 }
  });
  const completadas = await CausasCivil.countDocuments({
    'embeddingsProcessing.allProcessed': true
  });

  console.log(`\nCausas Civiles:`);
  console.log(`  Total: ${totalCausas}`);
  console.log(`  Con embeddings: ${conEmbeddings}`);
  console.log(`  Completadas: ${completadas}`);
  console.log(`  Progreso: ${(completadas / totalCausas * 100).toFixed(2)}%`);
}
```

---

## 🚀 Consideraciones de Escalabilidad

### Límites de MongoDB

- ✅ **Tamaño máximo de documento:** 16 MB
- ✅ **Overhead por movimiento:** ~50 bytes
- ✅ **Causa con 200 movimientos:** ~10 KB adicionales
- ✅ **Sin riesgo** de exceder límites

### Performance

#### Queries Optimizadas

```javascript
// ✅ BIEN: Usa índices
const causas = await CausasCivil.find({
  'embeddingsProcessing.allProcessed': false,
  'embeddingsProcessing.hasEligible': true
});

// ❌ MAL: Sin índices
const causas = await CausasCivil.find({
  'movimiento.url': { $exists: true }
});
```

#### Procesamiento en Lotes

```javascript
async function procesarEnLotes(batchSize = 10) {
  let offset = 0;
  let processed = 0;

  while (true) {
    const causas = await CausasCivil.find({
      'embeddingsProcessing.allProcessed': false
    })
    .skip(offset)
    .limit(batchSize);

    if (causas.length === 0) break;

    // Procesar en paralelo (con límite)
    await Promise.all(
      causas.map(causa => procesarCausa(causa))
    );

    processed += causas.length;
    offset += batchSize;

    console.log(`Procesadas ${processed} causas...`);
  }
}
```

### Costos Estimados (Pinecone)

Con **50-150M vectores**:

**Serverless:**
- ~$0.1 por 1M lecturas vectoriales
- 50M vectores: $70-150/mes
- 150M vectores: $200-400/mes

**Pod-based:**
- p1 pods: ~$70/pod/mes
- 2-4 pods necesarios: $140-280/mes

### Recomendaciones

1. **Worker dedicado:** Procesar embeddings en un worker separado
2. **Rate limiting:** Respetar límites de APIs (OpenAI, Pinecone)
3. **Retry logic:** Implementar reintentos con exponential backoff
4. **Monitoring:** Trackear progreso y errores
5. **Cleanup:** Limpiar embeddings `outdated` periódicamente

---

## 📝 Notas Finales

### Worker Externo

Este repositorio solo contiene **modelos**. El procesamiento de embeddings debe implementarse en un **worker separado** que:

1. Use estos modelos
2. Maneje descarga de PDFs
3. Genere embeddings (OpenAI, Cohere, etc.)
4. Sincronice con Pinecone
5. Actualice estados en MongoDB

### Migración de Datos Existentes

Para causas existentes sin los nuevos campos:

```javascript
// Los campos tienen defaults, no requiere migración
// Al guardar documentos existentes, se agregarán automáticamente

const causa = await CausasCivil.findById('...');
// embeddingsProcessing tendrá valores default
await causa.save(); // Persiste los defaults
```

---

## 📚 Referencias

- [Pinecone Documentation](https://docs.pinecone.io/)
- [OpenAI Embeddings](https://platform.openai.com/docs/guides/embeddings)
- [Mongoose Schema](https://mongoosejs.com/docs/guide.html)

---

**Última actualización:** Diciembre 2025
**Versión:** 1.0.0
