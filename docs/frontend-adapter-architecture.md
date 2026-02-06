# 前端对接层架构设计

## 问题背景

### 当前存在的问题

1. **后端代码被前端需求污染**
   - 前端的特殊需求直接修改后端核心代码
   - 缺乏统一的接口规范
   - 代码维护困难

2. **RPC 调用效率低**
   - 页面切换时多次独立查询（代币信息、授权状态等）
   - 每个查询都是独立的 RPC 调用
   - 容易触发节点限流

3. **接口冗余和混乱**
   - 盲目增加新接口
   - 缺乏统一的请求管理
   - 重复的查询逻辑

## 解决方案：前端对接层

### 架构设计

```
┌─────────────────────────────────────────────────────────────┐
│                         Frontend (Content Script)            │
│  ┌──────────────────────────────────────────────────────┐   │
│  │          Frontend Adapter (前端对接层)                │   │
│  │  - 统一查询接口                                       │   │
│  │  - 自动批量合并                                       │   │
│  │  - 请求去重                                          │   │
│  │  - 优先级管理                                        │   │
│  └──────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────┘
                              ↓
                    chrome.runtime.sendMessage
                              ↓
┌─────────────────────────────────────────────────────────────┐
│                      Backend (Service Worker)                │
│  ┌──────────────────────────────────────────────────────┐   │
│  │       Batch Query Handlers (批量查询处理器)          │   │
│  │  - 接收批量查询请求                                   │   │
│  │  - 使用 MultiCall 优化                               │   │
│  │  - 返回批量结果                                      │   │
│  └──────────────────────────────────────────────────────┘   │
│  ┌──────────────────────────────────────────────────────┐   │
│  │            Core Business Logic (核心业务逻辑)         │   │
│  │  - 交易执行                                          │   │
│  │  - 钱包管理                                          │   │
│  │  - 路由解析                                          │   │
│  │  - 不被前端需求污染                                   │   │
│  └──────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────┘
                              ↓
                         RPC Node (MultiCall)
```

## 核心特性

### 0. 聚合查询接口（推荐）

**问题**：页面切换时需要查询多个信息（余额、授权、元数据、路由等）

```typescript
// 之前：需要多次调用
const balance = await queryBalance(token, wallet);
const allowance1 = await queryAllowance(token, wallet, spender1);
const allowance2 = await queryAllowance(token, wallet, spender2);
const allowance3 = await queryAllowance(token, wallet, spender3);
const metadata = await queryMetadata(token, ['symbol', 'decimals']);
const route = await queryRoute(token);
// 需要调用 6 次方法
```

**解决**：一次调用获取所有信息

```typescript
// 现在：一次调用
const info = await queryTokenFullInfo(token, wallet);
// 返回：{ balance, allowances: { pancake, four, flap }, metadata, route }
// 只需调用 1 次方法，1 次 RPC 调用（MultiCall）
// 自动使用缓存，避免重复查询
```

**缓存优化**：
- 复用现有的 `fetchTokenInfoData` 和 `ensureTokenMetadata` 缓存逻辑
- 缓存 TTL：根据 `TOKEN_INFO_CACHE_TTL` 配置
- 缓存命中时直接返回，无需查询链上数据

### 1. 自动批量合并

**问题**：页面切换时可能同时查询多个代币的信息

```typescript
// 之前：多次独立查询
await queryBalance(token1);  // RPC 调用 1
await queryBalance(token2);  // RPC 调用 2
await queryBalance(token3);  // RPC 调用 3
// 总共：3 次 RPC 调用
```

**解决**：自动合并为批量查询

```typescript
// 现在：自动合并
await queryBalance(token1);  // 添加到队列
await queryBalance(token2);  // 添加到队列
await queryBalance(token3);  // 添加到队列
// 50ms 后自动批量执行
// 总共：1 次 RPC 调用（MultiCall）
```

### 2. 请求去重

**问题**：短时间内重复查询相同的数据

