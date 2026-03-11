# 非当前代币迁移完成时的插件行为分析

## 📋 问题描述

**场景**：用户已经离开代币A的页面（切换到代币B或其他页面），在此期间代币A从"迁移中"变成"已迁移完成"。

**问题**：插件会更新代币A的路由状态吗？

## 🔍 当前行为分析

### 1. 迁移监控机制

```typescript
// src/content/index.ts:4174
function startMigrationPolling(tokenAddress: string) {
  currentMigrationTokenAddress = tokenAddress;

  migrationPollingTimer = setInterval(() => {
    if (!isWalletLocked) {
      checkTokenMigrationStatus();  // 检查当前代币
    }
  }, 1000);
}

// src/content/index.ts:4113
async function checkTokenMigrationStatus() {
  const tokenAddress = currentTokenAddress;  // ⚠️ 只检查当前代币
  if (!tokenAddress || tokenAddress !== currentMigrationTokenAddress) {
    stopMigrationPolling();  // 切换代币时停止监控
    return;
  }
  // ...
}
```

**结论**：迁移监控**只针对当前代币**，切换代币时会停止监控。

### 2. Background 路由推送机制

检查 Background 是否推送路由状态变化：

```typescript
// src/background/index.ts
// ❌ 没有找到路由状态变化的推送机制

// 只有这些推送：
pushTokenBalanceToAllTabs(tokenAddress, { balance })  // ✓ 余额推送
pushWalletStatusToAllTabs()                           // ✓ 钱包状态推送
broadcastToContentPorts({ action: 'tx_confirmed' })   // ✓ 交易确认推送

// ❌ 没有路由状态推送，例如：
// pushTokenRouteToAllTabs(tokenAddress, { route })  // 不存在
```

**结论**：Background **不会主动推送路由状态变化**。

### 3. Content Script 路由缓存刷新

```typescript
// src/content/index.ts:4212
function startRouteCacheRefreshTimer() {
  // 每5分钟检查一次
  routeCacheRefreshTimer = setInterval(() => {
    if (!document.hidden && !isWalletLocked) {
      refreshRouteCacheIfNeeded();
    }
  }, 5 * 60 * 1000);
}

// src/content/index.ts:4068
async function refreshRouteCacheIfNeeded() {
  const tokenAddress = currentTokenAddress;  // ⚠️ 只刷新当前代币
  if (!tokenAddress) {
    return;
  }
  // ...
}
```

**结论**：定时刷新也**只针对当前代币**。

## ❌ 当前行为（非当前代币迁移完成）

### 时间线

```
T0: 用户在代币A页面
    ├─ currentTokenAddress = 0xAAA
    ├─ route: { progress: 0.9, readyForPancake: false }
    └─ startMigrationPolling(0xAAA)  // 启动监控

T1: 用户切换到代币B页面
    ├─ currentTokenAddress = 0xBBB
    ├─ checkTokenMigrationStatus()
    │   └─ tokenAddress(0xBBB) !== currentMigrationTokenAddress(0xAAA)
    │       └─ stopMigrationPolling()  // ⚠️ 停止监控代币A
    └─ 代币A不再被监控

T2: [用户不在代币A页面期间] 代币A迁移完成
    ├─ 链上状态：readyForPancake = true
    ├─ Background: 路由缓存可能已过期（TTL很短）
    └─ Content Script: 没有任何机制知道这个变化 ❌

T3: 用户切回代币A页面
    ├─ currentTokenAddress = 0xAAA
    ├─ loadTokenRoute(0xAAA)
    │   └─ 调用 Background: get_token_route
    │       ├─ 检查缓存
    │       ├─ 如果缓存过期 → 重新查询 Four.meme API
    │       └─ 返回最新状态：readyForPancake = true ✓
    └─ 显示正确状态（但经历了延迟）
```

### 问题

1. **延迟感知**：用户切回代币A时，需要重新加载路由才能看到迁移完成
2. **缓存过期**：如果离开时间够长，缓存可能已过期，需要重新查询API（增加延迟）
3. **无主动通知**：用户不知道代币A已经迁移完成

