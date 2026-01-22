# BSC 打狗棒插件 - 节点请求频率分析与优化报告

## 📊 执行摘要

本报告对插件的区块链节点 RPC 请求进行了全面分析，识别了请求频率、模式和优化机会。

**关键发现：**
- **当前峰值请求频率**：约 **2-3 次/秒**（正常使用）
- **每分钟请求量**：约 **120-180 次/分钟**
- **优化潜力**：可减少 **30-40%** 的请求量
- **成本影响**：中等（取决于节点服务商的计费模式）

---

## 🔍 详细分析

### 1. 请求类型分布

根据代码分析，插件的 RPC 请求主要分为以下类型：

#### 1.1 定时轮询请求

| 请求类型 | 频率 | 配置位置 | 每分钟请求数 |
|---------|------|---------|-------------|
| **余额更新** | 2000ms (2秒) | `UI_CONFIG.BALANCE_UPDATE_INTERVAL` | **30次** |
| **卖出估算** | 1000ms (1秒) | `CONTENT_CONFIG.SELL_ESTIMATE_INTERVAL_MS` | **60次** |
| **交易轮询** (降级模式) | 800ms | `TX_WATCHER_CONFIG.POLLING_INTERVAL` | **75次** (仅在WebSocket不可用时) |
| **通道状态刷新** | 5000ms (5秒) | `CONTENT_CONFIG.ROUTE_REFRESH_DEFAULT_DELAY_MS` | **12次** |

**小计（正常模式）**：约 **102 次/分钟**

#### 1.2 事件触发请求

| 触发事件 | 请求类型 | 频率 |
|---------|---------|------|
| 页面加载/URL变化 | 路由查询、余额查询、授权查询 | 每次切换代币页面 3-5 次 |
| 买入操作 | 授权查询、余额查询、交易提交、交易监听 | 每次操作 4-6 次 |
| 卖出操作 | 余额查询、估算查询、交易提交、交易监听 | 每次操作 4-6 次 |
| 授权操作 | 授权查询、授权交易、交易监听 | 每次操作 3-4 次 |

**估算（活跃交易）**：额外 **20-40 次/分钟**

#### 1.3 合约读取请求

代码中发现 **42 处** RPC 调用点，主要用于：

| 功能模块 | 请求数量 | 主要方法 |
|---------|---------|---------|
| 路由查询 (token-route.ts) | 4 处 | `readContract` - 查询 Factory、Helper、Launchpad |
| 交易通道 (trading-channels.ts) | 14 处 | `readContract` - 查询池子状态、余额、授权 |
| Four.meme 桥接 (four-quote-bridge.ts) | 5 处 | `readContract` - 查询 quote 余额、授权 |
| 自定义聚合器 (custom-aggregator-agent.ts) | 2 处 | `readContract` - 查询 V3 池子 |
| 交易监听 (tx-watcher.ts) | 3 处 | `getTransactionReceipt` - 轮询交易状态 |
| 后台服务 (background/index.ts) | 13 处 | 各类合约调用 |
| Offscreen (offscreen/index.ts) | 1 处 | 辅助查询 |

---

### 2. 峰值场景分析

#### 场景 A：用户浏览代币页面（无交易）
```
余额轮询：      30 次/分钟
卖出估算：      60 次/分钟  (如果在卖出输入框有焦点)
通道状态：      12 次/分钟
页面切换：      ~5 次/切换
-----------------------------------
总计：          102-107 次/分钟
每秒平均：      1.7-1.8 次/秒
```

#### 场景 B：活跃交易（频繁买卖）
```
基础轮询：      102 次/分钟
交易操作：      ~30 次/分钟  (每次交易 5 次 × 6 次交易)
交易监听：      ~20 次/分钟  (WebSocket 降级时)
-----------------------------------
总计：          152 次/分钟
每秒平均：      2.5 次/秒
```

#### 场景 C：WebSocket 不可用（最差情况）
```
基础轮询：      102 次/分钟
交易轮询：      75 次/分钟   (800ms 间隔)
交易操作：      30 次/分钟
-----------------------------------
总计：          207 次/分钟
每秒平均：      3.5 次/秒
```

---

## 🎯 优化建议

### 优先级 1：高影响优化（立即实施）

#### 1.1 延长余额更新间隔
**当前**：2000ms (2秒)
**建议**：3000-5000ms (3-5秒)
**影响**：减少 **33-60%** 余额请求
**节省**：10-20 次/分钟

