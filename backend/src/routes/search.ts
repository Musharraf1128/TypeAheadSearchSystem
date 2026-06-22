import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { BatchWriter } from '../batch/BatchWriter.js';
import { metrics } from '../middleware/metrics.js';

interface SearchBody {
  query?: string;
}

export function registerSearchRoute(
  fastify: FastifyInstance,
  batchWriter: BatchWriter
): void {

  fastify.post('/search', async (
    request: FastifyRequest<{ Body: SearchBody }>,
    reply: FastifyReply
  ) => {
    const query = (request.body as SearchBody)?.query?.trim();

    if (!query) {
      return reply.status(400).send({
        error: 'Missing required field: query',
        message: 'Please provide a query string.',
      });
    }

    // Phase 5: Enqueue into batch writer instead of direct DB write
    batchWriter.enqueue(query.toLowerCase());
    metrics.incrementDbWrites(1);

    return reply.send({
      message: 'Searched',
      query,
    });
  });
}
