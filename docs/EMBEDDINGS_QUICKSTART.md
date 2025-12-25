# 🚀 Guía Rápida: Embeddings para Causas

Esta guía te muestra cómo empezar a usar la infraestructura de embeddings en 5 minutos.

## 📦 Instalación

```bash
npm install git+https://github.com/cerramaximiliano/pjn-models.git
```

## 🎯 Casos de Uso Comunes

### 1. Verificar qué causas tienen movimientos para procesar

```javascript
const { CausasCivil } = require('pjn-models');

async function causasPendientes() {
  const causas = await CausasCivil.find({
    'movimiento.url': { $exists: true, $ne: null },
    'movimiento.embeddingStatus': 'pending'
  })
  .limit(10)
  .select('number year caratula movimiento embeddingsProcessing');

  console.log(`${causas.length} causas con movimientos pendientes`);

  causas.forEach(causa => {
    const pendientes = causa.movimiento.filter(m =>
      m.url && m.embeddingStatus === 'pending'
    );

    console.log(`\nCausa ${causa.number}/${causa.year}:`);
    console.log(`  Carátula: ${causa.caratula}`);
    console.log(`  Movimientos pendientes: ${pendientes.length}`);
  });
}

causasPendientes();
```

**Salida:**
```
10 causas con movimientos pendientes

Causa 12345/2024:
  Carátula: GARCIA JUAN C/ PEREZ MARIA S/ DAÑOS Y PERJUICIOS
  Movimientos pendientes: 5

Causa 12346/2024:
  Carátula: LOPEZ CARLOS C/ ESTADO NACIONAL S/ AMPARO
  Movimientos pendientes: 8
```

---

### 2. Escanear y marcar movimientos elegibles

```javascript
const { CausasCivil } = require('pjn-models');

async function escanearElegibilidad() {
  const causas = await CausasCivil.find({
    'embeddingsProcessing.lastScanAt': { $exists: false }
  }).limit(100);

  for (const causa of causas) {
    // Contar movimientos con URL
    const conUrl = causa.movimiento.filter(m => m.url && m.url.trim()).length;

    // Actualizar contadores
    causa.embeddingsProcessing.total = causa.movimiento.length;
    causa.embeddingsProcessing.eligible = conUrl;
    causa.embeddingsProcessing.hasEligible = conUrl > 0;
    causa.embeddingsProcessing.lastScanAt = new Date();

    await causa.save();
  }

  console.log(`✅ Escaneadas ${causas.length} causas`);
}

escanearElegibilidad();
```

---

### 3. Crear un DocumentEmbedding (simplificado)

```javascript
const { DocumentEmbedding, CausasCivil } = require('pjn-models');

async function crearEmbedding(causaId, movimientoIndex, chunks, embeddings) {
  const causa = await CausasCivil.findById(causaId);
  const movimiento = causa.movimiento[movimientoIndex];

  // Crear documento de embedding
  const docEmbed = await DocumentEmbedding.create({
    causaId: causa._id,
    causaType: causa.fuero,
    causaNumber: causa.number,
    causaYear: causa.year,

    movimientoIndex: movimientoIndex,
    movimientoFecha: movimiento.fecha,
    movimientoTipo: movimiento.tipo,
    sourceUrl: movimiento.url,

    fullText: chunks.map(c => c.text).join('\n'),

    chunks: chunks.map((chunk, i) => ({
      index: i,
      text: chunk.text,
      pineconeId: `temp_${i}`, // Se actualizará después
      pageNumber: chunk.page,
      tokenCount: chunk.tokens
    })),

    processingMetadata: {
      model: 'text-embedding-3-small',
      vectorDimensions: 1536,
      totalChunks: chunks.length,
      totalTokensUsed: chunks.reduce((sum, c) => sum + c.tokens, 0)
    },

    status: 'active',
    pineconeStatus: 'pending'
  });

  // Actualizar IDs reales de Pinecone
  docEmbed.chunks.forEach((chunk, i) => {
    chunk.pineconeId = `${docEmbed._id}_chunk_${i}`;
  });
  await docEmbed.save();

  // Actualizar causa
  movimiento.embeddingDocId = docEmbed._id;
  movimiento.embeddingStatus = 'completed';
  movimiento.embeddingProcessedAt = new Date();

  causa.embeddingsProcessing.processed++;
  causa.embeddingsProcessing.lastProcessedAt = new Date();

  await causa.save();

  console.log(`✅ Embedding creado: ${docEmbed._id}`);
  return docEmbed;
}
```

