/**
 * SDK 客户端管理器
 * 负责创建和管理 viem 客户端实例
 */

import { createPublicClient, createWalletClient, http, type PublicClient, type WalletClient, type Chain, type Transport } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { bsc } from 'viem/chains';
import { createSmartTransport, type TransportConfig } from '@bsc-trading/core';
import { logger } from './logger.js';

export class SDKClientManager {
  private publicClient: PublicClient | null = null;
  private walletClient: WalletClient | null = null;
  private transportManager: any = null;
  private transport: Transport | null = null;

  /**
   * 初始化客户端
   */
  async initialize(config: {
    rpcNodes: Array<{ url: string; priority?: number }>;
    privateKey?: string;
    chain?: Chain;
  }): Promise<void> {
    const chain = config.chain || bsc;

    // 创建 Smart Transport
    const transportConfig: TransportConfig = {
      nodes: config.rpcNodes.map((node, index) => ({
        id: `node-${index}`,
        url: node.url,
        priority: node.priority || 1,
        timeout: 5000,
      })),
      dynamicSelection: {
        enabled: true,
        interval: 30000,
        sampleCount: 10,
        latencyFloor: 50,
        switchThreshold: 0.2,
        minStableTime: 300000,
        weights: {
          latency: 0.5,
          stability: 0.3,
          successRate: 0.2,
        },
      },
    };

    const { transport, manager } = createSmartTransport(transportConfig);
    this.transport = transport;
    this.transportManager = manager;

    // 创建 Public Client
    this.publicClient = createPublicClient({
      chain,
      transport,
    }) as PublicClient;

    // 创建 Wallet Client（如果提供了私钥）
    if (config.privateKey) {
      const account = privateKeyToAccount(config.privateKey as `0x${string}`);
      this.walletClient = createWalletClient({
        account,
        chain,
        transport,
      }) as WalletClient;
    }

    logger.debug('[SDKClientManager] 客户端初始化完成');
  }

  /**
   * 更新钱包私钥
   */
  updateWallet(privateKey: string): void {
    if (!this.publicClient || !this.transport) {
      throw new Error('Public client not initialized');
    }

    const account = privateKeyToAccount(privateKey as `0x${string}`);
    this.walletClient = createWalletClient({
      account,
      chain: this.publicClient.chain,
      transport: this.transport,
    }) as WalletClient;

    logger.debug('[SDKClientManager] 钱包已更新');
  }

  /**
   * 清除钱包
   */
  clearWallet(): void {
    this.walletClient = null;
    logger.debug('[SDKClientManager] 钱包已清除');
  }

  /**
   * 获取 Public Client
   */
  getPublicClient(): PublicClient {
    if (!this.publicClient) {
      throw new Error('Public client not initialized');
    }
    return this.publicClient;
  }

  /**
   * 获取 Wallet Client
   */
  getWalletClient(): WalletClient {
    if (!this.walletClient) {
      throw new Error('Wallet client not initialized');
    }
    return this.walletClient;
  }

  /**
   * 检查是否已初始化
   */
  isInitialized(): boolean {
    return this.publicClient !== null;
  }

  /**
   * 检查钱包是否已设置
   */
  hasWallet(): boolean {
    return this.walletClient !== null;
  }

  /**
   * 获取 Transport Manager
   */
  getTransportManager(): any {
    return this.transportManager;
  }

  /**
   * 停止健康检查
   */
  destroy(): void {
    if (this.transportManager) {
      this.transportManager.stopHealthCheck();
    }
    this.publicClient = null;
    this.walletClient = null;
    this.transportManager = null;
    logger.debug('[SDKClientManager] 已销毁');
  }
}

// 全局单例
export const sdkClientManager = new SDKClientManager();