```typescript
// 之前：重复查询
await queryBalance(token1);  // RPC 调用 1
await queryBalance(token1);  // RPC 调用 2（重复）
// 总共：2 次 RPC 调用
```

**解决**：自动去重

```typescript
// 现在：自动去重
await queryBalance(token1);  // 添加到队列
await queryBalance(token1);  // 检测到重复，共享结果
// 总共：1 次 RPC 调用
```

### 3. 优先级管理

**问题**：所有查询都是同等优先级，关键查询可能被延迟

**解决**：支持优先级

```typescript
// 交易前的关键查询：高优先级，立即执行
await queryBalance(token, wallet, { priority: 'high', immediate: true });

// 显示更新的查询：普通优先级，可以批量
await queryBalance(token, wallet, { priority: 'normal' });

// 预加载的查询：低优先级
await queryBalance(token, wallet, { priority: 'low' });
```

### 4. 统一接口

**问题**：前端需求导致后端接口混乱

**解决**：标准化的查询接口

```typescript
// 统一的查询接口
frontendAdapter.query(type, params, options)

// 便捷方法
queryBalance(tokenAddress, walletAddress, options)
queryAllowance(tokenAddress, walletAddress, spenderAddress, options)
queryMetadata(tokenAddress, fields, options)
queryRoute(tokenAddress, force, options)
queryApprovalStatus(tokenAddress, walletAddress, spenderAddress, options)
```

## 使用示例

### 场景 1：页面切换时查询代币信息（推荐使用聚合接口）

```typescript
// 🎯 推荐：使用聚合接口，一次调用获取所有信息
import { queryTokenFullInfo } from './frontend-adapter';

const tokenInfo = await queryTokenFullInfo(tokenAddress, walletAddress);

// 返回结果包含所有信息：
// {
//   success: true,
//   tokenAddress: '0x...',
//   walletAddress: '0x...',
//   balance: '1000000000000000000',
//   allowances: {
//     pancake: '0',
//     four: '115792089237316195423570985008687907853269984665640564039457584007913129639935',
//     flap: '0'
//   },
//   metadata: {
//     symbol: 'TOKEN',
//     decimals: 18,
//     totalSupply: '1000000000000000000000000'
//   },
//   route: {
//     platform: 'four',
//     readyForPancake: false,
//     channelId: 'four'
//   }
// }

// 总共：1 次消息，1 次 RPC 调用（MultiCall）
```

```typescript
// ⚠️ 不推荐：分别调用多个接口（虽然会自动批量，但仍需多次调用）
import { queryBalance, queryAllowance, queryMetadata, queryRoute } from './frontend-adapter';

// 这些查询会自动合并为批量请求
const [balance, pancakeAllowance, fourAllowance, flapAllowance, metadata, route] = await Promise.all([
  queryBalance(tokenAddress, walletAddress),
  queryAllowance(tokenAddress, walletAddress, PANCAKE_ROUTER),
  queryAllowance(tokenAddress, walletAddress, FOUR_TOKEN_MANAGER),
  queryAllowance(tokenAddress, walletAddress, FLAP_PORTAL),
  queryMetadata(tokenAddress, ['symbol', 'decimals', 'totalSupply']),
  queryRoute(tokenAddress)
]);
// 总共：6 次方法调用，1-2 次消息，1 次 RPC 调用（MultiCall）
```

### 场景 1（旧）：页面切换时查询代币信息

```typescript
// 之前：多次独立查询
const balance = await chrome.runtime.sendMessage({
  action: 'get_token_info',
  data: { tokenAddress, needApproval: false }
});

const allowance = await chrome.runtime.sendMessage({
  action: 'check_token_approval',
  data: { tokenAddress, spenderAddress }
});

const route = await chrome.runtime.sendMessage({
  action: 'get_token_route',
  data: { tokenAddress }
});
// 总共：3 次消息，3+ 次 RPC 调用
```