---

### 4. Consultar embeddings de una causa

```javascript
const { DocumentEmbedding } = require('pjn-models');

async function verEmbeddings(causaId) {
  const embeddings = await DocumentEmbedding.findActiveByCausa(causaId);

  console.log(`\n📊 Embeddings de la causa: ${embeddings.length} documentos`);

  embeddings.forEach(emb => {
    console.log(`\n📄 Movimiento ${emb.movimientoIndex}:`);
    console.log(`   Tipo: ${emb.movimientoTipo}`);
    console.log(`   Fecha: ${emb.movimientoFecha?.toISOString().split('T')[0]}`);
    console.log(`   URL: ${emb.sourceUrl}`);
    console.log(`   Chunks: ${emb.chunks.length}`);
    console.log(`   Tokens: ${emb.processingMetadata.totalTokensUsed}`);
    console.log(`   Modelo: ${emb.processingMetadata.model}`);
    console.log(`   Estado Pinecone: ${emb.pineconeStatus}`);
  });
}

// Uso
verEmbeddings('507f1f77bcf86cd799439011');
```

**Salida:**
```
📊 Embeddings de la causa: 3 documentos

📄 Movimiento 5:
   Tipo: Sentencia
   Fecha: 2024-03-15
   URL: http://...
   Chunks: 15
   Tokens: 3200
   Modelo: text-embedding-3-small
   Estado Pinecone: synced

📄 Movimiento 12:
   Tipo: Resolución
   Fecha: 2024-06-20
   URL: http://...
   Chunks: 8
   Tokens: 1500
   Modelo: text-embedding-3-small
   Estado Pinecone: synced
```

---

### 5. Obtener metadata para Pinecone

```javascript
const { DocumentEmbedding } = require('pjn-models');

async function prepararParaPinecone(docEmbeddingId) {
  const doc = await DocumentEmbedding.findById(docEmbeddingId);

  // Metadata general del documento
  const baseMetadata = doc.getPineconeMetadata();

  // Preparar vectores para upsert
  const vectores = doc.chunks.map((chunk, i) => ({
    id: chunk.pineconeId,
    // values: [embedding vectors aquí],  // Se agregaría el vector real
    metadata: {
      ...baseMetadata,
      chunkIndex: i,
      pageNumber: chunk.pageNumber,
      text: chunk.text.substring(0, 500) // Pinecone permite metadata limitada
    }
  }));

  console.log(`Preparados ${vectores.length} vectores para Pinecone`);
  return vectores;
}
```

---

### 6. Dashboard de progreso

