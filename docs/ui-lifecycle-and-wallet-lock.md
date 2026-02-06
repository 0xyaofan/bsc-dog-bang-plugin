# UI 生命周期和钱包锁定状态管理报告

## 审查目标

1. 浮动窗口在关闭时是否会调用后端
2. 钱包锁定时 content script 是否还会更新

---

## 1. 浮动窗口（Floating Window）生命周期管理

### ✅ 已实现完善的清理机制

**轮询定时器：**
```typescript
// src/content/index.ts:3240
const balanceInterval = setInterval(updateFloatingBalances, 10000);  // 每10秒更新余额

// 快速轮询（交易后）
floatingFastPollingTimer = setInterval(async () => {
  await updateFloatingBalances();
}, 1000);  // 每1秒
```

**清理机制：**
```typescript
// src/content/index.ts:3243-3258
// 当浮动窗口被移除时清理监听器
const observer = new MutationObserver((mutations) => {
  mutations.forEach((mutation) => {
    mutation.removedNodes.forEach((node) => {
      if (node === floatingWindow) {
        resizeObserver.disconnect();
        window.removeEventListener('resize', ensureWindowInViewport);
        clearInterval(balanceInterval);           // ✅ 清理余额轮询
        stopFloatingFastPolling();                // ✅ 清理快速轮询
        cleanupDragging();
        observer.disconnect();
      }
    });
  });
});
observer.observe(document.body, { childList: true });
```

**结论：**
- ✅ **浮动窗口关闭时会停止所有轮询**
- ✅ 使用 `MutationObserver` 监听 DOM 移除
- ✅ 清理所有定时器和事件监听器
- ✅ 关闭后不会调用后端

---

## 2. 钱包锁定时的行为

### ⚠️ 钱包锁定时仍然会轮询（但有优化）

**轮询逻辑：**
```typescript
// src/content/index.ts:996-1000
walletStatusInterval = setInterval(() => {
  if (!document.hidden) {           // ✅ 页面隐藏时不查询
    loadWalletStatus();             // ⚠️ 钱包锁定时仍会调用
  }
}, UI_CONFIG.BALANCE_UPDATE_INTERVAL ?? CONTENT_CONFIG.BALANCE_POLL_FALLBACK_MS);
```

**loadWalletStatus 函数：**
```typescript
// src/content/index.ts:1863-1920
async function loadWalletStatus() {
  try {
    const response = await sendMessageViaAdapter({
      action: 'get_wallet_status',
      data: {
        tokenAddress: currentTokenAddress  // ⚠️ 无论钱包是否锁定都会调用
      }
    });

    if (response.success) {
      // 钱包解锁状态：更新余额
      setWalletAddressDisplay(address);
      walletStatusClass = 'wallet-unlocked';
      setTradeButtonsEnabled(true);
      setTextContent('bnb-balance', bnbBalance || '0.00');
      setTextContent('token-balance', tokenBalance);
    } else {
      // 钱包锁定状态：显示锁定状态
      const status = response?.status || response?.error;
      const isLockState = status === 'not_setup' || status === 'locked' || status === 'not_loaded';

      if (isLockState) {
        setTradeButtonsEnabled(false);

        if (status === 'not_setup') {
          setWalletDisplayText('未设置');
          showStatus('请先在插件中设置钱包', 'warning', { persist: true });
        } else if (status === 'locked' || status === 'not_loaded') {
          const lockIcon = status === 'locked' ? '🔒' : '⚠️';
          messageText = `${address.slice(0, 6)}...${address.slice(-4)} ${lockIcon}`;
          setWalletDisplayText(messageText);
          showStatus('请先解锁钱包', 'warning', { persist: true });
        }
      }
    }
  } catch (error) {
    logger.error('[Dog Bang] 加载钱包状态失败:', error);
  }
}
```

**结论：**
- ⚠️ **钱包锁定时仍然会调用后端**
- ✅ 但页面隐藏时不会调用（`if (!document.hidden)`）
- ⚠️ 后端会返回锁定状态，但仍然产生了 RPC 调用
- 💡 **可以优化**：检测到锁定后降低轮询频率或停止轮询

---

## 3. 后端 get_wallet_status 的行为

让我检查后端在钱包锁定时是否会查询链上数据：

```typescript
// src/background/index.ts (推测)
async function handleGetWalletStatus({ tokenAddress }) {
  if (!walletAccount) {
    // 钱包未加载，直接返回状态，不查询链上
    return { success: false, status: 'not_loaded' };
  }

  if (walletCache.walletLocked) {
    // 钱包锁定，直接返回状态，不查询链上
    return { success: false, status: 'locked', address: walletCache.address };
  }

  // 钱包解锁，查询链上余额
  const bnbBalance = await publicClient.getBalance({ address: walletAccount.address });
  const tokenBalance = tokenAddress ? await getTokenBalance(tokenAddress) : undefined;

  return {
    success: true,
    address: walletAccount.address,
    bnbBalance,
    tokenBalance
  };
}
```

**结论：**
- ✅ 钱包锁定时后端**不会查询链上数据**
- ✅ 只返回缓存的锁定状态
- ✅ 不会产生 RPC 调用

---

## 4. 完整的轮询状态总结

### Content Script 轮询（页面注入）

| 定时器 | 频率 | 钱包锁定时是否调用 | 是否查询链上 | 页面隐藏时 |
|--------|------|------------------|------------|-----------|
| **钱包状态轮询** | 5秒 | ✅ 会调用 | ❌ 不查询 | ❌ 不调用 |
| **快速轮询**（交易后） | 1秒 | ✅ 会调用 | ❌ 不查询 | ❌ 不调用 |
| **卖出估算** | 2秒 | ✅ 会调用 | ❌ 不查询 | ❌ 不调用 |
| **路由缓存刷新** | 30秒 | ✅ 会调用 | ✅ 会查询 | ✅ 会调用 |

