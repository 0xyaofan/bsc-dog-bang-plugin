# 自动授权模式实现文档

## 概述

插件提供三种自动授权模式，用户可以在设置中选择何时自动授权代币：

1. **买入时自动授权** (`buy`) - 点击买入按钮时自动授权
2. **切换页面时自动授权** (`switch`) - 切换到新代币页面时自动授权
3. **首次卖出时自动授权** (`sell`) - 第一次卖出某个代币时自动授权

## 配置方式

用户在设置中配置 `autoApproveMode` 字段：

```typescript
{
  trading: {
    autoApproveMode: 'buy' | 'switch' | 'sell' | 'manual'
  }
}
```

- `manual` (默认) - 不自动授权，需要用户手动点击授权按钮
- `buy` - 买入时自动授权
- `switch` - 切换页面时自动授权
- `sell` - 首次卖出时自动授权

## 实现细节

### 1. 买入时自动授权 (`autoApproveMode === 'buy'`)

**位置**: `src/content/index.ts` 第 1355-1357 行

**触发时机**: 用户点击"买入"按钮时

**实现代码**:
```typescript
if (userSettings?.trading?.autoApproveMode === 'buy') {
  autoApproveToken(tokenAddress, channel);
}
```

**执行流程**:
1. 用户点击"买入"按钮
2. 读取当前选择的通道（PancakeSwap/Four.meme/Flap）
3. 检查 `autoApproveMode` 是否为 `'buy'`
4. 如果是，调用 `autoApproveToken(tokenAddress, channel)`
5. `autoApproveToken` 内部调用 `requestTokenApproval`
6. `requestTokenApproval` 发送 `approve_token` 消息给 background
7. Background 的 `ensureTokenApproval` 检查是否需要授权
8. 如果未授权，发送授权交易；如果已授权，跳过

**特点**:
- 非阻塞：授权在后台执行，不会阻塞买入操作
- 适合频繁买入新代币的用户

---

### 2. 切换页面时自动授权 (`autoApproveMode === 'switch'`)

**位置**: `src/content/index.ts` 第 1197-1250 行

**触发时机**: 用户切换到新的代币页面时

**实现代码**:
```typescript
async function autoApproveOnSwitch(tokenAddress: string, channel?: string) {
  const settings = userSettings || DEFAULT_USER_SETTINGS;
  const autoApproveMode = settings.trading.autoApproveMode;

  logger.debug('[Dog Bang] Auto approve mode:', autoApproveMode);

  if (autoApproveMode !== 'switch') {
    return;
  }

  const panelElement = document.getElementById('dog-bang-panel');
  const channelSelector = panelElement?.querySelector('#channel-selector') as HTMLSelectElement | null;
  const currentChannel = channel || channelSelector?.value || 'pancake';

  logger.debug('[Dog Bang] 执行切换时自动授权:', { tokenAddress, channel: currentChannel });

  // 🐛 修复问题11：不要预检查授权状态，让 background 的 ensureTokenApproval 处理
  // 如果已授权，background 会返回 needApproval: false
  // 如果未授权，background 会发送授权交易并返回 needApproval: true
  updateTokenApprovalDisplay(false, true, undefined, 'approve');

  try {
    const response = await safeSendMessage({
      action: 'approve_token',
      data: {
        tokenAddress,
        channel: currentChannel
      }
    });

    if (response && response.success) {
      if (response.needApproval) {
        logger.debug('[Dog Bang] 自动授权已执行:', response.message);
      } else {
        logger.debug('[Dog Bang] 代币已授权，跳过:', response.message);
      }

      setTimeout(async () => {
        await loadTokenApprovalStatus(tokenAddress, currentChannel);
      }, 1500);
    } else {
      logger.debug('[Dog Bang] 自动授权失败:', response?.error);
      updateTokenApprovalDisplay(false, false, response?.error);
    }
  } catch (error) {
    logger.error('[Dog Bang] 自动授权异常:', error);
    updateTokenApprovalDisplay(false, false, '自动授权失败');
  }
}
```

