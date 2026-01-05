/**
 * Transaction Watcher Module for Chrome Extension
 * 直接连接 BSC WebSocket 节点实时监听交易确认
 *
 * 功能：
 * 1. 通过 WebSocket 连接到 BSC 节点监听新区块
 * 2. 检查待确认交易的状态
 * 3. 降级支持：WebSocket 失败时使用 HTTP 轮询
 */

import { createHttpClient } from './viem-helper.js';
import { NETWORK_CONFIG, TX_WATCHER_CONFIG, DEBUG_CONFIG } from './trading-config.js';
import type { Hash } from 'viem';

type PublicClient = ReturnType<typeof createHttpClient>;

interface TxConfirmationData {
  txHash: Hash;
  status: 'success' | 'failed' | 'timeout';
  blockNumber: number;
  gasUsed: string;
  timestamp: number;
  confirmationTime?: number;
  reason?: string;
}

interface WatchData {
  callback?: (data: TxConfirmationData) => void;
  startTime: number;
  pollInterval: ReturnType<typeof setInterval> | null;
  timeoutId: ReturnType<typeof setTimeout> | null;
}

export class TxWatcher {
  private httpClient: PublicClient | null;
  private wsSocket: WebSocket | null;
  private wsSubscriptionId: string | null;
  private wsSubscriptionRequestId: number | null;
  private connected: boolean;
  private currentWsUrlIndex: number;
  private reconnectAttempts: number;
  private watchingTxs: Map<Hash, WatchData>;
  private useWebSocket: boolean;
  private initializing: Promise<boolean> | null;

  constructor(publicClient: PublicClient | null = null) {
    this.httpClient = publicClient;
    this.wsSocket = null;
    this.wsSubscriptionId = null;
    this.wsSubscriptionRequestId = null;
    this.connected = false;
    this.currentWsUrlIndex = 0;
    this.reconnectAttempts = 0;
    this.watchingTxs = new Map();
    this.useWebSocket = true;
    this.initializing = null;
  }

  setClient(publicClient: PublicClient) {
    this.httpClient = publicClient;
  }

  /**
   * 初始化并连接到 BSC WebSocket 节点
   */
  async initialize() {
    if (!TX_WATCHER_CONFIG.ENABLED) {
      console.log('[TxWatcher] WebSocket 功能已禁用');
      this.useWebSocket = false;
      return false;
    }

    console.log('[TxWatcher] 初始化中...');
    this.useWebSocket = true;

    await this.ensureHttpClient();

    try {
      await this._connectWebSocket();
      return true;
    } catch (error) {
      console.warn('[TxWatcher] WebSocket 连接失败，降级到 HTTP 轮询:', error);
      this.useWebSocket = false;
      return true; // 轮询模式仍然可用
    }
  }

  /**
   * 连接到 WebSocket 节点
   */
  private async _connectWebSocket(): Promise<void> {
    if (!this.useWebSocket) {
      throw new Error('WebSocket 模式已禁用');
    }

    if (this.connected) {
      console.log('[TxWatcher] WebSocket 已连接');
      return;
    }

    this._cleanupWebSocket();

    const wsUrl = TX_WATCHER_CONFIG.BSC_WS_URLS[this.currentWsUrlIndex];
    console.log(`[TxWatcher] 尝试连接 WebSocket 节点: ${wsUrl}`);

    return new Promise<void>((resolve, reject) => {
      try {
        const socket = new WebSocket(wsUrl);
        this.wsSocket = socket;
        const subscribeRequestId = Date.now();
        this.wsSubscriptionRequestId = subscribeRequestId;
        let resolved = false;

        const timeout = setTimeout(() => {
          if (!resolved) {
            console.warn('[TxWatcher] WebSocket 连接超时');
            socket.close();
            reject(new Error('WebSocket 连接超时'));
          }
        }, TX_WATCHER_CONFIG.CONNECTION_TIMEOUT);

        socket.onopen = () => {
          socket.send(JSON.stringify({
            id: subscribeRequestId,
            method: 'eth_subscribe',
            params: ['newHeads']
          }));
        };

        socket.onmessage = (event) => {
          try {
            const payload = JSON.parse(event.data);

            if (payload.id === subscribeRequestId) {
              if (!payload.result) {
                throw new Error('订阅新区块失败');
              }

              resolved = true;
              clearTimeout(timeout);
              this.wsSubscriptionId = payload.result;
              this.connected = true;
              this.reconnectAttempts = 0;
              console.log('[TxWatcher] ✅ WebSocket 连接成功');
              resolve();
              return;
            }

            if (
              payload.method === 'eth_subscription' &&
              payload.params?.subscription === this.wsSubscriptionId
            ) {
              const blockNumberHex = payload.params?.result?.number;
              if (blockNumberHex) {
                const blockNumber = parseInt(blockNumberHex, 16);
                console.log(`[TxWatcher] 新区块: ${blockNumber}`);
              }
              this._checkPendingTransactions();
            }
          } catch (error) {
            console.warn('[TxWatcher] WebSocket 消息解析失败:', error);
          }
        };

        socket.onerror = (event) => {
          clearTimeout(timeout);
          if (!resolved) {
            reject(new Error('WebSocket 连接错误'));
          } else {
            console.error('[TxWatcher] WebSocket 错误:', event);
          }
        };

        socket.onclose = (event) => {
          clearTimeout(timeout);
          this.wsSocket = null;
          this.wsSubscriptionId = null;
          this.wsSubscriptionRequestId = null;

          if (!resolved) {
            reject(new Error('WebSocket 连接被关闭'));
            return;
          }

          console.warn('[TxWatcher] WebSocket 连接关闭:', event.code, event.reason);
          if (this.connected) {
            this.connected = false;
            this._handleConnectionError();
          }
        };
      } catch (error) {
        reject(error);
      }
    });
  }