```typescript
// src/shared/trading-config.ts
export const UI_CONFIG = {
  BALANCE_UPDATE_INTERVAL: 4000, // 从 2000 改为 4000
}
```

**理由**：余额变化不需要实时更新，3-5秒的延迟对用户体验影响极小。

#### 1.2 优化卖出估算频率
**当前**：1000ms (1秒)
**建议**：使用防抖（debounce）+ 2000ms 间隔
**影响**：减少 **50-70%** 估算请求
**节省**：30-40 次/分钟

```typescript
// 建议实现
let estimateDebounceTimer: NodeJS.Timeout | null = null;
function scheduleSellEstimate() {
  if (estimateDebounceTimer) clearTimeout(estimateDebounceTimer);
  estimateDebounceTimer = setTimeout(() => {
    updateSellEstimate();
  }, 2000); // 用户停止输入 2 秒后才更新
}
```

**理由**：用户输入时不需要每秒都估算，只在输入停止后估算即可。

#### 1.3 启用 WebSocket 交易监听
**当前**：`TX_WATCHER_CONFIG.ENABLED: false`
**建议**：`TX_WATCHER_CONFIG.ENABLED: true`
**影响**：减少 **75 次/分钟** 轮询请求（交易时）
**节省**：75 次/分钟（交易监听场景）

```typescript
// src/shared/trading-config.ts
export const TX_WATCHER_CONFIG = {
  ENABLED: true, // 从 false 改为 true
}
```

**理由**：WebSocket 是推送模式，比轮询高效得多。代码已实现，只需启用。

---

### 优先级 2：中等影响优化（短期实施）

#### 2.1 实现授权状态缓存
**当前**：每次操作都查询授权状态
**建议**：缓存授权状态 5-10 分钟
**影响**：减少 **20-30%** 授权查询
**节省**：5-10 次/分钟

```typescript
// 伪代码
const approvalCache = new Map<string, { approved: boolean, timestamp: number }>();
const CACHE_TTL = 5 * 60 * 1000; // 5 分钟

async function checkApproval(token: string): Promise<boolean> {
  const cached = approvalCache.get(token);
  if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
    return cached.approved;
  }
  const approved = await queryApprovalFromChain(token);
  approvalCache.set(token, { approved, timestamp: Date.now() });
  return approved;
}
```

**注意**：代码中已有 `QUOTE_ALLOWANCE_CACHE_TTL_MS: 24小时` 的缓存，可以扩展到所有代币。

#### 2.2 批量查询优化
**当前**：多个合约调用分别执行
**建议**：使用 Multicall 合约批量查询
**影响**：减少 **40-50%** 合约读取请求
**节省**：15-25 次/分钟

```typescript
// 使用 viem 的 multicall
import { multicall } from 'viem/actions';

const results = await multicall(publicClient, {
  contracts: [
    { address: token, abi: erc20Abi, functionName: 'balanceOf', args: [wallet] },
    { address: token, abi: erc20Abi, functionName: 'allowance', args: [wallet, spender] },
    { address: token, abi: erc20Abi, functionName: 'decimals' },
  ]
});
```

#### 2.3 智能轮询策略
**当前**：固定间隔轮询
**建议**：根据用户活跃度动态调整
**影响**：减少 **20-30%** 后台轮询
**节省**：20-30 次/分钟（用户不活跃时）

```typescript
// 伪代码
let lastUserActivity = Date.now();
let pollingInterval = 2000;

function updatePollingInterval() {
  const idleTime = Date.now() - lastUserActivity;
  if (idleTime > 60000) { // 1分钟无操作
    pollingInterval = 10000; // 降低到 10 秒
  } else if (idleTime > 30000) { // 30秒无操作
    pollingInterval = 5000; // 降低到 5 秒
  } else {
    pollingInterval = 2000; // 保持 2 秒
  }
}
```

---

### 优先级 3：长期优化（中期实施）

#### 3.1 实现本地状态预测
- 交易提交后，本地立即更新余额预估值
- 等待链上确认后再同步真实值
- 减少用户等待时的频繁刷新需求

#### 3.2 使用 IndexedDB 持久化缓存
- 缓存代币信息（名称、精度、logo）
- 缓存路由信息（池子地址、手续费）
- 减少重复查询

#### 3.3 实现请求队列和限流
- 限制并发请求数量（如最多 3 个并发）
- 实现请求优先级队列
- 避免请求风暴

---

## 📈 优化效果预估

### 实施优先级 1 优化后：