**执行流程**:
1. 用户切换到新的代币页面（URL 变化）
2. `observeUrlChanges` 检测到 URL 变化
3. 调用 `autoApproveOnSwitch(tokenAddress, channel)`
4. 检查 `autoApproveMode` 是否为 `'switch'`
5. 如果是，发送 `approve_token` 消息给 background
6. Background 的 `ensureTokenApproval` 检查是否需要授权
7. 返回结果：`needApproval: true` (已授权) 或 `needApproval: false` (已授权)
8. 1500ms 后查询链上授权状态，更新 UI

**特点**:
- 主动式：切换到代币页面即授权，无需等到交易时
- 适合喜欢提前准备、快速交易的用户

**修复历史**:
- **问题11**: 之前预检查授权状态，如果缓存显示已授权会跳过授权请求
- **修复**: 移除预检查，直接调用 background，让 `ensureTokenApproval` 处理

---

### 3. 首次卖出时自动授权 (`autoApproveMode === 'sell'`)

**位置**: `src/content/index.ts` 第 1521-1527 行

**触发时机**: 用户第一次卖出某个代币时

**实现代码**:
```typescript
if (userSettings?.trading?.autoApproveMode === 'sell' && tokenAddress && channel) {
  const sellApprovalKey = `${tokenAddress.toLowerCase()}:${channel}`;
  if (!sellAutoApproveCache.has(sellApprovalKey)) {
    await autoApproveToken(tokenAddress, channel);
    sellAutoApproveCache.add(sellApprovalKey);
  }
}
```

**执行流程**:
1. 用户点击"卖出"按钮
2. 检查 `autoApproveMode` 是否为 `'sell'`
3. 生成缓存键：`${tokenAddress}:${channel}`
4. 检查 `sellAutoApproveCache` 中是否已存在该键
5. 如果不存在（首次卖出），调用 `autoApproveToken(tokenAddress, channel)`
6. 添加到 `sellAutoApproveCache`，防止重复授权
7. `autoApproveToken` 内部调用 `requestTokenApproval`
8. `requestTokenApproval` 发送 `approve_token` 消息给 background
9. Background 的 `ensureTokenApproval` 检查是否需要授权

**缓存机制**:
```typescript
const sellAutoApproveCache = new Set<string>();
```

- 使用 `Set` 存储已自动授权的 `tokenAddress:channel` 组合
- 确保每个代币在每个通道上只自动授权一次
- 缓存在内存中，刷新页面后会重置

**特点**:
- 智能式：只在第一次卖出时授权，避免重复授权
- 适合持有多个代币、偶尔卖出的用户

---

## 共享核心函数

所有三个模式最终都调用 `requestTokenApproval` 函数：

**位置**: `src/content/index.ts` 第 3145-3206 行

**核心逻辑**:
```typescript
async function requestTokenApproval(tokenAddress?: string | null, channel?: string | null) {
  if (!tokenAddress || !channel) {
    return;
  }
  const requestKey = `${tokenAddress}:${channel}`;
  if (pendingApprovalKey === requestKey && pendingApprovalPromise) {
    return pendingApprovalPromise;
  }

  const approvalPromise = (async () => {
    try {
      logger.debug('[Dog Bang] 检查通道授权:', { tokenAddress, channel });

      // 🐛 修复问题11：不要预检查授权状态，让 background 的 ensureTokenApproval 处理
      // 如果已授权，background 会返回 needApproval: false
      // 如果未授权，background 会发送授权交易并返回 needApproval: true

      // 显示授权中状态
      updateTokenApprovalDisplay(false, true, undefined, 'approve');

      const response = await safeSendMessage({
        action: 'approve_token',
        data: {
          tokenAddress,
          channel
        }
      });

      if (response && response.success) {
        if (response.needApproval) {
          logger.debug('[Dog Bang] ✓ 自动授权完成:', response.message);

          // 延迟查询链上授权状态，确保 RPC 节点同步
          setTimeout(async () => {
            await loadTokenApprovalStatus(tokenAddress, channel);
          }, 1500);
        } else {
          logger.debug('[Dog Bang] 代币已授权，跳过:', response.message);

          // 即使不需要授权，也更新一下状态（无需延迟，因为没有新交易）
          await loadTokenApprovalStatus(tokenAddress, channel);
        }
      }
    } catch (error) {
      logger.debug('[Dog Bang] 授权检查异常:', error.message);

      // 授权失败，显示错误
      updateTokenApprovalDisplay(false, false, '授权失败');
    } finally {
      if (pendingApprovalKey === requestKey) {
        pendingApprovalKey = null;
        pendingApprovalPromise = null;
      }
    }
  })();

  pendingApprovalKey = requestKey;
  pendingApprovalPromise = approvalPromise;

  return approvalPromise;
}
```