  /**
   * 检查所有待确认交易
   * 优化：批量并发查询，减少总耗时
   */
  private async _checkPendingTransactions() {
    // 智能节流：无交易时跳过检查
    if (this.watchingTxs.size === 0 || !this.httpClient) {
      return;
    }

    const txHashes = Array.from(this.watchingTxs.keys());

    // 批量查询优化：并发查询所有交易
    const receiptPromises = txHashes.map(txHash =>
      this.httpClient.getTransactionReceipt({ hash: txHash })
        .then(receipt => ({ txHash, receipt }))
        .catch(() => ({ txHash, receipt: null }))
    );

    const results = await Promise.all(receiptPromises);

    for (const { txHash, receipt } of results) {
      if (receipt) {
        console.log(`[TxWatcher] ✅ 交易确认: ${txHash.substring(0, 10)}...`);
        const derivedStatus = receipt.status === 'success' ? 'success' : 'failed';
        const failureReason = derivedStatus === 'failed'
          ? receipt.status === 'reverted'
            ? '链上执行失败 (Reverted)'
            : '链上执行失败 (status = 0)'
          : undefined;

        const data: TxConfirmationData = {
          txHash,
          status: derivedStatus,
          blockNumber: Number(receipt.blockNumber),
          gasUsed: receipt.gasUsed?.toString?.() || '0',
          timestamp: Math.floor(Date.now() / 1000),
          reason: failureReason
        };

        this._handleTxConfirmed(txHash, data);
      }
    }
  }

  /**
   * 监听交易确认
   */
  async watchTransaction(txHash: Hash, callback?: (data: TxConfirmationData) => void, startTime: number | null = null) {
    await this.ensureHttpClient();

    const watchData: WatchData = {
      callback,
      startTime: startTime || Date.now(),
      pollInterval: null,
      timeoutId: null
    };

    this.watchingTxs.set(txHash, watchData);

    const timeoutMs = TX_WATCHER_CONFIG.TIMEOUT_MS || 60000;
    if (timeoutMs > 0) {
      watchData.timeoutId = setTimeout(() => this._handleTxTimeout(txHash), timeoutMs);
    }

    const useWs = await this.ensureWebSocketConnection();
    if (useWs) {
      console.log(`[TxWatcher] 👀 开始监听交易 (WebSocket): ${txHash.substring(0, 10)}...`);
      this._checkSingleTransaction(txHash);
      return true;
    }

    this._watchViaPolling(txHash, watchData);
    return true;
  }

  /**
   * 检查单个交易状态
   */
  private async _checkSingleTransaction(txHash: Hash) {
    const watchData = this.watchingTxs.get(txHash);
    if (!watchData || !this.httpClient) {
      return;
    }

    try {
      const receipt = await this.httpClient.getTransactionReceipt({ hash: txHash });

      if (receipt) {
        const derivedStatus = receipt.status === 'success' ? 'success' : 'failed';
        const failureReason = derivedStatus === 'failed'
          ? receipt.status === 'reverted'
            ? '链上执行失败 (Reverted)'
            : '链上执行失败 (status = 0)'
          : undefined;

        const data: TxConfirmationData = {
          txHash,
          status: derivedStatus,
          blockNumber: Number(receipt.blockNumber),
          gasUsed: receipt.gasUsed?.toString?.() || '0',
          timestamp: Math.floor(Date.now() / 1000),
          reason: failureReason
        };

        this._handleTxConfirmed(txHash, data);
      }
    } catch (error) {
      console.debug(`[TxWatcher] 交易 ${txHash.substring(0, 10)}... 尚未确认`);
    }
  }

