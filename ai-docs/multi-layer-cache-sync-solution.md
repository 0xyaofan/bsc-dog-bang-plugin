# 多层缓存同步解决方案

## 📋 问题分析

### 当前缓存架构

```
┌─────────────────────────────────────────────────────────────┐
│                    链上真实数据 (Source of Truth)              │
│                   balance: 1000000000000000000                │
└─────────────────────────────────────────────────────────────┘
                              ↑
                              │ RPC查询
                              ↓
┌─────────────────────────────────────────────────────────────┐
│              Background Layer (Service Worker)               │
│  ┌────────────────────────────────────────────────────────┐  │
│  │ tokenInfoCache: Map<cacheKey, TokenInfo>               │  │
│  │ - balance: "1000000000000000000"                       │  │
│  │ - updatedAt: 1234567890                                │  │
│  │ - TTL: 2000ms                                          │  │
│  └────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────┘
                              ↑
                              │ Chrome消息传递
                              ↓
┌─────────────────────────────────────────────────────────────┐
│                Content Script Layer (每个Tab独立)             │
│  ┌────────────────────────────────────────────────────────┐  │
│  │ currentTokenInfo: TokenInfo | null                     │  │
│  │ - balance: "1000000000000000000"                       │  │
│  │ - 只保存当前代币                                         │  │
│  │ - 切换代币时清空                                         │  │
│  └────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────┘
                              ↑
                              │ DOM更新
                              ↓
┌─────────────────────────────────────────────────────────────┐
│                      UI Display Layer                        │
│  ┌────────────────────────────────────────────────────────┐  │
│  │ DOM元素 #token-balance                                  │  │
│  │ textContent: "1.000"                                   │  │
│  └────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────┘
```

### 核心问题

1. **数据流向不统一**
   - Background → Content → UI：正常推送流程
   - Content → Background → Content：查询流程
   - UI → Content → Background：交易流程
   - 多个数据流路径，容易不同步

2. **缓存生命周期不一致**
   - Background: TTL=2秒，交易后清除
   - Content: 代币切换时清除，无TTL
   - UI: 手动更新，无缓存机制

3. **更新时机不确定**
   - 买入后：清除缓存 → 等待确认 → 500ms延迟 → 刷新
   - 卖出前：可能使用过期的currentTokenInfo
   - 切换代币：推送更新可能丢失

4. **缺少版本控制**
   - 无法判断哪个缓存层的数据更新
   - 可能用旧数据覆盖新数据

## 🎯 解决方案设计

### 核心思想

**实现单一数据源（Single Source of Truth）+ 版本化缓存 + 统一更新通道**

### 方案架构

```
┌─────────────────────────────────────────────────────────────┐
│                    链上真实数据 (Ultimate Truth)              │
└─────────────────────────────────────────────────────────────┘
                              ↑
                              │
                              ↓
┌─────────────────────────────────────────────────────────────┐
│            Background: TokenInfoStore (唯一数据源)            │
│  ┌────────────────────────────────────────────────────────┐  │
│  │ tokenInfoStore: Map<tokenAddress, TokenInfoEntry>     │  │
│  │                                                        │  │
│  │ TokenInfoEntry {                                      │  │
│  │   data: TokenInfo,        // 实际数据                  │  │
│  │   version: number,        // 版本号（递增）             │  │
│  │   updatedAt: number,      // 更新时间                  │  │
│  │   source: 'chain'|'tx',   // 数据来源                  │  │
│  │   confidence: 0-100       // 数据可信度                │  │
│  │ }                                                      │  │
│  └────────────────────────────────────────────────────────┘  │
│                                                              │
│  统一更新接口：                                               │
│  - updateTokenInfo(address, data, source)                  │
│  - invalidateTokenInfo(address)                            │
│  - getTokenInfo(address, maxAge?)                          │
│                                                              │
│  统一推送机制：                                               │
│  - pushTokenInfoUpdate(address, entry)                     │
│    → 推送到所有监听的Content Script                          │
└─────────────────────────────────────────────────────────────┘
                              ↑
                              │ 订阅/推送
                              ↓
┌─────────────────────────────────────────────────────────────┐
│          Content Script: TokenInfoCache (订阅者缓存)          │
│  ┌────────────────────────────────────────────────────────┐  │
│  │ tokenInfoCache: Map<tokenAddress, CachedTokenInfo>    │  │
│  │                                                        │  │
│  │ CachedTokenInfo {                                     │  │
│  │   data: TokenInfo,                                    │  │
│  │   version: number,        // 从Background同步          │  │
│  │   receivedAt: number,     // 接收时间                  │  │
│  │   isStale: boolean        // 是否过期                  │  │
│  │ }                                                      │  │
│  │                                                        │  │
│  │ currentTokenAddress: string                           │  │
│  └────────────────────────────────────────────────────────┘  │
│                                                              │
│  辅助方法：                                                   │
│  - getTokenInfo(address): 从Map获取                         │
│  - getCurrentTokenInfo(): 快捷获取当前代币                   │
│  - isTokenInfoFresh(address, maxAge): 检查新鲜度            │
└─────────────────────────────────────────────────────────────┘
                              ↑
                              │
                              ↓
┌─────────────────────────────────────────────────────────────┐
│                    UI Display Layer                          │
│  - 只读取Content Script的缓存                                │
│  - 不维护自己的状态                                           │
└─────────────────────────────────────────────────────────────┘
```

