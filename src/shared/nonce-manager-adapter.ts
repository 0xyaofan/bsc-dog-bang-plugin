/**
 * Nonce Manager Adapter
 * 实现类似原插件的 nonce 缓存优化机制
 *
 * 核心优化：
 * 1. 只在第一次交易时查询链上 nonce (避免重复 RPC 调用)
 * 2. 后续交易直接使用内存中的 nonce 游标并递增
 * 3. 发生 nonce 错误时才重新同步链上 nonce
 */

import type { PublicClient, Address } from 'viem';
import { logger } from './logger.js';

/**
 * SDK NonceManager 接口
 */
export interface NonceManager {
  execute<T>(label: string, fn: (nonce: number) => Promise<T>): Promise<T>;
  getCurrentNonce(): Promise<number>;
  reset(): void;
}

/**
 * Nonce Manager 适配器
 * 实现 SDK 的 NonceManager 接口，采用原插件的优化策略
 */
export class NonceManagerAdapter implements NonceManager {
  private nonceCursor: number | null = null;
  private publicClient: PublicClient;
  private account: Address;

  constructor(publicClient: PublicClient, account: Address) {
    this.publicClient = publicClient;
    this.account = account;
  }

  /**
   * 执行带 nonce 管理的交易
   *
   * 性能优化点：
   * - 第一次调用时查询链上 nonce（1 次 RPC 调用）
   * - 后续调用直接使用缓存的 nonce 游标（0 次 RPC 调用）
   * - 只在 nonce 错误时重新同步
   */
  async execute<T>(label: string, fn: (nonce: number) => Promise<T>): Promise<T> {
    const maxRetries = 3;
    let lastError: Error | null = null;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        // 预留 nonce（只在第一次或 nonceCursor 为 null 时查询链上）
        const nonce = await this.reserveNonce(label);

        logger.debug(`[NonceManagerAdapter] 执行交易 (${label})`, {
          nonce,
          attempt,
          usedCache: this.nonceCursor !== null && this.nonceCursor > nonce,
        });

        // 执行交易
        const result = await fn(nonce);

        logger.debug(`[NonceManagerAdapter] 交易成功 (${label})`, {
          nonce,
          attempt,
        });

        return result;
      } catch (error) {
        lastError = error as Error;
        const isNonceError = this.isNonceRelatedError(error);

        logger.warn(`[NonceManagerAdapter] 交易失败 (${label})`, {
          attempt,
          isNonceError,
          error: error instanceof Error ? error.message : String(error),
        });

        if (isNonceError && attempt < maxRetries) {
          // Nonce 错误，重新同步链上 nonce
          logger.info(`[NonceManagerAdapter] 检测到 nonce 错误，重新同步 (${label})`);
          await this.syncNonce(`retry-${attempt}`);
        } else {
          // 非 nonce 错误或已达最大重试次数
          throw error;
        }
      }
    }

    throw lastError || new Error('Transaction failed after retries');
  }

  /**
   * 获取当前 nonce
   */
  async getCurrentNonce(): Promise<number> {
    if (this.nonceCursor === null) {
      await this.syncNonce('getCurrentNonce');
    }
    return this.nonceCursor!;
  }

  /**
   * 重置 nonce
   * 在钱包切换或需要强制重新同步时调用
   */
  reset(): void {
    this.nonceCursor = null;
    logger.debug('[NonceManagerAdapter] Nonce 已重置');
  }

  /**
   * 同步链上 nonce
   * 只在必要时调用（第一次交易、nonce 错误）
   */
  private async syncNonce(reason: string): Promise<number> {
    const startTime = Date.now();

    const pending = await this.publicClient.getTransactionCount({
      address: this.account,
      blockTag: 'pending',
    });

    const duration = Date.now() - startTime;

    // 只在链上 nonce 更大时更新（避免回退）
    if (this.nonceCursor === null || pending > this.nonceCursor) {
      this.nonceCursor = pending;
    }

    logger.debug(`[NonceManagerAdapter] 已同步链上 nonce=${pending} (${reason}) | duration=${duration}ms`);
    return pending;
  }

  /**
   * 预留 nonce
   *
   * 核心优化：
   * - 第一次：查询链上 nonce（约 100-500ms）
   * - 后续：直接递增游标（<1ms）
   */
  private async reserveNonce(reason: string): Promise<number> {
    // 只在游标为 null 时查询链上（第一次交易）
    if (this.nonceCursor === null) {
      await this.syncNonce(reason);
    }

    if (this.nonceCursor === null) {
      throw new Error('无法获取链上 nonce');
    }

    // 预留当前游标值
    const reserved = this.nonceCursor;

    // 递增游标（下一次交易使用）
    this.nonceCursor += 1;

    logger.debug(`[NonceManagerAdapter] 预留 nonce=${reserved} (${reason}) | nextNonce=${this.nonceCursor}`);
    return reserved;
  }

  /**
   * 判断是否为 nonce 相关错误
   */
  private isNonceRelatedError(error: any): boolean {
    const message = (
      error?.shortMessage ||
      error?.message ||
      String(error) ||
      ''
    ).toLowerCase();

    if (!message) {
      return false;
    }

    return (
      message.includes('gapped-nonce') ||
      message.includes('nonce too') ||
      message.includes('nonce is too') ||
      (message.includes('nonce provided') && message.includes('lower')) ||
      message.includes('incorrect nonce') ||
      message.includes('nonce mismatch')
    );
  }
}