  /**
   * 通过 HTTP 轮询监听交易
   */
  private _watchViaPolling(txHash: Hash, watchData: WatchData) {
    if (!this.httpClient) {
      console.warn('[TxWatcher] HTTP Client 未初始化，无法轮询');
      return;
    }

    if (DEBUG_CONFIG.ENABLED) {
      console.log(`[TxWatcher] 使用 HTTP 轮询模式监听: ${txHash.substring(0, 10)}...`);
    }

    const pollInterval = setInterval(async () => {
      try {
        const receipt = await this.httpClient.getTransactionReceipt({ hash: txHash });

        if (receipt) {
          clearInterval(pollInterval);

          const data: TxConfirmationData = {
            txHash,
            status: receipt.status === 'success' ? 'success' : 'failed',
            blockNumber: Number(receipt.blockNumber),
            gasUsed: receipt.gasUsed?.toString?.() || '0',
            timestamp: Math.floor(Date.now() / 1000),
            reason:
              receipt.status === 'success'
                ? undefined
                : receipt.status === 'reverted'
                  ? '链上执行失败 (Reverted)'
                  : '链上执行失败 (status = 0)'
          };

          this._handleTxConfirmed(txHash, data);
        }
      } catch (error) {
        console.debug(`[TxWatcher] 轮询 ${txHash.substring(0, 10)}... 尚未确认`);
      }
    }, TX_WATCHER_CONFIG.POLLING_INTERVAL);

    watchData.pollInterval = pollInterval;
  }

  /**
   * 为所有正在监听的交易启动轮询
   */
  _startPollingForWatchingTxs() {
    this.watchingTxs.forEach((watchData, txHash) => {
      if (!watchData.pollInterval) {
        this._watchViaPolling(txHash, watchData);
      }
    });
  }

  /**
   * 停止监听交易
   */
  unwatchTransaction(txHash: Hash) {
    const watchData = this.watchingTxs.get(txHash);

    if (!watchData) {
      return;
    }

    if (watchData.pollInterval) {
      clearInterval(watchData.pollInterval);
    }

    this.watchingTxs.delete(txHash);
    console.log(`[TxWatcher] 🚫 停止监听交易: ${txHash.substring(0, 10)}...`);
    this._maybeShutdownWebSocket();
  }

  /**
   * 处理交易确认通知
   */
  private _handleTxConfirmed(txHash: Hash, data: TxConfirmationData) {
    const watchData = this.watchingTxs.get(txHash);
    if (!watchData) {
      return;
    }

    if (watchData.pollInterval) {
      clearInterval(watchData.pollInterval);
    }
    if (watchData.timeoutId) {
      clearTimeout(watchData.timeoutId);
    }

    const confirmationTime = Date.now() - watchData.startTime;
    data.confirmationTime = confirmationTime;

    if (watchData.callback && typeof watchData.callback === 'function') {
      watchData.callback(data);
    }

    this.watchingTxs.delete(txHash);
    this._maybeShutdownWebSocket();
  }

  private _handleTxTimeout(txHash: Hash) {
    const watchData = this.watchingTxs.get(txHash);
    if (!watchData) {
      return;
    }

    if (watchData.pollInterval) {
      clearInterval(watchData.pollInterval);
    }
    if (watchData.timeoutId) {
      clearTimeout(watchData.timeoutId);
    }

    const data: TxConfirmationData = {
      txHash,
      status: 'timeout',
      blockNumber: -1,
      gasUsed: '0',
      timestamp: Math.floor(Date.now() / 1000),
      confirmationTime: Date.now() - watchData.startTime,
      reason: '交易超过设定时间未确认'
    };

    if (watchData.callback && typeof watchData.callback === 'function') {
      watchData.callback(data);
    }

    this.watchingTxs.delete(txHash);
    this._maybeShutdownWebSocket();
  }

