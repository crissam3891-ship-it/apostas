// src/bets/provably-fair.ts
// Provably fair: resultado = SHA256(serverSeed:clientSeed:nonce).
// Funções puras. Sem banco, sem Redis, sem Math.random().
import { createHash, randomBytes, timingSafeEqual } from 'crypto';

const CLIENT_SEED_RE = /^[A-Za-z0-9_-]{1,64}$/;
const HEX64_RE = /^[0-9a-f]{64}$/;

export function sha256Hex(input: string): string {
  return createHash('sha256').update(input, 'utf8').digest('hex');
}

/** Gerado antes da rodada. Ao cliente vai apenas o serverSeedHash. */
export function generateServerSeed(): { serverSeed: string; serverSeedHash: string } {
  const serverSeed = randomBytes(32).toString('hex');
  return { serverSeed, serverSeedHash: sha256Hex(serverSeed) };
}

export function assertClientSeed(clientSeed: string): void {
  if (!CLIENT_SEED_RE.test(clientSeed)) {
    throw new Error('clientSeed inválido');
  }
}

export function assertNonce(nonce: number): void {
  if (!Number.isSafeInteger(nonce) || nonce < 0) {
    throw new Error('nonce inválido');
  }
}

/** Hash completo do resultado (64 hex). */
export function computeResultHash(serverSeed: string, clientSeed: string, nonce: number): string {
  assertClientSeed(clientSeed);
  assertNonce(nonce);
  return sha256Hex(`${serverSeed}:${clientSeed}:${nonce}`);
}

/**
 * Converte os primeiros 52 bits do hash em um valor em [0, 1).
 * Uso: sorteio de jogo. Nunca usar para cálculo monetário.
 */
export function rollUnit(resultHash: string): number {
  if (!HEX64_RE.test(resultHash)) {
    throw new Error('resultHash inválido');
  }
  return parseInt(resultHash.slice(0, 13), 16) / 2 ** 52;
}

/** Verificação feita pelo cliente após a revelação do serverSeed. */
export function verifyServerSeed(serverSeed: string, expectedHash: string): boolean {
  if (!HEX64_RE.test(expectedHash)) return false;
  const a = Buffer.from(sha256Hex(serverSeed), 'hex');
  const b = Buffer.from(expectedHash, 'hex');
  return a.length === b.length && timingSafeEqual(a, b);
}
