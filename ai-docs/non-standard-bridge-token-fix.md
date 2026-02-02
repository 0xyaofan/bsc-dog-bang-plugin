# 非标准桥接代币路由修复

## 问题描述

用户报告代币 `0xcc411e6eac8f660972bf06ac5ea12058267755f0` 在 PancakeSwap 中有流动性池，但点击买入失败，报错：

```
[PancakeSwap] 所有路径都失败，代币可能没有流动性
```

经分析发现，该代币与 USAT (`0xdb7a6d5a127ea5c0a3576677112f13d731232a27`) 配对，而不是与常见的 WBNB、USDT、USDC 等代币配对。

## 根本原因

PancakeSwap 路由系统使用预定义的桥接代币列表来查找交易路径：

1. **stableTokens**: USDT, USDC, BUSD
2. **helperTokens**: ASTER, USD1, UNITED_STABLES_U
3. **dynamicBridgeTokens**: USD1, UNITED_STABLES_U

当代币与这些预定义代币都没有流动性池时，路由系统无法找到有效路径，导致交易失败。

## 解决方案

### 1. 添加 USAT 作为桥接代币

在 `src/shared/trading-config.ts` 中：

```typescript
// 添加 USAT 合约地址
export const CONTRACTS = {
  // ...
  USAT: '0xdb7a6d5a127ea5c0a3576677112f13d731232a27',
  // ...
};

// 将 USAT 添加到 helperTokens 和 dynamicBridgeTokens
export const CHANNEL_DEFINITIONS = {
  pancake: {
    // ...
    options: {
      helperTokens: [
        CONTRACTS.ASTER,
        CONTRACTS.USD1,
        CONTRACTS.UNITED_STABLES_U,
        CONTRACTS.USAT  // 新增
      ].filter((token): token is string => Boolean(token)),
      dynamicBridgeTokens: [
        CONTRACTS.USD1,
        CONTRACTS.UNITED_STABLES_U,
        CONTRACTS.USAT  // 新增
      ].filter((token): token is string => Boolean(token)),
      // ...
    }
  }
};
```

### 2. 注册 USAT 的路由配置

```typescript
registerQuoteTokenPreset(CONTRACTS.USAT, {
  swapMode: 'v2',
  path: [CONTRACTS.WBNB, CONTRACTS.USAT]
});
```

## 工作原理

添加 USAT 后，路由系统会：

1. 检查代币是否与 USAT 有流动性池
2. 检查 USAT 是否与 WBNB 有流动性池
3. 如果两者都存在，创建路径：`[WBNB, USAT, Token]`（买入）或 `[Token, USAT, WBNB]`（卖出）

## 影响范围

- ✅ 支持与 USAT 配对的所有代币
- ✅ 不影响现有代币的路由
- ✅ 自动缓存路由结果，提升性能
- ✅ 同时支持 V2 和 V3 路由

## 扩展性

如果未来遇到其他非标准桥接代币，可以按照相同方式添加：

1. 在 `CONTRACTS` 中添加代币地址
2. 将代币添加到 `helperTokens` 和 `dynamicBridgeTokens`
3. 使用 `registerQuoteTokenPreset` 注册路由配置

## 测试建议

1. 测试与 USAT 配对的代币买入/卖出
2. 验证路由缓存是否正常工作
3. 确认不影响现有代币的交易

## 相关文件

- `src/shared/trading-config.ts` - 配置文件
- `src/shared/trading-channels.ts` - 路由逻辑
- `CHANGELOG.md` - 变更记录
