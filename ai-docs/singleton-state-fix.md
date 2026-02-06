# 单例对象状态污染修复

## 问题发现

用户在测试时发现 PerformanceTimer 对象池存在严重的状态污染问题：

```
[Perf:买入] 总耗时 15710.60ms
(16) [{…}, {…}, {…}, {…}, {…}, {…}, {…}, {…}, {…}, {…}, {…}, {…}, {…}, {…}, {…}, {…}]
0: {name: '检查钱包状态 (0.00ms)', duration: 0.10000000149011612}
1: {name: '预热服务 (0.40ms)', duration: 0.3999999985098839}
...
8: {name: '检查钱包状态 (0.00ms)', duration: 13350.5}  // 重复！
9: {name: '预热服务 (0.20ms)', duration: 0.29999999701976776}  // 重复！
...
```

**根本原因：** 对象池复用时，没有清理上一次使用的状态（`steps` 数组），导致记录累积。

---

## 修复方案

### 1. PerformanceTimer 状态重置 ✅

**问题：** 有状态对象（`steps` 数组、`startTime`）复用时未清理

**修复：** 添加 `reset()` 方法，在获取和归还时重置状态

```typescript
// src/shared/performance.ts

export class DebugPerformanceTimer {
  private type: string;
  private startTime: number;
  private steps: PerformanceStep[];

  constructor(type: string) {
    this.type = type;
    this.startTime = performance.now();
    this.steps = [];
  }

  /**
   * 重置计时器状态（用于对象池复用）
   */
  reset(type: string) {
    this.type = type;
    this.startTime = performance.now();
    this.steps = [];  // 清空步骤记录
  }

  // ... 其他方法
}

export class NoOpPerformanceTimer {
  // 同样添加 reset() 方法
  reset(type: string) {
    this.type = type;
    this.steps = [];
  }
}

export class PerformanceTimer {
  // 暴露 reset() 方法
  reset(type: string) {
    this.impl.reset(type);
  }
}
```

**对象池修改：**
```typescript
class PerformanceTimerPool {
  acquire(type: string): PerformanceTimer {
    const typePool = this.pool.get(type);
    if (typePool && typePool.length > 0) {
      const timer = typePool.pop()!;
      // ✅ 获取时重置状态
      timer.reset(type);
      return timer;
    }
    return new PerformanceTimer(type);
  }

  release(type: string, timer: PerformanceTimer) {
    if (!this.pool.has(type)) {
      this.pool.set(type, []);
    }
    const typePool = this.pool.get(type)!;
    if (typePool.length < this.maxPoolSize) {
      // ✅ 归还前重置状态（双重保险）
      timer.reset(type);
      typePool.push(timer);
    }
  }
}
```

---

### 2. Fee Candidates 数组冻结 ✅

**问题：** 虽然是预计算的数组，但返回的是可变引用，存在被外部修改的风险

**修复：** 使用 `Object.freeze()` 冻结数组，防止意外修改

```typescript
// src/background/four-quote-bridge.ts

const feeCandidatesCache = new Map<number | null, readonly number[]>();

function initializeFeeCandidatesCache() {
  // ✅ 冻结数组
  feeCandidatesCache.set(null, Object.freeze([...V3_FEE_TIERS]));

  V3_FEE_TIERS.forEach((preferredFee) => {
    const candidates = [preferredFee, ...V3_FEE_TIERS.filter((fee) => fee !== preferredFee)];
    // ✅ 冻结数组
    feeCandidatesCache.set(preferredFee, Object.freeze(candidates));
  });
}

function getFeeCandidates(preferredFee?: number): readonly number[] {
  const key = typeof preferredFee === 'number' ? preferredFee : null;
  // ✅ 返回冻结的数组
  return feeCandidatesCache.get(key) || Object.freeze([...V3_FEE_TIERS]);
}
```

**TypeScript 类型保护：**
- 返回类型改为 `readonly number[]`
- 防止编译时的意外修改

---

## 单例对象状态审查

### ✅ 安全的单例对象

#### 1. Chain Config 缓存
```typescript
// src/shared/viem-helper.ts
const chainConfigCache = new Map<string, any>();
```

**状态分析：**
- ✅ **完全无状态**：只是配置对象，不包含可变状态
- ✅ **不会被修改**：viem 内部只读取配置，不修改
- ✅ **无需重置**：配置对象创建后不变

**结论：** 安全，无需修改

---

#### 2. Fallback Client 数组缓存
```typescript
// src/background/four-quote-bridge.ts
let cachedFallbackClients: any[] | null = null;
let cachedPrimaryClient: any = null;
```

**状态分析：**
- ✅ **数组本身无状态**：只是 client 引用的容器
- ✅ **Client 对象有状态但不在此管理**：client 的状态由 viem 管理
- ✅ **数组只读使用**：只用于遍历，不修改数组内容
- ⚠️ **潜在风险**：如果外部代码修改数组（如 `push`、`pop`），会影响缓存

