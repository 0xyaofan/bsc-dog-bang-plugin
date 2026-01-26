# 未迁移代币交易性能调查报告

## 📊 问题描述

**现象**：未迁移前的交易第一次需要等待 3 秒以上，第二次会快很多

**分析目标**：
1. 追踪完整的交易流程
2. 识别所有 RPC 查询和预处理步骤
3. 找出哪些可以缓存、哪些可以并发
4. 提供优化建议

---

## 🔍 完整交易流程分析

### 入口函数：`handleBuyToken`
位置：`src/background/index.ts:2688`

### 流程图

```
用户点击买入
    ↓
handleBuyToken (background/index.ts:2688)
    ↓
步骤1: 检查钱包状态 (内存检查，无 RPC)
    ↓
步骤2: 初始化客户端 + 预热服务 (并发)
    ├─ createClients() (如果未初始化)
    └─ warmupBackgroundServices()
    ↓
步骤3: 解析代币路由 resolveTokenRoute()
    ├─ detectTokenPlatform() (地址模式匹配，无 RPC)
    ├─ fetchRouteWithFallback()
    │   └─ fetchFourRoute() / fetchFlapRoute() / fetchLunaRoute()
    │       ├─ RPC 1: helper.getTokenInfo(token)
    │       └─ RPC 2: helper.getPancakePair(token) (如果已迁移)
    └─ 返回路由信息 (platform, preferredChannel, quoteToken 等)
    ↓
步骤4: 获取通道处理器 getChannel(channelId)
    ↓
步骤5: 规范化 Gas Price (计算，无 RPC)
    ↓
步骤6: 执行买入交易
    ├─ 判断使用哪种交易方式：
    │   ├─ Custom Aggregator (自定义聚合器)
    │   ├─ Four Quote Bridge (非 BNB 筹集币种)
    │   ├─ Flap Quote Bridge
    │   ├─ XMode Direct Buy
    │   └─ 默认通道买入
    │
    └─ 以 Four Quote Bridge 为例：
        ├─ prepareFourQuoteBuy()
        │   ├─ RPC 3: getQuoteBalance() - 查询 quote token 余额
        │   ├─ RPC 4: readContract(quote.allowance) - 查询授权额度
        │   ├─ 如果授权不足：
        │   │   ├─ RPC 5: estimateGas(approve)
        │   │   ├─ RPC 6: sendTransaction(approve)
        │   │   └─ 等待授权交易确认
        │   └─ RPC 7: estimateQuoteToBnbAmount() - 估算需要多少 quote token
        │       └─ readContract(pancakeRouter.getAmountsIn)
        │
        └─ executeFourQuoteBuy()
            ├─ RPC 8: estimateGas(buyToken)
            ├─ RPC 9: sendTransaction(buyToken)
            └─ 返回交易哈希
    ↓
步骤7: 初始化交易监听 (如果启用)
    └─ txWatcher.watchTransaction(txHash)
    ↓
返回交易结果
```

---

## 📋 RPC 查询清单

### 第一次交易（未缓存）

| 序号 | 查询类型 | 函数 | 位置 | 是否可缓存 | 缓存时长 | 备注 |
|------|---------|------|------|-----------|---------|------|
| 1 | 路由查询 | `helper.getTokenInfo()` | token-route.ts:272 | ✅ 是 | 10分钟 | 代币基本信息 |
| 2 | LP查询 | `helper.getPancakePair()` | token-route.ts:325 | ✅ 是 | 10分钟 | 仅已迁移代币 |
| 3 | 余额查询 | `quote.balanceOf()` | four-quote-bridge.ts | ✅ 是 | 5秒 | Quote token 余额 |
| 4 | 授权查询 | `quote.allowance()` | four-quote-bridge.ts | ✅ 是 | 24小时 | 授权额度 |
| 5 | Gas估算 | `estimateGas(approve)` | - | ❌ 否 | - | 仅授权不足时 |
| 6 | 授权交易 | `sendTransaction(approve)` | - | ❌ 否 | - | 仅授权不足时 |
| 7 | 价格估算 | `router.getAmountsIn()` | four-quote-bridge.ts | ❌ 否 | - | 实时价格 |
| 8 | Gas估算 | `estimateGas(buyToken)` | - | ❌ 否 | - | 每次必需 |
| 9 | 买入交易 | `sendTransaction(buyToken)` | - | ❌ 否 | - | 每次必需 |

### 第二次交易（已缓存）

| 序号 | 查询类型 | 状态 | 说明 |
|------|---------|------|------|
| 1 | 路由查询 | ✅ 缓存命中 | 10分钟内复用 |
| 2 | LP查询 | ✅ 缓存命中 | 10分钟内复用 |
| 3 | 余额查询 | ⚠️ 可能过期 | 5秒缓存，可能需要重新查询 |
| 4 | 授权查询 | ✅ 缓存命中 | 24小时内复用 |
| 5-6 | 授权相关 | ✅ 跳过 | 已授权 |
| 7 | 价格估算 | ❌ 必须查询 | 实时价格 |
| 8-9 | 交易相关 | ❌ 必须查询 | 每次必需 |