```javascript
const { CausasCivil, DocumentEmbedding } = require('pjn-models');

async function dashboard() {
  // Estadísticas de causas
  const totalCausas = await CausasCivil.countDocuments();
  const conElegibles = await CausasCivil.countDocuments({
    'embeddingsProcessing.hasEligible': true
  });
  const completadas = await CausasCivil.countDocuments({
    'embeddingsProcessing.allProcessed': true
  });

  // Estadísticas de embeddings
  const totalEmbeddings = await DocumentEmbedding.countDocuments();
  const activos = await DocumentEmbedding.countDocuments({ status: 'active' });
  const sincronizados = await DocumentEmbedding.countDocuments({
    pineconeStatus: 'synced'
  });

  // Agregaciones
  const stats = await DocumentEmbedding.aggregate([
    { $match: { status: 'active' } },
    {
      $group: {
        _id: null,
        totalChunks: { $sum: '$processingMetadata.totalChunks' },
        totalTokens: { $sum: '$processingMetadata.totalTokensUsed' }
      }
    }
  ]);

  console.log('\n📊 DASHBOARD DE EMBEDDINGS\n');

  console.log('Causas Civiles:');
  console.log(`  Total: ${totalCausas.toLocaleString()}`);
  console.log(`  Con movimientos elegibles: ${conElegibles.toLocaleString()}`);
  console.log(`  Completadas: ${completadas.toLocaleString()}`);
  console.log(`  Progreso: ${((completadas / conElegibles) * 100).toFixed(1)}%\n`);

  console.log('Embeddings:');
  console.log(`  Total documentos: ${totalEmbeddings.toLocaleString()}`);
  console.log(`  Activos: ${activos.toLocaleString()}`);
  console.log(`  Sincronizados con Pinecone: ${sincronizados.toLocaleString()}`);

  if (stats.length > 0) {
    console.log(`  Total chunks: ${stats[0].totalChunks.toLocaleString()}`);
    console.log(`  Total tokens: ${stats[0].totalTokens.toLocaleString()}`);
    console.log(`  Costo estimado (OpenAI): $${(stats[0].totalTokens / 1000000 * 0.02).toFixed(2)}`);
  }
}

dashboard();
```

**Salida:**
```
📊 DASHBOARD DE EMBEDDINGS

Causas Civiles:
  Total: 300,000
  Con movimientos elegibles: 85,000
  Completadas: 12,500
  Progreso: 14.7%

Embeddings:
  Total documentos: 45,000
  Activos: 44,980
  Sincronizados con Pinecone: 44,500
  Total chunks: 850,000
  Total tokens: 15,300,000
  Costo estimado (OpenAI): $306.00
```

---

### 7. Manejo de errores

```javascript
const { CausasCivil } = require('pjn-models');

async function listarFallidos() {
  const causasConErrores = await CausasCivil.find({
    'embeddingsProcessing.failed': { $gt: 0 }
  })
  .select('number year caratula movimiento embeddingsProcessing')
  .limit(20);

  console.log(`${causasConErrores.length} causas con errores\n`);

  causasConErrores.forEach(causa => {
    const fallidos = causa.movimiento.filter(m =>
      m.embeddingStatus === 'failed'
    );

    console.log(`Causa ${causa.number}/${causa.year}:`);
    console.log(`  Movimientos fallidos: ${fallidos.length}`);

    fallidos.slice(0, 3).forEach((mov, i) => {
      console.log(`  ${i + 1}. Tipo: ${mov.tipo || 'N/A'}`);
      console.log(`     URL: ${mov.url?.substring(0, 50)}...`);
    });
    console.log('');
  });
}

async function reintentarFallidos(causaId) {
  const causa = await CausasCivil.findById(causaId);

  const fallidos = causa.movimiento
    .map((mov, idx) => ({ mov, idx }))
    .filter(({ mov }) => mov.embeddingStatus === 'failed');

  console.log(`Reintentando ${fallidos.length} movimientos fallidos...`);

  for (const { mov, idx } of fallidos) {
    // Resetear estado
    mov.embeddingStatus = 'pending';
    // mov.embeddingProcessedAt permanece para tracking

    console.log(`  Reseteado movimiento ${idx}`);
  }

  causa.embeddingsProcessing.failed = 0;
  await causa.save();

  console.log('✅ Listos para reintentar');
}
```

---

## 🎓 Flujo Completo (Worker)

Este es un ejemplo simplificado de cómo se vería un worker completo:

