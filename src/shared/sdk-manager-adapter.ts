/**
 * SDK Manager 适配器
 * 使用新的 @bsc-trading/manager 统一接口
 */

import type { Address } from 'viem';
import { createTradingManager, type TradingManager } from '@bsc-trading/manager';
import { sdkClientManager } from './sdk-client-manager.js';
import { logger } from './logger.js';
import { createPluginTradingConfig } from './config/sdk-config-adapter.js';

/**
 * SDK Manager 适配器
 */
export class SDKManagerAdapter {
  private manager: TradingManager | null = null;
  private initialized: boolean = false;

  /**
   * 初始化 TradingManager
   */
  async initialize(): Promise<void> {
    if (this.initialized && this.manager) {
      logger.debug('[SDKManagerAdapter] 已初始化，跳过');
      return;
    }

    try {
      const publicClient = sdkClientManager.getPublicClient();
      const walletClient = sdkClientManager.getWalletClient();
      const account = walletClient.account;

      if (!account) {
        throw new Error('Wallet account not found');
      }

      // 从用户偏好加载配置
      const tradingConfig = await createPluginTradingConfig();

      // 创建 TradingManager
      this.manager = createTradingManager({
        publicClient,
        walletClient,
        account,
        ...tradingConfig,
      });

      // 初始化（会自动加载所有服务和注册平台查询）
      await this.manager.initialize();

      this.initialized = true;
      logger.info('[SDKManagerAdapter] TradingManager 初始化完成', tradingConfig);
    } catch (error) {
      logger.error('[SDKManagerAdapter] 初始化失败', error);
      throw error;
    }
  }

  /**
   * 重置（钱包更新时调用）
   */
  reset(): void {
    this.manager = null;
    this.initialized = false;
    logger.debug('[SDKManagerAdapter] 已重置');
  }

  /**
   * 检查是否已初始化
   */
  isInitialized(): boolean {
    return this.initialized && this.manager !== null;
  }

  /**
   * 获取 TradingManager 实例
   */
  getManager(): TradingManager {
    if (!this.manager) {
      throw new Error('TradingManager not initialized');
    }
    return this.manager;
  }

  /**
   * 查询代币路由信息
   */
  async queryRoute(tokenAddress: Address) {
    if (!this.manager) {
      throw new Error('TradingManager not initialized');
    }

    return this.manager.queryRoute(tokenAddress);
  }

  /**
   * 批量查询路由信息
   */
  async queryRouteBatch(tokenAddresses: Address[]) {
    if (!this.manager) {
      throw new Error('TradingManager not initialized');
    }

    return this.manager.queryRouteBatch(tokenAddresses);
  }

  /**
   * 买入代币
   */
  async buyToken(params: {
    tokenAddress: Address;
    amountBnb: string | number;
    slippageBps?: number;
    channel?: string;
    gasPriceWei?: bigint;
    deadline?: number;
  }) {
    if (!this.manager) {
      throw new Error('TradingManager not initialized');
    }

    try {
      logger.info('[SDKManagerAdapter] 开始买入', {
        tokenAddress: params.tokenAddress,
        amountBnb: params.amountBnb,
        channel: params.channel,
      });

      const result = await this.manager.buy({
        tokenAddress: params.tokenAddress,
        amountBnb: params.amountBnb,
        slippage: params.slippageBps,
        channel: params.channel as any,
        gasPriceWei: params.gasPriceWei,
        deadline: params.deadline,
      });

      logger.info('[SDKManagerAdapter] 买入成功', {
        hash: result.hash,
        channel: result.channel,
      });

      return {
        status: 'success' as const,
        hash: result.hash,
        channel: result.channel,
        mode: result.mode,
        amountIn: result.amountIn,
        expectedAmountOut: result.expectedAmountOut,
        gasPrice: result.gasPrice,
        timestamp: result.timestamp,
      };
    } catch (error) {
      logger.error('[SDKManagerAdapter] 买入失败', error);
      return {
        status: 'error' as const,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * 卖出代币
   */
  async sellToken(params: {
    tokenAddress: Address;
    amountToken: string | number;
    slippageBps?: number;
    channel?: string;
    gasPriceWei?: bigint;
    deadline?: number;
  }) {
    if (!this.manager) {
      throw new Error('TradingManager not initialized');
    }

    try {
      logger.info('[SDKManagerAdapter] 开始卖出', {
        tokenAddress: params.tokenAddress,
        amountToken: params.amountToken,
        channel: params.channel,
      });

      const result = await this.manager.sell({
        tokenAddress: params.tokenAddress,
        amountToken: params.amountToken,
        slippage: params.slippageBps,
        channel: params.channel as any,
        gasPriceWei: params.gasPriceWei,
        deadline: params.deadline,
      });

      logger.info('[SDKManagerAdapter] 卖出成功', {
        hash: result.hash,
        channel: result.channel,
      });

      return {
        status: 'success' as const,
        hash: result.hash,
        channel: result.channel,
        mode: result.mode,
        amountIn: result.amountIn,
        expectedAmountOut: result.expectedAmountOut,
        gasPrice: result.gasPrice,
        timestamp: result.timestamp,
      };
    } catch (error) {
      logger.error('[SDKManagerAdapter] 卖出失败', error);
      return {
        status: 'error' as const,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * 获取报价
   */
  async getQuote(params: {
    tokenAddress: Address;
    amountIn: bigint;
    direction: 'buy' | 'sell';
    channel?: string;
    slippageBps?: number;
  }) {
    if (!this.manager) {
      throw new Error('TradingManager not initialized');
    }

    try {
      const result = await this.manager.getQuote({
        tokenAddress: params.tokenAddress,
        amountIn: params.amountIn,
        direction: params.direction,
        channel: params.channel as any,
        slippage: params.slippageBps,
      });

      return {
        status: 'success' as const,
        quote: result,
      };
    } catch (error) {
      logger.error('[SDKManagerAdapter] 获取报价失败', error);
      return {
        status: 'error' as const,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * 清除路由缓存
   */
  clearRouteCache(tokenAddress?: Address): void {
    if (!this.manager) {
      return;
    }

    this.manager.clearRouteCache(tokenAddress);
    logger.debug('[SDKManagerAdapter] 路由缓存已清除', { tokenAddress });
  }

  /**
   * 获取路由缓存统计
   */
  getRouteCacheStats() {
    if (!this.manager) {
      return { size: 0, maxSize: 0, entries: [] };
    }

    return this.manager.getRouteCacheStats();
  }

  /**
   * 获取配置
   */
  getConfig() {
    if (!this.manager) {
      return null;
    }

    return this.manager.getConfig();
  }

  /**
   * 更新配置
   */
  updateConfig(config: {
    defaultSlippage?: number;
    defaultDeadline?: number;
    enabledChannels?: string[];
    autoSelectBestChannel?: boolean;
  }): void {
    if (!this.manager) {
      return;
    }

    this.manager.updateConfig(config as any);
    logger.debug('[SDKManagerAdapter] 配置已更新', config);
  }
}

// 全局单例
export const sdkManagerAdapter = new SDKManagerAdapter();

// 导出 sdkClientManager 供外部使用
export { sdkClientManager } from './sdk-client-manager.js';
