/**
 * ContentTokenInfoCache - Content Script 端的代币信息缓存
 * 支持多代币缓存，版本控制，自动同步
 */

import { logger } from '../shared/logger.js';

/**
 * 代币信息接口（与 Background 保持一致）
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
 * 缓存的代币信息
 */
interface CachedTokenInfo {
  data: TokenInfo;
  version: number; // 从 Background 同步的版本号
  receivedAt: number; // 接收时间
  source: 'chain' | 'tx' | 'optimistic';
}

/**
 * ContentTokenInfoCache 类
 * 管理 Content Script 端的多代币缓存
 */
export class ContentTokenInfoCache {
  private cache = new Map<string, CachedTokenInfo>();
  private currentTokenAddress: string | null = null;
  private updateCallback: ((tokenAddress: string, tokenInfo: TokenInfo) => void) | null = null;

  /**
   * 设置当前代币地址
   */
  setCurrentToken(tokenAddress: string | null): void {
    this.currentTokenAddress = tokenAddress;
  }

  /**
   * 设置更新回调（当当前代币更新时触发）
   */
  setUpdateCallback(callback: (tokenAddress: string, tokenInfo: TokenInfo) => void): void {
    this.updateCallback = callback;
  }

  /**
   * 获取代币信息
   */
  get(tokenAddress: string, options?: { maxAge?: number }): TokenInfo | null {
    const key = tokenAddress.toLowerCase();
    const cached = this.cache.get(key);

    if (!cached) {
      return null;
    }

    // 检查年龄
    if (options?.maxAge !== undefined) {
      const age = Date.now() - cached.receivedAt;
      if (age > options.maxAge) {
        logger.debug('[ContentTokenCache] 缓存过期', {
          tokenAddress,
          age,
          maxAge: options.maxAge
        });
        return null;
      }
    }

    return cached.data;
  }

  /**
   * 更新代币信息（接收 Background 推送）
   */
  update(
    tokenAddress: string,
    data: {
      tokenInfo: TokenInfo;
      version: number;
      updatedAt: number;
      source: 'chain' | 'tx' | 'optimistic';
    }
  ): void {
    const key = tokenAddress.toLowerCase();
    const existingCache = this.cache.get(key);

    // 版本控制：只接受更新的版本
    if (existingCache && existingCache.version >= data.version) {
      logger.debug('[ContentTokenCache] 忽略旧版本更新', {
        tokenAddress,
        existingVersion: existingCache.version,
        newVersion: data.version
      });
      return;
    }

    // 更新缓存
    this.cache.set(key, {
      data: data.tokenInfo,
      version: data.version,
      receivedAt: Date.now(),
      source: data.source
    });

    logger.debug('[ContentTokenCache] 缓存已更新', {
      tokenAddress,
      version: data.version,
      source: data.source
    });

    // 如果是当前代币，触发 UI 更新
    if (this.currentTokenAddress?.toLowerCase() === key && this.updateCallback) {
      this.updateCallback(tokenAddress, data.tokenInfo);
    }
  }

  /**
   * 设置代币信息（本地更新）
   */
  set(tokenAddress: string, tokenInfo: TokenInfo, version?: number): void {
    const key = tokenAddress.toLowerCase();
    this.cache.set(key, {
      data: tokenInfo,
      version: version ?? 0, // 本地更新版本号为 0
      receivedAt: Date.now(),
      source: 'chain'
    });

    logger.debug('[ContentTokenCache] 本地设置缓存', { tokenAddress });
  }

  /**
   * 删除代币缓存
   */
  delete(tokenAddress: string): void {
    const key = tokenAddress.toLowerCase();
    this.cache.delete(key);
    logger.debug('[ContentTokenCache] 删除缓存', { tokenAddress });
  }

  /**
   * 清除所有缓存
   */
  clear(): void {
    this.cache.clear();
    logger.debug('[ContentTokenCache] 清除所有缓存');
  }

  /**
   * 获取缓存大小
   */
  size(): number {
    return this.cache.size;
  }

  /**
   * 获取所有缓存的代币地址
   */
  getCachedTokens(): string[] {
    return Array.from(this.cache.keys());
  }
}

// 全局单例
export const contentTokenCache = new ContentTokenInfoCache();