  /**
   * 处理连接错误
   */
  private _handleConnectionError() {
    this.reconnectAttempts++;
    this.connected = false;

    if (this.reconnectAttempts >= TX_WATCHER_CONFIG.MAX_RECONNECT_ATTEMPTS) {
      console.error(`[TxWatcher] WebSocket 重连失败（${this.reconnectAttempts} 次尝试）`);
      console.log('[TxWatcher] 🔄 降级到 HTTP 轮询模式');
      this.useWebSocket = false;
      this._cleanupWebSocket();

      if (this.watchingTxs.size > 0) {
        this._startPollingForWatchingTxs();
      }
    } else {
      if (this.watchingTxs.size === 0) {
        this._cleanupWebSocket();
        return;
      }
      this.currentWsUrlIndex = (this.currentWsUrlIndex + 1) % TX_WATCHER_CONFIG.BSC_WS_URLS.length;
      console.log(`[TxWatcher] 尝试切换到下一个节点 (${this.reconnectAttempts}/${TX_WATCHER_CONFIG.MAX_RECONNECT_ATTEMPTS})`);

      setTimeout(() => {
        this._connectWebSocket().catch((error) => {
          console.error('[TxWatcher] 重连失败:', error);
          this._handleConnectionError();
        });
      }, TX_WATCHER_CONFIG.RECONNECT_DELAY);
    }
  }

  private _cleanupWebSocket() {
    if (this.wsSocket) {
      try {
        this.wsSocket.onopen = null;
        this.wsSocket.onmessage = null;
        this.wsSocket.onerror = null;
        this.wsSocket.onclose = null;
        this.wsSocket.close();
      } catch (error) {
        console.warn('[TxWatcher] 关闭旧 WebSocket 时出错:', error);
      }
    }
    this.wsSocket = null;
    this.wsSubscriptionId = null;
    this.wsSubscriptionRequestId = null;
    this.initializing = null;
  }

  /**
   * 断开连接
   */
  disconnect() {
    this._cleanupWebSocket();
    this.connected = false;
    console.log('[TxWatcher] 🔌 WebSocket 已断开');

    this.watchingTxs.forEach((watchData) => {
      if (watchData.pollInterval) {
        clearInterval(watchData.pollInterval);
      }
    });
  }

  hasActiveWatchers(): boolean {
    return this.watchingTxs.size > 0;
  }

  async forceReconnect() {
    this._cleanupWebSocket();
    this.connected = false;
    if (this.useWebSocket && this.watchingTxs.size > 0) {
      try {
        await this.ensureWebSocketConnection();
      } catch (error) {
        console.warn('[TxWatcher] 强制重连失败:', error);
      }
    }
  }

  /**
   * 检查是否已连接
   */
  isConnected(): boolean {
    return this.connected;
  }

  /**
   * 获取当前模式
   */
  getCurrentMode(): 'websocket' | 'connecting' | 'polling' {
    if (this.useWebSocket && this.connected) {
      return 'websocket';
    } else if (this.useWebSocket && !this.connected) {
      return 'connecting';
    } else {
      return 'polling';
    }
  }

  /**
   * 获取监听器状态
   */
  getStatus() {
    return {
      connected: this.connected,
      mode: this.getCurrentMode(),
      currentWsUrl: TX_WATCHER_CONFIG.BSC_WS_URLS[this.currentWsUrlIndex],
      watchingCount: this.watchingTxs.size,
      reconnectAttempts: this.reconnectAttempts
    };
  }

  private async ensureHttpClient() {
    if (!this.httpClient) {
      this.httpClient = createHttpClient(NETWORK_CONFIG.BSC_RPC);
    }
  }

  private async ensureWebSocketConnection(): Promise<boolean> {
    if (!TX_WATCHER_CONFIG.ENABLED) {
      this.useWebSocket = false;
      return false;
    }
    if (!this.useWebSocket) {
      return false;
    }
    if (this.connected) {
      return true;
    }
    if (this.initializing) {
      return this.initializing;
    }

    this.initializing = (async () => {
      await this.ensureHttpClient();
      try {
        await this._connectWebSocket();
        return true;
      } catch (error) {
        console.warn('[TxWatcher] WebSocket 初始化失败，降级至轮询:', error);
        this.useWebSocket = false;
        this.connected = false;
        return false;
      } finally {
        this.initializing = null;
      }
    })();

    return this.initializing;
  }

  private _maybeShutdownWebSocket() {
    // 优化：保持 WebSocket 连接，不关闭
    // 无交易时，newHeads 事件仍会触发，但 _checkPendingTransactions 会立即返回（智能节流）
    // 这样下次交易时无需重新建立连接，提升交易执行速度
    if (this.watchingTxs.size === 0) {
      if (DEBUG_CONFIG.ENABLED) {
        console.log('[TxWatcher] 无待确认交易，保持 WebSocket 连接以提升下次交易速度');
      }
    }
  }
}
