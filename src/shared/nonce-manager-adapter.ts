/**
 * Nonce Manager Adapter
 * 将插件的 nonce 管理系统适配为 SDK 的 NonceManager 接口
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
 * 实现 SDK 的 NonceManager 接口
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
   */
  async execute<T>(label: string, fn: (nonce: number) => Promise<T>): Promise<T> {
    const maxRetries = 3;
    let lastError: Error | null = null;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        // 预留 nonce
        const nonce = await this.reserveNonce(label);

        logger.debug(`[NonceManagerAdapter] 执行交易 (${label})`, {
          nonce,
          attempt,
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
          // Nonce 错误，重新同步并重试
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
   */
  reset(): void {
    this.nonceCursor = null;
    logger.debug('[NonceManagerAdapter] Nonce 已重置');
  }

  /**
   * 同步链上 nonce
   */
  private async syncNonce(reason: string): Promise<number> {
    const pending = await this.publicClient.getTransactionCount({
      address: this.account,
      blockTag: 'pending',
    });

    if (this.nonceCursor === null || pending > this.nonceCursor) {
      this.nonceCursor = pending;
    }

    logger.debug(`[NonceManagerAdapter] 已同步链上 nonce=${pending} (${reason})`);
    return pending;
  }

  /**
   * 预留 nonce
   */
  private async reserveNonce(reason: string): Promise<number> {
    if (this.nonceCursor === null) {
      await this.syncNonce(reason);
    }

    if (this.nonceCursor === null) {
      throw new Error('无法获取链上 nonce');
    }

    const reserved = this.nonceCursor;
    this.nonceCursor += 1;

    logger.debug(`[NonceManagerAdapter] 预留 nonce=${reserved} (${reason})`);
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
