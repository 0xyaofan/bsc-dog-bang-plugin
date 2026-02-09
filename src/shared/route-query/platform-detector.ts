/**
 * 平台检测器
 * 根据代币地址检测所属平台
 */

import { structuredLogger } from '../structured-logger.js';
import type { TokenPlatform } from './types.js';

/**
 * 平台检测器
 */
export class PlatformDetector {
  /**
   * 检测代币所属平台
   */
  detect(tokenAddress: string): TokenPlatform {
    const normalized = this.normalizeAddress(tokenAddress);

    // 验证地址格式
    if (!this.isValidAddress(normalized)) {
      structuredLogger.warn('[PlatformDetector] 无效的代币地址', { tokenAddress });
      return 'unknown';
    }

    // 检测平台
    const platform = this.detectByAddressPattern(normalized);

    structuredLogger.debug('[PlatformDetector] 平台检测完成', {
      tokenAddress: normalized,
      platform
    });

    return platform;
  }

  /**
   * 根据地址模式检测平台
   */
  private detectByAddressPattern(address: string): TokenPlatform {
    // Four.meme: 地址以 4444 或 ffff 结尾
    if (address.endsWith('4444') || address.endsWith('ffff')) {
      return 'four';
    }

    // XMode: 地址以 4444 开头
    if (address.startsWith('0x4444')) {
      return 'xmode';
    }

    // Flap: 地址以 7777 或 8888 结尾
    if (address.endsWith('7777') || address.endsWith('8888')) {
      return 'flap';
    }

    // Luna: 暂无特定模式，需要通过合约查询判断
    // 这里返回 unknown，让查询逻辑尝试所有平台

    // 不匹配任何发射台模式
    return 'unknown';
  }

  /**
   * 标准化地址
   */
  private normalizeAddress(address: string): string {
    return (address || '').toLowerCase();
  }

  /**
   * 验证地址格式
   */
  private isValidAddress(address: string): boolean {
    return /^0x[a-f0-9]{40}$/.test(address);
  }

  /**
   * 批量检测
   */
  detectBatch(tokenAddresses: string[]): Map<string, TokenPlatform> {
    const results = new Map<string, TokenPlatform>();

    for (const address of tokenAddresses) {
      const platform = this.detect(address);
      results.set(address.toLowerCase(), platform);
    }

    return results;
  }

  /**
   * 检测是否是发射台代币
   */
  isLaunchpadToken(tokenAddress: string): boolean {
    const platform = this.detect(tokenAddress);
    return platform !== 'unknown';
  }

  /**
   * 获取平台名称
   */
  getPlatformName(platform: TokenPlatform): string {
    const names: Record<TokenPlatform, string> = {
      four: 'Four.meme',
      xmode: 'XMode',
      flap: 'Flap',
      luna: 'Luna.fun',
      unknown: 'Unknown/PancakeSwap'
    };

    return names[platform] || 'Unknown';
  }
}

/**
 * 创建平台检测器实例
 */
export function createPlatformDetector(): PlatformDetector {
  return new PlatformDetector();
}

/**
 * 全局平台检测器实例
 */
export const platformDetector = new PlatformDetector();

/**
 * 便捷函数：检测代币平台
 */
export function detectTokenPlatform(tokenAddress: string): TokenPlatform {
  return platformDetector.detect(tokenAddress);
}
