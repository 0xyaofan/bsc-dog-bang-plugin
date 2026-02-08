# ADR-003: 平台检测机制

## 状态
已接受 (Accepted)

## 日期
2026-02-08

## 背景
BSC 链上有多个 Meme 代币发射平台，每个平台使用不同的合约和交易机制：
- **Four.meme**: 地址以 `ffff` 或 `4444` 结尾
- **XMode**: 地址以 `0x4444` 开头
- **Flap**: 地址以 `7777` 或 `8888` 结尾
- **Luna**: 没有特定地址模式
- **Unknown**: 其他所有代币（通常在 PancakeSwap 交易）

需要一个可靠的机制来识别代币所属的平台，以便使用正确的路由策略。

## 决策
采用**基于地址模式的静态检测**机制：

### 检测规则
```typescript
export function detectTokenPlatform(tokenAddress: string): TokenPlatform {
  const normalized = normalizeAddress(tokenAddress);

  // 验证地址格式
  if (!/^0x[a-f0-9]{40}$/.test(normalized)) {
    return 'unknown';
  }

  // 按优先级检测
  if (normalized.endsWith('ffff')) return 'four';
  if (normalized.endsWith('4444')) return 'four';
  if (normalized.startsWith('0x4444')) return 'xmode';
  if (normalized.endsWith('7777') || normalized.endsWith('8888')) return 'flap';

  // 默认为 unknown（包括 Luna 和 PancakeSwap 代币）
  return 'unknown';
}
```

### 优先级顺序
1. **Four.meme** (ffff/4444 结尾) - 最高优先级
2. **XMode** (0x4444 开头) - 第二优先级
3. **Flap** (7777/8888 结尾) - 第三优先级
4. **Unknown** (其他) - 默认

**注意**：Luna 平台没有特定地址模式，被归类为 unknown

## 理由

### 为什么选择这个方案？

1. **性能优异**：O(1) 时间复杂度，无需链上查询
2. **准确可靠**：基于平台的地址生成规则
3. **易于维护**：规则清晰，容易理解和修改
4. **向后兼容**：新增平台只需添加规则

### 考虑过的其他方案

#### 方案 A：链上查询检测
```typescript
// 尝试调用每个平台的合约
const isFour = await tryCallFourContract(tokenAddress);
const isFlap = await tryCallFlapContract(tokenAddress);
```

- **优点**：100% 准确
- **缺点**：需要多次链上查询，延迟高，消耗 RPC 配额
- **为什么不选**：性能太差，用户体验不佳

#### 方案 B：维护平台代币列表
```typescript
const FOUR_TOKENS = new Set([
  '0x1234...ffff',
  '0x5678...4444',
  // ...
]);
```

- **优点**：精确控制
- **缺点**：需要手动维护，新代币需要更新列表
- **为什么不选**：维护成本高，扩展性差

#### 方案 C：混合检测（地址模式 + 链上验证）
```typescript
const platform = detectByPattern(tokenAddress);
if (platform !== 'unknown') {
  await verifyOnChain(tokenAddress, platform);
}
```

- **优点**：兼顾性能和准确性
- **缺点**：实现复杂，增加延迟
- **为什么不选**：过度设计，当前方案已足够准确

## 后果

### 正面影响
- ✅ 极快的检测速度（< 1ms）
- ✅ 无需链上查询，节省 RPC 配额
- ✅ 代码简单，易于理解和维护
- ✅ 支持离线检测

### 负面影响
- ⚠️ 依赖平台的地址生成规则
- ⚠️ 如果平台改变规则，需要更新代码
- ⚠️ Luna 平台无法通过地址检测

### 风险和缓解

#### 风险 1：平台改变地址生成规则
- **概率**：低（地址规则通常不会改变）
- **影响**：高（会导致检测失败）
- **缓解**：监控平台更新，及时调整规则

#### 风险 2：地址冲突
- **概率**：极低（40 位十六进制地址空间巨大）
- **影响**：中（可能误判平台）
- **缓解**：优先级排序，先匹配更具体的规则

#### 风险 3：Luna 平台检测
- **概率**：N/A（Luna 没有地址模式）
- **影响**：中（需要显式传入平台参数）
- **缓解**：在调用时显式指定 platform='luna'

## 实现细节

### 地址规范化
```typescript
function normalizeAddress(address: string): string {
  if (typeof address !== 'string') return '';
  return (address || '').toLowerCase().trim();
}
```

**目的**：
- 统一大小写
- 去除空格
- 处理 null/undefined

### 测试覆盖
```typescript
describe('detectTokenPlatform', () => {
  it('应该识别 Four.meme (ffff)', () => {
    expect(detectTokenPlatform('0x...ffff')).toBe('four');
  });

  it('应该识别 Four.meme (4444)', () => {
    expect(detectTokenPlatform('0x...4444')).toBe('four');
  });

  it('应该识别 XMode (0x4444)', () => {
    expect(detectTokenPlatform('0x4444...')).toBe('xmode');
  });

  it('应该识别 Flap (7777/8888)', () => {
    expect(detectTokenPlatform('0x...7777')).toBe('flap');
    expect(detectTokenPlatform('0x...8888')).toBe('flap');
  });

  it('应该处理无效地址', () => {
    expect(detectTokenPlatform('invalid')).toBe('unknown');
  });
});
```

### 边界情况处理
1. **空字符串**：返回 'unknown'
2. **null/undefined**：返回 'unknown'
3. **非字符串**：返回 'unknown'
4. **无效格式**：返回 'unknown'
5. **大小写混合**：规范化后检测

## 扩展性

### 添加新平台
```typescript
// 1. 添加平台类型
export type TokenPlatform = 'four' | 'xmode' | 'flap' | 'luna' | 'newplatform' | 'unknown';

// 2. 添加检测规则
if (normalized.endsWith('xxxx')) return 'newplatform';

// 3. 添加测试
it('应该识别 NewPlatform', () => {
  expect(detectTokenPlatform('0x...xxxx')).toBe('newplatform');
});
```

### 修改检测规则
```typescript
// 如果需要更复杂的规则
if (normalized.startsWith('0x4444') && normalized.endsWith('0000')) {
  return 'special-platform';
}
```

## 监控和维护

### 需要监控的指标
1. 各平台检测数量分布
2. unknown 平台的比例
3. 检测失败的案例

### 维护检查清单
- [ ] 定期检查平台是否有新的地址规则
- [ ] 监控 unknown 平台中是否有新平台
- [ ] 收集用户反馈的误判案例
- [ ] 更新测试用例覆盖新场景

## 相关决策
- ADR-001: Service Worker 环境下的路由查询策略
- ADR-002: 路由缓存策略

## 参考资料
- Four.meme 合约文档
- Flap.sh 技术文档
- Luna.fun 开发者指南
- Issue: "Bug #2: Four.meme 未迁移代币（BNB 筹集）应该被识别为 four"