**去重机制**:
- 使用 `pendingApprovalKey` 和 `pendingApprovalPromise` 防止并发重复请求
- 同一个 `tokenAddress:channel` 组合在授权过程中只会有一个请求

**修复历史**:
- **问题**: 之前预检查授权状态（调用 `loadTokenApprovalStatus`），如果缓存显示已授权会直接返回，不调用 background
- **影响**: 当缓存不准确时（例如授权交易还在pending），会导致自动授权不生效
- **修复**: 移除预检查，直接调用 background 的 `approve_token`，让 `ensureTokenApproval` 来判断是否需要授权

---

## Background 处理逻辑

**位置**: `src/background/index.ts`

当 content 发送 `approve_token` 消息时，background 处理流程：

```typescript
case 'approve_token': {
  const { tokenAddress, channel } = message.data;

  // 调用 ensureTokenApproval 检查并执行授权
  const result = await ensureTokenApproval({
    tokenAddress,
    channel,
    // ... 其他参数
  });

  if (result.needApproval) {
    // 发送了授权交易
    sendResponse({
      success: true,
      needApproval: true,
      message: '授权交易已发送',
      txHash: result.txHash
    });
  } else {
    // 已授权，无需重复授权
    sendResponse({
      success: true,
      needApproval: false,
      message: '代币已授权'
    });
  }
}
```

**ensureTokenApproval 逻辑**:
1. 查询当前授权额度
2. 如果授权额度 >= 需要的额度，返回 `needApproval: false`
3. 如果授权额度 < 需要的额度，发送授权交易，返回 `needApproval: true`

**优势**:
- 权威判断：只有 background 与链交互，能获取最准确的授权状态
- 避免重复授权：自动跳过已授权的代币
- 统一逻辑：所有授权请求都走相同的检查流程

---

## 测试建议

### 测试场景 1: 买入时自动授权

1. 在设置中选择"买入时自动授权"
2. 找一个未授权的代币
3. 点击"买入"按钮
4. **预期结果**:
   - 授权按钮显示"授权中"
   - 钱包弹出授权请求
   - 授权完成后，授权按钮变为"✓ 已授权"
   - 买入操作正常执行

### 测试场景 2: 切换页面时自动授权

1. 在设置中选择"切换页面时自动授权"
2. 访问一个未授权的代币页面
3. **预期结果**:
   - 页面加载后自动触发授权
   - 授权按钮显示"授权中"
   - 钱包弹出授权请求
   - 授权完成后，授权按钮变为"✓ 已授权"
4. 切换到另一个未授权的代币页面
5. **预期结果**: 重复上述自动授权流程

### 测试场景 3: 首次卖出时自动授权

1. 在设置中选择"首次卖出时自动授权"
2. 买入一个新代币（此时不会触发授权）
3. 第一次点击"卖出"按钮
4. **预期结果**:
   - 授权按钮显示"授权中"
   - 钱包弹出授权请求
   - 授权完成后，卖出操作正常执行
5. 再次点击"卖出"按钮
6. **预期结果**: 不会再次触发授权，直接卖出

### 测试场景 4: 已授权代币

1. 选择任意自动授权模式
2. 访问一个已授权的代币
3. 触发自动授权（根据选择的模式）
4. **预期结果**:
   - Background 检测到已授权，返回 `needApproval: false`
   - 不会弹出钱包授权请求
   - 授权按钮直接显示"✓ 已授权"
   - 日志显示"代币已授权，跳过"

---

## 常见问题

### Q1: 为什么选择"切换页面时自动授权"，但切换页面时没有授权？

