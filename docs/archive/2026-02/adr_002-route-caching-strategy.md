# ADR-002: 路由缓存策略

## 状态
已接受 (Accepted)

## 日期
2026-02-08

## 背景
路由查询涉及多次链上合约调用，每次查询都需要：
1. 查询代币信息（Four.meme/Flap/Luna）
2. 查询 PancakeSwap pair
3. 查询流动性储备量

频繁的链上查询会导致：
- 响应延迟增加
- RPC 请求配额消耗
- 用户体验下降

## 决策
采用**分层缓存策略**，根据代币迁移状态使用不同的缓存时长：

### 缓存层级

#### 1. 永久缓存（已迁移代币）
```typescript
if (cached.migrationStatus === 'migrated') {
  return cached.route; // 直接返回，不重新查询
}
```

**理由**：已迁移的代币状态不会改变，可以永久缓存

#### 2. 短期缓存（未迁移代币）
```typescript
if (cached.migrationStatus === 'unmigrated') {
  // 重新查询以检测迁移状态变化
  const route = await fetchTokenRouteState(...);
}
```

**理由**：未迁移代币可能随时迁移，需要定期检查

#### 3. 缓存清理
```typescript
function cleanupRouteCache(): void {
  const now = Date.now();
  for (const [key, entry] of routeCache.entries()) {
    if (now - entry.timestamp > MAX_CACHE_AGE) {
      routeCache.delete(key);
    }
  }
}
```

**理由**：防止缓存无限增长，占用过多内存

### 缓存键设计
```typescript
const cacheKey = tokenAddress.toLowerCase();
```

**理由**：使用小写地址作为键，避免大小写导致的缓存未命中

## 理由

### 为什么选择这个方案？

1. **性能优化**：减少不必要的链上查询
2. **准确性保证**：未迁移代币能及时检测到状态变化
3. **内存可控**：自动清理过期缓存
4. **简单实用**：实现简单，易于维护

### 考虑过的其他方案

#### 方案 A：统一 TTL 缓存
```typescript
// 所有路由都使用 5 分钟 TTL
const TTL = 5 * 60 * 1000;
```

- **优点**：实现简单
- **缺点**：已迁移代币会被重复查询，浪费资源
- **为什么不选**：不够智能，性能不佳

#### 方案 B：LRU 缓存
```typescript
class LRUCache {
  constructor(maxSize: number) {...}
}
```

- **优点**：自动淘汰最少使用的项
- **缺点**：实现复杂，可能淘汰重要的缓存
- **为什么不选**：过度设计，当前场景不需要

#### 方案 C：持久化缓存（chrome.storage）
```typescript
await chrome.storage.local.set({ routeCache });
```

- **优点**：跨会话保持缓存
- **缺点**：异步操作增加复杂度，可能缓存过期数据
- **为什么不选**：增加复杂度，收益不明显

## 后果

### 正面影响
- ✅ 显著减少链上查询次数
- ✅ 提升响应速度
- ✅ 降低 RPC 请求压力
- ✅ 已迁移代币查询几乎瞬时完成

### 负面影响
- ⚠️ 内存占用增加（但可控）
- ⚠️ 未迁移代币每次都需要查询（但这是必要的）
- ⚠️ 缓存清理可能在关键时刻触发（但影响很小）

### 性能指标
- **缓存命中率**：预计 60-70%（基于已迁移代币比例）
- **响应时间**：缓存命中时 < 10ms，未命中时 500-2000ms
- **内存占用**：每个缓存项约 1KB，100 个代币约 100KB

## 实现细节

### 缓存数据结构
```typescript
interface RouteCache {
  route: RouteFetchResult;
  timestamp: number;
  migrationStatus: 'migrated' | 'unmigrated' | 'unknown';
}

const routeCache = new Map<string, RouteCache>();
```

### 缓存更新条件
```typescript
function shouldUpdateRouteCache(
  tokenAddress: string,
  cached: RouteCache | undefined,
  newRoute: RouteFetchResult
): boolean {
  // 1. 无缓存，需要更新
  if (!cached) return true;

  // 2. 迁移状态变化，需要更新
  const newStatus = getMigrationStatus(newRoute);
  if (cached.migrationStatus !== newStatus) return true;

  // 3. 已迁移代币，不需要更新
  if (cached.migrationStatus === 'migrated') return false;

  // 4. 未迁移代币，总是更新
  return true;
}
```

### 缓存清理策略
- **触发时机**：每次设置缓存时
- **清理条件**：超过 1 小时的缓存
- **清理数量**：一次最多清理 10 个

## 监控和优化

### 需要监控的指标
1. 缓存命中率
2. 平均响应时间
3. 缓存大小
4. 清理频率

### 优化方向
1. 根据实际使用情况调整 TTL
2. 考虑为热门代币增加预加载
3. 评估持久化缓存的必要性

## 相关决策
- ADR-001: Service Worker 环境下的路由查询策略
- ADR-003: 平台检测机制

## 参考资料
- [缓存策略最佳实践](https://web.dev/cache-api-quick-guide/)
- Issue: "清理缓存还是存在问题"
