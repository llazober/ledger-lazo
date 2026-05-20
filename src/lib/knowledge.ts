import { prisma } from '@/lib/prisma';
import { openai } from '@/lib/openai';

/**
 * Searches the database for document chunks matching the query using vector similarity.
 * Optionally filters chunks to a specific document ID.
 */
export async function searchKnowledge(query: string, docId?: string | null) {
  // Fetch chunks from database first to make sure they are available for either vector or keyword search
  let chunks: any[] = [];
  try {
    chunks = await prisma.documentChunk.findMany({
      where: docId ? { documentId: docId } : undefined,
      include: { document: true }
    });
  } catch (dbErr) {
    console.error("[RAG Search] Database chunk fetch failed:", dbErr);
    return null;
  }

  if (chunks.length === 0) {
    console.log(`[RAG Search] No chunks found in the database matching scope (docId: ${docId || 'any'}).`);
    return null;
  }

  const hasOpenAI = process.env.OPENAI_API_KEY && 
                    process.env.OPENAI_API_KEY !== 'missing_api_key' &&
                    process.env.OPENAI_API_KEY !== 'dummy_key_for_build_time';

  if (!hasOpenAI) {
    console.warn("[RAG Search] OpenAI API key is missing. Falling back to keyword search.");
    return performKeywordFallback(query, chunks);
  }

  try {
    // 1. Generate query vector embedding
    const response = await openai.embeddings.create({
      model: 'text-embedding-3-small',
      input: query,
    });

    const queryEmbedding = response.data[0].embedding;

    // 2. Compute cosine similarity in memory
    const similarity = (vecA: number[], vecB: number[]) => {
      if (!Array.isArray(vecA) || !Array.isArray(vecB) || vecA.length === 0 || vecB.length === 0) {
        return 0;
      }
      const dotProduct = vecA.reduce((sum, a, i) => sum + a * (vecB[i] || 0), 0);
      const magA = Math.sqrt(vecA.reduce((sum, a) => sum + a * a, 0));
      const magB = Math.sqrt(vecB.reduce((sum, b) => sum + b * b, 0));
      if (magA === 0 || magB === 0) return 0;
      return dotProduct / (magA * magB);
    };

    const results = chunks
      .map(chunk => {
        // Embeddings are saved as Json in the DB
        const chunkEmbedding = Array.isArray(chunk.embedding) 
          ? chunk.embedding as number[] 
          : [];
        
        const score = similarity(queryEmbedding, chunkEmbedding);

        // Boost matching results for key tax and pricing terms to improve recall
        const lowerQuery = query.toLowerCase();
        const lowerContent = chunk.content.toLowerCase();
        const triggerWords = [
          'price', 'cost', 'fee', 'package', 'service', 'bot', 'ai', 'setup', 
          'cuanto', 'precio', 'costo', 'tax', 'w2', 'w-2', '1099', 'checking', 
          'savings', 'interest', 'wage', 'salary', 'income', 'deduction', 's-corp'
        ];
        const hasTrigger = triggerWords.some(word => lowerQuery.includes(word) && lowerContent.includes(word));
        
        return {
          content: chunk.content,
          documentName: chunk.document.name,
          category: chunk.document.category,
          score: hasTrigger ? Math.max(score, 0.8) : score
        };
      })
      .sort((a, b) => b.score - a.score)
      .slice(0, 4)
      .filter(r => r.score > 0.15); // filter out irrelevant chunks

    if (results.length === 0) {
      console.log(`[RAG Search] No chunks passed similarity threshold. Falling back to keyword match.`);
      return performKeywordFallback(query, chunks);
    }

    // Formulate final context block
    return results
      .map(r => `[From Document "${r.documentName}" (Category: ${r.category})]:\n${r.content}`)
      .join('\n\n---\n\n');
  } catch (error) {
    console.error('[RAG Search] Vector similarity failed. Falling back to keyword search. Error:', error);
    return performKeywordFallback(query, chunks);
  }
}

/**
 * Keyword frequency search fallback when vector similarity is unavailable.
 */
function performKeywordFallback(query: string, chunks: any[]) {
  const queryWords = query.toLowerCase()
    .replace(/[^\w\s]/g, '')
    .split(/\s+/)
    .filter(word => word.length > 2 && !['the', 'and', 'for', 'are', 'with', 'this', 'that', 'from', 'was'].includes(word));

  if (queryWords.length === 0) {
    queryWords.push(...query.toLowerCase().split(/\s+/));
  }

  const results = chunks
    .map(chunk => {
      const lowerContent = chunk.content.toLowerCase();
      let matchCount = 0;
      queryWords.forEach(word => {
        if (lowerContent.includes(word)) {
          matchCount++;
        }
      });

      // Simple relative frequency score
      const score = queryWords.length > 0 ? (matchCount / queryWords.length) : 0;
      return {
        content: chunk.content,
        documentName: chunk.document.name,
        category: chunk.document.category,
        score
      };
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, 4)
    .filter(r => r.score > 0);

  if (results.length === 0) return null;

  return results
    .map(r => `[From Document "${r.documentName}" (Category: ${r.category})]:\n${r.content}`)
    .join('\n\n---\n\n');
}