**A**: 这是之前的 Bug（问题11），已在最新版本中修复。

**原因**: 之前 `autoApproveOnSwitch` 和 `requestTokenApproval` 会预检查授权缓存，如果缓存显示已授权，会直接跳过授权请求。但缓存可能不准确（例如授权交易还在 pending），导致实际未授权但跳过了授权流程。

**修复**: 移除预检查，直接调用 background 的 `approve_token`，让 `ensureTokenApproval` 通过查询链上状态来判断是否需要授权。

### Q2: 自动授权会影响交易速度吗？

**A**: 不会。所有自动授权都是非阻塞的。

- **买入时自动授权**: 授权和买入并行执行，不会延迟买入
- **切换页面时自动授权**: 在用户浏览页面时后台授权，交易时已授权完成
- **首次卖出时自动授权**: 使用 nonce 顺序机制，授权和卖出按顺序执行，总时间与手动授权相同

### Q3: 自动授权失败会怎样？

**A**: 不会影响用户操作。

- 授权失败会在日志中记录
- 用户可以手动点击授权按钮重试
- 交易操作不会被阻塞

### Q4: 为什么"首次卖出时自动授权"使用内存缓存？

**A**: 为了平衡便利性和安全性。

- **便利性**: 每个代币在每个通道上只自动授权一次，避免重复授权
- **安全性**: 刷新页面后缓存清空，重新触发授权检查，防止授权额度被耗尽而不知情

### Q5: 可以同时启用多个自动授权模式吗？

**A**: 不可以，只能选择一个模式。

配置项 `autoApproveMode` 是单选，可选值：
- `'manual'` - 手动授权（默认）
- `'buy'` - 买入时自动授权
- `'switch'` - 切换页面时自动授权
- `'sell'` - 首次卖出时自动授权

---

## 修复历史

### 问题11: 自动授权配置不生效

**发现时间**: 2025-02-05

**问题描述**:
用户选择"切换页面时自动授权"，但切换页面时没有触发授权。日志显示"代币已授权，跳过"，但实际代币并未授权。

**根本原因**:
1. `autoApproveOnSwitch` 函数预检查授权状态：
   ```typescript
   const approved = await loadTokenApprovalStatus(tokenAddress, currentChannel);
   if (approved) {
     logger.debug('[Dog Bang] 代币已授权,跳过自动授权');
     return;
   }
   ```

2. `requestTokenApproval` 函数也预检查授权状态：
   ```typescript
   const currentApprovalStatus = await loadTokenApprovalStatus(tokenAddress, channel);
   if (currentApprovalStatus) {
     logger.debug('[Dog Bang] 代币已授权，跳过');
     return;
   }
   ```

3. `loadTokenApprovalStatus` 从缓存中读取授权状态，但缓存可能不准确（授权交易在 pending 状态）

**影响范围**:
- 买入时自动授权 - 受影响
- 切换页面时自动授权 - 受影响
- 首次卖出时自动授权 - 受影响

**修复方案**:
1. 移除 `autoApproveOnSwitch` 中的预检查
2. 移除 `requestTokenApproval` 中的预检查
3. 直接调用 background 的 `approve_token`
4. 让 `ensureTokenApproval` 通过查询链上状态来判断是否需要授权

**修复代码**:

`autoApproveOnSwitch` (src/content/index.ts:1197-1250):
```typescript
// 移除预检查
// const approved = await loadTokenApprovalStatus(tokenAddress, currentChannel);
// if (approved) return;

// 直接调用 background
const response = await safeSendMessage({
  action: 'approve_token',
  data: { tokenAddress, channel: currentChannel }
});

if (response && response.success) {
  if (response.needApproval) {
    logger.debug('[Dog Bang] 自动授权已执行:', response.message);
  } else {
    logger.debug('[Dog Bang] 代币已授权，跳过:', response.message);
  }
}
```

`requestTokenApproval` (src/content/index.ts:3145-3206):
```typescript
// 移除预检查
// const currentApprovalStatus = await loadTokenApprovalStatus(tokenAddress, channel);
// if (currentApprovalStatus) return;

// 直接调用 background
const response = await safeSendMessage({
  action: 'approve_token',
  data: { tokenAddress, channel }
});
```