| 场景 | 优化前 | 优化后 | 减少比例 |
|-----|-------|-------|---------|
| 浏览代币 | 102 次/分钟 | **65 次/分钟** | **-36%** |
| 活跃交易 | 152 次/分钟 | **95 次/分钟** | **-37%** |
| WebSocket 降级 | 207 次/分钟 | **120 次/分钟** | **-42%** |

### 实施全部优化后：

| 场景 | 优化前 | 优化后 | 减少比例 |
|-----|-------|-------|---------|
| 浏览代币 | 102 次/分钟 | **45 次/分钟** | **-56%** |
| 活跃交易 | 152 次/分钟 | **70 次/分钟** | **-54%** |
| WebSocket 降级 | 207 次/分钟 | **85 次/分钟** | **-59%** |

---

## 💰 成本影响分析

### 节点服务商计费模式

大多数 RPC 节点服务商按请求数量计费：

| 服务商 | 免费额度 | 超额费用 |
|-------|---------|---------|
| Alchemy | 300M 请求/月 | $49/月 起 |
| Infura | 100K 请求/天 | $50/月 起 |
| QuickNode | 10M 请求/月 | $9/月 起 |
| NodeReal | 3M 请求/天 | 按需定价 |

### 单用户月度请求量估算

**优化前**：
- 平均 150 次/分钟 × 60 分钟 × 8 小时/天 × 30 天 = **216万 次/月**

**优化后**：
- 平均 70 次/分钟 × 60 分钟 × 8 小时/天 × 30 天 = **100万 次/月**

**节省**：**116万 次/月** (-54%)

### 多用户场景

如果有 100 个活跃用户：
- **优化前**：2.16亿 次/月
- **优化后**：1.0亿 次/月
- **节省**：1.16亿 次/月

---

## 🚀 实施路线图

### 第一阶段（1-2天）- 快速优化
- [x] 延长余额更新间隔：2秒 → 4秒
- [x] 启用 WebSocket 交易监听
- [ ] 优化卖出估算（添加防抖）

**预期效果**：减少 35-40% 请求量

### 第二阶段（1周）- 缓存优化
- [ ] 实现授权状态缓存
- [ ] 扩展 quote 缓存到所有代币
- [ ] 实现路由信息缓存

**预期效果**：额外减少 15-20% 请求量

### 第三阶段（2-3周）- 架构优化
- [ ] 实现 Multicall 批量查询
- [ ] 智能轮询策略
- [ ] 请求队列和限流

**预期效果**：额外减少 10-15% 请求量

---

## ⚠️ 注意事项

### 1. 用户体验权衡
- 延长轮询间隔可能导致数据更新延迟
- 建议在关键操作（交易提交后）立即刷新
- 提供手动刷新按钮作为补充

### 2. 缓存失效风险
- 授权状态可能被其他应用撤销
- 建议在交易失败时清除相关缓存
- 提供"清除缓存"功能

### 3. WebSocket 稳定性
- 需要完善的重连机制（已实现）
- 监控 WebSocket 连接状态
- 保持 HTTP 轮询作为降级方案

### 4. 节点限流
- 某些节点有速率限制（如 300 req/min）
- 实施优化后可避免触发限流
- 建议配置多个备用节点（已实现）

---

## 📊 监控建议

建议添加以下监控指标：

```typescript
// 请求统计
const rpcStats = {
  totalRequests: 0,
  requestsByType: new Map<string, number>(),
  requestsPerMinute: 0,
  cacheHitRate: 0,
  websocketUptime: 0
};

// 定期输出统计
setInterval(() => {
  console.log('[RPC Stats]', {
    rpm: rpcStats.requestsPerMinute,
    cacheHit: `${(rpcStats.cacheHitRate * 100).toFixed(1)}%`,
    wsUptime: `${(rpcStats.websocketUptime * 100).toFixed(1)}%`
  });
}, 60000);
```

---

## 📝 结论

当前插件的节点请求频率处于**中等偏高**水平（2-3 次/秒），通过实施建议的优化措施，可以：

✅ **减少 50-60% 的 RPC 请求量**
✅ **降低节点服务成本**
✅ **提高插件响应速度**（减少网络等待）
✅ **增强稳定性**（减少限流风险）
✅ **改善用户体验**（更快的交互响应）

**建议优先实施第一阶段优化**，这些改动简单且效果显著，可以立即带来 35-40% 的请求量减少。

---

**报告生成时间**：2026-01-21
**分析版本**：v1.1.3
**分析工具**：代码静态分析 + 配置审查
