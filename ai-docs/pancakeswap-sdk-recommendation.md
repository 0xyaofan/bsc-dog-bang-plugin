# PancakeSwap SDK 引入建议（快速参考）

**日期：** 2026-02-04

---

## 核心结论

✅ **推荐引入：** `@pancakeswap/swap-sdk-core` v1.5.0

❌ **不推荐引入：** `@pancakeswap/smart-router`、`@pancakeswap/sdk`、`@pancakeswap/v3-sdk`

---

## 为什么选择 `@pancakeswap/swap-sdk-core`？

### 包信息

| 属性 | 值 |
|------|-----|
| **包名** | `@pancakeswap/swap-sdk-core` |
| **版本** | 1.5.0 |
| **大小** | 39KB（unpacked） |
| **依赖** | 极少，零额外 SDK 依赖 |
| **许可** | MIT |
| **维护** | PancakeSwap 官方 |

### 包含内容

```typescript
// 核心类型
import {
  Currency,       // 货币基类
  Token,          // ERC20 代币
  CurrencyAmount, // 货币数量
  Price,          // 价格
  Fraction,       // 分数计算
  Percent         // 百分比
} from '@pancakeswap/swap-sdk-core'
```

### 优势

- ✅ **轻量级**：仅 39KB，插件体积增加 <1%
- ✅ **类型安全**：官方 TypeScript 类型定义
- ✅ **精确计算**：Fraction、Percent 数学工具
- ✅ **零依赖**：不会引入其他 SDK 包
- ✅ **官方维护**：持续更新，与生态一致
- ✅ **不影响性能**：不包含路由逻辑

---

## 使用场景

### 1. 类型定义

**替换前（手写）：**
```typescript
interface TokenInfo {
  address: string
  decimals: number
  symbol: string
  name: string
}
```

**替换后（SDK）：**
```typescript
import type { Token } from '@pancakeswap/swap-sdk-core'

// Token 类包含完整的类型定义和验证
const token = new Token(
  chainId,
  address,
  decimals,
  symbol,
  name
)
```

### 2. 精确计算

**价格影响计算：**
```typescript
import { Percent, Fraction } from '@pancakeswap/swap-sdk-core'

// 精确的百分比计算，避免浮点数误差
const priceImpact = new Percent(
  new Fraction(amountOut - expectedOut, expectedOut)
)

console.log(priceImpact.toSignificant(2)) // "2.5%"
```

**滑点计算：**
```typescript
import { Percent } from '@pancakeswap/swap-sdk-core'

const slippage = new Percent(50, 10000) // 0.5%
const minAmountOut = amountOut.multiply(
  new Percent(10000 - 50, 10000)
)
```

### 3. 价格表示

```typescript
import { Price, Token } from '@pancakeswap/swap-sdk-core'

const price = new Price(
  tokenIn,
  tokenOut,
  amountIn,
  amountOut
)

console.log(price.toSignificant(6)) // "1.234567"
console.log(price.invert().toSignificant(6)) // "0.810000"
```

---

## 不引入的包及原因

### ❌ `@pancakeswap/smart-router`

**原因：** 包含完整路由查询逻辑，会严重影响性能

| 指标 | 手写实现 | SDK 实现 | 差异 |
|------|---------|---------|------|
| V2 QuoteToken（首次） | 0.5-1s | 2-3s | **+200%** |
| 缓存命中 | 50-200ms | 500-1000ms | **+400%** |
| 买入后卖出 | 0-100ms | 2-3s | **+2000%** |

**核心问题：**
- 无法实现 QuoteToken 优化（插件核心竞争力）
- 无法实现 1小时路由缓存
- 无法实现预加载机制
- 无法实现失败缓存

### ❌ `@pancakeswap/sdk` 和 `@pancakeswap/v3-sdk`

**原因：** 包含 V2/V3 路由逻辑，与 smart-router 问题相同

**包体积：** 合计 ~500KB

---

## 实施计划

### 第一阶段：安装和配置

```bash
# 安装核心包
npm install @pancakeswap/swap-sdk-core@1.5.0

# 或使用 pnpm
pnpm add @pancakeswap/swap-sdk-core@1.5.0
```

### 第二阶段：逐步替换类型定义

**优先级 1：核心类型**
- [ ] Token 类型
- [ ] Currency 类型
- [ ] CurrencyAmount 类型

**优先级 2：计算工具**
- [ ] Fraction（分数计算）
- [ ] Percent（百分比）
- [ ] Price（价格）

**优先级 3：清理手写代码**
- [ ] 移除手写类型定义
- [ ] 移除手写工具函数
- [ ] 更新测试用例

### 第三阶段：测试验证

- [ ] 单元测试
- [ ] 集成测试
- [ ] 性能基准测试
- [ ] 手动测试

---

## 成本收益分析

### 成本

| 项目 | 值 |
|------|-----|
| **包体积增加** | +39KB（<1%） |
| **开发时间** | 2-3天（逐步替换） |
| **测试时间** | 1天 |
| **维护成本** | 极低（官方维护） |

### 收益

| 项目 | 值 |
|------|-----|
| **代码减少** | ~100行 |
| **类型安全** | 提升 |
| **计算精度** | 提升 |
| **维护性** | 提升 |
| **生态一致性** | 提升 |
| **性能影响** | 0（不包含路由逻辑） |

**ROI：** 非常高，建议立即实施

---

## 风险评估

### 低风险

- ✅ 包体积小（39KB）
- ✅ 零额外依赖
- ✅ 不影响核心路由逻辑
- ✅ 官方维护，稳定可靠
- ✅ 可逐步替换，风险可控

### 潜在问题

1. **版本更新**
   - **风险：** SDK 更新可能引入 Breaking Changes
   - **缓解：** 锁定版本号，定期评估更新

2. **学习成本**
   - **风险：** 团队需要学习 SDK API
   - **缓解：** API 简单直观，文档完善

---

## 对比：完整 SDK vs 核心包

| 特性 | 手写实现 | 核心包 | 完整 SDK |
|------|---------|--------|---------|
| **类型定义** | 手写 | ✅ SDK | ✅ SDK |
| **工具函数** | 手写 | ✅ SDK | ✅ SDK |
| **路由查询** | ✅ 手写 | ✅ 手写 | ❌ SDK |
| **性能** | ✅ 优秀 | ✅ 优秀 | ❌ 较差 |
| **包体积** | 0KB | +39KB | +500KB |
| **维护成本** | 高 | 低 | 低 |
| **灵活性** | ✅ 高 | ✅ 高 | ❌ 低 |

**结论：** 核心包是最佳折中方案

---

## 参考资料

- [可行性研究完整报告](./pancakeswap-sdk-feasibility-report.md)
- [@pancakeswap/swap-sdk-core on Yarn](https://classic.yarnpkg.com/en/package/@pancakeswap/swap-sdk-core)
- [PancakeSwap GitHub](https://github.com/pancakeswap)

---

**下一步行动：** 安装 `@pancakeswap/swap-sdk-core` 并开始逐步替换类型定义

**预期完成时间：** 3-4天

**预期收益：** 代码更简洁、类型更安全、维护更容易
