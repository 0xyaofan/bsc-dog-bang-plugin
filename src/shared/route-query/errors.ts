/**
 * 路由查询错误类型
 */

import { RouteError, PlatformError } from '../errors.js';
import type { TokenPlatform } from './types.js';

/**
 * 路由查询错误
 */
export class RouteQueryError extends PlatformError {
  constructor(
    message: string,
    platform: TokenPlatform,
    public readonly tokenAddress: string,
    context?: Record<string, any>
  ) {
    super(message, platform, { ...context, tokenAddress });
    Object.setPrototypeOf(this, RouteQueryError.prototype);
  }
}

/**
 * Service Worker 限制错误
 */
export class ServiceWorkerError extends RouteError {
  public readonly operation: string;

  constructor(
    message: string,
    operation: string,
    cause?: Error
  ) {
    super(message, 'SERVICE_WORKER_ERROR', { operation, cause: cause?.message });
    this.operation = operation;
    Object.setPrototypeOf(this, ServiceWorkerError.prototype);
  }
}

/**
 * 平台数据无效错误
 */
export class InvalidPlatformDataError extends RouteQueryError {
  public readonly reason: string;

  constructor(
    platform: TokenPlatform,
    tokenAddress: string,
    reason: string
  ) {
    super(`Invalid platform data: ${reason}`, platform, tokenAddress, { reason });
    this.reason = reason;
    Object.setPrototypeOf(this, InvalidPlatformDataError.prototype);
  }
}

/**
 * 流动性不足错误
 */
export class InsufficientLiquidityError extends RouteError {
  public readonly pairAddress: string;
  public readonly quoteToken: string;
  public readonly actualLiquidity: bigint;
  public readonly requiredLiquidity: bigint;

  constructor(
    message: string,
    pairAddress: string,
    quoteToken: string,
    actualLiquidity: bigint,
    requiredLiquidity: bigint
  ) {
    super(
      message,
      'INSUFFICIENT_LIQUIDITY',
      {
        pairAddress,
        quoteToken,
        actualLiquidity: actualLiquidity.toString(),
        requiredLiquidity: requiredLiquidity.toString()
      }
    );
    this.pairAddress = pairAddress;
    this.quoteToken = quoteToken;
    this.actualLiquidity = actualLiquidity;
    this.requiredLiquidity = requiredLiquidity;
    Object.setPrototypeOf(this, InsufficientLiquidityError.prototype);
  }
}

/**
 * Pancake Pair 未找到错误
 */
export class PancakePairNotFoundError extends RouteError {
  public readonly tokenAddress: string;
  public readonly quoteToken?: string;

  constructor(
    tokenAddress: string,
    quoteToken?: string
  ) {
    super(
      `Pancake pair not found for token ${tokenAddress}`,
      'PANCAKE_PAIR_NOT_FOUND',
      { tokenAddress, quoteToken }
    );
    this.tokenAddress = tokenAddress;
    this.quoteToken = quoteToken;
    Object.setPrototypeOf(this, PancakePairNotFoundError.prototype);
  }
}

/**
 * 检查错误是否是 Service Worker 限制错误
 */
export function isServiceWorkerError(error: unknown): boolean {
  if (error instanceof ServiceWorkerError) {
    return true;
  }

  if (error instanceof Error) {
    const message = error.message || '';
    return message.includes('import() is disallowed on ServiceWorkerGlobalScope');
  }

  return false;
}

/**
 * 将错误转换为 Service Worker 错误（如果适用）
 */
export function toServiceWorkerError(error: unknown, operation: string): ServiceWorkerError | null {
  if (isServiceWorkerError(error)) {
    return new ServiceWorkerError(
      `Service Worker limitation in ${operation}`,
      operation,
      error instanceof Error ? error : undefined
    );
  }
  return null;
}