## 🔧 实施细节

### 1. Background Layer: TokenInfoStore

#### 1.1 数据结构定义

```typescript
// src/background/token-info-store.ts

/**
 * 代币信息条目
 */
interface TokenInfoEntry {
  data: TokenInfo;           // 实际的代币数据
  version: number;           // 版本号（每次更新递增）
  updatedAt: number;         // 更新时间戳
  source: 'chain' | 'tx' | 'optimistic';  // 数据来源
  confidence: number;        // 数据可信度 0-100
}

/**
 * 代币信息存储（单例）
 */
class TokenInfoStore {
  private store = new Map<string, TokenInfoEntry>();
  private versionCounter = 0;

  /**
   * 获取代币信息
   */
  get(tokenAddress: string, walletAddress: string, options?: {
    maxAge?: number;          // 最大年龄（ms），超过则认为过期
    minConfidence?: number;   // 最小可信度，低于则认为不可用
  }): TokenInfoEntry | null {
    const key = this.getCacheKey(tokenAddress, walletAddress);
    const entry = this.store.get(key);

    if (!entry) {
      return null;
    }

    // 检查年龄
    const age = Date.now() - entry.updatedAt;
    const maxAge = options?.maxAge ?? 10000; // 默认10秒
    if (age > maxAge) {
      logger.debug('[TokenInfoStore] 缓存过期', { tokenAddress, age, maxAge });
      return null;
    }

    // 检查可信度
    const minConfidence = options?.minConfidence ?? 50;
    if (entry.confidence < minConfidence) {
      logger.debug('[TokenInfoStore] 可信度不足', {
        tokenAddress,
        confidence: entry.confidence,
        minConfidence
      });
      return null;
    }

    return entry;
  }

  /**
   * 更新代币信息
   */
  set(tokenAddress: string, walletAddress: string, data: TokenInfo, options: {
    source: 'chain' | 'tx' | 'optimistic';
    confidence?: number;
  }): TokenInfoEntry {
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

    // 推送更新到所有Content Script
    this.pushUpdate(tokenAddress, entry);

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
   * 推送更新到所有Content Script
   */
  private pushUpdate(tokenAddress: string, entry: TokenInfoEntry): void {
    broadcastToContentPorts({
      action: 'token_info_updated',
      data: {
        tokenAddress,
        tokenInfo: entry.data,
        version: entry.version,
        updatedAt: entry.updatedAt,
        source: entry.source
      }
    });
  }

  private getCacheKey(tokenAddress: string, walletAddress: string): string {
    return `${tokenAddress.toLowerCase()}:${walletAddress.toLowerCase()}`;
  }
}

// 单例
export const tokenInfoStore = new TokenInfoStore();
```

#### 1.2 集成到现有代码

