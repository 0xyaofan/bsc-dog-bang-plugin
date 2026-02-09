# 故障排查手册

## 概述

本手册提供常见问题的诊断和解决方案，帮助你快速定位和修复问题。

---

## 目录

1. [快速诊断](#快速诊断)
2. [路由查询问题](#路由查询问题)
3. [Service Worker 问题](#service-worker-问题)
4. [缓存问题](#缓存问题)
5. [流动性检查问题](#流动性检查问题)
6. [交易失败问题](#交易失败问题)
7. [性能问题](#性能问题)
8. [日志分析](#日志分析)
9. [错误代码参考](#错误代码参考)

---

## 快速诊断

### 问题分类

根据症状快速定位问题类型：

| 症状 | 可能原因 | 章节 |
|------|---------|------|
| 路由查询返回错误平台 | 平台检测逻辑错误 | [路由查询问题](#路由查询问题) |
| 提示 Service Worker 错误 | 环境限制 | [Service Worker 问题](#service-worker-问题) |
| 缓存数据不更新 | 缓存策略问题 | [缓存问题](#缓存问题) |
| 提示流动性不足 | 流动性检查失败 | [流动性检查问题](#流动性检查问题) |
| 交易失败 | Gas 估算、滑点等 | [交易失败问题](#交易失败问题) |
| 响应缓慢 | 性能瓶颈 | [性能问题](#性能问题) |

### 诊断工具

#### 1. 查看日志

```typescript
import { structuredLogger } from './shared/structured-logger';

// 获取所有日志
const logs = structuredLogger.getLogs();
console.table(logs);

// 获取错误日志
const errors = structuredLogger.getLogs({ level: 'error' });
console.table(errors);

// 获取统计信息
const stats = structuredLogger.getStats();
console.log('错误数:', stats.errorCount);
console.log('最近错误:', stats.recentErrors);
```

#### 2. 查看路由追踪

```typescript
import { routeTracer } from './shared/route-tracer';

// 获取所有追踪
const traces = routeTracer.getAllTraces();
console.table(traces);

// 获取统计信息
const stats = routeTracer.getStats();
console.log('平均耗时:', stats.averageDuration, 'ms');
console.log('成功率:', stats.successRate);
```

#### 3. 检查缓存状态

```typescript
import { clearRouteCache } from './shared/token-route';

// 清除特定代币缓存
clearRouteCache('0x...');

// 清除所有缓存
clearRouteCache();
```

---

## 路由查询问题

### 问题 1: 路由查询返回错误的平台

**症状**:
- Four.meme 代币被识别为 unknown
- Flap 代币被识别为 four

**原因**:
- 平台检测逻辑错误
- 地址格式不正确

**诊断步骤**:

```typescript
import { detectTokenPlatform } from './shared/token-route';

const tokenAddress = '0xd86eb37348f72ddff0c0b9873531dd0fe4d7ffff';
const platform = detectTokenPlatform(tokenAddress);

console.log('检测到的平台:', platform);
console.log('地址后缀:', tokenAddress.slice(-4));
```

**解决方案**:

1. 检查地址格式是否正确（40 个十六进制字符）
2. 确认地址后缀符合平台规则：
   - Four.meme: 以 `ffff` 结尾
   - Flap: 以 `4444` 结尾
3. 如果是新平台，需要更新检测逻辑

**示例**:

```typescript
// ❌ 错误：地址不完整
const addr1 = '0xffff';  // 太短

// ❌ 错误：地址格式错误
const addr2 = '0xGGGG...ffff';  // 包含非十六进制字符

// ✅ 正确
const addr3 = '0xd86eb37348f72ddff0c0b9873531dd0fe4d7ffff';
```

---

### 问题 2: 路由查询返回 unknown 平台

**症状**:
- 所有代币都返回 unknown 平台
- 应该识别的平台没有被识别

**原因**:
- 平台检测失败
- 地址大小写问题

**诊断步骤**:

```typescript
const tokenAddress = '0xD86EB37348F72DDFF0C0B9873531DD0FE4D7FFFF';  // 大写
const normalized = tokenAddress.toLowerCase();

console.log('原始地址:', tokenAddress);
console.log('规范化地址:', normalized);
console.log('后缀:', normalized.slice(-4));
```

**解决方案**:

1. 确保地址已转换为小写
2. 检查地址长度是否为 42 字符（包括 '0x'）
3. 验证地址是否有效

```typescript
import { validateAddress } from './shared/validation';

try {
  const validAddress = validateAddress(tokenAddress);
  console.log('有效地址:', validAddress);
} catch (error) {
  console.error('地址无效:', error.message);
}
```

---

### 问题 3: 未迁移代币被识别为已迁移

**症状**:
- 未迁移代币的 `readyForPancake` 为 true
- 推荐使用 PancakeSwap 但实际没有流动性

**原因**:
- 流动性检查逻辑错误
- 缓存数据过期

**诊断步骤**:

```typescript
import { fetchRouteWithFallback, clearRouteCache } from './shared/token-route';

// 1. 清除缓存
clearRouteCache(tokenAddress);

// 2. 重新查询
const route = await fetchRouteWithFallback(publicClient, tokenAddress, platform);

console.log('平台:', route.platform);
console.log('已迁移:', route.readyForPancake);
console.log('进度:', route.progress);
console.log('备注:', route.notes);
```

**解决方案**:

1. 清除缓存后重新查询
2. 检查链上数据是否正确
3. 验证流动性检查逻辑

```typescript
// 手动检查流动性
const hasLiquidity = await checkPairLiquidity(
  publicClient,
  pairAddress,
  tokenAddress,
  quoteToken
);

console.log('流动性检查结果:', hasLiquidity);
```

---

## Service Worker 问题

### 问题 4: Service Worker import() 错误

**症状**:
```
Error: import() is disallowed on ServiceWorkerGlobalScope
```

**原因**:
- Chrome Extension 的 Service Worker 环境不支持动态 import
- 某些库使用了动态 import

**诊断步骤**:

```typescript
// 检查是否在 Service Worker 环境
const isServiceWorker = typeof importScripts === 'function';
console.log('Service Worker 环境:', isServiceWorker);
```

**解决方案**:

系统已自动处理此问题，会返回默认路由：

```typescript
try {
  info = await publicClient.readContract({...});
} catch (error) {
  if (error.message.includes('import() is disallowed')) {
    // 返回默认未迁移状态
    return {
      platform,
      preferredChannel: 'four',
      readyForPancake: false,
      progress: 0,
      migrating: false,
      notes: 'Service Worker 限制，无法查询代币信息，假设未迁移'
    };
  }
  throw error;
}
```

**注意事项**:
- 这是 Chrome Extension 的限制，无法完全避免
- 系统会使用保守策略，假设代币未迁移
- 用户可以手动刷新以获取最新状态

---

### 问题 5: Service Worker 控制台找不到日志

**症状**:
- 看不到 console.log 输出
- 日志消失

**原因**:
- Service Worker 可能被停止
- 需要重新打开控制台

**解决方案**:

1. 打开 Chrome 扩展管理页面：`chrome://extensions/`
2. 找到插件，点击"Service Worker"链接
3. 这会打开 Service Worker 的 DevTools
4. 如果 Service Worker 已停止，触发一个操作（如点击插件图标）来唤醒它

**调试技巧**:

```typescript
// 使用结构化日志，可以持久化
import { structuredLogger } from './shared/structured-logger';

structuredLogger.info('Service Worker 启动');

// 稍后查看日志
const logs = structuredLogger.getLogs();
console.table(logs);
```

---

## 缓存问题

### 问题 6: 缓存数据不更新

**症状**:
- 代币已迁移，但仍显示未迁移
- 清除缓存后问题消失

**原因**:
- 缓存策略问题
- 缓存没有正确更新

**诊断步骤**:

```typescript
import { clearRouteCache } from './shared/token-route';

// 1. 检查缓存
const cached = getRouteCache(tokenAddress);
console.log('缓存数据:', cached);
console.log('缓存时间:', new Date(cached?.timestamp));
console.log('迁移状态:', cached?.migrationStatus);

// 2. 清除缓存
clearRouteCache(tokenAddress);

// 3. 重新查询
const route = await fetchRouteWithFallback(publicClient, tokenAddress, platform);
console.log('新数据:', route);
```

**解决方案**:

1. **临时解决**: 清除缓存
   ```typescript
   clearRouteCache(tokenAddress);
   ```

2. **永久解决**: 检查缓存更新逻辑
   ```typescript
   function shouldUpdateRouteCache(
     tokenAddress: string,
     cachedRoute: RouteCache | undefined,
     currentRoute: RouteFetchResult
   ): boolean {
     // 1. 无缓存 → 更新
     if (!cachedRoute) return true;

     // 2. 迁移状态变化 → 更新
     const cachedMigrated = cachedRoute.migrationStatus === 'migrated';
     const currentMigrated = currentRoute.readyForPancake;
     if (cachedMigrated !== currentMigrated) return true;

     // 3. 迁移状态未变化 → 不更新
     return false;
   }
   ```

---

### 问题 7: 缓存占用内存过多

**症状**:
- 内存使用持续增长
- 浏览器变慢

**原因**:
- 缓存没有正确清理
- 缓存大小超过限制

**诊断步骤**:

```typescript
// 检查缓存大小
console.log('缓存条目数:', routeCache.size);

// 查看缓存内容
for (const [key, value] of routeCache.entries()) {
  console.log(key, value);
}
```

**解决方案**:

1. 清除所有缓存
   ```typescript
   clearRouteCache();
   ```

2. 检查清理逻辑
   ```typescript
   const MAX_ROUTE_CACHE_SIZE = 50;

   function cleanupRouteCache(): void {
     if (routeCache.size > MAX_ROUTE_CACHE_SIZE) {
       // 删除最旧的缓存项
       const entries = Array.from(routeCache.entries());
       entries.sort((a, b) => a[1].timestamp - b[1].timestamp);

       const toDelete = entries.slice(0, routeCache.size - MAX_ROUTE_CACHE_SIZE);
       toDelete.forEach(([key]) => routeCache.delete(key));
     }
   }
   ```

---

## 流动性检查问题

### 问题 8: 流动性检查总是返回 false

**症状**:
- 明明有流动性，但检查返回 false
- 无法使用 PancakeSwap 交易

**原因**:
- 流动性阈值设置过高
- 配对地址错误
- 报价代币错误

**诊断步骤**:

```typescript
import { checkPairLiquidity } from './shared/token-route';

// 1. 手动检查流动性
const hasLiquidity = await checkPairLiquidity(
  publicClient,
  pairAddress,
  tokenAddress,
  quoteToken
);

console.log('流动性检查结果:', hasLiquidity);

// 2. 查看储备量
const reserves = await publicClient.readContract({
  address: pairAddress,
  abi: PAIR_ABI,
  functionName: 'getReserves'
});

console.log('储备量:', reserves);

// 3. 查看阈值
const threshold = MIN_LIQUIDITY_THRESHOLDS[quoteToken.toLowerCase()];
console.log('流动性阈值:', threshold);
```

**解决方案**:

1. 检查配对地址是否正确
2. 确认报价代币地址正确
3. 调整流动性阈值（如果合理）

```typescript
// 当前阈值
const MIN_LIQUIDITY_THRESHOLDS = {
  // 稳定币: $100
  [CONTRACTS.USDT?.toLowerCase() ?? '']: BigInt(100 * 1e18),
  // WBNB: 0.2 BNB
  [CONTRACTS.WBNB?.toLowerCase() ?? '']: BigInt(0.2 * 1e18),
  // 默认: 100 个代币
  default: BigInt(100 * 1e18)
};
```

---

### 问题 9: V3 流动性检查失败

**症状**:
- V2 有流动性，V3 检查失败
- 错误信息不明确

**原因**:
- V3 池不存在
- 费率档位不正确

**诊断步骤**:

```typescript
import { checkV3PoolLiquidity } from './shared/token-route';

// 检查 V3 流动性
const hasV3Liquidity = await checkV3PoolLiquidity(
  publicClient,
  tokenAddress,
  quoteToken
);

console.log('V3 流动性:', hasV3Liquidity);
```

**解决方案**:

1. 确认 V3 池是否存在
2. 尝试不同的费率档位（0.01%, 0.05%, 0.25%, 1%）
3. 如果 V3 池不存在，使用 V2

---

## 交易失败问题

### 问题 10: Gas 估算失败

**症状**:
```
Error: execution reverted
Error: insufficient funds for gas
```

**原因**:
- Gas 估算不准确
- 账户余额不足
- 合约执行失败

**诊断步骤**:

```typescript
// 1. 检查账户余额
const balance = await publicClient.getBalance({
  address: userAddress
});
console.log('账户余额:', balance);

// 2. 手动估算 Gas
try {
  const gasEstimate = await publicClient.estimateGas({
    account: userAddress,
    to: contractAddress,
    data: calldata
  });
  console.log('Gas 估算:', gasEstimate);
} catch (error) {
  console.error('Gas 估算失败:', error);
}
```

**解决方案**:

1. 确保账户有足够的 BNB 支付 Gas
2. 增加 Gas Limit（如 +20%）
3. 检查合约调用参数是否正确

```typescript
// 增加 Gas Limit
const gasLimit = gasEstimate * 120n / 100n;  // +20%
```

---

### 问题 11: 滑点过大导致交易失败

**症状**:
```
Error: INSUFFICIENT_OUTPUT_AMOUNT
Error: slippage tolerance exceeded
```

**原因**:
- 价格波动
- 滑点设置过低
- 流动性不足

**诊断步骤**:

```typescript
// 检查当前滑点设置
const slippage = 0.5;  // 0.5%
console.log('滑点设置:', slippage, '%');

// 计算最小输出
const minOutput = expectedOutput * (100 - slippage) / 100;
console.log('最小输出:', minOutput);
```

**解决方案**:

1. 增加滑点容忍度（如 1% 或 2%）
2. 等待价格稳定后再交易
3. 减少交易金额

```typescript
// 调整滑点
const slippage = 1.0;  // 1%
```

---

### 问题 12: 交易卡住不确认

**症状**:
- 交易已发送，但长时间不确认
- 区块浏览器显示 pending

**原因**:
- Gas Price 过低
- 网络拥堵
- Nonce 冲突

**诊断步骤**:

```typescript
// 1. 检查交易状态
const receipt = await publicClient.getTransactionReceipt({
  hash: txHash
});
console.log('交易状态:', receipt?.status);

// 2. 检查 Gas Price
const gasPrice = await publicClient.getGasPrice();
console.log('当前 Gas Price:', gasPrice);
```

**解决方案**:

1. 等待网络确认（可能需要几分钟）
2. 如果长时间不确认，可以尝试加速交易（增加 Gas Price）
3. 检查是否有 Nonce 冲突

---

## 性能问题

### 问题 13: 路由查询很慢

**症状**:
- 查询耗时超过 5 秒
- 用户体验差

**原因**:
- 链上查询过多
- 网络延迟
- 没有使用缓存

**诊断步骤**:

```typescript
import { routeTracer } from './shared/route-tracer';

// 1. 追踪查询过程
const traceId = routeTracer.startTrace(tokenAddress, platform);
const route = await fetchRouteWithFallback(publicClient, tokenAddress, platform);
routeTracer.endTrace(traceId, route);

// 2. 查看耗时
const trace = routeTracer.getTrace(traceId);
console.log('总耗时:', trace.totalDuration, 'ms');
console.log('步骤详情:', trace.steps);

// 3. 查看统计
const stats = routeTracer.getStats();
console.log('平均耗时:', stats.averageDuration, 'ms');
console.log('P95 耗时:', stats.p95Duration, 'ms');
```

**解决方案**:

1. 使用缓存（系统已自动缓存）
2. 减少链上查询次数
3. 使用批处理（multicall）
4. 优化网络连接

```typescript
// 使用 multicall 批量查询
const results = await publicClient.multicall({
  contracts: [
    { address: addr1, abi: abi1, functionName: 'func1' },
    { address: addr2, abi: abi2, functionName: 'func2' }
  ]
});
```

---

### 问题 14: 内存使用过高

**症状**:
- 浏览器内存占用持续增长
- 页面变慢或崩溃

**原因**:
- 日志累积过多
- 缓存没有清理
- 内存泄漏

**诊断步骤**:

```typescript
// 1. 检查日志数量
const logs = structuredLogger.getLogs();
console.log('日志数量:', logs.length);

// 2. 检查缓存大小
console.log('缓存大小:', routeCache.size);

// 3. 检查追踪数量
const traces = routeTracer.getAllTraces();
console.log('追踪数量:', traces.length);
```

**解决方案**:

1. 清除日志
   ```typescript
   structuredLogger.clearLogs();
   ```

2. 清除缓存
   ```typescript
   clearRouteCache();
   ```

3. 清除追踪
   ```typescript
   routeTracer.clearTraces();
   ```

4. 定期清理
   ```typescript
   // 每小时清理一次
   setInterval(() => {
     structuredLogger.clearLogs();
     routeTracer.clearTraces();
   }, 60 * 60 * 1000);
   ```

---

## 日志分析

### 查看错误日志

```typescript
import { structuredLogger } from './shared/structured-logger';

// 获取所有错误
const errors = structuredLogger.getLogs({ level: 'error' });

// 按时间排序
errors.sort((a, b) => b.timestamp - a.timestamp);

// 查看最近的错误
console.table(errors.slice(0, 10));

// 分析错误类型
const errorTypes = {};
errors.forEach(log => {
  const type = log.error?.name || 'Unknown';
  errorTypes[type] = (errorTypes[type] || 0) + 1;
});
console.table(errorTypes);
```

### 查看性能日志

```typescript
// 获取性能日志
const perfLogs = structuredLogger.getLogs()
  .filter(log => log.message.includes('[Perf]'));

// 计算平均耗时
const durations = perfLogs.map(log => log.context?.duration || 0);
const avgDuration = durations.reduce((a, b) => a + b, 0) / durations.length;

console.log('平均耗时:', avgDuration, 'ms');
console.log('最大耗时:', Math.max(...durations), 'ms');
console.log('最小耗时:', Math.min(...durations), 'ms');
```

### 导出日志

```typescript
// 导出为 JSON
const json = structuredLogger.exportLogs();

// 保存到文件（在 Node.js 环境）
const fs = require('fs');
fs.writeFileSync('logs.json', json);

// 或复制到剪贴板
navigator.clipboard.writeText(json);
```

---

## 错误代码参考

### 路由查询错误

| 错误代码 | 描述 | 解决方案 |
|---------|------|---------|
| `PLATFORM_DETECTION_FAILED` | 平台检测失败 | 检查地址格式 |
| `ROUTE_QUERY_FAILED` | 路由查询失败 | 检查网络连接 |
| `SERVICE_WORKER_ERROR` | Service Worker 限制 | 系统自动处理 |
| `CACHE_ERROR` | 缓存错误 | 清除缓存 |

### 流动性检查错误

| 错误代码 | 描述 | 解决方案 |
|---------|------|---------|
| `LIQUIDITY_CHECK_FAILED` | 流动性检查失败 | 检查配对地址 |
| `INSUFFICIENT_LIQUIDITY` | 流动性不足 | 使用其他通道 |
| `PAIR_NOT_FOUND` | 配对不存在 | 确认代币已迁移 |

### 交易错误

| 错误代码 | 描述 | 解决方案 |
|---------|------|---------|
| `GAS_ESTIMATION_FAILED` | Gas 估算失败 | 检查参数 |
| `INSUFFICIENT_FUNDS` | 余额不足 | 充值 BNB |
| `SLIPPAGE_EXCEEDED` | 滑点过大 | 增加滑点 |
| `TRANSACTION_FAILED` | 交易失败 | 查看错误详情 |

---

## 获取帮助

### 自助资源

1. [API 参考](./api-reference.md)
2. [开发者指南](./developer-guide.md)
3. [架构决策记录](./adr/README.md)

### 联系支持

如果问题仍未解决：

1. 收集错误日志
   ```typescript
   const logs = structuredLogger.exportLogs();
   ```

2. 收集追踪信息
   ```typescript
   const traces = routeTracer.exportTraces();
   ```

3. 在 GitHub 创建 Issue，包含：
   - 问题描述
   - 复现步骤
   - 错误日志
   - 追踪信息
   - 环境信息（浏览器版本、插件版本等）

---

## 预防措施

### 1. 定期清理

```typescript
// 每天清理一次
setInterval(() => {
  // 清理旧日志（保留最近 24 小时）
  const oneDayAgo = Date.now() - 24 * 60 * 60 * 1000;
  const logs = structuredLogger.getLogs({ since: oneDayAgo });
  structuredLogger.clearLogs();
  logs.forEach(log => structuredLogger.log(log.level, log.message, log.context));

  // 清理旧追踪
  routeTracer.clearTraces();
}, 24 * 60 * 60 * 1000);
```

### 2. 监控性能

```typescript
// 监控平均响应时间
const stats = routeTracer.getStats();
if (stats.averageDuration > 3000) {
  console.warn('路由查询性能下降，平均耗时:', stats.averageDuration, 'ms');
}
```

### 3. 错误告警

```typescript
// 监控错误率
const stats = structuredLogger.getStats();
const errorRate = stats.errorCount / stats.total;
if (errorRate > 0.1) {
  console.error('错误率过高:', (errorRate * 100).toFixed(2), '%');
}
```

---

**最后更新**: 2026-02-09