```typescript
// 现在：使用前端对接层
import { queryBalance, queryAllowance, queryRoute } from './frontend-adapter';

// 这些查询会自动合并为批量请求
const [balance, allowance, route] = await Promise.all([
  queryBalance(tokenAddress, walletAddress),
  queryAllowance(tokenAddress, walletAddress, spenderAddress),
  queryRoute(tokenAddress)
]);
// 总共：1-2 次消息，1 次 RPC 调用（MultiCall）
```

### 场景 2：快速轮询余额

```typescript
// 之前：每次都是独立查询
setInterval(async () => {
  const balance = await chrome.runtime.sendMessage({
    action: 'get_token_info',
    data: { tokenAddress, needApproval: false }
  });
  updateUI(balance);
}, 1000);
// 每秒 1 次 RPC 调用
```

```typescript
// 现在：自动去重和批量
setInterval(async () => {
  const balance = await queryBalance(tokenAddress, walletAddress);
  updateUI(balance);
}, 1000);
// 如果多个地方同时轮询，自动去重
// 如果查询多个代币，自动批量
```

### 场景 3：交易前的关键查询

```typescript
// 交易前需要最新的余额和授权，使用高优先级
const [balance, allowance] = await Promise.all([
  queryBalance(tokenAddress, walletAddress, {
    priority: 'high',
    immediate: true
  }),
  queryAllowance(tokenAddress, walletAddress, spenderAddress, {
    priority: 'high',
    immediate: true
  })
]);

// 立即执行，不等待批量
```

## 配置参数

### 批次配置

```typescript
{
  balance: {
    maxWaitTime: 50,      // 最大等待 50ms
    maxBatchSize: 10      // 最多批量 10 个
  },
  allowance: {
    maxWaitTime: 50,
    maxBatchSize: 10
  },
  metadata: {
    maxWaitTime: 50,
    maxBatchSize: 10
  },
  route: {
    maxWaitTime: 100,     // 路由查询等待时间稍长
    maxBatchSize: 5
  },
  approval_status: {
    maxWaitTime: 50,
    maxBatchSize: 10
  }
}
```

## 性能优化效果

### 页面切换场景

**之前**：
- 查询余额：1 次 RPC
- 查询授权（3 个合约）：3 次 RPC
- 查询元数据：3 次 RPC
- 查询路由：1 次 RPC
- **总计：8 次 RPC 调用**

**现在**：
- 批量查询余额 + 授权 + 元数据：1 次 RPC（MultiCall）
- 查询路由：1 次 RPC
- **总计：2 次 RPC 调用**
- **减少 75% 的 RPC 调用**

### 多代币场景

**之前**：
- 查询 5 个代币的余额：5 次 RPC
- 查询 5 个代币的授权：15 次 RPC（每个 3 个合约）
- **总计：20 次 RPC 调用**

**现在**：
- 批量查询 5 个代币的余额：1 次 RPC（MultiCall）
- 批量查询 5 个代币的授权：1 次 RPC（MultiCall）
- **总计：2 次 RPC 调用**
- **减少 90% 的 RPC 调用**

## 实施计划

### Phase 1：基础设施（已完成）
- ✅ 创建前端对接层 (`frontend-adapter.ts`)
- ✅ 创建批量查询处理器 (`batch-query-handlers.ts`)
- ✅ 在 background 中注册批量查询接口

### Phase 2：迁移现有代码
- ⏳ 迁移 content script 使用前端对接层
- ⏳ 移除直接调用 `chrome.runtime.sendMessage` 的代码
- ⏳ 测试验证

### Phase 3：优化和监控
- ⏳ 添加性能监控
- ⏳ 优化批次配置
- ⏳ 添加错误重试机制

## 维护指南

### 前端对接层提供的所有接口

#### 1. 查询类接口（支持批量和缓存）

**聚合查询接口（推荐）**：
```typescript
queryTokenFullInfo(tokenAddress, walletAddress, options?)
// 一次性返回：余额、授权、元数据、路由
```

