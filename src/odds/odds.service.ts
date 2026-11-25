// src/odds/odds.service.ts
// Lê markets, monta snapshot (cache Redis TTL 30s) e emite quoteId (TTL 30s).
// Não cria nem altera mercados. Sem circuit breaker, sem cupom.
import { Injectable } from '@nestjs/common';
import Redis from 'ioredis';
import { randomUUID } from 'crypto';
import { Pool, PoolClient } from 'pg';
import { DomainError } from '../common/errors';
import { Dec, Money, toMoney } from '../bets/payout-calculator';

export const ODDS_CACHE_TTL_SECONDS = 30;
export const QUOTE_TTL_MS = 30_000;

export type MarketStatus = 'ABERTO' | 'SUSPENSO' | 'FECHADO';

export interface MarketRow {
  market_id: string;
  status: MarketStatus;
  limit_stake: string;
  closes_at: Date | string;
  /** selectionId -> odd (string decimal). */
  selections: Record<string, string>;
}

export interface MarketSnapshot {
  marketId: string;
  status: MarketStatus;
  limitStake: Money;
  closesAt: string;
  selections: Record<string, string>;
  cachedAt: string;
}

export interface Quote {
  quoteId: string;
  marketId: string;
  selectionId: string;
  odd: string;
  limitStake: Money;
  closesAt: string;
  quotedAt: string;
  expiresAt: string;
}

const MARKET_SQL =
  'SELECT market_id, status, limit_stake, closes_at, selections FROM markets WHERE market_id = $1';

function hasOwn(obj: Record<string, string>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(obj, key);
}

@Injectable()
export class OddsService {
  constructor(
    private readonly pool: Pool,
    private readonly redis: Redis,
  ) {}

  private snapshotKey(marketId: string): string {
    return `odds:snapshot:${marketId}`;
  }

  private quoteKey(quoteId: string): string {
    return `quote:${quoteId}`;
  }

  /** Cache-aside com TTL de 30s. Usado para montar cotações, nunca para liquidar ou apostar. */
  async getSnapshot(marketId: string): Promise<MarketSnapshot> {
    const key = this.snapshotKey(marketId);
    const cached = await this.redis.get(key);
    if (cached) {
      return JSON.parse(cached) as MarketSnapshot;
    }

    const { rows } = await this.pool.query<MarketRow>(MARKET_SQL, [marketId]);
    if (rows.length === 0) {
      throw new DomainError('MARKET_NOT_FOUND', 404);
    }

    const row = rows[0];
    const now = new Date();
    const snapshot: MarketSnapshot = {
      marketId: row.market_id,
      status: row.status,
      limitStake: toMoney(new Dec(row.limit_stake)),
      closesAt: new Date(row.closes_at).toISOString(),
      selections: row.selections,
      cachedAt: now.toISOString(),
    };

    await this.redis.set(key, JSON.stringify(snapshot), 'EX', ODDS_CACHE_TTL_SECONDS);
    return snapshot;
  }

  /** Emite a cotação. O front guarda o quoteId e o envia na criação da aposta. */
  async createQuote(marketId: string, selectionId: string): Promise<Quote> {
    const snapshot = await this.getSnapshot(marketId);
    const now = new Date();
    this.assertMarketOpen(snapshot.status, snapshot.closesAt, now);

    if (!hasOwn(snapshot.selections, selectionId)) {
      throw new DomainError('SELECTION_NOT_FOUND', 404);
    }

    const quote: Quote = {
      quoteId: randomUUID(),
      marketId,
      selectionId,
      odd: snapshot.selections[selectionId],
      limitStake: snapshot.limitStake,
      closesAt: snapshot.closesAt,
      quotedAt: now.toISOString(),
      expiresAt: new Date(now.getTime() + QUOTE_TTL_MS).toISOString(),
    };

    await this.redis.set(this.quoteKey(quote.quoteId), JSON.stringify(quote), 'PX', QUOTE_TTL_MS);
    return quote;
  }

  /** Carrega a cotação guardada. Inexistente ou vencida = QUOTE_EXPIRED. Sem prorrogação. */
  async loadQuote(quoteId: string, now: Date = new Date()): Promise<Quote> {
    const raw = await this.redis.get(this.quoteKey(quoteId));
    if (!raw) {
      throw new DomainError('QUOTE_EXPIRED', 409, 'Cotação inexistente ou vencida. Busque uma nova.');
    }
    const quote = JSON.parse(raw) as Quote;
    if (now.getTime() > new Date(quote.expiresAt).getTime()) {
      throw new DomainError('QUOTE_EXPIRED', 409, 'Cotação vencida. Busque uma nova.');
    }
    return quote;
  }

  /**
   * Lê o mercado dentro da transação de aposta, sem cache.
   * FOR SHARE: uma alteração de mercado espera o COMMIT da aposta, e vice-versa.
   */
  async readMarketForBet(client: PoolClient, marketId: string): Promise<MarketRow> {
    const { rows } = await client.query<MarketRow>(`${MARKET_SQL} FOR SHARE`, [marketId]);
    if (rows.length === 0) {
      throw new DomainError('MARKET_NOT_FOUND', 404);
    }
    return rows[0];
  }

  /**
   * Valida a cotação contra o mercado lido agora. Não substitui odd silenciosamente:
   * se a odd mudou, rejeita com ODD_CHANGED e o front precisa pedir nova cotação.
   * Retorna a odd da cotação, já validada.
   */
  assertQuoteStillValid(
    quote: Quote,
    fresh: MarketRow,
    request: { marketId: string; selectionId: string; stake: Money },
    now: Date = new Date(),
  ): string {
    if (quote.marketId !== request.marketId || quote.selectionId !== request.selectionId) {
      throw new DomainError('QUOTE_MISMATCH', 409, 'Cotação não corresponde ao mercado ou seleção.');
    }
    if (now.getTime() > new Date(quote.expiresAt).getTime()) {
      throw new DomainError('QUOTE_EXPIRED', 409, 'Cotação vencida. Busque uma nova.');
    }

    this.assertMarketOpen(fresh.status, fresh.closes_at, now);

    if (new Dec(request.stake).gt(new Dec(fresh.limit_stake))) {
      throw new DomainError('STAKE_ABOVE_MARKET_LIMIT', 422, 'Stake acima do limite do mercado.');
    }

    const freshOdd = hasOwn(fresh.selections, request.selectionId)
      ? fresh.selections[request.selectionId]
      : undefined;
    if (!freshOdd || !new Dec(freshOdd).equals(new Dec(quote.odd))) {
      throw new DomainError('ODD_CHANGED', 409, 'Odd mudou desde a cotação. Busque uma nova.');
    }

    return quote.odd;
  }

  /**
   * Invalida o cache do mercado. Chamar SOMENTE depois do COMMIT
   * da transação que alterou o mercado. Nunca antes.
   */
  async invalidate(marketId: string): Promise<void> {
    await this.redis.del(this.snapshotKey(marketId));
  }

  private assertMarketOpen(status: MarketStatus, closesAt: string | Date, now: Date): void {
    if (status !== 'ABERTO') {
      throw new DomainError('MARKET_NOT_OPEN', 409, `Mercado ${status}.`);
    }
    if (new Date(closesAt).getTime() <= now.getTime()) {
      throw new DomainError('MARKET_CLOSED', 409, 'Mercado fechado para apostas.');
    }
  }
}