```typescript
// src/background/index.ts

// 替换 tokenInfoCache 的使用
function writeCachedTokenInfo(
  tokenAddress: string,
  walletAddress: string,
  data: TokenInfo,
  source: 'chain' | 'tx' = 'chain'
): void {
  tokenInfoStore.set(tokenAddress, walletAddress, data, { source });
}

function readCachedTokenInfo(
  tokenAddress: string,
  walletAddress: string,
  needAllowances: boolean
): TokenInfo | null {
  const entry = tokenInfoStore.get(tokenAddress, walletAddress, {
    maxAge: 10000,      // 10秒
    minConfidence: 80   // 至少80%可信度
  });

  if (!entry) {
    return null;
  }

  // 检查是否需要授权信息
  if (needAllowances && !entry.data.hasAllowances) {
    return null;
  }

  return entry.data;
}

function invalidateTokenInfoCache(tokenAddress: string, walletAddress: string): void {
  tokenInfoStore.invalidate(tokenAddress, walletAddress);
}
```

### 2. Content Script Layer: TokenInfoCache

#### 2.1 数据结构

```typescript
// src/content/token-info-cache.ts

/**
 * Content Script 端的代币信息缓存
 */
interface CachedTokenInfo {
  data: TokenInfo;
  version: number;        // 从Background同步的版本号
  receivedAt: number;     // 接收时间
  source: 'chain' | 'tx' | 'optimistic';
}

class ContentTokenInfoCache {
  private cache = new Map<string, CachedTokenInfo>();
  private currentTokenAddress: string | null = null;

  /**
   * 获取代币信息
   */
  get(tokenAddress: string, options?: {
    maxAge?: number;
  }): TokenInfo | null {
    const cached = this.cache.get(tokenAddress.toLowerCase());

    if (!cached) {
      return null;
    }

    // 检查是否过期
    const age = Date.now() - cached.receivedAt;
    const maxAge = options?.maxAge ?? 15000; // 默认15秒

    if (age > maxAge) {
      logger.debug('[ContentTokenCache] 缓存过期', { tokenAddress, age });
      return null;
    }

    return cached.data;
  }

  /**
   * 更新缓存（接收Background推送）
   */
  update(tokenAddress: string, data: {
    tokenInfo: TokenInfo;
    version: number;
    updatedAt: number;
    source: 'chain' | 'tx' | 'optimistic';
  }): void {
    const key = tokenAddress.toLowerCase();
    const existing = this.cache.get(key);

    // 版本检查：只接受更新的版本
    if (existing && existing.version >= data.version) {
      logger.debug('[ContentTokenCache] 忽略旧版本', {
        tokenAddress,
        existingVersion: existing.version,
        newVersion: data.version
      });
      return;
    }

    const cached: CachedTokenInfo = {
      data: data.tokenInfo,
      version: data.version,
      receivedAt: Date.now(),
      source: data.source
    };

    this.cache.set(key, cached);

    logger.debug('[ContentTokenCache] 更新缓存', {
      tokenAddress,
      version: data.version,
      source: data.source
    });

    // 如果是当前代币，触发UI更新
    if (tokenAddress.toLowerCase() === this.currentTokenAddress?.toLowerCase()) {
      this.notifyCurrentTokenUpdated(cached.data);
    }
  }

  /**
   * 获取当前代币信息
   */
  getCurrent(): TokenInfo | null {
    if (!this.currentTokenAddress) {
      return null;
    }
    return this.get(this.currentTokenAddress);
  }

  /**
   * 设置当前代币地址
   */
  setCurrentToken(tokenAddress: string): void {
    this.currentTokenAddress = tokenAddress.toLowerCase();
  }

  /**
   * 检查缓存是否新鲜
   */
  isFresh(tokenAddress: string, maxAge: number = 5000): boolean {
    const cached = this.cache.get(tokenAddress.toLowerCase());
    if (!cached) {
      return false;
    }
    const age = Date.now() - cached.receivedAt;
    return age < maxAge;
  }

  /**
   * 清除缓存
   */
  clear(tokenAddress?: string): void {
    if (tokenAddress) {
      this.cache.delete(tokenAddress.toLowerCase());
    } else {
      this.cache.clear();
    }
  }

  /**
   * 通知UI更新
   */
  private notifyCurrentTokenUpdated(tokenInfo: TokenInfo): void {
    // 更新全局变量
    currentTokenInfo = tokenInfo;

    // 更新UI显示
    updateTokenBalanceDisplay(this.currentTokenAddress!);

    logger.debug('[ContentTokenCache] 当前代币已更新', {
      tokenAddress: this.currentTokenAddress,
      balance: tokenInfo.balance
    });
  }
}

// 单例
export const contentTokenCache = new ContentTokenInfoCache();
```

