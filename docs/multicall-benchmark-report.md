# MultiCall vs 并发查询性能测试报告

## 测试结果

### 测试场景
- 查询 3 个合约的 `allowance`（授权）
- 测试代币：USDT (BSC)
- 测试次数：每种方法运行 5 次

### 性能对比

| 方法 | 平均耗时 | RPC 调用次数 | 最快 | 最慢 |
|------|---------|-------------|------|------|
| **并发查询 (Promise.all)** | 105.56ms | 3 次 | 93.88ms | 119.64ms |
| **Viem MultiCall** | 94.09ms | 1 次 | 91.92ms | 96.95ms |

### 结论

✅ **MultiCall 性能更优**
- **速度提升**：10.87% 更快
- **减少 RPC 调用**：3 次 → 1 次（减少 66.7%）
- **稳定性更好**：最快和最慢的差异更小（5ms vs 26ms）

## 为什么 MultiCall 更快？

### 1. **减少网络往返**
- 并发查询：3 次独立的 HTTP 请求
- MultiCall：1 次 HTTP 请求（包含 3 个调用）
- 节省了 2 次网络往返时间

### 2. **减少 RPC 节点压力**
- 并发查询：节点需要处理 3 个独立请求
- MultiCall：节点只需处理 1 个请求
- 降低触发限流的风险

### 3. **原子性保证**
- 并发查询：3 个调用可能在不同区块执行
- MultiCall：所有调用在同一区块执行
- 数据一致性更好

## 适用场景

### ✅ 推荐使用 MultiCall
1. **查询多个合约的相同函数**
   - 例如：查询 3 个合约的 `allowance`
   - 例如：查询多个代币的 `balanceOf`

2. **查询同一合约的多个函数**
   - 例如：查询代币的 `symbol`, `decimals`, `totalSupply`

3. **高频查询场景**
   - 快速轮询
   - 批量查询
   - 避免触发节点限流

### ⚠️ 不推荐使用 MultiCall
1. **单个查询**
   - 只查询 1 个函数时，MultiCall 没有优势

2. **关键路径查询**
   - 如果某个查询失败会导致整个 MultiCall 失败
   - 建议关键查询独立执行

## 实现建议

### 当前代码中可以优化的地方

#### 1. 授权查询（3 个合约）
```typescript
// 当前：并发查询
const [pancakeAllowance, fourAllowance, flapAllowance] = await Promise.all([
  publicClient.readContract({ ... }),
  publicClient.readContract({ ... }),
  publicClient.readContract({ ... })
]);

// 优化：使用 MultiCall
const results = await publicClient.multicall({
  contracts: [
    { address: tokenAddress, abi: ERC20_ABI, functionName: 'allowance', args: [...] },
    { address: tokenAddress, abi: ERC20_ABI, functionName: 'allowance', args: [...] },
    { address: tokenAddress, abi: ERC20_ABI, functionName: 'allowance', args: [...] }
  ]
});
```

#### 2. 代币元数据查询
```typescript
// 当前：并发查询
const [symbol, decimals, totalSupply] = await Promise.all([
  publicClient.readContract({ functionName: 'symbol' }),
  publicClient.readContract({ functionName: 'decimals' }),
  publicClient.readContract({ functionName: 'totalSupply' })
]);

// 优化：使用 MultiCall
const results = await publicClient.multicall({
  contracts: [
    { address: tokenAddress, abi: ERC20_ABI, functionName: 'symbol' },
    { address: tokenAddress, abi: ERC20_ABI, functionName: 'decimals' },
    { address: tokenAddress, abi: ERC20_ABI, functionName: 'totalSupply' }
  ]
});
```

## 预期收益

### 性能提升
- **授权查询**：~10% 速度提升
- **元数据查询**：~10% 速度提升
- **减少 RPC 调用**：66.7% 减少

### 稳定性提升
- **降低限流风险**：RPC 调用次数减少 2/3
- **提高成功率**：减少网络请求失败的概率
- **数据一致性**：所有查询在同一区块执行

## 实施计划

1. ✅ 完成性能测试
2. ⏳ 修改授权查询使用 MultiCall
3. ⏳ 修改元数据查询使用 MultiCall
4. ⏳ 测试验证
5. ⏳ 提交代码

---

**测试日期**: 2026-02-06
**测试环境**: BSC 主网
**RPC 节点**: ZAN Node