## ✅ 使用多代币缓存后的行为

### 方案1：被动更新（推荐，简单实用）

```typescript
// Content Script: TokenInfoCache
class ContentTokenInfoCache {
  private cache = new Map<string, CachedTokenInfo>();

  // 接收 Background 推送
  update(tokenAddress: string, data: {
    tokenInfo: TokenInfo;
    version: number;
  }) {
    // ✅ 更新缓存（无论是否为当前代币）
    this.cache.set(tokenAddress, {
      data: data.tokenInfo,
      version: data.version,
      receivedAt: Date.now()
    });

    // 只有当前代币才更新UI
    if (tokenAddress === this.currentTokenAddress) {
      this.notifyUI();
    }
  }
}

// 用户切回代币A
async function onTokenChange(newTokenAddress: string) {
  // ✅ 从缓存恢复
  const cached = contentTokenCache.get(newTokenAddress);

  if (cached && isFresh(cached)) {
    // 立即显示缓存的数据（可能包含最新的余额）
    currentTokenInfo = cached.data;
    updateUI();

    // 但路由状态可能过期，异步刷新
    loadTokenRoute(newTokenAddress).then(route => {
      if (route.readyForPancake !== currentTokenRoute?.readyForPancake) {
        // 迁移状态有变化，更新UI
        applyTokenRouteToUI(route);
      }
    });
  } else {
    // 缓存过期或不存在，重新加载
    await loadTokenInfo(newTokenAddress);
  }
}
```

**行为**：
- ✅ 余额数据能保留（通过 Background 推送）
- ⚠️ 路由状态仍需要重新查询（因为没有路由推送）
- ✅ 但有缓存兜底，体验更好

### 方案2：主动推送（完美，但复杂）

需要实现路由状态推送机制。

#### 2.1 Background 定时检测所有代币的迁移状态

```typescript
// src/background/token-route-monitor.ts
class TokenRouteMontior {
  private monitoredTokens = new Set<string>();
  private monitorTimer: NodeJS.Timeout | null = null;

  /**
   * 添加代币到监控列表
   */
  addToken(tokenAddress: string, route: RouteInfo) {
    if (route.progress >= 0.8 && !route.readyForPancake) {
      this.monitoredTokens.add(tokenAddress);
      this.startMonitoring();
    }
  }

  /**
   * 启动监控（每5秒检查一次）
   */
  private startMonitoring() {
    if (this.monitorTimer) return;

    this.monitorTimer = setInterval(async () => {
      for (const tokenAddress of this.monitoredTokens) {
        await this.checkMigrationStatus(tokenAddress);
      }
    }, 5000); // 5秒
  }

  /**
   * 检查单个代币的迁移状态
   */
  private async checkMigrationStatus(tokenAddress: string) {
    try {
      // 强制刷新路由
      const route = await fetchRouteWithFallback(
        publicClient,
        tokenAddress,
        detectTokenPlatform(tokenAddress)
      );

      // 检查是否迁移完成
      if (route.readyForPancake && route.preferredChannel === 'pancake') {
        logger.info('[RouteMonitor] 检测到代币迁移完成:', tokenAddress);

        // 从监控列表移除
        this.monitoredTokens.delete(tokenAddress);

        // 推送到所有 Tab
        broadcastToContentPorts({
          action: 'token_route_updated',
          data: {
            tokenAddress,
            route,
            migrationCompleted: true
          }
        });
      }
    } catch (error) {
      logger.debug('[RouteMonitor] 检查失败:', tokenAddress, error);
    }
  }
}

// 单例
export const tokenRouteMonitor = new TokenRouteMontior();
```

#### 2.2 Content Script 接收路由推送

