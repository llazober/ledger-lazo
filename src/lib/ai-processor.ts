import { prisma } from '@/lib/prisma';
import { openai } from '@/lib/openai';

/**
 * Splits extracted document text into chunks and generates OpenAI vector embeddings
 * for RAG search. Deletes any existing chunks for the document first to prevent duplicates.
 */
export async function processDocumentChunks(documentId: string, text: string) {
  try {
    console.log(`[RAG Indexer] Processing document chunks for ${documentId}...`);

    // 1. Delete any existing chunks for this document (allows clean re-indexing/updates)
    await prisma.documentChunk.deleteMany({
      where: { documentId }
    });

    if (!text || text.trim() === '') {
      console.log(`[RAG Indexer] Document ${documentId} has no text. Skipping chunking.`);
      return { success: true, count: 0 };
    }

    // 2. Chunking (1000 chars with 200 chars overlap)
    const chunkSize = 1000;
    const overlap = 200;
    const chunks: string[] = [];

    // Safety guard to avoid infinite loop if overlap is larger than or equal to chunkSize
    const step = chunkSize - overlap <= 0 ? chunkSize : chunkSize - overlap;

    for (let i = 0; i < text.length; i += step) {
      const chunk = text.slice(i, i + chunkSize);
      if (chunk.trim()) {
        chunks.push(chunk);
      }
    }

    console.log(`[RAG Indexer] Split document ${documentId} into ${chunks.length} chunks.`);

    // 3. Generate embeddings and save to database
    const hasOpenAI = process.env.OPENAI_API_KEY && 
                      process.env.OPENAI_API_KEY !== 'missing_api_key' &&
                      process.env.OPENAI_API_KEY !== 'dummy_key_for_build_time';

    if (!hasOpenAI) {
      console.warn(`[RAG Indexer] OpenAI API Key is missing. Creating chunks WITHOUT embeddings.`);
      
      // Save chunks without embedding array
      for (const chunkContent of chunks) {
        await prisma.documentChunk.create({
          data: {
            documentId,
            content: chunkContent,
          }
        });
      }
      return { success: true, count: chunks.length, embedded: false };
    }

    // Create chunks with OpenAI embeddings
    for (const chunkContent of chunks) {
      try {
        const response = await openai.embeddings.create({
          model: 'text-embedding-3-small',
          input: chunkContent,
        });

        const embedding = response.data[0].embedding;

        await prisma.documentChunk.create({
          data: {
            documentId,
            content: chunkContent,
            embedding: embedding as number[], // Saved as JSON array of numbers
          }
        });
      } catch (embErr) {
        console.error(`[RAG Indexer] Failed to generate embedding for a chunk of document ${documentId}:`, embErr);
        // Fallback: save chunk without embedding rather than failing the whole flow
        await prisma.documentChunk.create({
          data: {
            documentId,
            content: chunkContent,
          }
        });
      }
    }

    console.log(`[RAG Indexer] Indexed ${chunks.length} chunks for document ${documentId}.`);
    return { success: true, count: chunks.length, embedded: true };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    console.error(`[RAG Indexer] Error chunking/embedding document ${documentId}:`, errorMessage);
    throw error;
  }
}