---

## ⏱️ 性能瓶颈分析

### 第一次交易慢的原因

1. **路由查询（~500-1000ms）**
   - `helper.getTokenInfo()` 查询代币信息
   - 如果已迁移，还需要 `helper.getPancakePair()`
   - **优化空间**：✅ 已实现缓存（10分钟）

2. **授权检查 + 授权交易（~2000-3000ms）**
   - 查询 quote token 授权额度
   - 如果未授权，需要发送授权交易并等待确认
   - **优化空间**：
     - ✅ 授权额度缓存（24小时）
     - ⚠️ 首次授权无法避免

3. **余额查询（~200-500ms）**
   - 查询 quote token 余额
   - **优化空间**：✅ 已实现缓存（5秒）

4. **价格估算（~200-500ms）**
   - 调用 PancakeRouter.getAmountsIn() 估算需要多少 quote token
   - **优化空间**：❌ 实时价格，无法缓存

### 第二次交易快的原因

1. ✅ 路由信息已缓存（节省 500-1000ms）
2. ✅ 授权已完成（节省 2000-3000ms）
3. ✅ 余额可能仍在缓存中（节省 200-500ms）
4. ❌ 价格估算仍需查询（~200-500ms）
5. ❌ Gas 估算和交易提交仍需执行（~500-1000ms）

**总节省时间**：约 2700-4500ms

---

## 🎯 优化建议

### 优先级 1：已实现的优化 ✅

1. **路由信息缓存**（已实现）
   - 位置：`token-route.ts`
   - 缓存时长：10分钟
   - 效果：节省 500-1000ms

2. **授权额度缓存**（已实现）
   - 位置：`four-quote-bridge.ts`
   - 缓存时长：24小时
   - 效果：避免重复查询

3. **余额缓存**（已实现）
   - 缓存时长：5秒
   - 效果：节省 200-500ms

### 优先级 2：可以优化的部分 🔧

#### 2.1 并发查询优化

**当前问题**：某些查询是串行的，可以并发执行

**优化方案**：
```typescript
// 当前（串行）
const quoteBalance = await getQuoteBalance(...);
const allowance = await readContract({ functionName: 'allowance' });
const amountIn = await estimateQuoteToBnbAmount(...);

// 优化后（并发）
const [quoteBalance, allowance, amountIn] = await Promise.all([
  getQuoteBalance(...),
  readContract({ functionName: 'allowance' }),
  estimateQuoteToBnbAmount(...)
]);
```

**预期效果**：节省 200-400ms

#### 2.2 预加载优化

**方案 1：解锁时预加载常用数据**

在 `handleUnlockWallet` 或 `warmupBackgroundServices` 中预加载：
- 常用 quote token 的授权状态
- 常用 quote token 的余额

```typescript
async function warmupBackgroundServices() {
  if (!walletAccount) return;

  // 预加载常用 quote token 数据
  const commonQuoteTokens = [CONTRACTS.ASTER, CONTRACTS.USD1, CONTRACTS.USDT];
  await Promise.all(
    commonQuoteTokens.map(async (token) => {
      try {
        await Promise.all([
          getQuoteBalance(token, walletAccount.address),
          readContract({
            address: token,
            abi: ERC20_ABI,
            functionName: 'allowance',
            args: [walletAccount.address, CONTRACTS.FOUR_TOKEN_MANAGER]
          })
        ]);
      } catch (error) {
        // 忽略错误，预加载失败不影响主流程
      }
    })
  );
}
```

**预期效果**：首次交易节省 300-600ms

**方案 2：切换代币时预加载路由**

在用户浏览代币页面时（URL 变化），后台预加载路由信息：

```typescript
// content script 检测到 URL 变化
const tokenAddress = extractTokenAddressFromUrl(window.location.href);
if (tokenAddress) {
  // 后台预加载路由（不阻塞 UI）
  chrome.runtime.sendMessage({
    action: 'prefetch_token_route',
    data: { tokenAddress }
  });
}
```

**预期效果**：用户点击买入时路由已缓存，节省 500-1000ms

#### 2.3 智能授权策略

**当前问题**：每次都检查授权，即使已经授权过

**优化方案**：
- 授权成功后，在本地缓存中标记 `approved: true`
- 下次交易时，先检查本地缓存，如果已标记则跳过授权检查
- 仅在交易失败时才重新检查链上授权状态

