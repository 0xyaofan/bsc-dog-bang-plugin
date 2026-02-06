# UI 生命周期管理审查报告

## 审查目标

检查 popup 和 sidepanel 在关闭时是否仍然调用后端获取信息，确保不浪费资源。

---

## 审查结果

### ✅ Popup（浮动窗口）- 已优化

**状态：** 无需修改，已经是最优实现

**定时器使用情况：**
```typescript
// src/popup/App.tsx

// ✅ 只用于 UI 反馈，3秒后清除消息
setTimeout(() => setMessage(null), 3000);

// ✅ 只用于 UI 动画延迟
setTimeout(() => { /* UI update */ }, 100);

// ✅ 只用于重试延迟
await new Promise(resolve => setTimeout(resolve, 1000));
```

**后端调用情况：**
```typescript
useEffect(() => {
  checkWalletStatus();  // ✅ 只在打开时调用一次
}, [checkWalletStatus]);

useEffect(() => {
  evaluateLocalStatus({ silent: true });  // ✅ 只在打开时调用一次
}, [evaluateLocalStatus]);
```

**结论：**
- ✅ **无轮询定时器**：没有 `setInterval`
- ✅ **无持续后端调用**：只在打开时查询一次
- ✅ **关闭即停止**：popup 关闭时，所有 React 组件卸载，定时器自动清理

---

### ✅ SidePanel（侧边栏）- 已实现可见性管理

**状态：** 已经实现了完善的生命周期管理

**轮询定时器：**
```typescript
// src/sidepanel/main.tsx:1365-1393

let walletStatusCheckInterval: ReturnType<typeof setInterval> | null = null;

function startWalletStatusPolling() {
  if (walletStatusCheckInterval) {
    return;
  }

  console.log('[Dog Bang Side Panel] 启动钱包状态轮询');
  walletStatusCheckInterval = setInterval(async () => {
    try {
      const response = await chrome.runtime.sendMessage({ action: 'get_wallet_status' });
      // 更新锁定状态
      updateLockOverlayState(isLocked);
    } catch (error) {
      console.warn('[Dog Bang Side Panel] 轮询钱包状态失败:', error);
    }
  }, 3000); // ✅ 每3秒检查一次
}

function stopWalletStatusPolling() {
  if (walletStatusCheckInterval) {
    clearInterval(walletStatusCheckInterval);
    walletStatusCheckInterval = null;
    console.log('[Dog Bang Side Panel] 停止钱包状态轮询');
  }
}
```

**可见性管理：**
```typescript
// ✅ 监听页面可见性变化
document.addEventListener('visibilitychange', () => {
  if (document.hidden) {
    stopWalletStatusPolling();  // ✅ 隐藏时停止轮询
  } else {
    checkInitialWalletStatus();
    startWalletStatusPolling();  // ✅ 显示时恢复轮询
  }
});

// ✅ 页面卸载时清理
window.addEventListener('beforeunload', () => {
  stopWalletStatusPolling();  // ✅ 关闭时停止轮询
});
```

**结论：**
- ✅ **有轮询但已优化**：每3秒检查钱包状态
- ✅ **可见性管理**：隐藏时停止，显示时恢复
- ✅ **卸载清理**：关闭时清理定时器
- ✅ **资源友好**：不在后台浪费资源

---

## Content Script 轮询情况

### ⚠️ Content Script - 有多个轮询定时器

**发现的定时器：**

1. **钱包状态轮询**（每5秒）
```typescript
// src/content/index.ts:982-1006
let walletStatusInterval: ReturnType<typeof setInterval> | null = null;

function startWalletStatusPolling() {
  walletStatusInterval = setInterval(() => {
    updateWalletStatus();
  }, 5000);
}
```

2. **快速轮询**（交易后）
```typescript
// src/content/index.ts:1043
fastPollingTimer = setInterval(async () => {
  await updateWalletStatus();
}, 1000);
```

