# Shared Modules

这个目录包含项目中共享的核心模块。

## 模块说明

### 📝 logger.ts
日志管理模块，提供统一的日志接口。

**导出内容:**
- `DEBUG_CONFIG` - 调试配置对象
- `logger` - 日志工具对象，包含以下方法:
  - `error()` - 错误日志（总是显示）
  - `warn()` - 警告日志（总是显示）
  - `info()` - 信息日志（仅 DEBUG 模式）
  - `debug()` - 调试日志（仅 DEBUG 模式）
  - `perf()` - 性能日志（仅 DEBUG 模式）
  - `group()` - 分组日志（仅 DEBUG 模式）
  - `groupEnd()` - 结束分组（仅 DEBUG 模式）

**使用示例:**
```typescript
import { logger, DEBUG_CONFIG } from './logger';

// 启用调试模式
DEBUG_CONFIG.ENABLED = true;

// 使用日志
logger.debug('调试信息');
logger.error('错误信息');
```

---

### ⏱️ performance.ts
性能监控模块，提供交易性能分析工具。

**导出内容:**
- `PerformanceTimer` - 性能计时器类（根据 DEBUG 模式自动选择实现）
- `perf` - 性能测量工具对象
- `PerformanceStep` - 性能步骤类型
- `PerformanceReport` - 性能报告类型

**使用示例:**
```typescript
import { PerformanceTimer, perf } from './performance';

// 创建计时器
const timer = new PerformanceTimer('buy');

// 记录步骤
timer.step('验证参数');
// ... 执行操作 ...

timer.step('发送交易');
// ... 执行操作 ...

// 完成并打印报告
const report = timer.finish();
console.log(`总耗时: ${report.totalTime}ms`);
```

---

### ⚙️ trading-config.ts
交易配置模块，包含所有配置常量和合约定义。

**导出内容:**
- **重新导出:** `logger`, `DEBUG_CONFIG`, `PerformanceTimer`, `perf` 等（向后兼容）
- `WALLET_CONFIG` - 钱包配置
- `NETWORK_CONFIG` - 网络配置（RPC 节点等）
- `TX_CONFIG` - 交易参数配置（Gas、滑点等）
- `UI_CONFIG` - UI 配置
- `TX_WATCHER_CONFIG` - 交易监听配置
- `CONTRACTS` - 合约地址
- `ROUTER_ABI` - PancakeSwap Router ABI
- `ERC20_ABI` - ERC20 标准 ABI
- `FOUR_TOKEN_MANAGER_ABI` - Four.meme ABI
- `FLAP_PORTAL_ABI` - Flap Portal ABI
- `CHANNELS` - 交易通道配置

**使用示例:**
```typescript
import {
  CONTRACTS,
  TX_CONFIG,
  NETWORK_CONFIG,
  logger
} from './trading-config';

// 使用配置
const routerAddress = CONTRACTS.PANCAKE_ROUTER;
const slippage = TX_CONFIG.DEFAULT_SLIPPAGE;
const rpcUrl = NETWORK_CONFIG.BSC_RPC;

// 日志仍然可用（重新导出）
logger.debug('配置已加载');
```

---

### 🔄 trading-channels.ts
交易通道实现模块，提供不同 DEX 的交易逻辑。

**支持的通道:**
- PancakeSwap
- Four.meme
- X Mode
- Flap Portal

---

### 👁️ tx-watcher.ts
交易监听模块，监听区块链交易确认状态。

**功能:**
- WebSocket 实时监听
- HTTP 轮询降级方案
- 自动重连机制

---

### 🔧 promise-dedupe.ts
Promise 去重工具，避免重复请求。

---

## 模块依赖关系

```
logger.ts (独立模块)

performance.ts
└── logger.ts (依赖 DEBUG_CONFIG)

trading-config.ts (纯配置)

trading-channels.ts
├── logger.ts
└── trading-config.ts

tx-watcher.ts
└── trading-config.ts

background/index.ts
├── logger.ts
├── performance.ts
├── trading-config.ts
├── trading-channels.ts
└── tx-watcher.ts

content/index.ts
├── logger.ts
├── performance.ts
└── trading-config.ts
```

## 重构说明

### 2025-11-28 模块化重构

**目标:** 将 `trading-config.ts` 中的非配置功能剥离，实现完全模块化。

**变更:**
1. ✅ 创建独立的 `logger.ts` 模块
2. ✅ 创建独立的 `performance.ts` 模块
3. ✅ `trading-config.ts` 只保留配置，**不再重新导出其他模块**
4. ✅ 更新所有引用文件的 import 语句

**优势:**
- ✅ 职责分离：配置、日志、性能监控各司其职
- ✅ 更好的可维护性：每个模块功能单一
- ✅ 清晰的依赖关系：必须显式导入所需模块
- ✅ 更小的打包体积：按需导入

**使用方式:**

```typescript
// 日志功能
import { logger, DEBUG_CONFIG } from '../shared/logger';

// 性能监控
import { PerformanceTimer, perf } from '../shared/performance';

// 配置
import { CONTRACTS, TX_CONFIG, NETWORK_CONFIG } from '../shared/trading-config';
```

**注意:** 不再支持从 `trading-config.ts` 导入 `logger` 或 `PerformanceTimer`！
