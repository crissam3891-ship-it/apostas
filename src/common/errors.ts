// src/common/errors.ts
// Erros de domínio. O httpStatus é usado pelo filtro global do Nest.
export type DomainErrorCode =
  | 'WALLET_NOT_FOUND'
  | 'MARKET_NOT_FOUND'
  | 'SELECTION_NOT_FOUND'
  | 'MARKET_NOT_OPEN'
  | 'MARKET_CLOSED'
  | 'STAKE_ABOVE_MARKET_LIMIT'
  | 'QUOTE_EXPIRED'
  | 'QUOTE_MISMATCH'
  | 'ODD_CHANGED'
  | 'FREEBET_ODD_TOO_LOW'
  | 'INSUFFICIENT_FUNDS'
  | 'INSUFFICIENT_FREEBET'
  | 'BONUS_LOT_CONFLICT';

export class DomainError extends Error {
  constructor(
    public readonly code: DomainErrorCode,
    public readonly httpStatus: number,
    message?: string,
  ) {
    super(message ?? code);
    this.name = 'DomainError';
  }
}
