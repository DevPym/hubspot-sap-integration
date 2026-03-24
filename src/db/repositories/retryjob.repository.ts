/**
 * retryjob.repository.ts — Persistencia de reintentos en PostgreSQL.
 *
 * ┌─────────────────────────────────────────────────────────────────────────┐
 * │  RESPONSABILIDADES                                                      │
 * │  ─────────────────                                                      │
 * │  1. Registrar jobs que fallan en BullMQ (backup en PostgreSQL)         │
 * │  2. Actualizar contador de intentos y último error                     │
 * │  3. Marcar como "exhausted" cuando se agotan los reintentos            │
 * │  4. Listar jobs pendientes (para recovery manual si Redis se pierde)   │
 * └─────────────────────────────────────────────────────────────────────────┘
 *
 * ┌─────────────────────────────────────────────────────────────────────────┐
 * │  CONEXIONES                                                             │
 * │  ──────────                                                             │
 * │  Usa:                                                                   │
 * │    - src/db/prisma.client.ts → acceso a PostgreSQL                     │
 * │                                                                         │
 * │  Consumido por:                                                         │
 * │    - src/queue/sync.worker.ts → registra fallos y actualiza intentos   │
 * └─────────────────────────────────────────────────────────────────────────┘
 */

import { prisma } from '../prisma.client';

// ---------------------------------------------------------------------------
// Tipos
// ---------------------------------------------------------------------------

export interface CreateRetryJobData {
  bullmqJobId: string;
  payload: object;
  maxAttempts: number;
  nextRetryAt: Date;
}

// ---------------------------------------------------------------------------
// Repositorio
// ---------------------------------------------------------------------------

export const retryJobRepo = {
  /**
   * Registra un job fallido en PostgreSQL.
   * Se llama la primera vez que un job falla en el worker.
   */
  async create(data: CreateRetryJobData) {
    return prisma.retryJob.create({
      data: {
        bullmqJobId: data.bullmqJobId,
        payload: data.payload,
        maxAttempts: data.maxAttempts,
        attemptCount: 1,
        nextRetryAt: data.nextRetryAt,
      },
    });
  },

  /**
   * Actualiza el intento de un job existente.
   * Se llama en cada reintento subsiguiente.
   */
  async updateAttempt(bullmqJobId: string, error: string, nextRetryAt: Date) {
    return prisma.retryJob.update({
      where: { bullmqJobId },
      data: {
        attemptCount: { increment: 1 },
        lastError: error,
        nextRetryAt,
      },
    });
  },

  /**
   * Marca un job como exhausted (se agotaron los reintentos).
   * El job ya no será reintentado automáticamente.
   */
  async markExhausted(bullmqJobId: string, error: string) {
    return prisma.retryJob.update({
      where: { bullmqJobId },
      data: {
        exhausted: true,
        lastError: error,
      },
    });
  },

  /**
   * Busca un retry job por su ID de BullMQ.
   */
  async findByBullmqJobId(bullmqJobId: string) {
    return prisma.retryJob.findUnique({
      where: { bullmqJobId },
    });
  },

  /**
   * Lista jobs pendientes (no exhausted) ordenados por nextRetryAt.
   * Útil para recovery manual si Redis se pierde.
   */
  async findPending(limit = 50) {
    return prisma.retryJob.findMany({
      where: { exhausted: false },
      orderBy: { nextRetryAt: 'asc' },
      take: limit,
    });
  },

  /**
   * Lista jobs exhausted (fallaron todos los reintentos).
   * Para revisión manual del equipo.
   */
  async findExhausted(limit = 50) {
    return prisma.retryJob.findMany({
      where: { exhausted: true },
      orderBy: { updatedAt: 'desc' },
      take: limit,
    });
  },
};