**独立查询接口**：
```typescript
queryBalance(tokenAddress, walletAddress, options?)
queryAllowance(tokenAddress, walletAddress, spenderAddress, options?)
queryMetadata(tokenAddress, fields, options?)
queryRoute(tokenAddress, force?, options?)
queryApprovalStatus(tokenAddress, walletAddress, spenderAddress, options?)
```

#### 2. 钱包管理接口

```typescript
getWalletStatus(tokenAddress?)
// 获取钱包状态（地址、余额等）
```

#### 3. 代币信息接口

```typescript
getTokenInfo(tokenAddress, needApproval?)
// 已废弃，推荐使用 queryTokenFullInfo

getTokenRoute(tokenAddress, force?)
// 获取代币路由信息
```

#### 4. 授权管理接口

```typescript
checkTokenApproval(tokenAddress, spenderAddress)
// 检查代币授权

approveToken(tokenAddress, spenderAddress, amount?, options?)
// 授权代币

revokeTokenApproval(tokenAddress, spenderAddress)
// 撤销代币授权
```

#### 5. 交易接口

```typescript
buyToken({ tokenAddress, amount, slippage?, ... })
// 买入代币

sellToken({ tokenAddress, percentage, slippage?, ... })
// 卖出代币

estimateSellAmount(tokenAddress, percentage, channelId?)
// 估算卖出金额
```

#### 6. 预加载接口

```typescript
prefetchTokenBalance(tokenAddress)
// 预加载代币余额

prefetchApprovalStatus(tokenAddress)
// 预加载授权状态

prefetchRoute(tokenAddress)
// 预加载路由信息
```

#### 7. 工具接口

```typescript
showNotification(title, message)
// 显示通知

getCacheInfo()
// 获取缓存信息（调试用）
```

### 使用建议

1. **页面切换/初始加载**：使用 `queryTokenFullInfo` 聚合接口
2. **快速轮询余额**：使用 `queryBalance` + 低优先级
3. **交易前查询**：使用独立接口 + 高优先级 + immediate
4. **预加载**：使用 `prefetch*` 系列接口

### 添加新的查询类型

1. 在 `frontend-adapter.ts` 中添加查询类型：
```typescript
type QueryType = 'balance' | 'allowance' | 'new_query_type';
```

2. 添加处理器：
```typescript
this.queryHandlers.set('new_query_type', async (requests) => {
  return this.handleNewQueryType(requests);
});
```

3. 在 `batch-query-handlers.ts` 中实现后端处理：
```typescript
export async function handleBatchQueryNewType({ queries }) {
  // 使用 MultiCall 批量查询
  // 返回结果
}
```

4. 在 background 中注册接口：
```typescript
ACTION_HANDLER_MAP['batch_query_new_type'] = handleBatchQueryNewType;
```

### 调整批次配置

根据实际使用情况调整：
- `maxWaitTime`：等待时间越长，批量效果越好，但响应越慢
- `maxBatchSize`：批次越大，RPC 调用越少，但单次调用越慢

建议：
- 关键查询：`maxWaitTime: 20-50ms`
- 普通查询：`maxWaitTime: 50-100ms`
- 低优先级：`maxWaitTime: 100-200ms`

## 总结

前端对接层的核心价值：

1. **聚合查询接口**：页面切换时一次调用获取所有信息，减少方法调用次数
2. **分离关注点**：前端需求不污染后端核心代码
3. **自动优化**：自动批量、去重、优先级管理
4. **统一接口**：标准化的查询接口，减少混乱
5. **性能提升**：减少 75-90% 的 RPC 调用
6. **易于维护**：清晰的架构，易于扩展

### 推荐使用方式

- **页面切换场景**：使用 `queryTokenFullInfo` 聚合接口
- **单个查询场景**：使用 `queryBalance`、`queryAllowance` 等独立接口
- **交易前查询**：使用 `{ priority: 'high', immediate: true }` 选项

---

**创建日期**: 2026-02-06
**版本**: 1.0