**验证方法**:
1. 选择"切换页面时自动授权"
2. 切换到一个未授权的代币页面
3. 观察日志：应该显示"自动授权已执行"而不是"代币已授权，跳过"
4. 钱包应该弹出授权请求

**修复后优势**:
- 授权判断更准确：由 background 查询链上状态，而不是依赖可能过时的缓存
- 逻辑更简单：content 不需要预判断，直接转发给 background
- 更可靠：即使缓存不准确，也不会影响自动授权功能

---

## 性能优化

### 1. 移除买入后的无用授权检查

**问题发现**: 2025-02-05

**问题描述**:
之前在 `loadTokenInfo` 函数中，每次调用都会执行 `loadTokenApprovalStatus` 来检查授权状态。由于买入成功后会调用 `loadTokenInfo` 来刷新代币信息，这导致每次买入后都会执行一次授权状态查询，但买入操作本身不需要授权，这是一个无用的操作。

**影响**:
- 每次买入后都会额外查询一次授权状态（多余的 RPC 调用）
- 增加了不必要的网络开销和日志输出
- 对用户体验没有帮助

**修复方案**:
从 `loadTokenInfo` 中移除 `loadTokenApprovalStatus` 调用，授权状态只在以下必要场景更新：

1. **页面切换时** (`observeUrlChanges`) - 第 2242 行
2. **通道切换时** (`channel-selector` change event) - 第 3109 行
3. **自动授权完成后** (`autoApproveOnSwitch`, `requestTokenApproval`) - 第 1241, 3182, 3188 行
4. **手动授权完成后** (`handleApproveToken`) - 第 1134, 1182 行

**修复代码** (`src/content/index.ts` 第 996-1006 行):
```typescript
// 之前（有问题）:
updateTokenBalanceDisplay(tokenAddress);
scheduleSellEstimate();

// 同时更新授权状态
const panelElement = document.getElementById('dog-bang-panel');
const channelSelector = panelElement?.querySelector('#channel-selector') as HTMLSelectElement | null;
const currentChannel = channelSelector?.value || 'pancake';
loadTokenApprovalStatus(tokenAddress, currentChannel);  // ❌ 买入不需要授权，这是无用操作

// 修复后:
updateTokenBalanceDisplay(tokenAddress);
scheduleSellEstimate();

// 🐛 优化：只在需要授权时才检查授权状态
// 买入不需要授权，只有卖出或用户主动操作时才需要
// 授权状态会在以下场景更新：
// 1. 页面切换时（observeUrlChanges）
// 2. 通道切换时（channel-selector change event）
// 3. 自动授权完成后
// 4. 用户点击授权按钮后
// 不需要在每次 loadTokenInfo 时都查询
```

**优化效果**:
- 减少不必要的 RPC 调用
- 减少网络开销和响应时间
- 日志更清晰，只在必要时才显示授权相关日志

---

### 2. 移除买入/卖出后的多余 loadTokenInfo 调用

**问题发现**: 2025-02-05

**问题描述**:
买入/卖出成功后立即调用 `loadTokenInfo(tokenAddress)` 来刷新代币信息，但存在以下问题：

1. **代币信息在交易前就已加载** - 页面切换时就获取了代币符号、精度等静态信息
2. **交易刚提交，余额不会变化** - 交易可能还未确认，立即查询余额还是旧值
3. **已有轮询机制** - `startFastPolling` 会每秒调用 `loadTokenInfo`，等待余额变化

这导致了重复查询，浪费了 RPC 资源。

**影响**:
- 每次买入/卖出后都会立即执行一次无效的余额查询（交易未确认）
- 100ms 后 `startFastPolling` 又会执行第一次查询，造成重复
- 增加了不必要的网络开销

**原始代码** (`src/content/index.ts`):

买入流程（第 1416-1423 行）:
```typescript
// 之前（有问题）:
// 买入成功后立即刷新余额
const previousBalance = currentTokenInfo?.balance || '0';
loadWalletStatus();
loadTokenInfo(tokenAddress);                     // ❌ 交易未确认，查不到新余额
loadTokenRoute(tokenAddress, { force: true });

// 启动快速轮询，快速检测余额变化
startFastPolling(tokenAddress, previousBalance);  // ✅ 内部会调用 loadTokenInfo
```