3. **卖出估算轮询**（每2秒）
```typescript
// src/content/index.ts:2198
sellEstimateTimer = setInterval(() => {
  updateSellEstimate();
}, 2000);
```

4. **浮动窗口余额轮询**（每10秒）
```typescript
// src/content/index.ts:3240
const balanceInterval = setInterval(updateFloatingBalances, 10000);
```

5. **路由缓存刷新**（每30秒）
```typescript
// src/content/index.ts:3934
routeCacheRefreshTimer = setInterval(() => {
  refreshRouteCache();
}, 30000);
```

**状态：** Content Script 需要持续运行，因为它注入到网页中，这些轮询是必要的。

**建议：**
- ✅ 已经有清理逻辑（各个 `stop*` 函数）
- 💡 可以考虑添加页面可见性检测，隐藏时降低轮询频率

---

## 总结

### ✅ 当前状态

| 组件 | 轮询状态 | 生命周期管理 | 是否需要优化 |
|------|---------|-------------|-------------|
| **Popup** | 无轮询 | ✅ 自动清理 | ❌ 无需优化 |
| **SidePanel** | 有轮询（3秒） | ✅ 可见性管理 | ❌ 无需优化 |
| **Content Script** | 多个轮询 | ✅ 有清理逻辑 | 💡 可选优化 |

### 关键发现

1. **Popup 已经是最优实现**
   - 打开时查询一次
   - 关闭时自动清理
   - 无后台轮询

2. **SidePanel 已经实现可见性管理**
   - 隐藏时停止轮询
   - 显示时恢复轮询
   - 关闭时清理定时器

3. **Content Script 轮询是必要的**
   - 需要实时更新页面状态
   - 已经有清理逻辑
   - 可以考虑可见性优化（可选）

---

## 可选优化建议

### Content Script 可见性优化（可选）

如果想进一步优化，可以在 content script 中添加页面可见性检测：

```typescript
// src/content/index.ts

// 监听页面可见性
document.addEventListener('visibilitychange', () => {
  if (document.hidden) {
    // 页面隐藏时，降低轮询频率或停止非关键轮询
    stopNonCriticalPolling();
  } else {
    // 页面显示时，恢复正常轮询
    startNormalPolling();
  }
});

function stopNonCriticalPolling() {
  // 停止余额轮询（非关键）
  if (balanceInterval) {
    clearInterval(balanceInterval);
  }

  // 停止路由缓存刷新（非关键）
  if (routeCacheRefreshTimer) {
    clearInterval(routeCacheRefreshTimer);
  }

  // 保留钱包状态轮询（关键，但可以降低频率）
  if (walletStatusInterval) {
    clearInterval(walletStatusInterval);
    // 降低到每30秒检查一次
    walletStatusInterval = setInterval(updateWalletStatus, 30000);
  }
}

function startNormalPolling() {
  // 恢复正常频率
  startWalletStatusPolling();
  startBalancePolling();
  startRouteCacheRefresh();
}
```

**优点：**
- 页面在后台时减少资源消耗
- 降低后端压力
- 节省电池（移动设备）

**缺点：**
- 增加代码复杂度
- 页面切换回来时可能有短暂延迟

**建议：** 如果用户经常打开多个标签页，这个优化会很有价值。

---

## 结论

**回答你的问题：**

> 现在浮动窗口和SidePanel在关闭的情况下会不会去调用后端获取信息？

**答案：不会！** ✅

1. **Popup（浮动窗口）**
   - ✅ 关闭时不会调用后端
   - ✅ 只在打开时查询一次
   - ✅ 无后台轮询

2. **SidePanel（侧边栏）**
   - ✅ 关闭时不会调用后端
   - ✅ 隐藏时停止轮询
   - ✅ 已实现完善的生命周期管理

**当前实现已经很优秀，无需修改！** 🎉

---

**审查日期**: 2026-02-06
**审查人**: AI Assistant
**状态**: 已通过，无需优化