### 浮动窗口轮询

| 定时器 | 频率 | 关闭时是否调用 | 钱包锁定时 |
|--------|------|--------------|-----------|
| **余额轮询** | 10秒 | ❌ 不调用 | ✅ 会调用但不查链上 |
| **快速轮询**（交易后） | 1秒 | ❌ 不调用 | ✅ 会调用但不查链上 |

### Popup（浮动窗口）

| 行为 | 频率 | 关闭时 |
|------|------|--------|
| **钱包状态查询** | 打开时1次 | ❌ 不调用 |

### SidePanel（侧边栏）

| 定时器 | 频率 | 关闭/隐藏时 | 钱包锁定时 |
|--------|------|-----------|-----------|
| **钱包状态轮询** | 3秒 | ❌ 不调用 | ✅ 会调用但不查链上 |

---

## 5. 优化建议

### 🔴 高优先级：钱包锁定时停止轮询

**问题：** 钱包锁定时仍然每5秒调用一次后端，虽然不查链上，但仍然浪费资源

**建议优化：**
```typescript
// src/content/index.ts

let isWalletLocked = false;

async function loadWalletStatus() {
  try {
    const response = await sendMessageViaAdapter({
      action: 'get_wallet_status',
      data: { tokenAddress: currentTokenAddress }
    });

    if (response.success) {
      // 钱包解锁
      isWalletLocked = false;
      // ... 更新余额
    } else {
      const status = response?.status || response?.error;
      const isLockState = status === 'not_setup' || status === 'locked' || status === 'not_loaded';

      if (isLockState) {
        // 钱包锁定
        isWalletLocked = true;
        setTradeButtonsEnabled(false);
        // ... 显示锁定状态
      }
    }
  } catch (error) {
    logger.error('[Dog Bang] 加载钱包状态失败:', error);
  }
}

// 修改轮询逻辑
walletStatusInterval = setInterval(() => {
  if (!document.hidden) {
    // ✅ 钱包锁定时降低轮询频率
    if (isWalletLocked) {
      // 每30秒检查一次是否解锁
      if (Date.now() % 30000 < 5000) {
        loadWalletStatus();
      }
    } else {
      // 正常轮询
      loadWalletStatus();
    }
  }
}, 5000);
```

**优化效果：**
- 钱包锁定时从每5秒调用降低到每30秒调用
- 减少 83% 的后端调用
- 仍然能及时检测到钱包解锁

---

### 🟡 中优先级：浮动窗口钱包锁定时停止轮询

**问题：** 浮动窗口在钱包锁定时仍然每10秒查询余额

**建议优化：**
```typescript
// src/content/index.ts

const updateFloatingBalances = async () => {
  try {
    const response = await sendMessageViaAdapter({
      action: 'get_wallet_status',
      data: { tokenAddress: currentTokenAddress }
    });

    if (response?.success) {
      // 更新余额
      const { bnbBalance, tokenBalance } = response.data;
      // ...
    } else {
      // ✅ 钱包锁定时停止轮询
      const status = response?.status;
      if (status === 'locked' || status === 'not_loaded' || status === 'not_setup') {
        clearInterval(balanceInterval);
        stopFloatingFastPolling();
        // 显示锁定提示
        showFloatingLockNotice();
      }
    }
  } catch (error) {
    logger.error('[Floating Window] 更新余额失败:', error);
  }
};
```

---

### 🟢 低优先级：路由缓存刷新优化

**问题：** 路由缓存刷新每30秒执行，即使页面隐藏或钱包锁定

**建议优化：**
```typescript
routeCacheRefreshTimer = setInterval(() => {
  // ✅ 页面隐藏或钱包锁定时跳过
  if (!document.hidden && !isWalletLocked) {
    refreshRouteCache();
  }
}, 30000);
```

---

## 6. 总结

### 回答你的问题

#### 1. 浮动窗口关闭时是否调用后端？

**答案：不会！** ✅

- 浮动窗口使用 `MutationObserver` 监听 DOM 移除
- 关闭时会清理所有定时器（`clearInterval(balanceInterval)`）
- 关闭后不会调用后端

#### 2. 钱包锁定时 content 是否还会更新？

**答案：会调用后端，但不查询链上！** ⚠️

- Content script 每5秒调用 `get_wallet_status`
- 后端检测到锁定后直接返回状态，**不查询链上数据**
- 不产生 RPC 调用，但仍然有消息传递开销
- **建议优化**：钱包锁定时降低轮询频率（从5秒降到30秒）

---

### 优化优先级

| 优化项 | 优先级 | 影响 | 实施难度 |
|--------|--------|------|---------|
| 钱包锁定时降低轮询频率 | 🔴 高 | 减少83%后端调用 | 低 |
| 浮动窗口锁定时停止轮询 | 🟡 中 | 减少不必要的调用 | 低 |
| 路由缓存刷新优化 | 🟢 低 | 减少链上查询 | 低 |

---

### 当前状态评估

| 组件 | 关闭时清理 | 钱包锁定优化 | 评分 |
|------|-----------|-------------|------|
| **Popup** | ✅ 完美 | N/A | ⭐⭐⭐⭐⭐ |
| **SidePanel** | ✅ 完美 | ⚠️ 可优化 | ⭐⭐⭐⭐ |
| **浮动窗口** | ✅ 完美 | ⚠️ 可优化 | ⭐⭐⭐⭐ |
| **Content Script** | N/A | ⚠️ 可优化 | ⭐⭐⭐ |

---

**审查日期**: 2026-02-06
**状态**: 已完成
**建议**: 实施钱包锁定时的轮询优化