卖出流程（第 1574-1584 行）:
```typescript
// 之前（有问题）:
// 卖出成功后立即刷新余额
const is100PercentSell = parseFloat(percent) === 100;
const previousBalance = currentTokenInfo?.balance || '0';
loadWalletStatus();
loadTokenInfo(tokenAddress);                     // ❌ 交易未确认，查不到新余额
loadTokenRoute(tokenAddress, { force: true });

// 启动快速轮询，快速检测余额变化（100%卖出除外，因为会直接清零）
if (!is100PercentSell) {
  startFastPolling(tokenAddress, previousBalance);  // ✅ 内部会调用 loadTokenInfo
}
```

**修复方案**:
移除买入/卖出后的 `loadTokenInfo` 调用，只保留必要的操作：

1. ✅ **`loadWalletStatus()`** - 刷新 BNB 余额（买入花费/卖出获得 BNB）
2. ❌ **`loadTokenInfo()`** - 删除，交易未确认，余额不会变化
3. ✅ **`loadTokenRoute()`** - 刷新路由缓存（交易可能影响流动性）
4. ✅ **`startFastPolling()`** - 轮询等待余额变化（内部会调用 `loadTokenInfo`）

**修复代码**:

买入流程（第 1416-1426 行）:
```typescript
// 修复后:
// 买入成功后立即刷新必要信息
const previousBalance = currentTokenInfo?.balance || '0';
loadWalletStatus();  // 刷新 BNB 余额（买入花费了 BNB）
// 🐛 优化：不需要立即调用 loadTokenInfo，因为：
// 1. 代币信息（符号、精度等）在页面加载时已获取，不会变化
// 2. 交易刚提交，链上可能还未确认，余额查不到新值
// 3. startFastPolling 会每秒轮询 loadTokenInfo，等待余额变化
loadTokenRoute(tokenAddress, { force: true });  // 刷新路由缓存（买入后可能影响流动性）

// 启动快速轮询，快速检测余额变化（内部会调用 loadTokenInfo）
startFastPolling(tokenAddress, previousBalance);
```

卖出流程（第 1574-1589 行）:
```typescript
// 修复后:
// 卖出成功后立即刷新必要信息
const is100PercentSell = parseFloat(percent) === 100;
const previousBalance = currentTokenInfo?.balance || '0';
loadWalletStatus();  // 刷新 BNB 余额（卖出获得了 BNB）
// 🐛 优化：不需要立即调用 loadTokenInfo，因为：
// 1. 代币信息（符号、精度等）在页面加载时已获取，不会变化
// 2. 交易刚提交，链上可能还未确认，余额查不到新值
// 3. startFastPolling 会每秒轮询 loadTokenInfo，等待余额变化
// 4. 100% 卖出会在下面直接清零余额显示
loadTokenRoute(tokenAddress, { force: true });  // 刷新路由缓存（卖出后可能影响流动性）

// 启动快速轮询，快速检测余额变化（100%卖出除外，因为会直接清零）
if (!is100PercentSell) {
  startFastPolling(tokenAddress, previousBalance);
}

// 特别处理：100% 卖出成功后直接清零余额
// ...
```

**优化效果**:
- ✅ 减少每次交易后的一次无效 RPC 调用（交易未确认时查询余额）
- ✅ 避免重复查询（立即查询 + 100ms 后 startFastPolling 第一次轮询）
- ✅ 逻辑更清晰：余额更新完全由 `startFastPolling` 负责
- ✅ 提升响应速度，降低网络开销

**补充说明**:

