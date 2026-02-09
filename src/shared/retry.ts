/**
 * 错误重试机制
 *
 * 提供灵活的重试策略，支持指数退避和自定义重试条件
 */

import { isRetryableError } from './errors.js';
import { structuredLogger } from './structured-logger.js';

/**
 * 重试选项
 */
export interface RetryOptions {
  /** 最大重试次数 */
  maxAttempts: number;
  /** 初始延迟时间（毫秒） */
  delayMs: number;
  /** 退避策略 */
  backoff: 'linear' | 'exponential' | 'fixed';
  /** 最大延迟时间（毫秒），防止指数退避过大 */
  maxDelayMs?: number;
  /** 自定义重试条件，返回 true 表示应该重试 */
  shouldRetry?: (error: Error, attempt: number) => boolean;
  /** 重试前的回调 */
  onRetry?: (error: Error, attempt: number, delayMs: number) => void;
  /** 操作名称（用于日志） */
  operationName?: string;
}

/**
 * 默认重试选项
 */
const DEFAULT_RETRY_OPTIONS: Partial<RetryOptions> = {
  maxAttempts: 3,
  delayMs: 1000,
  backoff: 'exponential',
  maxDelayMs: 10000,
  shouldRetry: isRetryableError
};

/**
 * 计算延迟时间
 */
function calculateDelay(
  attempt: number,
  baseDelay: number,
  backoff: 'linear' | 'exponential' | 'fixed',
  maxDelay?: number
): number {
  let delay: number;

  switch (backoff) {
    case 'fixed':
      delay = baseDelay;
      break;
    case 'linear':
      delay = baseDelay * attempt;
      break;
    case 'exponential':
      delay = baseDelay * Math.pow(2, attempt - 1);
      break;
    default:
      delay = baseDelay;
  }

  // 限制最大延迟
  if (maxDelay !== undefined) {
    delay = Math.min(delay, maxDelay);
  }

  return delay;
}

/**
 * 带重试的异步函数执行
 *
 * @param fn 要执行的异步函数
 * @param options 重试选项
 * @returns 函数执行结果
 *
 * @example
 * ```typescript
 * const result = await withRetry(
 *   () => fetchRouteFromChain(tokenAddress),
 *   {
 *     maxAttempts: 3,
 *     delayMs: 1000,
 *     backoff: 'exponential',
 *     operationName: 'fetchRoute'
 *   }
 * );
 * ```
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  options: Partial<RetryOptions> = {}
): Promise<T> {
  const opts: RetryOptions = {
    ...DEFAULT_RETRY_OPTIONS,
    ...options
  } as RetryOptions;

  let lastError: Error;
  const operationName = opts.operationName || 'operation';

  for (let attempt = 1; attempt <= opts.maxAttempts; attempt++) {
    try {
      // 记录尝试
      if (attempt > 1) {
        structuredLogger.debug(`[Retry] 第 ${attempt} 次尝试: ${operationName}`);
      }

      // 执行函数
      const result = await fn();

      // 成功，记录日志
      if (attempt > 1) {
        structuredLogger.info(`[Retry] 重试成功: ${operationName}`, {
          attempt,
          totalAttempts: opts.maxAttempts
        });
      }

      return result;
    } catch (error) {
      lastError = error as Error;

      // 记录错误
      structuredLogger.warn(`[Retry] 第 ${attempt} 次尝试失败: ${operationName}`, {
        attempt,
        error: lastError.message
      });

      // 检查是否应该重试
      const shouldRetry = opts.shouldRetry
        ? opts.shouldRetry(lastError, attempt)
        : isRetryableError(lastError);

      // 如果不应该重试，直接抛出错误
      if (!shouldRetry) {
        structuredLogger.warn(`[Retry] 错误不可重试: ${operationName}`, {
          error: lastError.message
        });
        throw lastError;
      }

      // 如果是最后一次尝试，不再等待
      if (attempt === opts.maxAttempts) {
        structuredLogger.error(`[Retry] 所有重试都失败: ${operationName}`, {
          totalAttempts: opts.maxAttempts,
          error: lastError.message
        });
        break;
      }

      // 计算延迟时间
      const delay = calculateDelay(
        attempt,
        opts.delayMs,
        opts.backoff,
        opts.maxDelayMs
      );

      // 调用重试回调
      if (opts.onRetry) {
        opts.onRetry(lastError, attempt, delay);
      }

      // 记录延迟
      structuredLogger.debug(`[Retry] 等待 ${delay}ms 后重试: ${operationName}`);

      // 等待后重试
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }

  // 所有尝试都失败，抛出最后一个错误
  throw lastError!;
}

/**
 * 创建带重试的函数包装器
 *
 * @param fn 要包装的函数
 * @param options 重试选项
 * @returns 包装后的函数
 *
 * @example
 * ```typescript
 * const fetchWithRetry = createRetryWrapper(
 *   fetchRouteFromChain,
 *   { maxAttempts: 3, delayMs: 1000 }
 * );
 *
 * const result = await fetchWithRetry(tokenAddress);
 * ```
 */
export function createRetryWrapper<TArgs extends any[], TResult>(
  fn: (...args: TArgs) => Promise<TResult>,
  options: Partial<RetryOptions> = {}
): (...args: TArgs) => Promise<TResult> {
  return async (...args: TArgs): Promise<TResult> => {
    return withRetry(() => fn(...args), options);
  };
}

/**
 * 重试统计信息
 */
export interface RetryStats {
  /** 总尝试次数 */
  totalAttempts: number;
  /** 成功次数 */
  successCount: number;
  /** 失败次数 */
  failureCount: number;
  /** 重试次数 */
  retryCount: number;
  /** 平均重试次数 */
  averageRetries: number;
  /** 最大重试次数 */
  maxRetries: number;
}