#### 2.2 集成到现有代码

```typescript
// src/content/index.ts

// 替换 currentTokenInfo 的使用

// 初始化
const contentTokenCache = new ContentTokenInfoCache();

// 代币切换
async function onTokenChange(newTokenAddress: string) {
  contentTokenCache.setCurrentToken(newTokenAddress);

  // 尝试从缓存获取
  const cached = contentTokenCache.get(newTokenAddress, { maxAge: 10000 });

  if (cached) {
    logger.debug('[Dog Bang] 使用缓存的代币信息');
    currentTokenInfo = cached;
    updateTokenBalanceDisplay(newTokenAddress);

    // 异步刷新授权（如果需要）
    if (!cached.allowances) {
      updateTokenAllowances(newTokenAddress);
    }
  } else {
    // 缓存未命中，加载
    currentTokenInfo = null;
    await loadTokenInfo(newTokenAddress);
  }
}

// 接收Background推送
function handleTokenInfoUpdate(data: {
  tokenAddress: string;
  tokenInfo: TokenInfo;
  version: number;
  updatedAt: number;
  source: 'chain' | 'tx' | 'optimistic';
}) {
  contentTokenCache.update(data.tokenAddress, data);
}

// 消息监听器
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === 'token_info_updated') {
    handleTokenInfoUpdate(message.data);
  }
  // ... 其他消息
});

// 卖出前获取代币信息
async function handleSell(tokenAddress: string, percent: string, slippage: string, gasPrice: string, channel: string) {
  // ... 前置检查

  // 获取代币信息
  let tokenInfo = contentTokenCache.getCurrent();

  // 检查是否新鲜
  const isFresh = contentTokenCache.isFresh(tokenAddress, 3000); // 3秒内认为新鲜

  if (!isFresh || !tokenInfo) {
    logger.debug('[Sell] 缓存不新鲜或不存在，强制刷新');
    await updateTokenBalance(tokenAddress);
    tokenInfo = contentTokenCache.getCurrent();
  }

  // 发送卖出请求
  const response = await sendMessageViaAdapter({
    action: 'sell_token',
    data: {
      tokenAddress,
      percent: parseFloat(percent),
      slippage: parseFloat(slippage),
      gasPrice: parseFloat(gasPrice),
      channel,
      tokenInfo
    }
  });

  // ...
}
```

### 3. 统一更新流程

#### 3.1 买入成功后的更新流程

```typescript
// src/background/index.ts

// 交易确认回调
async function onTxConfirmed(receipt, tradeContext) {
  const { tokenAddress, type } = tradeContext;
  const isSuccess = receipt.status === 'success';

  if (isSuccess && tokenAddress && walletAccount?.address) {
    // 🚀 立即刷新缓存（移除500ms延迟）
    logger.debug('[TxWatcher] 交易成功，立即刷新代币信息');

    // 清除缓存
    invalidateWalletDerivedCaches(walletAccount.address, tokenAddress, {
      allowances: type === 'sell'
    });

    // 立即查询链上余额
    await refreshTokenInfoAfterTx(tokenAddress, {
      includeAllowances: type === 'sell'
    });

    // 推送钱包状态更新（包含BNB余额）
    pushWalletStatusToAllTabs();
  }
}

// 刷新代币信息
async function refreshTokenInfoAfterTx(
  tokenAddress: string,
  options: { includeAllowances: boolean }
): Promise<void> {
  if (!walletAccount?.address) {
    return;
  }

  try {
    // 查询链上数据
    const latestInfo = await fetchTokenInfoData(
      tokenAddress,
      walletAccount.address,
      options.includeAllowances
    );

    // 🚀 使用 TokenInfoStore 更新（自动推送）
    tokenInfoStore.set(
      tokenAddress,
      walletAccount.address,
      latestInfo,
      { source: 'chain' } // 标记为链上查询，可信度100%
    );

    logger.debug('[Background] 代币信息已刷新并推送', {
      tokenAddress,
      balance: latestInfo.balance
    });
  } catch (error) {
    logger.error('[Background] 刷新代币信息失败:', error);
  }
}
```