```typescript
// src/content/index.ts
class ContentTokenInfoCache {
  // ...

  /**
   * 更新路由状态（接收 Background 推送）
   */
  updateRoute(tokenAddress: string, route: RouteInfo) {
    const cached = this.cache.get(tokenAddress);

    if (cached) {
      // 更新路由信息
      cached.route = route;
      cached.routeUpdatedAt = Date.now();
      this.cache.set(tokenAddress, cached);

      logger.debug('[ContentTokenCache] 路由已更新', {
        tokenAddress,
        readyForPancake: route.readyForPancake
      });
    }

    // 如果是当前代币，更新UI
    if (tokenAddress === this.currentTokenAddress) {
      applyTokenRouteToUI(route);

      // 如果迁移完成，显示通知
      if (route.readyForPancake) {
        showNotification({
          title: '代币已迁移',
          message: '代币已迁移到 PancakeSwap'
        });
      }
    }
  }
}

// 消息监听
chrome.runtime.onMessage.addListener((message) => {
  if (message.action === 'token_route_updated') {
    const { tokenAddress, route } = message.data;
    contentTokenCache.updateRoute(tokenAddress, route);
  }
});
```

#### 2.3 集成到现有流程

```typescript
// src/background/index.ts

// 用户查询路由时，添加到监控
async function handleGetTokenRoute({ tokenAddress, force }) {
  // ... 获取路由
  const route = await resolveTokenRoute(tokenAddress);

  // 如果代币正在迁移，添加到监控
  if (route.progress >= 0.8 && !route.readyForPancake) {
    tokenRouteMonitor.addToken(tokenAddress, route);
  }

  return { success: true, data: route };
}
```

## 📊 方案对比

| 方案 | 非当前代币迁移完成时的行为 | 实施难度 | 用户体验 |
|------|---------------------------|---------|---------|
| **当前实现** | ❌ 不更新，切回时重新查询 | - | ⭐⭐ 差 |
| **方案1：被动更新** | ⚠️ 余额更新，路由需重新查询 | ⭐ 低 | ⭐⭐⭐ 好 |
| **方案2：主动推送** | ✅ 完全更新，实时通知 | ⭐⭐⭐ 高 | ⭐⭐⭐⭐⭐ 完美 |

## 💡 推荐实施策略

### 阶段1：实施方案1（1-2天）

**优先级**：🔴 高

**理由**：
- 实施简单，只需要实现多代币缓存
- 能解决90%的快速买卖问题（余额缓存）
- 路由状态虽然不实时，但切回时会刷新

**收益**：
- ✅ 解决买入后余额为0的问题
- ✅ 解决切换代币丢失余额的问题
- ✅ 减少不必要的链上查询

### 阶段2：实施方案2（可选，3-4天）

**优先级**：🟡 中

**理由**：
- 提供完美的用户体验
- 但实施复杂度高
- 需要 Background 常驻监控

**收益**：
- ✅ 实时感知代币迁移完成
- ✅ 切回代币时立即显示正确状态
- ✅ 可以主动通知用户

**何时实施**：
- 如果用户反馈"切回代币时需要等待"
- 如果需要"代币迁移完成通知"功能

## 🎯 总结

### 当前行为

**非当前代币迁移完成时**：
- ❌ 不会更新
- ❌ 不会通知
- ⚠️ 切回时需要重新查询（可能有延迟）

### 方案1实施后

**非当前代币迁移完成时**：
- ✅ 余额会更新（通过余额推送）
- ⚠️ 路由状态不会更新（没有路由推送）
- ✅ 切回时从缓存恢复（余额正确，路由异步刷新）

### 方案2实施后

**非当前代币迁移完成时**：
- ✅ 余额会更新
- ✅ 路由状态会更新
- ✅ 可以主动通知用户
- ✅ 切回时立即显示正确状态

## 🚀 行动建议

1. **立即实施**：方案1（多代币缓存）
   - 解决当前最痛的问题（快速买卖余额为0）
   - 实施简单，风险低

2. **观察反馈**：收集用户反馈
   - 是否有用户抱怨"切回代币时状态不对"
   - 是否需要"迁移完成通知"功能

3. **按需实施**：方案2（路由监控+推送）
   - 如果用户有需求，再实施
   - 优先级低于快速买卖问题

是否继续实施方案1（多代币缓存）？