```javascript
const { CausasCivil, DocumentEmbedding } = require('pjn-models');
const { Pinecone } = require('@pinecone-database/pinecone');
const OpenAI = require('openai');

// Inicializar clientes
const pinecone = new Pinecone({ apiKey: process.env.PINECONE_API_KEY });
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const index = pinecone.index('causas-juridicas');

async function worker() {
  while (true) {
    // 1. Buscar causas pendientes
    const causas = await CausasCivil.find({
      'embeddingsProcessing.hasEligible': true,
      'embeddingsProcessing.allProcessed': false
    })
    .limit(10);

    if (causas.length === 0) {
      console.log('✅ No hay causas pendientes');
      break;
    }

    // 2. Procesar cada causa
    for (const causa of causas) {
      console.log(`\nProcesando causa ${causa.number}/${causa.year}...`);

      // Encontrar movimientos pendientes
      const pendientes = causa.movimiento
        .map((mov, idx) => ({ mov, idx }))
        .filter(({ mov }) => mov.url && mov.embeddingStatus === 'pending');

      for (const { mov, idx } of pendientes) {
        try {
          // 3. Descargar y procesar PDF
          const pdfText = await descargarPDF(mov.url);
          const chunks = dividirEnChunks(pdfText);

          // 4. Generar embeddings
          const embeddings = await generarEmbeddings(chunks);

          // 5. Guardar en MongoDB
          const docEmbed = await guardarEmbedding(causa, idx, chunks);

          // 6. Upsert en Pinecone
          await subirAPinecone(docEmbed, embeddings);

          // 7. Actualizar causa
          mov.embeddingDocId = docEmbed._id;
          mov.embeddingStatus = 'completed';
          mov.embeddingProcessedAt = new Date();

          causa.embeddingsProcessing.processed++;
          causa.embeddingsProcessing.lastProcessedAt = new Date();

        } catch (error) {
          console.error(`❌ Error en movimiento ${idx}:`, error.message);

          mov.embeddingStatus = 'failed';
          causa.embeddingsProcessing.failed++;
        }
      }

      // Verificar si está completo
      causa.embeddingsProcessing.allProcessed =
        causa.embeddingsProcessing.processed >=
        causa.embeddingsProcessing.eligible;

      await causa.save();

      console.log(`✅ Causa ${causa.number}/${causa.year} procesada`);
    }
  }
}

// Funciones auxiliares (implementar según necesidades)
async function descargarPDF(url) {
  // Implementar descarga y extracción de texto
}

function dividirEnChunks(text) {
  // Implementar chunking strategy
}

async function generarEmbeddings(chunks) {
  // Llamar a OpenAI API
  const response = await openai.embeddings.create({
    model: 'text-embedding-3-small',
    input: chunks.map(c => c.text)
  });
  return response.data;
}

async function guardarEmbedding(causa, idx, chunks) {
  // Crear DocumentEmbedding (ver ejemplo 3)
}

async function subirAPinecone(docEmbed, embeddings) {
  // Upsert en Pinecone (ver ejemplo 5)
}

// Ejecutar
worker().catch(console.error);
```

---

## 🔗 Próximos Pasos

1. **Lee la documentación completa:** [`EMBEDDINGS.md`](./EMBEDDINGS.md)
2. **Implementa tu worker** usando estos ejemplos como base
3. **Configura Pinecone** para búsquedas vectoriales
4. **Monitorea el progreso** con el dashboard de ejemplo

---

## ❓ Preguntas Frecuentes

**P: ¿Necesito procesar todos los movimientos?**
R: No, solo los que tengan URL válida y sean relevantes para tu caso de uso.

**P: ¿Puedo cambiar el modelo de embeddings?**
R: Sí, solo actualiza `processingMetadata.model` al crear DocumentEmbedding.

**P: ¿Qué pasa si falla el procesamiento?**
R: El movimiento queda con `embeddingStatus: 'failed'`. Puedes reintentarlo (ver ejemplo 7).

**P: ¿Cómo regenero embeddings?**
R: Marca el anterior como `outdated` y crea uno nuevo (ver `EMBEDDINGS.md` ejemplo 3).

---

**📖 Documentación completa:** [`EMBEDDINGS.md`](./EMBEDDINGS.md)