#### 3.2 卖出前的验证流程

```typescript
// src/content/index.ts

async function handleSell(tokenAddress: string, percent: string, ...) {
  // 检查是否有待确认的买入
  const hasPendingBuy = Array.from(pendingTransactions.values())
    .some(tx => tx.type === 'buy' && tx.token === tokenAddress);

  // 🚀 改进的余额检查逻辑
  let tokenInfo = contentTokenCache.getCurrent();
  let shouldRefresh = false;

  if (hasPendingBuy) {
    // 有待确认的买入，必须刷新
    logger.debug('[Sell] 检测到待确认的买入，强制刷新余额');
    shouldRefresh = true;
  } else if (!tokenInfo) {
    // 缓存不存在
    logger.debug('[Sell] 缓存不存在，需要加载');
    shouldRefresh = true;
  } else if (!contentTokenCache.isFresh(tokenAddress, 3000)) {
    // 缓存超过3秒，认为不新鲜
    logger.debug('[Sell] 缓存不新鲜（>3秒），强制刷新');
    shouldRefresh = true;
  } else if (parseFloat(tokenInfo.balance || '0') === 0) {
    // 缓存余额为0，可能有问题
    logger.warn('[Sell] 缓存余额为0，强制刷新验证');
    shouldRefresh = true;
  }

  if (shouldRefresh) {
    await updateTokenBalance(tokenAddress);
    tokenInfo = contentTokenCache.getCurrent();

    // 刷新后再次检查
    if (!tokenInfo || parseFloat(tokenInfo.balance || '0') === 0) {
      throw new Error('代币余额为0，无法卖出');
    }
  }

  // 发送卖出请求（携带新鲜的tokenInfo）
  const response = await sendMessageViaAdapter({
    action: 'sell_token',
    data: {
      tokenAddress,
      percent: parseFloat(percent),
      slippage: parseFloat(slippage),
      gasPrice: parseFloat(gasPrice),
      channel,
      tokenInfo
    }
  });

  // ...
}
```

## 📊 数据流时序图

### 场景1: 买入成功后的缓存同步

```
用户         Content Script      Background        TokenInfoStore      链上
 │                │                    │                   │             │
 │  买入成功       │                    │                   │             │
 │───────────────>│  buy_token         │                   │             │
 │                │───────────────────>│                   │             │
 │                │                    │  交易发送成功        │             │
 │                │<───────────────────│                   │             │
 │                │                    │                   │             │
 │                │                    │  [等待交易确认]      │             │
 │                │                    │                   │             │
 │                │                    │  交易确认           │             │
 │                │                    │  ↓                │             │
 │                │                    │  invalidate缓存    │             │
 │                │                    │  ↓                │             │
 │                │                    │  查询链上余额        │             │
 │                │                    │──────────────────────────────────>│
 │                │                    │<──────────────────────────────────│
 │                │                    │  balance=1000      │             │
 │                │                    │  ↓                │             │
 │                │                    │  set(tokenInfo)    │             │
 │                │                    │───────────────────>│             │
 │                │                    │                   │ version++   │
 │                │                    │                   │ updatedAt   │
 │                │                    │                   │ confidence=100
 │                │                    │                   │ ↓           │
 │                │                    │                   │ pushUpdate() │
 │                │  token_info_updated│<──────────────────│             │
 │                │<───────────────────│ (广播)             │             │
 │                │                    │                   │             │
 │                │  update cache      │                   │             │
 │                │  version check ✓   │                   │             │
 │                │  ↓                 │                   │             │
 │                │  更新UI显示         │                   │             │
 │<───────────────│  余额: 1000        │                   │             │
 │  UI显示更新     │                    │                   │             │
```

