/**
 * TokenInfoStore - Background 端的代币信息存储
 * 单一数据源，版本控制，推送机制
 */

import { logger } from '../shared/logger.js';
import type { Address } from 'viem';

/**
 * 代币信息接口
 */
export interface TokenInfo {
  address: string;
  symbol: string;
  decimals: number;
  totalSupply: string;
  balance: string;
  allowances?: Record<string, string>;
  hasAllowances?: boolean;
}

/**
 * 代币信息条目（带版本和元数据）
 */
export interface TokenInfoEntry {
  data: TokenInfo;
  version: number;
  updatedAt: number;
  source: 'chain' | 'tx' | 'optimistic';
  confidence: number; // 0-100，数据可信度
}

/**
 * TokenInfoStore 类
 * 管理代币信息的单一数据源
 */
class TokenInfoStore {
  private store = new Map<string, TokenInfoEntry>();
  private versionCounter = 0;
  private pushCallback: ((tokenAddress: string, entry: TokenInfoEntry) => void) | null = null;

  /**
   * 设置推送回调
   */
  setPushCallback(callback: (tokenAddress: string, entry: TokenInfoEntry) => void): void {
    this.pushCallback = callback;
  }

  /**
   * 获取代币信息
   */
  get(
    tokenAddress: string,
    walletAddress: string,
    options?: {
      maxAge?: number;
      minConfidence?: number;
    }
  ): TokenInfoEntry | null {
    const key = this.getCacheKey(tokenAddress, walletAddress);
    const entry = this.store.get(key);

    if (!entry) {
      return null;
    }

    // 检查年龄
    if (options?.maxAge !== undefined) {
      const age = Date.now() - entry.updatedAt;
      if (age > options.maxAge) {
        logger.debug('[TokenInfoStore] 缓存过期', {
          tokenAddress,
          age,
          maxAge: options.maxAge
        });
        return null;
      }
    }

    // 检查可信度
    if (options?.minConfidence !== undefined) {
      if (entry.confidence < options.minConfidence) {
        logger.debug('[TokenInfoStore] 可信度不足', {
          tokenAddress,
          confidence: entry.confidence,
          minConfidence: options.minConfidence
        });
        return null;
      }
    }

    return entry;
  }

  /**
   * 更新代币信息
   */
  set(
    tokenAddress: string,
    walletAddress: string,
    data: TokenInfo,
    options: {
      source: 'chain' | 'tx' | 'optimistic';
      confidence?: number;
    }
  ): TokenInfoEntry {
    const key = this.getCacheKey(tokenAddress, walletAddress);
    const version = ++this.versionCounter;

    // 根据来源设置可信度
    let confidence = options.confidence ?? 100;
    if (options.source === 'optimistic') {
      confidence = 70; // 乐观更新的可信度较低
    } else if (options.source === 'tx') {
      confidence = 90; // 交易后的估算
    } else {
      confidence = 100; // 链上查询
    }

    const entry: TokenInfoEntry = {
      data,
      version,
      updatedAt: Date.now(),
      source: options.source,
      confidence
    };

    this.store.set(key, entry);

    logger.debug('[TokenInfoStore] 更新缓存', {
      tokenAddress,
      version,
      source: options.source,
      confidence
    });

    // 推送更新到所有 Content Script
    if (this.pushCallback) {
      this.pushCallback(tokenAddress, entry);
    }

    return entry;
  }

  /**
   * 使缓存失效
   */
  invalidate(tokenAddress: string, walletAddress: string): void {
    const key = this.getCacheKey(tokenAddress, walletAddress);
    this.store.delete(key);
    logger.debug('[TokenInfoStore] 清除缓存', { tokenAddress });
  }

  /**
   * 清除所有缓存
   */
  clear(): void {
    this.store.clear();
    logger.debug('[TokenInfoStore] 清除所有缓存');
  }

  /**
   * 获取缓存大小
   */
  size(): number {
    return this.store.size;
  }

  private getCacheKey(tokenAddress: string, walletAddress: string): string {
    return `${tokenAddress.toLowerCase()}:${walletAddress.toLowerCase()}`;
  }
}

// 单例
export const tokenInfoStore = new TokenInfoStore();
