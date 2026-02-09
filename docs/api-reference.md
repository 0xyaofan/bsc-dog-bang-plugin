# API 参考文档

## 概述

本文档提供 BSC Dog Bang Plugin 的完整 API 参考，包括所有公共函数、类型定义和使用示例。

---

## 目录

- [路由查询 API](#路由查询-api)
- [平台检测 API](#平台检测-api)
- [缓存管理 API](#缓存管理-api)
- [流动性检查 API](#流动性检查-api)
- [验证工具 API](#验证工具-api)
- [日志系统 API](#日志系统-api)
- [类型定义](#类型定义)

---

## 路由查询 API

### fetchRouteWithFallback

查询代币的路由信息，支持多平台 fallback 机制。

**签名**:
```typescript
async function fetchRouteWithFallback(
  publicClient: any,
  tokenAddress: Address,
  initialPlatform: TokenPlatform
): Promise<RouteFetchResult>
```

**参数**:
- `publicClient`: Viem public client 实例
- `tokenAddress`: 代币合约地址（必须是有效的以太坊地址）
- `initialPlatform`: 初始平台类型（'four' | 'xmode' | 'flap' | 'luna' | 'unknown'）

**返回值**:
```typescript
{
  platform: TokenPlatform;           // 代币所在平台
  preferredChannel: string;          // 推荐的交易通道
  readyForPancake: boolean;          // 是否已迁移到 PancakeSwap
  progress: number;                  // 迁移进度 (0-1)
  migrating: boolean;                // 是否正在迁移
  quoteToken?: string;               // 报价代币地址
  metadata?: Record<string, any>;    // 额外元数据
  notes?: string;                    // 备注信息
}
```

**使用示例**:
```typescript
import { createPublicClient, http } from 'viem';
import { bsc } from 'viem/chains';
import { fetchRouteWithFallback, detectTokenPlatform } from './shared/token-route';

// 创建 public client
const publicClient = createPublicClient({
  chain: bsc,
  transport: http()
});

// 查询路由
const tokenAddress = '0xd86eb37348f72ddff0c0b9873531dd0fe4d7ffff';
const platform = detectTokenPlatform(tokenAddress);
const route = await fetchRouteWithFallback(publicClient, tokenAddress, platform);

console.log('Platform:', route.platform);
console.log('Preferred Channel:', route.preferredChannel);
console.log('Ready for Pancake:', route.readyForPancake);
```

**错误处理**:
```typescript
try {
  const route = await fetchRouteWithFallback(publicClient, tokenAddress, platform);
} catch (error) {
  if (error.message.includes('Service Worker')) {
    // Service Worker 限制错误
    console.error('Service Worker 环境限制');
  } else if (error.message.includes('Network')) {
    // 网络错误
    console.error('网络请求失败');
  } else {
    // 其他错误
    console.error('路由查询失败:', error);
  }
}
```

**注意事项**:
- 该函数会自动处理 Service Worker 环境限制
- 支持多平台 fallback，按优先级尝试不同平台
- 结果会自动缓存，提高后续查询性能
- 对于未迁移代币，会定期重新查询以检测迁移状态

---

### fetchTokenRouteState

查询指定平台的代币路由状态。

**签名**:
```typescript
async function fetchTokenRouteState(
  publicClient: any,
  tokenAddress: Address,
  platform: TokenPlatform
): Promise<RouteFetchResult>
```

**参数**:
- `publicClient`: Viem public client 实例
- `tokenAddress`: 代币合约地址
- `platform`: 目标平台类型

**返回值**: 同 `fetchRouteWithFallback`

**使用示例**:
```typescript
// 直接查询 Four.meme 平台
const route = await fetchTokenRouteState(
  publicClient,
  '0xd86eb37348f72ddff0c0b9873531dd0fe4d7ffff',
  'four'
);
```

**注意事项**:
- 不会自动 fallback 到其他平台
- 如果平台不支持该代币，会抛出错误
- 建议使用 `fetchRouteWithFallback` 以获得更好的容错性

---

## 平台检测 API

### detectTokenPlatform

根据代币地址检测所属平台。

**签名**:
```typescript
function detectTokenPlatform(tokenAddress: string): TokenPlatform
```

**参数**:
- `tokenAddress`: 代币合约地址（大小写不敏感）

**返回值**:
- `'four'`: Four.meme 平台（地址以 'ffff' 结尾）
- `'xmode'`: XMode 平台（地址以 'ffff' 结尾且特定前缀）
- `'flap'`: Flap 平台（地址以 '4444' 结尾）
- `'luna'`: Luna 平台（暂无特定模式）
- `'unknown'`: 未知平台（默认使用 PancakeSwap）

**使用示例**:
```typescript
import { detectTokenPlatform } from './shared/token-route';

// Four.meme 代币
const platform1 = detectTokenPlatform('0xd86eb37348f72ddff0c0b9873531dd0fe4d7ffff');
console.log(platform1); // 'four'

// Flap 代币
const platform2 = detectTokenPlatform('0x3e2a009d420512627a2791be63eeb04c94674444');
console.log(platform2); // 'flap'

// 普通代币
const platform3 = detectTokenPlatform('0x0e09fabb73bd3ade0a17ecc321fd13a19e81ce82');
console.log(platform3); // 'unknown'
```

**检测规则**:
```typescript
// Four.meme: 地址以 'ffff' 结尾
'0x...ffff' → 'four'

// XMode: 地址以 'ffff' 结尾且有特定前缀
'0x0000...ffff' → 'xmode'

// Flap: 地址以 '4444' 结尾
'0x...4444' → 'flap'

// Luna: 暂无特定模式
// 需要通过其他方式识别

// 其他: 默认为 unknown
'0x...' → 'unknown'
```

**注意事项**:
- 地址会自动转换为小写进行匹配
- 检测是基于地址模式的静态分析
- Luna 平台暂无地址模式，返回 'unknown'

---

## 缓存管理 API

### clearRouteCache

清除路由缓存。

**签名**:
```typescript
function clearRouteCache(tokenAddress?: string): void
```

**参数**:
- `tokenAddress`: 可选，指定要清除的代币地址。如果不提供，清除所有缓存。

**使用示例**:
```typescript
import { clearRouteCache } from './shared/token-route';

// 清除特定代币的缓存
clearRouteCache('0xd86eb37348f72ddff0c0b9873531dd0fe4d7ffff');

// 清除所有缓存
clearRouteCache();
```

**使用场景**:
- 调试时强制刷新路由信息
- 代币迁移后手动清除旧缓存
- 发现缓存数据错误时重置

**注意事项**:
- 清除缓存后，下次查询会重新从链上获取数据
- 频繁清除缓存会增加链上查询次数
- 建议只在必要时使用

---

### getRouteCache

获取缓存的路由信息（内部函数，不建议直接使用）。

**签名**:
```typescript
function getRouteCache(tokenAddress: string): RouteCache | undefined
```

**返回值**:
```typescript
{
  route: RouteFetchResult;
  timestamp: number;
  migrationStatus: 'migrated' | 'not_migrated';
}
```

---

### setRouteCache

设置路由缓存（内部函数，不建议直接使用）。

**签名**:
```typescript
function setRouteCache(tokenAddress: string, route: RouteFetchResult): void
```

---

## 流动性检查 API

### checkPairLiquidity

检查 PancakeSwap V2 配对的流动性是否足够。

**签名**:
```typescript
async function checkPairLiquidity(
  publicClient: any,
  pairAddress: string,
  tokenAddress: string,
  quoteToken: string
): Promise<boolean>
```

**参数**:
- `publicClient`: Viem public client 实例
- `pairAddress`: 配对合约地址
- `tokenAddress`: 目标代币地址
- `quoteToken`: 报价代币地址（WBNB、USDT 等）

**返回值**:
- `true`: 流动性足够
- `false`: 流动性不足

**流动性阈值**:
```typescript
// 稳定币（USDT/BUSD/USDC/USD1）
最小流动性: $100 (100 * 10^18)

// WBNB
最小流动性: 0.2 BNB (0.2 * 10^18)

// 其他代币
最小流动性: 100 个代币 (100 * 10^18)
```

**使用示例**:
```typescript
const hasLiquidity = await checkPairLiquidity(
  publicClient,
  '0x...',  // pair address
  '0x...',  // token address
  '0xbb4cdb9cbd36b01bd1cbaebf2de08d9173bc095c'  // WBNB
);

if (hasLiquidity) {
  console.log('流动性充足，可以交易');
} else {
  console.log('流动性不足，建议使用其他通道');
}
```

**注意事项**:
- 该函数会查询链上数据，有一定延迟
- 流动性阈值是保守估计，确保交易能够执行
- 对于新代币，可能需要等待流动性添加

---

### checkV3PoolLiquidity

检查 PancakeSwap V3 池的流动性是否足够。

**签名**:
```typescript
async function checkV3PoolLiquidity(
  publicClient: any,
  tokenAddress: string,
  quoteToken: string
): Promise<boolean>
```

**参数**:
- `publicClient`: Viem public client 实例
- `tokenAddress`: 目标代币地址
- `quoteToken`: 报价代币地址

**返回值**:
- `true`: 流动性足够
- `false`: 流动性不足或池不存在

**使用示例**:
```typescript
const hasV3Liquidity = await checkV3PoolLiquidity(
  publicClient,
  '0x...',  // token address
  '0xbb4cdb9cbd36b01bd1cbaebf2de08d9173bc095c'  // WBNB
);
```

**注意事项**:
- V3 池使用集中流动性，检查逻辑与 V2 不同
- 会检查多个费率档位（0.01%, 0.05%, 0.25%, 1%）
- 如果任一档位有足够流动性，返回 true

---

## 验证工具 API

### validateAddress

验证并规范化以太坊地址。

**签名**:
```typescript
function validateAddress(address: any, paramName: string = 'address'): string
```

**参数**:
- `address`: 待验证的地址
- `paramName`: 参数名称（用于错误消息）

**返回值**: 规范化的地址（小写）

**抛出错误**:
- 如果地址为空或无效

**使用示例**:
```typescript
import { validateAddress } from './shared/validation';

try {
  const addr = validateAddress('0xd86eb37348f72ddff0c0b9873531dd0fe4d7ffff');
  console.log(addr); // '0xd86eb37348f72ddff0c0b9873531dd0fe4d7ffff'
} catch (error) {
  console.error('地址无效:', error.message);
}
```

---

### validatePlatform

验证平台类型。

**签名**:
```typescript
function validatePlatform(platform: any, paramName: string = 'platform'): string
```

**参数**:
- `platform`: 待验证的平台类型
- `paramName`: 参数名称（用于错误消息）

**返回值**: 验证后的平台类型

**有效值**: 'four' | 'xmode' | 'flap' | 'luna' | 'unknown'

**使用示例**:
```typescript
import { validatePlatform } from './shared/validation';

try {
  const platform = validatePlatform('four');
  console.log(platform); // 'four'
} catch (error) {
  console.error('平台类型无效:', error.message);
}
```

---

### validateBigInt

验证并转换 BigInt 值。

**签名**:
```typescript
function validateBigInt(
  value: any,
  paramName: string = 'value',
  options?: {
    min?: bigint;
    max?: bigint;
    allowZero?: boolean;
  }
): bigint
```

**参数**:
- `value`: 待验证的值
- `paramName`: 参数名称
- `options`: 验证选项
  - `min`: 最小值
  - `max`: 最大值
  - `allowZero`: 是否允许零值（默认 true）

**返回值**: BigInt 值

**使用示例**:
```typescript
import { validateBigInt } from './shared/validation';

// 基本验证
const amount = validateBigInt('1000000000000000000');
console.log(amount); // 1000000000000000000n

// 带范围验证
const amount2 = validateBigInt('500', 'amount', {
  min: 100n,
  max: 1000n,
  allowZero: false
});
```

---

## 日志系统 API

### structuredLogger

结构化日志记录器实例。

**方法**:

#### debug / info / warn / error

记录不同级别的日志。

**签名**:
```typescript
debug(message: string, context?: LogContext): void
info(message: string, context?: LogContext): void
warn(message: string, context?: LogContext): void
error(message: string, contextOrError?: LogContext | Error): void
```

**使用示例**:
```typescript
import { structuredLogger } from './shared/structured-logger';

// 基本日志
structuredLogger.info('路由查询开始');

// 带上下文的日志
structuredLogger.debug('查询代币信息', {
  tokenAddress: '0x...',
  platform: 'four'
});

// 错误日志
structuredLogger.error('查询失败', new Error('Network timeout'));
```

---

#### route / trade / cache / perf

专用日志函数。

**签名**:
```typescript
route(message: string, context: {
  tokenAddress?: string;
  platform?: string;
  channel?: string;
  [key: string]: any;
}): void

trade(message: string, context: {
  tokenAddress?: string;
  amount?: string;
  type?: 'buy' | 'sell';
  [key: string]: any;
}): void

cache(message: string, context: {
  key?: string;
  hit?: boolean;
  [key: string]: any;
}): void

perf(message: string, duration: number, context?: LogContext): void
```

**使用示例**:
```typescript
// 路由日志
structuredLogger.route('找到路由', {
  tokenAddress: '0x...',
  platform: 'four',
  channel: 'pancake'
});

// 交易日志
structuredLogger.trade('交易执行', {
  tokenAddress: '0x...',
  amount: '1000000000000000000',
  type: 'buy'
});

// 缓存日志
structuredLogger.cache('缓存命中', {
  key: 'route:0x...',
  hit: true
});

// 性能日志
structuredLogger.perf('路由查询完成', 1234, {
  tokenAddress: '0x...'
});
```

---

#### getLogs / getStats / exportLogs

查询和导出日志。

**签名**:
```typescript
getLogs(filter?: {
  level?: LogLevel;
  since?: number;
  until?: number;
}): LogEntry[]

getStats(): {
  total: number;
  debugCount: number;
  infoCount: number;
  warnCount: number;
  errorCount: number;
  recentErrors: LogEntry[];
}

exportLogs(): string
```

**使用示例**:
```typescript
// 获取所有错误日志
const errors = structuredLogger.getLogs({ level: 'error' });

// 获取最近 5 分钟的日志
const recent = structuredLogger.getLogs({
  since: Date.now() - 5 * 60 * 1000
});

// 获取统计信息
const stats = structuredLogger.getStats();
console.log(`总日志数: ${stats.total}`);
console.log(`错误数: ${stats.errorCount}`);

// 导出日志为 JSON
const json = structuredLogger.exportLogs();
```

---

### routeTracer

路由追踪器实例。

**方法**:

#### startTrace

开始追踪路由查询。

**签名**:
```typescript
startTrace(tokenAddress: string, platform: string): string
```

**返回值**: 追踪 ID

---

#### addStep

添加追踪步骤。

**签名**:
```typescript
addStep(traceId: string, step: string, data?: any): void
```

---

#### addError

添加错误信息。

**签名**:
```typescript
addError(traceId: string, step: string, error: Error): void
```

---

#### endTrace

结束追踪。

**签名**:
```typescript
endTrace(traceId: string, result?: any): void
```

---

#### getTrace / getStats / exportTraces

查询和导出追踪数据。

**使用示例**:
```typescript
import { routeTracer } from './shared/route-tracer';

// 开始追踪
const traceId = routeTracer.startTrace(tokenAddress, 'four');

// 添加步骤
routeTracer.addStep(traceId, 'cache-check');
routeTracer.addStep(traceId, 'fetch-route', { platform: 'four' });

// 添加错误
try {
  // ... 查询逻辑
} catch (error) {
  routeTracer.addError(traceId, 'fetch-failed', error);
}

// 结束追踪
routeTracer.endTrace(traceId, route);

// 获取追踪信息
const trace = routeTracer.getTrace(traceId);
console.log('总耗时:', trace.totalDuration, 'ms');

// 获取统计信息
const stats = routeTracer.getStats();
console.log('平均耗时:', stats.averageDuration, 'ms');
```

---

## 类型定义

### TokenPlatform

代币平台类型。

```typescript
type TokenPlatform = 'four' | 'xmode' | 'flap' | 'luna' | 'unknown';
```

---

### RouteFetchResult

路由查询结果。

```typescript
type RouteFetchResult = {
  platform: TokenPlatform;           // 代币所在平台
  preferredChannel: string;          // 推荐的交易通道
  readyForPancake: boolean;          // 是否已迁移到 PancakeSwap
  progress: number;                  // 迁移进度 (0-1)
  migrating: boolean;                // 是否正在迁移
  quoteToken?: string;               // 报价代币地址
  metadata?: Record<string, any>;    // 额外元数据
  notes?: string;                    // 备注信息
};
```

---

### LogLevel

日志级别。

```typescript
type LogLevel = 'debug' | 'info' | 'warn' | 'error';
```

---

### LogContext

日志上下文。

```typescript
type LogContext = Record<string, any>;
```

---

### LogEntry

日志条目。

```typescript
interface LogEntry {
  timestamp: number;
  level: LogLevel;
  message: string;
  context?: LogContext;
  error?: Error;
}
```

---

## 最佳实践

### 1. 错误处理

始终使用 try-catch 包裹异步调用：

```typescript
try {
  const route = await fetchRouteWithFallback(publicClient, tokenAddress, platform);
  // 处理结果
} catch (error) {
  // 处理错误
  structuredLogger.error('路由查询失败', error);
}
```

### 2. 日志记录

使用结构化日志记录关键操作：

```typescript
structuredLogger.route('开始查询路由', {
  tokenAddress,
  platform
});

const route = await fetchRouteWithFallback(publicClient, tokenAddress, platform);

structuredLogger.route('路由查询成功', {
  tokenAddress,
  platform: route.platform,
  channel: route.preferredChannel
});
```

### 3. 性能监控

使用路由追踪器监控性能：

```typescript
const traceId = routeTracer.startTrace(tokenAddress, platform);
try {
  const route = await fetchRouteWithFallback(publicClient, tokenAddress, platform);
  routeTracer.endTrace(traceId, route);
} catch (error) {
  routeTracer.addError(traceId, 'query-failed', error);
  routeTracer.endTrace(traceId);
}
```

### 4. 输入验证

始终验证用户输入：

```typescript
import { validateAddress, validatePlatform } from './shared/validation';

function queryRoute(address: string, platform: string) {
  const validAddress = validateAddress(address, 'tokenAddress');
  const validPlatform = validatePlatform(platform, 'platform');

  return fetchRouteWithFallback(publicClient, validAddress, validPlatform);
}
```

---

## 常见问题

### Q: 如何处理 Service Worker 限制？

A: 系统会自动处理 Service Worker 环境限制，返回默认路由。无需特殊处理。

### Q: 缓存多久会过期？

A: 已迁移代币使用永久缓存，未迁移代币每次都会重新查询以检测迁移状态。

### Q: 如何强制刷新路由信息？

A: 使用 `clearRouteCache(tokenAddress)` 清除缓存，然后重新查询。

### Q: 支持哪些报价代币？

A: 支持 WBNB、USDT、BUSD、USDC、USD1、CAKE 等主流代币。

### Q: 如何调试路由查询问题？

A: 使用 `routeTracer` 追踪查询过程，查看每个步骤的耗时和结果。

---

## 更新日志

### 2026-02-09
- 初始版本
- 添加所有核心 API 文档
- 添加使用示例和最佳实践

---

## 相关文档

- [开发者指南](./developer-guide.md)
- [故障排查手册](./troubleshooting.md)
- [架构决策记录](./adr/README.md)