### 场景2: 快速买入后卖出

```
用户         Content Script      Background        TokenInfoStore      链上
 │                │                    │                   │             │
 │  买入           │                    │                   │             │
 │───────────────>│                    │                   │             │
 │                │───────────────────>│                   │             │
 │  买入成功       │<───────────────────│                   │             │
 │<───────────────│  txHash            │                   │             │
 │                │                    │                   │             │
 │  [1秒后]        │                    │                   │             │
 │  点击卖出       │                    │                   │             │
 │───────────────>│  handleSell()      │                   │             │
 │                │  ↓                 │                   │             │
 │                │  检查缓存           │                   │             │
 │                │  hasPendingBuy=true│                   │             │
 │                │  isFresh=false     │                   │             │
 │                │  ↓                 │                   │             │
 │                │  强制刷新余额        │                   │             │
 │                │  get_token_info    │                   │             │
 │                │───────────────────>│                   │             │
 │                │                    │  get(tokenInfo)   │             │
 │                │                    │───────────────────>│             │
 │                │                    │<──────────────────│             │
 │                │                    │  缓存已过期 (null)  │             │
 │                │                    │  ↓                │             │
 │                │                    │  查询链上余额       │             │
 │                │                    │──────────────────────────────────>│
 │                │                    │<──────────────────────────────────│
 │                │                    │  balance=1000      │             │
 │                │                    │  ↓                │             │
 │                │                    │  set(tokenInfo)    │             │
 │                │                    │───────────────────>│             │
 │                │  tokenInfo         │<──────────────────│             │
 │                │<───────────────────│  (返回+推送)        │             │
 │                │  ↓                 │                   │             │
 │                │  update cache      │                   │             │
 │                │  ↓                 │                   │             │
 │                │  发送卖出请求       │                   │             │
 │                │  (携带新鲜tokenInfo)│                   │             │
 │                │───────────────────>│                   │             │
 │                │                    │  卖出交易          │             │
 │                │                    │  balance=1000 ✓   │             │
```

## ✅ 方案优势

### 1. 单一数据源
- Background的TokenInfoStore是唯一的数据源
- 所有更新通过统一接口
- 避免多处更新导致不一致

### 2. 版本控制
- 每次更新版本号递增
- Content Script接收推送时检查版本
- 自动忽略过期的数据

### 3. 可信度机制
- 根据数据来源设置可信度
- 链上查询：100%
- 交易估算：90%
- 乐观更新：70%
- 可根据可信度决定是否使用

### 4. 自动同步
- Background更新时自动推送
- Content Script自动更新缓存
- 当前代币自动更新UI

### 5. 多代币缓存
- Content Script维护多个代币的缓存
- 切换代币不丢失数据
- 推送更新不会因切换代币而丢失

## 🔄 迁移路径

### 阶段1: 实现基础设施（1-2天）
1. 创建 `TokenInfoStore` 类
2. 创建 `ContentTokenInfoCache` 类
3. 添加推送机制

### 阶段2: 逐步迁移Background（2-3天）
1. 替换 `writeCachedTokenInfo` 使用TokenInfoStore
2. 替换 `readCachedTokenInfo` 使用TokenInfoStore
3. 更新交易确认回调

### 阶段3: 逐步迁移Content Script（2-3天）
1. 替换 `currentTokenInfo` 使用ContentTokenInfoCache
2. 更新余额显示逻辑
3. 更新卖出前验证逻辑

### 阶段4: 测试和优化（1-2天）
1. 单元测试
2. 集成测试
3. 性能测试

## 📝 总结

这个方案通过：
- **单一数据源**：TokenInfoStore
- **版本控制**：防止旧数据覆盖新数据
- **可信度机制**：根据数据来源判断可靠性
- **自动推送**：Background更新自动同步到所有Tab
- **多代币缓存**：Content Script维护多个代币的缓存

彻底解决多层缓存不同步的问题，确保快速买卖场景下数据的一致性和准确性。