`startFastPolling` 的工作机制（`src/content/index.ts` 第 919-953 行）:
```typescript
function startFastPolling(tokenAddress: string, previousBalance: string) {
  // 每 1 秒轮询一次，最多轮询 10 次（10 秒）
  fastPollingTimer = setInterval(async () => {
    fastPollingCount++;

    // 查询最新余额
    await loadTokenInfo(tokenAddress);  // ✅ 在这里调用，等待交易确认

    // 检查余额是否变化
    const currentBalance = currentTokenInfo?.balance || '0';
    if (currentBalance !== previousBalance) {
      logger.debug('[Dog Bang] 检测到余额变化，停止快速轮询');
      stopFastPolling();
      return;
    }

    // 达到最大轮询次数，停止
    if (fastPollingCount >= 10) {
      logger.debug('[Dog Bang] 快速轮询达到最大次数，停止');
      stopFastPolling();
    }
  }, 1000);  // 1 秒间隔
}
```

这个机制保证了：
- 每秒检查一次余额，及时发现变化
- 检测到变化后立即停止轮询
- 最多轮询 10 次（10 秒），避免无限轮询

因此，买入/卖出后不需要立即调用 `loadTokenInfo`，等待第一次轮询即可（100-1000ms 延迟是可接受的）。

---

### 3. 拆分 loadTokenInfo 函数，避免重复获取静态信息

**问题发现**: 2025-02-05

**问题描述**:
`loadTokenInfo` 函数承担了多个职责，导致在不同场景下做了不必要的操作：

1. **职责过多**:
   - 从 background 获取代币完整信息（symbol, decimals, totalSupply, balance, allowances）
   - 更新 currentTokenInfo
   - 更新余额显示
   - 调度卖出估算

2. **不同场景需求不同**:
   - **页面加载时**: 需要完整信息（静态 + 动态）
   - **买卖后轮询**: 只需要更新余额（balance）
   - **100% 卖出**: 不需要轮询（余额直接清零）

3. **快速轮询重复获取静态信息**:
   - `startFastPolling` 每秒调用 `loadTokenInfo`
   - 每次都重新获取 symbol, decimals 等不会变化的静态信息
   - 每轮询 10 次就重复获取 10 次静态信息，浪费资源

**影响**:
- 快速轮询期间（最多 10 秒），重复获取 10 次静态信息
- 增加 RPC 调用数量和返回数据量
- 增加网络开销和处理时间

**修复方案**:
拆分 `loadTokenInfo` 为两个细粒度函数：

1. **`updateTokenBalance(tokenAddress)`** - 仅更新余额
   - 只从 background 获取 balance 和 totalSupply
   - 不获取授权信息（needApproval: false）
   - 更新 currentTokenInfo.balance
   - 更新余额显示
   - 用于买卖后的快速轮询

2. **`loadTokenInfo(tokenAddress)`** - 完整加载代币信息
   - 获取所有信息（symbol, decimals, balance, allowances）
   - 更新 currentTokenInfo 所有字段
   - 更新余额显示
   - 调度卖出估算
   - 用于页面加载、切换代币等场景

**修复代码** (`src/content/index.ts` 第 970-1056 行):

```typescript
// ========== 代币信息加载（拆分为多个细粒度函数）==========

/**
 * 仅从 background 获取并更新代币余额
 * 用于买卖后的快速轮询，只获取余额，避免重复获取静态信息
 */
async function updateTokenBalance(tokenAddress: string): Promise<string | null> {
  try {
    const response = await safeSendMessage({
      action: 'get_token_info',
      data: {
        tokenAddress,
        needApproval: false  // 余额更新不需要授权信息
      }
    });

    if (response && response.success) {
      // 只更新余额相关字段，保留其他静态信息
      if (currentTokenInfo) {
        currentTokenInfo.balance = response.data.balance;
        currentTokenInfo.totalSupply = response.data.totalSupply;
      }

      // 更新余额显示
      updateTokenBalanceDisplay(tokenAddress);

      return response.data.balance;
    }
  } catch (error) {
    logger.error('[Dog Bang] Error updating token balance:', error);
  }
  return null;
}

/**
 * 完整加载代币信息（包括静态信息和授权信息）
 * 用于页面加载、切换代币等场景
 */
async function loadTokenInfo(tokenAddress) {
  try {
    logger.debug('[Dog Bang] 从 background 获取代币信息');

    const response = await safeSendMessage({
      action: 'get_token_info',
      data: {
        tokenAddress,
        needApproval: true  // 获取授权信息，用于卖出时的性能优化
      }
    });

    if (response && response.success) {
      // 保存当前代币信息用于 UI 显示（包括授权信息）
      currentTokenInfo = {
        address: tokenAddress,
        symbol: response.data.symbol,
        decimals: response.data.decimals,
        totalSupply: response.data.totalSupply,
        balance: response.data.balance,
        allowances: response.data.allowances
      };

      logger.debug('[Dog Bang] 代币信息已更新:', {
        symbol: currentTokenInfo.symbol,
        decimals: currentTokenInfo.decimals
      });

      // 更新余额显示（包括余额为0的情况）
      updateTokenBalanceDisplay(tokenAddress);
      scheduleSellEstimate();

      return currentTokenInfo;
    }
  } catch (error) {
    logger.error('[Dog Bang] Error loading token info:', error);
  }
  return null;
}
```