```typescript
const approvalCache = new Map<string, boolean>();

async function checkAndApprove(token, spender) {
  const cacheKey = `${token}-${spender}`;

  // 检查本地缓存
  if (approvalCache.get(cacheKey)) {
    return; // 已授权，跳过
  }

  // 查询链上状态
  const allowance = await readContract({...});
  if (allowance >= REQUIRED_AMOUNT) {
    approvalCache.set(cacheKey, true);
    return;
  }

  // 执行授权
  await approve(...);
  approvalCache.set(cacheKey, true);
}
```

**预期效果**：节省 200-300ms（跳过授权查询）

### 优先级 3：架构优化（长期）🏗️

#### 3.1 Service Worker 常驻优化

**问题**：Service Worker 可能被终止，导致需要重新初始化

**方案**：
- 使用 Keep-Alive 机制保持 Service Worker 活跃
- 已实现：`WALLET_CONFIG.KEEP_ALIVE_DURATION`

#### 3.2 Offscreen Document 优化

**问题**：某些 RPC 查询可以在 Offscreen Document 中并发执行

**方案**：
- 将非关键查询（余额、授权）移到 Offscreen
- Background 专注于交易提交

---

## 📊 优化效果预估

### 当前性能（第一次交易）

| 步骤 | 耗时 | 说明 |
|------|------|------|
| 路由查询 | 500-1000ms | helper.getTokenInfo() |
| 授权检查 | 200-300ms | allowance 查询 |
| 授权交易 | 2000-3000ms | 仅首次需要 |
| 余额查询 | 200-500ms | quote token 余额 |
| 价格估算 | 200-500ms | getAmountsIn() |
| Gas估算+交易 | 500-1000ms | 必需步骤 |
| **总计** | **3600-6300ms** | 首次交易 |

### 优化后性能（实施优先级2优化）

| 步骤 | 耗时 | 优化 |
|------|------|------|
| 路由查询 | 0ms | ✅ 预加载 |
| 授权检查 | 0ms | ✅ 本地缓存 |
| 授权交易 | 2000-3000ms | ⚠️ 首次无法避免 |
| 余额+价格估算 | 300-600ms | ✅ 并发查询 |
| Gas估算+交易 | 500-1000ms | 必需步骤 |
| **总计** | **2800-4600ms** | 节省 800-1700ms |

### 第二次交易（已授权）

| 步骤 | 耗时 | 说明 |
|------|------|------|
| 路由查询 | 0ms | ✅ 缓存 |
| 授权检查 | 0ms | ✅ 缓存 |
| 余额+价格估算 | 300-600ms | 并发查询 |
| Gas估算+交易 | 500-1000ms | 必需步骤 |
| **总计** | **800-1600ms** | 已经很快 |

---

## 🔧 实施计划

### 阶段 1：并发查询优化（1-2天）

- [ ] 修改 `prepareFourQuoteBuy()` 使用 Promise.all 并发查询
- [ ] 修改 `prepareFlapQuoteBuy()` 使用 Promise.all 并发查询
- [ ] 测试验证性能提升

**预期效果**：节省 200-400ms

### 阶段 2：预加载优化（2-3天）

- [ ] 在 `warmupBackgroundServices()` 中预加载常用 quote token 数据
- [ ] 在 content script 中实现 URL 变化时预加载路由
- [ ] 添加预加载失败的容错处理

**预期效果**：首次交易节省 800-1600ms

### 阶段 3：智能授权缓存（1天）

- [ ] 实现本地授权状态缓存
- [ ] 添加缓存失效机制（交易失败时清除）
- [ ] 测试验证

**预期效果**：节省 200-300ms

---

## 📝 总结

### 关键发现

1. ✅ **第一次慢的主要原因**：
   - 路由查询（500-1000ms）
   - 授权交易（2000-3000ms，仅首次）
   - 多个串行 RPC 查询

2. ✅ **第二次快的原因**：
   - 路由信息已缓存
   - 授权已完成
   - 部分数据仍在缓存中

3. ✅ **已实现的优化**：
   - 路由信息缓存（10分钟）
   - 授权额度缓存（24小时）
   - 余额缓存（5秒）

4. 🔧 **可以优化的部分**：
   - 并发查询（节省 200-400ms）
   - 预加载（节省 800-1600ms）
   - 智能授权缓存（节省 200-300ms）

### 优化潜力

- **当前首次交易**：3600-6300ms
- **优化后首次交易**：2800-4600ms（已授权）或 4800-7600ms（未授权）
- **第二次交易**：800-1600ms（已经很快）

### 建议

1. **立即实施**：并发查询优化（简单且效果明显）
2. **短期实施**：预加载优化（效果最显著）
3. **中期实施**：智能授权缓存（进一步优化）

---

**报告生成时间**：2026-01-26
**分析版本**：v1.1.4
**分析工具**：代码静态分析 + 流程追踪
