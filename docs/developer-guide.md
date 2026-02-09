# 开发者指南

## 欢迎

欢迎来到 BSC Dog Bang Plugin 开发者指南。本指南将帮助你快速了解项目架构、开发流程和最佳实践。

---

## 目录

1. [快速开始](#快速开始)
2. [项目架构](#项目架构)
3. [核心模块详解](#核心模块详解)
4. [开发工作流](#开发工作流)
5. [测试策略](#测试策略)
6. [调试指南](#调试指南)
7. [代码规范](#代码规范)
8. [常见任务](#常见任务)

---

## 快速开始

### 环境要求

- Node.js >= 18.x
- npm >= 9.x
- Git

### 安装依赖

```bash
# 克隆仓库
git clone https://github.com/0xyaofan/bsc-dog-bang-plugin.git
cd bsc-dog-bang-plugin

# 安装依赖
npm install

# 运行测试
npm test

# 构建项目
npm run build
```

### 项目结构

```
bsc-dog-bang-plugin/
├── src/                      # 源代码
│   ├── background/          # Background Service Worker
│   ├── content/             # Content Scripts
│   ├── popup/               # 弹窗界面
│   └── shared/              # 共享模块
│       ├── token-route.ts   # 路由查询核心
│       ├── trading-channels.ts  # 交易通道
│       ├── cache-manager.ts # 缓存管理
│       ├── validation.ts    # 输入验证
│       ├── structured-logger.ts  # 日志系统
│       └── route-tracer.ts  # 路由追踪
├── test/                    # 测试文件
│   ├── routing/            # 路由测试
│   └── shared/             # 共享模块测试
├── docs/                    # 文档
│   ├── adr/                # 架构决策记录
│   ├── api-reference.md    # API 参考
│   ├── developer-guide.md  # 开发者指南
│   └── troubleshooting.md  # 故障排查
├── abis/                    # 合约 ABI
├── public/                  # 静态资源
└── manifest.json           # Chrome 扩展配置
```

---

## 项目架构

### 整体架构

```
┌─────────────────────────────────────────────────────┐
│                   Chrome Extension                   │
├─────────────────────────────────────────────────────┤
│                                                       │
│  ┌──────────┐  ┌──────────┐  ┌──────────────────┐  │
│  │  Popup   │  │ Content  │  │    Background    │  │
│  │   UI     │  │ Scripts  │  │ Service Worker   │  │
│  └────┬─────┘  └────┬─────┘  └────────┬─────────┘  │
│       │             │                  │             │
│       └─────────────┴──────────────────┘             │
│                     │                                │
│              ┌──────▼──────┐                        │
│              │   Shared    │                        │
│              │   Modules   │                        │
│              └──────┬──────┘                        │
└─────────────────────┼────────────────────────────────┘
                      │
         ┌────────────┼────────────┐
         │            │            │
    ┌────▼────┐  ┌───▼────┐  ┌───▼────┐
    │ Routing │  │Trading │  │ Cache  │
    │ System  │  │Channels│  │Manager │
    └────┬────┘  └───┬────┘  └───┬────┘
         │           │            │
         └───────────┴────────────┘
                     │
              ┌──────▼──────┐
              │  BSC Chain  │
              │  (via RPC)  │
              └─────────────┘
```

### 核心概念

#### 1. 代币平台 (Token Platform)

系统支持多个代币发射平台：

- **Four.meme**: 地址以 `ffff` 结尾
- **XMode**: 特殊的 Four.meme 变体
- **Flap**: 地址以 `4444` 结尾
- **Luna**: 暂无地址模式
- **Unknown**: 默认平台（PancakeSwap）

#### 2. 路由查询 (Route Query)

路由查询是系统的核心功能，负责：

1. 检测代币所属平台
2. 查询代币状态（未迁移/迁移中/已迁移）
3. 确定推荐的交易通道
4. 检查流动性
5. 缓存结果

#### 3. 交易通道 (Trading Channel)

系统支持多个交易通道：

- **four**: Four.meme 原生合约
- **xmode**: XMode 原生合约
- **flap**: Flap 原生合约
- **pancake**: PancakeSwap V2
- **pancake-v3**: PancakeSwap V3

#### 4. 缓存策略 (Cache Strategy)

- **已迁移代币**: 永久缓存（状态不会改变）
- **未迁移代币**: 每次重新查询（检测迁移状态变化）
- **缓存大小**: 最多 50 个条目
- **清理策略**: LRU（最近最少使用）

---

## 核心模块详解

### 1. 路由系统 (token-route.ts)

路由系统是项目的核心，负责查询代币的路由信息。

#### 主要函数

**fetchRouteWithFallback**

核心路由查询函数，支持多平台 fallback。

```typescript
export async function fetchRouteWithFallback(
  publicClient: any,
  tokenAddress: Address,
  initialPlatform: TokenPlatform
): Promise<RouteFetchResult>
```

**工作流程**:

```
1. 检查缓存
   ├─ 已迁移 → 返回缓存
   └─ 未迁移 → 继续查询

2. 构建平台探测顺序
   例如: ['four', 'flap', 'luna', 'unknown']

3. 依次尝试每个平台
   ├─ 成功 → 更新缓存，返回结果
   ├─ Service Worker 错误 → 返回默认路由
   └─ 其他错误 → 尝试下一个平台

4. 所有平台都失败
   └─ 返回默认 unknown 路由
```

**平台特定函数**

每个平台都有独立的查询函数：

- `fetchFourRoute`: Four.meme 平台
- `fetchFlapRoute`: Flap 平台
- `fetchLunaRoute`: Luna 平台
- `fetchDefaultRoute`: 默认平台（PancakeSwap）

#### 关键逻辑

**Service Worker 限制处理**

Chrome Extension 的 Service Worker 环境不支持动态 import，需要特殊处理：

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
      migrating: false
    };
  }
  throw error;
}
```

**迁移状态检测**

代币可能处于三种状态：

1. **未迁移**: `readyForPancake = false`, `progress = 0`
2. **迁移中**: `readyForPancake = false`, `progress > 0`
3. **已迁移**: `readyForPancake = true`, `progress = 1`

```typescript
// 检查是否已添加流动性
const liquidityAdded = info.liquidityAdded || infoArray[11];

if (liquidityAdded) {
  // 已迁移，检查 PancakeSwap 流动性
  const hasLiquidity = await checkPancakePair(...);
  return {
    platform,
    preferredChannel: hasLiquidity ? 'pancake' : 'four',
    readyForPancake: hasLiquidity,
    progress: hasLiquidity ? 1 : 0.9,
    migrating: !hasLiquidity
  };
} else {
  // 未迁移，使用原生合约
  return {
    platform,
    preferredChannel: 'four',
    readyForPancake: false,
    progress: 0,
    migrating: false
  };
}
```

---

### 2. 交易通道 (trading-channels.ts)

交易通道模块负责执行实际的交易操作。

#### 主要功能

- 构建交易参数
- 估算 Gas
- 发送交易
- 监控交易状态

#### 通道选择逻辑

```typescript
function selectChannel(route: RouteFetchResult): string {
  if (route.readyForPancake) {
    // 已迁移，使用 PancakeSwap
    return 'pancake';
  } else {
    // 未迁移，使用原生合约
    return route.preferredChannel;
  }
}
```

---

### 3. 缓存管理 (cache-manager.ts)

缓存管理模块提供统一的缓存接口。

#### 缓存类型

1. **路由缓存**: 缓存路由查询结果
2. **价格缓存**: 缓存代币价格
3. **流动性缓存**: 缓存流动性检查结果

#### 缓存策略

```typescript
type CacheStrategy = {
  ttl: number;           // 生存时间（毫秒）
  maxSize: number;       // 最大条目数
  persistent: boolean;   // 是否持久化
};

// 路由缓存策略
const routeCacheStrategy: CacheStrategy = {
  ttl: Infinity,         // 已迁移代币永久缓存
  maxSize: 50,
  persistent: false
};
```

---

### 4. 验证系统 (validation.ts)

验证系统提供输入验证和不变量检查。

#### 验证函数

```typescript
// 地址验证
validateAddress(address, 'tokenAddress');

// 平台验证
validatePlatform(platform, 'platform');

// BigInt 验证
validateBigInt(amount, 'amount', {
  min: 0n,
  max: MAX_UINT256,
  allowZero: false
});

// 数字验证
validateNumber(slippage, 'slippage', {
  min: 0,
  max: 100
});
```

#### 不变量检查

```typescript
// 断言条件必须为真
invariant(route.platform !== 'unknown', '平台不能为 unknown');

// 断言非空
invariantNonNull(publicClient, 'publicClient');

// 断言数组非空
invariantNonEmpty(tokens, 'tokens');
```

---

### 5. 日志系统 (structured-logger.ts)

结构化日志系统提供丰富的日志功能。

#### 日志级别

- **debug**: 调试信息
- **info**: 一般信息
- **warn**: 警告信息
- **error**: 错误信息

#### 专用日志函数

```typescript
// 路由日志
structuredLogger.route('找到路由', {
  tokenAddress,
  platform,
  channel
});

// 交易日志
structuredLogger.trade('交易执行', {
  tokenAddress,
  amount,
  type: 'buy'
});

// 缓存日志
structuredLogger.cache('缓存命中', {
  key,
  hit: true
});

// 性能日志
structuredLogger.perf('查询完成', duration, {
  tokenAddress
});
```

---

### 6. 路由追踪 (route-tracer.ts)

路由追踪器用于监控和调试路由查询过程。

#### 使用方法

```typescript
// 开始追踪
const traceId = routeTracer.startTrace(tokenAddress, platform);

// 添加步骤
routeTracer.addStep(traceId, 'cache-check');
routeTracer.addStep(traceId, 'fetch-route', { platform });

// 添加错误
routeTracer.addError(traceId, 'fetch-failed', error);

// 结束追踪
routeTracer.endTrace(traceId, result);

// 查看追踪信息
const trace = routeTracer.getTrace(traceId);
console.log('总耗时:', trace.totalDuration, 'ms');
console.log('步骤:', trace.steps);
```

---

## 开发工作流

### 1. 功能开发流程

```
1. 创建功能分支
   git checkout -b feature/your-feature

2. 编写代码
   - 遵循代码规范
   - 添加类型定义
   - 编写注释

3. 编写测试
   - 单元测试
   - 集成测试
   - 边界情况测试

4. 运行测试
   npm test

5. 提交代码
   git add .
   git commit -m "feat: 添加新功能"

6. 推送到远程
   git push origin feature/your-feature

7. 创建 Pull Request
   - 填写 PR 描述
   - 关联相关 Issue
   - 等待代码审查
```

### 2. Bug 修复流程

```
1. 创建修复分支
   git checkout -b fix/bug-description

2. 重现 Bug
   - 编写失败的测试用例
   - 确认 Bug 存在

3. 修复 Bug
   - 修改代码
   - 确保测试通过

4. 验证修复
   - 运行所有测试
   - 手动测试

5. 提交和推送
   git commit -m "fix: 修复 XXX 问题"
   git push origin fix/bug-description

6. 创建 Pull Request
```

### 3. 代码审查清单

审查者应检查：

- [ ] 代码符合规范
- [ ] 有足够的测试覆盖
- [ ] 没有引入新的 bug
- [ ] 性能没有明显下降
- [ ] 文档已更新
- [ ] 提交信息清晰

---

## 测试策略

### 1. 测试类型

#### 单元测试

测试单个函数或模块：

```typescript
describe('detectTokenPlatform', () => {
  it('应该识别 Four.meme 代币', () => {
    const platform = detectTokenPlatform('0x...ffff');
    expect(platform).toBe('four');
  });

  it('应该识别 Flap 代币', () => {
    const platform = detectTokenPlatform('0x...4444');
    expect(platform).toBe('flap');
  });
});
```

#### 集成测试

测试多个模块的协作：

```typescript
describe('路由查询完整流程', () => {
  it('应该正确查询未迁移代币', async () => {
    const tokenAddress = '0x...ffff';
    const platform = detectTokenPlatform(tokenAddress);
    const route = await fetchRouteWithFallback(
      publicClient,
      tokenAddress,
      platform
    );

    expect(route.platform).toBe('four');
    expect(route.preferredChannel).toBe('four');
    expect(route.readyForPancake).toBe(false);
  });
});
```

### 2. 测试工具

- **Vitest**: 测试框架
- **vi.fn()**: Mock 函数
- **vi.spyOn()**: 监听函数调用

### 3. Mock 策略

```typescript
// Mock publicClient
const mockPublicClient = {
  readContract: vi.fn(),
  multicall: vi.fn()
};

// Mock 返回值
mockPublicClient.readContract.mockResolvedValue({
  liquidityAdded: false,
  quote: '0x...'
});

// 验证调用
expect(mockPublicClient.readContract).toHaveBeenCalledWith({
  address: expect.any(String),
  abi: expect.any(Array),
  functionName: 'getTokenInfo',
  args: [tokenAddress]
});
```

### 4. 测试覆盖率

目标覆盖率：

- **语句覆盖率**: > 70%
- **分支覆盖率**: > 60%
- **函数覆盖率**: > 70%
- **行覆盖率**: > 70%

查看覆盖率报告：

```bash
npm run test:coverage
open coverage/index.html
```

---

## 调试指南

### 1. 本地调试

#### 使用 Chrome DevTools

1. 打开 Chrome 扩展管理页面：`chrome://extensions/`
2. 启用"开发者模式"
3. 点击"加载已解压的扩展程序"
4. 选择项目的 `dist` 目录
5. 打开 Background Service Worker 控制台

#### 查看日志

```typescript
// 在代码中添加日志
structuredLogger.debug('调试信息', { data });

// 在控制台查看
const logs = structuredLogger.getLogs();
console.table(logs);
```

### 2. 调试路由查询

使用路由追踪器：

```typescript
// 启用追踪
const traceId = routeTracer.startTrace(tokenAddress, platform);

// 查询路由
const route = await fetchRouteWithFallback(
  publicClient,
  tokenAddress,
  platform
);

// 查看追踪信息
const trace = routeTracer.getTrace(traceId);
console.log('追踪信息:', trace);
console.log('步骤:', trace.steps);
console.log('总耗时:', trace.totalDuration, 'ms');
```

### 3. 调试缓存问题

```typescript
// 清除缓存
clearRouteCache(tokenAddress);

// 重新查询
const route = await fetchRouteWithFallback(...);

// 检查缓存
const cached = getRouteCache(tokenAddress);
console.log('缓存状态:', cached);
```

### 4. 调试 Service Worker 问题

Service Worker 环境有特殊限制：

- 不支持 `import()`
- 不支持 `eval()`
- 不支持某些 DOM API

解决方案：

```typescript
// 检测 Service Worker 环境
const isServiceWorker = typeof importScripts === 'function';

if (isServiceWorker) {
  // 使用替代方案
} else {
  // 正常逻辑
}
```

---

## 代码规范

### 1. TypeScript 规范

#### 类型定义

```typescript
// ✅ 好的做法
type TokenPlatform = 'four' | 'xmode' | 'flap' | 'luna' | 'unknown';

interface RouteFetchResult {
  platform: TokenPlatform;
  preferredChannel: string;
  readyForPancake: boolean;
}

// ❌ 避免使用 any
function fetchRoute(client: any): any {  // 不好
  // ...
}

// ✅ 使用具体类型
function fetchRoute(client: PublicClient): RouteFetchResult {
  // ...
}
```

#### 函数命名

```typescript
// ✅ 动词开头，描述性强
function fetchRouteWithFallback() {}
function validateAddress() {}
function checkPairLiquidity() {}

// ❌ 名称不清晰
function route() {}
function check() {}
function get() {}
```

### 2. 注释规范

```typescript
/**
 * 查询代币的路由信息，支持多平台 fallback
 *
 * @param publicClient - Viem public client 实例
 * @param tokenAddress - 代币合约地址
 * @param initialPlatform - 初始平台类型
 * @returns 路由查询结果
 *
 * @example
 * ```typescript
 * const route = await fetchRouteWithFallback(
 *   publicClient,
 *   '0x...ffff',
 *   'four'
 * );
 * ```
 */
export async function fetchRouteWithFallback(
  publicClient: any,
  tokenAddress: Address,
  initialPlatform: TokenPlatform
): Promise<RouteFetchResult> {
  // 实现...
}
```

### 3. 错误处理

```typescript
// ✅ 具体的错误处理
try {
  const route = await fetchRoute();
} catch (error) {
  if (error instanceof NetworkError) {
    // 处理网络错误
  } else if (error instanceof ServiceWorkerError) {
    // 处理 Service Worker 错误
  } else {
    // 处理其他错误
  }
}

// ❌ 笼统的错误处理
try {
  const route = await fetchRoute();
} catch (error) {
  console.error(error);  // 不够具体
}
```

### 4. 异步处理

```typescript
// ✅ 使用 async/await
async function fetchData() {
  const result1 = await fetch1();
  const result2 = await fetch2();
  return { result1, result2 };
}

// ✅ 并行请求
async function fetchDataParallel() {
  const [result1, result2] = await Promise.all([
    fetch1(),
    fetch2()
  ]);
  return { result1, result2 };
}

// ❌ 回调地狱
function fetchData(callback) {
  fetch1((result1) => {
    fetch2((result2) => {
      callback({ result1, result2 });
    });
  });
}
```

---

## 常见任务

### 1. 添加新的代币平台

```typescript
// 1. 更新类型定义
type TokenPlatform = 'four' | 'xmode' | 'flap' | 'luna' | 'newplatform' | 'unknown';

// 2. 添加平台检测逻辑
export function detectTokenPlatform(tokenAddress: string): TokenPlatform {
  const normalized = tokenAddress.toLowerCase();

  // 添加新平台的检测规则
  if (normalized.endsWith('aaaa')) {
    return 'newplatform';
  }

  // 其他平台...
}

// 3. 实现平台特定的路由查询
async function fetchNewPlatformRoute(
  publicClient: any,
  tokenAddress: Address
): Promise<RouteFetchResult> {
  // 实现查询逻辑
}

// 4. 集成到 fetchTokenRouteState
export async function fetchTokenRouteState(
  publicClient: any,
  tokenAddress: Address,
  platform: TokenPlatform
): Promise<RouteFetchResult> {
  switch (platform) {
    case 'newplatform':
      return fetchNewPlatformRoute(publicClient, tokenAddress);
    // 其他平台...
  }
}

// 5. 添加测试
describe('新平台路由', () => {
  it('应该正确查询新平台代币', async () => {
    // 测试逻辑
  });
});
```

### 2. 添加新的交易通道

```typescript
// 1. 在 trading-channels.ts 中添加通道实现
export async function executeNewChannelTrade(
  params: TradeParams
): Promise<TransactionResult> {
  // 实现交易逻辑
}

// 2. 更新通道选择逻辑
function selectChannel(route: RouteFetchResult): string {
  if (route.platform === 'newplatform') {
    return 'newchannel';
  }
  // 其他逻辑...
}

// 3. 添加测试
```

### 3. 优化性能

```typescript
// 1. 使用性能监控
const perfMonitor = new PerformanceMonitor();

const result = await perfMonitor.measure('fetchRoute', async () => {
  return await fetchRouteWithFallback(...);
});

// 2. 查看性能统计
const stats = perfMonitor.getStats('fetchRoute');
console.log('平均耗时:', stats.avg, 'ms');
console.log('P95:', stats.p95, 'ms');

// 3. 优化瓶颈
// - 减少链上查询
// - 使用批处理
// - 优化缓存策略
```

---

## 相关资源

### 文档

- [API 参考](./api-reference.md)
- [故障排查手册](./troubleshooting.md)
- [架构决策记录](./adr/README.md)

### 外部资源

- [Viem 文档](https://viem.sh/)
- [Vitest 文档](https://vitest.dev/)
- [Chrome Extension 文档](https://developer.chrome.com/docs/extensions/)

---

## 获取帮助

### 遇到问题？

1. 查看[故障排查手册](./troubleshooting.md)
2. 搜索 GitHub Issues
3. 查看测试用例
4. 联系团队成员

### 贡献代码

欢迎提交 Pull Request！请确保：

- 代码符合规范
- 有足够的测试覆盖
- 文档已更新
- 所有测试通过

---

**最后更新**: 2026-02-09
