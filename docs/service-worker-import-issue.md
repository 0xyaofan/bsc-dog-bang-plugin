# Service Worker Import 问题临时解决方案

## 问题

在 Service Worker 环境中，Viem 的 `readContract` 调用会触发动态 `import()`，这在 Service Worker 中是被禁止的：

```
import() is disallowed on ServiceWorkerGlobalScope by the HTML specification
```

## 临时方案

当前实现：遇到这个错误时，返回 `hasLiquidity: true`，让交易系统使用路径缓存。

## 根本问题

即使绕过了 Service Worker 限制，路径缓存仍然使用的是 KDOG/WBNB，而不是 KDOG/KGST。

## 下一步

需要清除旧的路径缓存，让系统重新发现配对。或者，修复 Viem 的 Service Worker 兼容性问题。

---

创建日期：2026-02-08