**改进建议（可选）：**
```typescript
// 返回冻结的数组（如果担心被修改）
function buildV3FallbackClients(primaryClient: any): readonly any[] {
  // ...
  return Object.freeze(clients);
}
```

**结论：** 当前实现安全，但可以考虑冻结数组增强防护

---

#### 3. Fee Candidates 缓存
```typescript
// src/background/four-quote-bridge.ts
const feeCandidatesCache = new Map<number | null, readonly number[]>();
```

**状态分析：**
- ✅ **已冻结**：使用 `Object.freeze()` 防止修改
- ✅ **TypeScript 类型保护**：`readonly number[]` 防止编译时修改
- ✅ **完全不可变**：数字数组，即使不冻结也很难意外修改

**结论：** 已修复，完全安全

---

## 对象池设计原则

### ✅ 适合对象池的对象特征

1. **可重置状态**
   - 对象有明确的初始状态
   - 可以通过 `reset()` 方法恢复初始状态
   - 状态重置成本低

2. **创建成本高**
   - 对象创建涉及复杂计算或资源分配
   - 复用比创建更高效

3. **生命周期短**
   - 对象使用后很快释放
   - 适合频繁创建和销毁的场景

### ❌ 不适合对象池的对象特征

1. **无法完全重置**
   - 对象有隐藏状态或闭包引用
   - 重置成本接近或超过创建成本

2. **生命周期长**
   - 对象长时间持有（如 WebSocket 连接）
   - 对象池无法有效复用

3. **状态复杂**
   - 对象有复杂的内部状态
   - 重置逻辑容易出错

---

## 对象池最佳实践

### 1. 双重重置保护
```typescript
class ObjectPool<T> {
  acquire(): T {
    const obj = this.pool.pop();
    if (obj) {
      obj.reset();  // ✅ 获取时重置
      return obj;
    }
    return this.create();
  }

  release(obj: T) {
    obj.reset();  // ✅ 归还时重置（双重保险）
    this.pool.push(obj);
  }
}
```

### 2. 状态验证（开发模式）
```typescript
class ObjectPool<T> {
  acquire(): T {
    const obj = this.pool.pop();
    if (obj) {
      if (DEBUG_MODE) {
        // ✅ 验证对象状态是否干净
        this.validateCleanState(obj);
      }
      obj.reset();
      return obj;
    }
    return this.create();
  }
}
```

### 3. 池大小限制
```typescript
class ObjectPool<T> {
  private maxPoolSize = 5;  // ✅ 限制池大小，防止内存泄漏

  release(obj: T) {
    if (this.pool.length < this.maxPoolSize) {
      obj.reset();
      this.pool.push(obj);
    }
    // 超过限制的对象直接丢弃，让 GC 回收
  }
}
```

---

## 缓存对象最佳实践

### 1. 不可变数据
```typescript
// ✅ 好：冻结数组
const cache = Object.freeze([1, 2, 3]);

// ❌ 坏：可变数组
const cache = [1, 2, 3];
```

### 2. 防御性复制（如果无法冻结）
```typescript
// ✅ 返回副本，防止修改原始缓存
function getCachedArray(): number[] {
  return [...cachedArray];
}
```

### 3. TypeScript 类型保护
```typescript
// ✅ 使用 readonly 类型
const cache: readonly number[] = Object.freeze([1, 2, 3]);

function getCache(): readonly number[] {
  return cache;
}
```

---

## 测试验证

### 功能测试
- [x] PerformanceTimer 不再累积记录
- [x] 多次交易日志正常
- [x] 对象池正确复用
- [x] Fee Candidates 不可修改

### 性能测试
- [ ] 对象池命中率监控
- [ ] 内存使用稳定性
- [ ] GC 频率降低

### 安全测试
- [x] 尝试修改冻结数组（应该失败）
- [x] 验证状态重置完整性
- [ ] 长时间运行无内存泄漏

---

## 总结

### 修复内容
1. ✅ **PerformanceTimer 状态重置**：添加 `reset()` 方法，解决状态污染
2. ✅ **Fee Candidates 数组冻结**：使用 `Object.freeze()` 防止修改
3. ✅ **单例对象审查**：确认其他缓存对象安全

### 关键教训
1. **对象池必须重置状态**：有状态对象复用前必须清理
2. **缓存对象应该不可变**：使用 `Object.freeze()` 和 `readonly` 类型
3. **双重保护更安全**：获取时重置 + 归还时重置
4. **只有无状态对象才适合简单缓存**：有状态对象需要对象池模式

### 设计原则
- **对象池**：适用于有状态、可重置、频繁创建的对象
- **简单缓存**：适用于无状态、不可变的对象
- **状态管理**：明确区分对象的状态和引用

---

**修复日期**: 2026-02-06
**版本**: 1.1
**问题严重性**: 高（导致日志混乱和潜在的状态错误）
**修复状态**: 已完成并验证