**更新快速轮询** (`src/content/index.ts` 第 950-980 行):

```typescript
function startFastPolling(tokenAddress: string, previousBalance: string) {
  // 停止之前的快速轮询
  stopFastPolling();

  fastPollingCount = 0;
  logger.debug('[Dog Bang] 启动快速轮询，检测余额变化');

  fastPollingTimer = setInterval(async () => {
    fastPollingCount++;

    try {
      // 🐛 优化：只查询余额，不重复获取代币静态信息（symbol, decimals）
      const currentBalance = await updateTokenBalance(tokenAddress);

      // 检查余额是否变化
      if (currentBalance && currentBalance !== previousBalance) {
        logger.debug('[Dog Bang] 检测到余额变化，停止快速轮询', {
          previous: previousBalance,
          current: currentBalance
        });
        stopFastPolling();
        return;
      }

      // 达到最大轮询次数，停止
      if (fastPollingCount >= FAST_POLLING_MAX_COUNT) {
        logger.debug('[Dog Bang] 快速轮询达到最大次数，停止');
        stopFastPolling();
      }
    } catch (error) {
      logger.debug('[Dog Bang] 快速轮询查询余额失败:', error);
    }
  }, FAST_POLLING_INTERVAL);
}
```

**优化效果**:

对比（以 10 次轮询为例）:

| 操作 | 之前 | 现在 | 减少 |
|------|------|------|------|
| 获取 symbol | 10 次 | 0 次 | 10 次 |
| 获取 decimals | 10 次 | 0 次 | 10 次 |
| 获取 allowances | 10 次 | 0 次 | 10 次 |
| 获取 balance | 10 次 | 10 次 | 0 次 |
| RPC 返回数据量 | 大 | 小 | ~70% |

**性能提升**:
- ✅ 减少重复获取静态信息（每次轮询减少 ~70% 数据量）
- ✅ 降低 RPC 节点负担
- ✅ 加快轮询响应速度
- ✅ 职责清晰：`updateTokenBalance` 只负责余额，`loadTokenInfo` 负责完整信息

**使用场景**:

| 场景 | 使用函数 | 原因 |
|------|---------|------|
| 页面加载/切换代币 | `loadTokenInfo` | 需要完整信息（symbol, decimals, balance, allowances） |
| 买卖后快速轮询 | `updateTokenBalance` | 只需要更新余额，静态信息已存在 |
| 手动刷新余额 | `updateTokenBalance` | 只需要更新余额 |
| 授权完成后 | `loadTokenInfo` | 需要更新授权信息（allowances） |

---

## 总结

三个自动授权模式为不同使用习惯的用户提供了灵活的授权选项：

- **买入时自动授权**: 适合频繁买入新代币的用户，在点击买入时自动授权
- **切换页面时自动授权**: 适合喜欢提前准备的用户，切换到代币页面时自动授权
- **首次卖出时自动授权**: 适合持有多个代币的用户，只在第一次卖出时授权

所有模式都通过统一的 `requestTokenApproval` 函数实现，确保逻辑一致性和可靠性。最新的修复移除了预检查逻辑，让 background 的 `ensureTokenApproval` 负责权威判断，提高了准确性和可靠性。

同时，通过移除买入后的无用授权检查，进一步优化了性能，减少了不必要的 RPC 调用。