/**
 * 重试统计收集器
 */
export class RetryStatsCollector {
  private stats: Map<string, {
    attempts: number;
    successes: number;
    failures: number;
    retries: number[];
  }>;

  constructor() {
    this.stats = new Map();
  }

  /**
   * 记录操作结果
   */
  record(
    operationName: string,
    success: boolean,
    attemptCount: number
  ): void {
    if (!this.stats.has(operationName)) {
      this.stats.set(operationName, {
        attempts: 0,
        successes: 0,
        failures: 0,
        retries: []
      });
    }

    const stat = this.stats.get(operationName)!;
    stat.attempts++;

    if (success) {
      stat.successes++;
    } else {
      stat.failures++;
    }

    if (attemptCount > 1) {
      stat.retries.push(attemptCount - 1);
    }
  }

  /**
   * 获取统计信息
   */
  getStats(operationName: string): RetryStats | null {
    const stat = this.stats.get(operationName);
    if (!stat) {
      return null;
    }

    const retryCount = stat.retries.length;
    const averageRetries = retryCount > 0
      ? stat.retries.reduce((a, b) => a + b, 0) / retryCount
      : 0;
    const maxRetries = retryCount > 0
      ? Math.max(...stat.retries)
      : 0;

    return {
      totalAttempts: stat.attempts,
      successCount: stat.successes,
      failureCount: stat.failures,
      retryCount,
      averageRetries,
      maxRetries
    };
  }

  /**
   * 获取所有统计信息
   */
  getAllStats(): Map<string, RetryStats> {
    const result = new Map<string, RetryStats>();

    for (const [name, _] of this.stats) {
      const stats = this.getStats(name);
      if (stats) {
        result.set(name, stats);
      }
    }

    return result;
  }

  /**
   * 清除统计信息
   */
  clear(operationName?: string): void {
    if (operationName) {
      this.stats.delete(operationName);
    } else {
      this.stats.clear();
    }
  }
}

/**
 * 全局重试统计收集器
 */
export const retryStatsCollector = new RetryStatsCollector();

/**
 * 带统计的重试函数
 *
 * @param fn 要执行的异步函数
 * @param options 重试选项
 * @returns 函数执行结果
 */
export async function withRetryAndStats<T>(
  fn: () => Promise<T>,
  options: Partial<RetryOptions> = {}
): Promise<T> {
  const operationName = options.operationName || 'operation';
  let attemptCount = 0;
  let success = false;

  try {
    const result = await withRetry(
      async () => {
        attemptCount++;
        return await fn();
      },
      options
    );

    success = true;
    return result;
  } finally {
    // 记录统计信息
    retryStatsCollector.record(operationName, success, attemptCount);
  }
}

/**
 * 预设的重试策略
 */
export const RetryStrategies = {
  /**
   * 快速重试策略（适用于轻量级操作）
   */
  fast: {
    maxAttempts: 2,
    delayMs: 500,
    backoff: 'fixed' as const,
    maxDelayMs: 500
  },

  /**
   * 标准重试策略（适用于大多数操作）
   */
  standard: {
    maxAttempts: 3,
    delayMs: 1000,
    backoff: 'exponential' as const,
    maxDelayMs: 5000
  },

  /**
   * 激进重试策略（适用于重要操作）
   */
  aggressive: {
    maxAttempts: 5,
    delayMs: 1000,
    backoff: 'exponential' as const,
    maxDelayMs: 10000
  },

  /**
   * 网络请求重试策略
   */
  network: {
    maxAttempts: 3,
    delayMs: 2000,
    backoff: 'exponential' as const,
    maxDelayMs: 8000,
    shouldRetry: (error: Error) => {
      const message = error.message.toLowerCase();
      return message.includes('network') ||
             message.includes('timeout') ||
             message.includes('fetch') ||
             message.includes('connection');
    }
  },

  /**
   * 链上查询重试策略
   */
  onchain: {
    maxAttempts: 4,
    delayMs: 1500,
    backoff: 'exponential' as const,
    maxDelayMs: 10000,
    shouldRetry: (error: Error) => {
      const message = error.message.toLowerCase();
      // 重试网络错误和超时，但不重试合约执行错误
      return (message.includes('network') ||
              message.includes('timeout')) &&
             !message.includes('revert') &&
             !message.includes('execution');
    }
  }
};

/**
 * 便捷函数：使用快速重试策略
 */
export async function withFastRetry<T>(
  fn: () => Promise<T>,
  operationName?: string
): Promise<T> {
  return withRetry(fn, {
    ...RetryStrategies.fast,
    operationName
  });
}

/**
 * 便捷函数：使用标准重试策略
 */
export async function withStandardRetry<T>(
  fn: () => Promise<T>,
  operationName?: string
): Promise<T> {
  return withRetry(fn, {
    ...RetryStrategies.standard,
    operationName
  });
}

/**
 * 便捷函数：使用激进重试策略
 */
export async function withAggressiveRetry<T>(
  fn: () => Promise<T>,
  operationName?: string
): Promise<T> {
  return withRetry(fn, {
    ...RetryStrategies.aggressive,
    operationName
  });
}

/**
 * 便捷函数：使用网络重试策略
 */
export async function withNetworkRetry<T>(
  fn: () => Promise<T>,
  operationName?: string
): Promise<T> {
  return withRetry(fn, {
    ...RetryStrategies.network,
    operationName
  });
}

/**
 * 便捷函数：使用链上查询重试策略
 */
export async function withOnchainRetry<T>(
  fn: () => Promise<T>,
  operationName?: string
): Promise<T> {
  return withRetry(fn, {
    ...RetryStrategies.onchain,
    operationName
  });
}
