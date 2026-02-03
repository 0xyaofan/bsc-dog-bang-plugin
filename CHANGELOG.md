# Changelog

All notable changes to BSC Dog Bang Plugin will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.1.7] - 2026-02-04

### Fixed
- **🐛 浮动窗口钱包状态同步问题** - 修复浮动窗口创建时交易按钮无法点击的问题
  - **问题**：浮动窗口创建后，即使钱包已解锁，买卖按钮点击无反应
  - **原因**：`updateFloatingBalances` 只更新余额显示，不更新 `walletButtonsEnabled` 状态
  - **修复**：在 `updateFloatingBalances` 中根据钱包状态同步更新交易按钮状态
  - **效果**：浮动窗口的交易按钮状态与钱包状态实时同步

### Changed
- **⚡ 日志系统优化** - 优化日志级别，使用分级管理提升可读性
  - **性能日志**：耗时相关日志改为 `logger.perf()`，由 `PERF_ENABLED` 独立控制
  - **调试日志**：技术细节日志改为 `logger.debug()`，减少 info 级别日志噪音
  - **业务日志**：保留关键业务信息为 `logger.info()`，如路由选择结果、混合路由执行等
  - **效果**：普通用户看关键信息，调试时看详细信息，性能分析时看耗时数据

### Added
- **✨ TaxToken 支持** - 支持 Four.meme 税收代币（2026年1月30日发布）
  - **识别**：自动识别地址以 `ffff` 结尾的 TaxToken
  - **验证**：通过 `getTokenInfo` 查询验证代币是否在 Four.meme 系统中
    - 如果查询返回空数据，说明不是真正的 Four.meme 代币
    - 自动跳过其他发射台平台，直接使用 Pancake 交易
  - **交易**：TaxToken 使用与普通 Four.meme 代币相同的 TokenManager2 合约和交易接口
  - **兼容性**：
    - 买入：`buyTokenAMAP(token, amountIn, minAmountOut)` - 与普通代币相同
    - 卖出：`sellToken(token, amount, minFunds)` - 与普通代币相同
    - 无需修改交易逻辑，完全兼容现有实现
  - **特性**：
    - TaxToken 会在交易时自动扣除税费（1%, 3%, 5%, 10%）
    - 税费分配给创始人、持币者、销毁、流动性
    - 持币者可领取奖励（未来可添加 UI 支持）
  - **性能优化**：模式匹配但获取信息失败时，直接使用 Pancake，避免尝试所有发射台平台
  - **文档**：参考 `launchpad-docs/fourmeme/API-Contract-TaxToken.md`

### Fixed
- **🐛 未迁移代币错误路由到 Pancake 问题** - 修复未迁移代币被错误识别并路由到 Pancake 的问题
  - **问题**：未迁移代币（筹集币种是 BNB）被路由到 Pancake 进行交易
  - **后果**：
    - 在 Pancake 上尝试所有路径，全部失败（4-5 秒）
    - 浪费大量 RPC 请求
    - 最终交易失败
  - **根本原因**：
    - Four.meme helper 返回的数据被判定为"空"
    - 系统自动切换到 Pancake，不检查 liquidityAdded 状态
    - 未迁移代币在 Pancake 上没有流动性
  - **修复**：
    - 在切换到 Pancake 前检查 liquidityAdded 状态
    - 只有在 liquidityAdded = true 时才切换到 Pancake
    - 未迁移代币抛出错误，使用 fallback 策略（Four.meme/Flap）
  - **效果**：
    - 未迁移代币正确使用 Four.meme 或 Flap 通道
    - 避免 4-5 秒的无效 Pancake 路由查询
    - 交易成功率提升
- **🐛 已迁移代币缓存污染问题** - 修复代币迁移后缓存仍保留旧通道信息的问题
  - **问题**：代币从 Four.meme 迁移到 Pancake 后，缓存仍保留 Four.meme 的合约地址
  - **后果**：
    - 缓存复用失败，每次都需要重新查询路由（3-4 秒）
    - 日志显示 `routerAddress=0x5c952063`（Four.meme 合约）而非 Pancake 路由器
    - 缓存提示"路由缓存有效"但实际无法使用
  - **修复**：
    - 在缓存复用前验证 routerAddress 是否属于 Pancake
    - 如果不匹配，自动清除无效缓存
    - 避免跨通道缓存污染
  - **效果**：
    - 已迁移代币第二次交易：从 3-4 秒降至 50-200ms
    - 性能提升：约 95%
    - 确保缓存始终有效
- **🐛 卖出路由缓存优化** - 修复卖出交易缓存不生效的问题
  - **问题**：卖出时即使有缓存，仍需要几秒查询路由
  - **原因**：
    - 卖出流程先用预估金额查询路由（更新缓存）
    - 然后用实际金额重新查询（缓存刚更新，但金额不同）
    - 导致缓存验证失败，触发完整的路由查询
  - **修复**：
    - 检测是否有有效的卖出路由缓存
    - 如果有缓存且预估精度高，直接使用实际金额查询（复用缓存）
    - 避免先用预估金额查询再重查的双重查询
  - **效果**：
    - 第二次及后续卖出：从 3-5 秒降至 50-200ms
    - 性能提升：约 95%
    - 卖出速度与买入一致
- **🐛 缓存复用顺序优化** - 修复 V2 已知失败时仍尝试 V2 路由的问题
  - **问题**：即使 V2 已知失败，缓存复用时仍先尝试 V2，导致触发 quote token discovery（耗时 7 秒）
  - **原因**：缓存复用逻辑先尝试 V2，再尝试 V3，没有检查失败状态
  - **修复**：
    - 检查 V2 失败状态（`v2BuyFailed` / `v2SellFailed`）
    - 如果 V2 已知失败或 lastMode 是 v3，优先尝试 V3 缓存
    - 只有在 V2 未知失败时才尝试 V2 缓存
  - **效果**：
    - V2 失败的代币卖出：从 7 秒降至 50-200ms
    - 性能提升：约 97%
    - 避免不必要的路径检测
- **🐛 未迁移代币卖出重查优化** - 修复 Flap 通道每次都重新查询报价的问题
  - **问题**：未迁移代币（four/flap）卖出时，即使差异很小也会重新查询报价
  - **原因**：
    - 重查条件：`amountToSell !== estimatedAmount`
    - 实际金额和预估金额几乎不可能完全相等
    - 导致每次都触发重查（额外 200-300ms）
  - **修复**：
    - 添加差异百分比判断（与 Pancake 一致）
    - 只有差异 > 5-10% 才重新查询
    - 差异在阈值内直接使用预估报价
  - **效果**：
    - 未迁移代币卖出：减少 200-300ms 不必要延迟
    - 性能提升：约 30-50%
    - 与 Pancake 逻辑保持一致

### Added
- **🚀 路由预加载状态管理** - 完整的预加载状态跟踪和等待机制
  - **功能**：
    - 添加 `loading` 状态：标记路由正在预加载中
    - 添加 `waitForRouteLoading` 函数：等待预加载完成（最多10秒）
    - 交易时自动检测预加载状态并等待
  - **工作流程**：
    1. 买入交易发送时，并发预加载卖出路由（设置 `sellRouteStatus = 'loading'`）
    2. 用户点击卖出时，检测到 `loading` 状态
    3. 自动等待预加载完成（最多10秒，每100ms检查一次）
    4. 预加载完成后，直接使用缓存路由
    5. 超时后自动降级到正常查询（3-4秒）
  - **状态缓存**：
    - 所有状态持久化到 `chrome.storage.local`
    - 包括：`buyRouteStatus`, `sellRouteStatus`, `buyRouteLoadedAt`, `sellRouteLoadedAt`
    - 浏览器关闭后仍然有效
  - **效果**：
    - 买入后立即卖出：无需等待路由查询
    - 预加载进行中：自动等待完成（最多10秒）
    - 预加载失败/超时：自动降级到正常查询
    - 用户体验更流畅
- **🔄 路由缓存主动刷新机制** - 混合策略确保缓存始终有效
  - **策略1：页面可见性检测**
    - 用户切回页面时，自动检查缓存是否过期
    - 过期则立即后台刷新
  - **策略2：定时检查（每5分钟）**
    - 检查缓存是否即将过期（还有5分钟）
    - 提前刷新，避免用户交易时缓存过期
    - 仅在页面可见时执行，节省资源
  - **效果**：
    - 停留超过1小时后交易：仍然快速（50-200ms）
    - 用户无感知的后台刷新
    - 避免第一次交易变慢的问题

### Performance
- **🚀 Four.meme 已迁移代币路由优化** - 利用固定规则优先尝试 QuoteToken 路径
  - **背景**：Four.meme 已迁移代币在 Pancake V2 上创建的流动性池是：`Token ↔ QuoteToken`
  - **优化前**：
    - 首先尝试 `WBNB → Token`（直接路径，通常失败）
    - 然后尝试所有桥接路径（USDT、USDC、BUSD、ASTER 等）
    - 浪费大量时间和 RPC 请求
  - **优化后**：
    - 从 tokenInfo 获取 quoteToken 信息
    - 如果 quoteToken 不是 WBNB，优先尝试 `WBNB → QuoteToken → Token` 路径
    - 如果 quoteToken 是 WBNB，使用直接路径
    - 命中正确路径后立即返回，不再尝试其他路径
  - **效果**：
    - Four.meme 已迁移代币首次买入：从 3-4 秒降至 **0.5-1 秒**
    - Four.meme 已迁移代币首次卖出：从 3-5 秒降至 **0.5-1 秒**
    - 性能提升：**75-85%**
    - 减少 RPC 请求次数：约 **80%**
- **🚀 路由缓存有效期机制** - 1 小时内自动复用缓存路由
  - **问题**：即使路由已缓存，每次交易仍需重新查询验证
  - **修复**：
    - 添加路由加载时间戳（buyRouteLoadedAt/sellRouteLoadedAt）
    - 1 小时内的缓存路由直接复用，无需重新查询
    - 超过 1 小时自动重新查询并更新缓存
    - 导出 `checkRouteCache` 函数供预加载使用
  - **效果**：
    - 1 小时内的重复交易：从 200ms 降至 50-100ms
    - 性能提升：约 50-75%
    - 用户体验更流畅
- **🚀 路由失败缓存** - 跳过已知会失败的路由查询
  - **问题**：V2 路由失败后，每次交易仍重复尝试所有路径，耗时 3.7 秒
  - **原因**：只缓存成功的路径，不缓存失败结果
  - **修复**：
    - 记录 V2/V3 的失败状态到缓存
    - 下次交易时，如果 V2 已知失败且 V3 有缓存，直接跳过 V2 查询
    - 失败状态随缓存持久化保存
  - **效果**：
    - 只有 V3 可用的代币：从 4 秒降至 200ms
    - 性能提升：约 95%
    - 第二次及后续交易始终快速响应
- **🚀 路由缓存持久化** - 缓存不再因浏览器关闭或时间间隔而失效
  - **问题**：路由缓存存储在内存中，Service Worker 终止后丢失
  - **影响场景**：
    - Service Worker 空闲 30 秒后被终止
    - 关闭浏览器
    - 扩展重新加载
    - 切换代币后再切回来
  - **修复**：
    - 使用 `chrome.storage.local` 持久化存储路由缓存
    - 启动时自动加载缓存
    - 更新路由时自动保存到存储
    - 缓存有效期：7 天
    - 最多缓存 100 个代币
  - **效果**：
    - 关闭浏览器后重新打开，缓存仍然有效
    - 长时间不用后再次交易，仍使用缓存路由
    - 第二次及后续交易始终保持 1-2 秒的快速响应
- **🚀 V3 路由查询性能优化** - 解决首次交易 14 秒延迟问题
  - **问题**：V3 多跳路由查询耗时 14.5 秒，导致首次交易极慢
  - **原因**：
    - 顺序评估所有桥接代币（7-10 个），每个需要 2-3 次 RPC 调用
    - 某些 RPC 调用超时或响应慢，但没有超时机制
    - 总耗时 = 桥接代币数量 × 单个评估时间（可能 1-2 秒）
  - **修复**：
    - **并行评估**：所有桥接代币路由同时查询，而非顺序
    - **超时机制**：单个桥接代币评估最多 2 秒，直接路由最多 3 秒
    - **详细日志**：记录每个路由评估的耗时，便于诊断
  - **性能提升**：
    - V3 查询时间：从 14500ms 降至 2000-3000ms
    - 首次交易时间：从 15 秒降至 3-4 秒
    - 性能提升：约 75%
  - **影响**：大幅提升首次交易速度，避免用户等待过久
- **🚀 V2 路径查询优化** - 直接路径成功后不再尝试其他路径
  - **问题**：V2 查询耗时 1000ms，尝试了 24 个失败的多跳路径
  - **原因**：即使直接路径已经成功，系统仍然尝试所有其他路径
  - **修复**：直接路径成功后立即返回，不再尝试其他路径
  - **性能提升**：
    - V2 查询时间：从 1000ms 降至 100-200ms
    - 总查询时间：从 1000ms 降至 500-600ms
    - 性能提升：约 50%
  - **影响**：大幅提升首次交易速度，减少不必要的 RPC 调用
- **🚀 并行路由查询优化** - 提升 50% 首次交易速度
  - 使用 Promise.allSettled 并行执行 V2 和 V3 查询
  - **之前**：顺序执行，总时间 = V2时间 + V3时间 (约 1000-2000ms)
  - **现在**：并行执行，总时间 = max(V2时间, V3时间) (约 500-1000ms)
  - **性能提升**：约 50%
  - 不影响路由选择逻辑，仍然选择最优路由
- **混合路由检测性能优化** - 大幅提升首次交易速度
  - 只在 V2 和 V3 都失败后才检测混合路由，避免不必要的 RPC 调用
  - 移除 V3 路由失败时的混合路由检测，减少 10-40 次 RPC 请求
  - 优化后，普通代币首次交易速度恢复到优化前水平（< 2 秒）
  - 只有真正需要混合路由的代币才会触发检测
- **3-hop 路由支持** - 支持复杂的多跳交易路径
  - 自动发现代币的 quote token（募集币种）
  - 构建 WBNB → Bridge → QuoteToken → Token 的 3-hop 路径
  - 当标准 2-hop 路径失败时自动回退到 3-hop 路径
  - 支持与非主流代币配对的代币交易（如 UDOG-USAT）
  - 智能路径评估，选择最优路由
- **扩展桥接代币支持** - 支持更多非标准流动性池代币
  - 新增 USAT (0xdb7a6d5a127ea5c0a3576677112f13d731232a27) 作为桥接代币
  - 支持与 USAT 配对的代币交易路由
  - 自动发现和使用非标准桥接代币路径
  - 解决代币与非主流币种配对时路由失败的问题
- **非 BNB 筹集币种性能优化** - 大幅提升非 BNB 筹集币种首次交易速度
  - 添加 USD1 (0x8d0D000Ee44948FC98c9B98A4FA4921476f08B0d) 到 quote token 发现列表
  - 添加 UNITED_STABLES_U (0xcE24439F2D9C6a2289F741120FE202248B666666) 到发现列表
  - 避免触发昂贵的 3-hop 路径回退机制
  - 使用 USD1 作为筹集币种的代币首次交易速度提升 80-90%
  - 从 10-20 秒降至 1-2 秒
- **交易流程性能监控** - 添加详细的交易步骤计时日志
  - 记录路由查询耗时
  - 记录交易发送耗时
  - 记录买入交易总耗时
  - 帮助诊断性能瓶颈

### Fixed
- **🚨🚨🚨 严重修复：完全禁用强制路由模式** - 彻底解决路由锁定问题
  - **根本原因**：V3 路由成功但报价极差（仅为 V2 的 1/10），强制模式未被清除
  - **之前的修复**：只在 V3 失败时清除强制模式（不够彻底）
  - **最终解决方案**：
    - **完全忽略 forcedMode**，无论其值是什么
    - 检测到 forcedMode 时立即清除并发出警告
    - **始终同时尝试 V2 和 V3**
    - **始终比较两者的输出金额**
    - **始终选择输出金额最大的路由**
  - **权衡**：
    - 每次交易增加 100-200ms 路由查询时间
    - 但避免了 90% 的资金损失风险
    - 这是值得的安全权衡
  - **影响**：彻底消除强制模式导致的资金损失风险
- **🚨 严重修复：路由选择缺陷导致交易亏损** - 修复 V2/V3 路由选择逻辑
  - **问题**：系统采用"先到先得"策略，只要找到第一个可用路由就立即使用
  - **后果**：当 V3 池流动性极低时，会选择 V3 而忽略流动性更好的 V2 池
  - **实际案例**：用户交易代币 0xe1e93e92c0c2aff2dc4d7d4a8b250d973cad4444 时，V3 输出仅为 V2 的 1/10
  - **修复**：改为"比较最优"策略
    - 同时尝试 V2 和 V3 路由
    - 比较两者的输出金额（amountOut）
    - 选择输出金额最大的路由
    - 记录改进百分比（bps）到日志
  - **影响**：所有 PancakeSwap 交易都将自动选择最优路由
  - **安全性**：避免因路由选择不当导致的资金损失

### Added
- **混合 V2/V3 路由自动执行** - 自动执行需要混合路由的代币交易
  - 自动检测需要同时使用 V2 和 V3 池的交易路径
  - 识别 V3 → V2 和 V2 → V3 的混合路径
  - **两步交易自动执行**
    - 第一步：执行 V3 swap（WBNB → 桥接代币）
    - 等待第一步交易确认
    - 查询实际获得的桥接代币数量
    - 自动授权桥接代币给 V2 Router
    - 第二步：执行 V2 swap（桥接代币 → 目标代币）
  - 支持 UDOG-USAT 等需要混合路由的代币交易
  - 买入功能完全支持，卖出功能暂不支持
  - 添加 `swapExactTokensForTokens` 函数到 Router ABI，支持 token-to-token 交换

### Performance
- **🚀 V2 路径查询优化** - 直接路径成功后不再尝试其他路径
  - **问题**：V2 查询耗时 1000ms，尝试了 24 个失败的多跳路径
  - **原因**：即使直接路径已经成功，系统仍然尝试所有其他路径
  - **修复**：直接路径成功后立即返回，不再尝试其他路径
  - **性能提升**：
    - V2 查询时间：从 1000ms 降至 100-200ms
    - 总查询时间：从 1000ms 降至 500-600ms
    - 性能提升：约 50%
  - **影响**：大幅提升首次交易速度，减少不必要的 RPC 调用
- **🚀 并行路由查询优化** - 提升 50% 首次交易速度
  - 使用 Promise.allSettled 并行执行 V2 和 V3 查询
  - **之前**：顺序执行，总时间 = V2时间 + V3时间 (约 1000-2000ms)
  - **现在**：并行执行，总时间 = max(V2时间, V3时间) (约 500-1000ms)
  - **性能提升**：约 50%
  - 不影响路由选择逻辑，仍然选择最优路由
- **混合路由检测性能优化** - 大幅提升首次交易速度
  - 只在 V2 和 V3 都失败后才检测混合路由，避免不必要的 RPC 调用
  - 移除 V3 路由失败时的混合路由检测，减少 10-40 次 RPC 请求
  - 优化后，普通代币首次交易速度恢复到优化前水平（< 2 秒）
  - 只有真正需要混合路由的代币才会触发检测
- **3-hop 路由支持** - 支持复杂的多跳交易路径
  - 自动发现代币的 quote token（募集币种）
  - 构建 WBNB → Bridge → QuoteToken → Token 的 3-hop 路径
  - 当标准 2-hop 路径失败时自动回退到 3-hop 路径
  - 支持与非主流代币配对的代币交易（如 UDOG-USAT）
  - 智能路径评估，选择最优路由
- **扩展桥接代币支持** - 支持更多非标准流动性池代币
  - 新增 USAT (0xdb7a6d5a127ea5c0a3576677112f13d731232a27) 作为桥接代币
  - 支持与 USAT 配对的代币交易路由
  - 自动发现和使用非标准桥��代币路径
  - 解决代币与非主流币种配对时路由失败的问题
- **非 BNB 筹集币种性能优化** - 大幅提升非 BNB 筹集币种首次交易速度
  - 添加 USD1 (0x8d0D000Ee44948FC98c9B98A4FA4921476f08B0d) 到 quote token 发现列表
  - 添加 UNITED_STABLES_U (0xcE24439F2D9C6a2289F741120FE202248B666666) 到发现列表
  - 避免触发昂贵的 3-hop 路径回退机制
  - 使用 USD1 作为筹集币种的代币首次交易速度提升 80-90%
  - 从 10-20 秒降至 1-2 秒


## [Unreleased]

### Planned
- Luna.fun trading support
- Multi-wallet management
- Trading bot features
- Chrome Web Store publication


## [1.1.6] - 2025-01-27

### Added
- **卖出交易性能优化** - 提升卖出交易速度和响应性
  - Background handler 并发执行 quote balance 查询和卖出交易
  - Router Channel (Pancake) 并发执行 prepareTokenSell 和 findBestRoute
  - Quote Portal Channel (Flap) 并发执行 prepareTokenSell 和 getQuote
  - **新增：并行查询 V2 和 V3 授权**
    - 在查询路由的同时并行查询两个授权
    - 避免等待路由结果后再查询授权
    - 消除 V3 授权重查的 20-50ms 延迟
  - **新增：授权状态缓存机制**
    - 整合现有的代币授权缓存系统
    - 优先使用 tokenInfo 中的授权信息（来自 background 缓存）
    - 其次使用 trading-channels 层的授权缓存
    - 最后才查询链上授权状态
    - 首次卖出时如果已授权，直接使用缓存，无需链上查询
    - 第二次及后续卖出时直接使用缓存，无需链上查询
    - 消除已授权场景下的 40-100ms 授权查询延迟
    - 授权成功后自动更新缓存
    - 撤销授权后自动清除缓存
    - 前端获取代币信息时同时获取授权状态
  - 预期性能提升 30-50%（首次卖出），50-70%（已授权场景）
- **买入/卖出后快速余额更新机制**
  - 买入/卖出成功后启动快速轮询（每1秒查询一次）
  - 持续10秒或直到检测到余额变化后自动停止
  - 同时支持 SidePanel 和浮动窗口
  - 大幅提升余额更新速度，从10-15秒降至1-3秒

### Fixed
- **代币切换后立即交易失败问题**
  - 修复用户切换到新代币后，前 2-3 次点击买入立即失败的问题
  - 错误信息："检测到代币已切换，请刷新页面后重试"
  - 修改 ensureTradeTokenContext 函数，检测到代币切换时直接更新上下文而不是抛出错误
  - 允许用户在切换代币后立即交易，无需等待或重试
- **"迁移中"状态交易锁定问题**
  - 移除"迁移中"状态的交易锁定
  - "迁移中"是短暂的过渡状态（通常只有几秒），不应阻止用户交易
  - 提升用户体验，减少不必要的交易限制
- **买入后立即卖出失败问题**
  - 修复买入成功后立即卖出时提示"代币余额为0，无法卖出"的问题
  - 检测待确认的买入交易，允许在余额更新前立即卖出
  - 同时修复浮动窗口和 SidePanel 的卖出逻辑
  - 提升交易连续性和用户体验

### Changed
- **调试日志优化**
  - 将详细错误上下文日志从 logger.error 降级为 logger.debug
  - 保持关键错误日志为 logger.error 级别
  - 减少生产环境控制台噪音，避免影响交易性能

## [1.1.5] - 2025-01-26

### Added
- **交易性能优化系统** - 全面提升交易速度和用户体验
  - 路由信息永久缓存机制
    - 已迁移代币使用永久缓存，0ms 查询时间
    - 未迁移代币智能检测迁移状态变化
    - 支持多代币并存（使用 tokenAddress 作为键）
    - 支持多标签页（每个代币独立缓存）
    - 自动清理机制（最多缓存 50 个代币）
  - 页面切换预加载优化
    - URL 变化时后台预加载代币余额
    - 预加载 quote token 余额
    - 预加载授权状态
    - 异步执行，不阻塞主流程
  - 并发查询优化
    - Four Quote Bridge 价格估算和余额查询并发执行
    - Flap Quote Agent 自动受益
  - 性能监控文档
    - 完整的性能调查报告 (`docs/trade-performance-investigation.md`)
    - 详细的优化执行计划 (`docs/trade-performance-optimization-plan.md`)
    - 优化计划摘要 (`docs/trade-performance-optimization-plan-summary.md`)

### Changed
- **余额缓存策略优化**
  - 余额轮询间隔从 5 秒提高到 15 秒
  - 页面切换时立即更新余额
  - 交易后立即更新余额
  - 减少 40% 余额查询次数
- **迁移检测优化**
  - 迁移中代币检测间隔从 0.7 秒优化至 0.5 秒
  - 更快速地检测代币迁移完成
  - 及时切换到 Pancake 通道
- **构建配置优化**
  - 抑制第三方依赖 ox 包的 PURE 注释警告
  - 更清晰的构建输出

### Fixed
- **后台标签页问题修复**
  - 修复右键在新标签页打开代币时，当前标签页代币信息被覆盖的问题
  - 只有可见标签页才同步代币上下文
  - 切换到后台标签页时自动同步该标签页的代币信息
- **迁移检测问题修复**
  - 修复已迁移代币未自动切换到 Pancake 通道的问题
  - 实现智能缓存策略：已迁移代币永久缓存，未迁移代币每次检测
  - 确保及时发现代币迁移状态变化
- **编译错误修复**
  - 修复 getQuoteBalance 参数缺失错误
  - 修复 FOUR_TOKEN_MANAGER 常量名称错误
  - 修复 checkTokenAllowance 函数不存在错误

### Performance
- **首次交易速度提升 60-70%**
  - 优化前：1600-3300ms
  - 优化后：< 1000ms
- **第二次交易速度提升**
  - 优化前：800-1600ms
  - 优化后：< 1000ms
- **切换代币/标签页**
  - 直接使用缓存，无需重新查询
  - 性能提升 100%
- **RPC 请求优化**
  - 减少 50% RPC 请求次数
  - 降低节点负载

## [1.1.4] - 2025-01-22

### Added
- **日夜间主题系统**
  - 完整的日间/夜间模式切换功能
  - Popup、SidePanel、Content Script 全局主题支持
  - 遵循 WCAG AAA 标准的颜色对比度设计
  - 平滑的主题切换过渡动画
- **RPC 请求优化分析报告**
  - 完整的 RPC 节点请求频率分析
  - 识别 42 个 RPC 调用位置
  - 提供优化建议，可减少 50-60% 请求量
  - 详细文档位于 `docs/rpc-request-optimization-report.md`

### Changed
- **UI 视觉优化**
  - SidePanel 选项卡按钮使用更亮的金黄色渐变
    - 夜间模式：amber-300 → amber-400 (更明亮的金黄色)
    - 日间模式：amber-50 → amber-100 (淡黄色)
  - Popup 界面主题切换图标底部对齐标题文字
  - 提升整体视觉一致性和美观度
- **主题系统颜色规范**
  - SidePanel 钱包地址在日间模式显示纯黑色 (#000000)
  - 钱包地址在夜间模式显示淡蓝色 (#86d9f9)
  - 所有主题颜色使用 CSS 变量统一管理
  - 确保所有界面元素正确响应主题切换

### Fixed
- **钱包地址颜色显示问题**
  - 修复 SidePanel 钱包地址在日间模式下显示淡蓝色的问题
  - 添加 `.wallet-link` 类的主题特定样式规则
  - 确保日间模式下钱包地址显示黑色，提升可读性
- **Popup 图标对齐问题**
  - 修复主题切换图标垂直居中问题
  - 改为底部对齐，与标题文字视觉平衡
- **选项卡按钮亮度问题**
  - 修复交易和配置选项卡按钮颜色过暗的问题
  - 调整为更明亮的渐变色，提升视觉吸引力

## [1.1.3] - 2025-01-17

### Added
- **新平台支持**
  - Axiom.trade 平台集成
  - Debot.ai 平台集成
  - 扩展支持的交易平台列表
- **钱包地址复制功能**
  - Popup 界面支持点击钱包地址一键复制
  - 复制成功/失败即时提示

### Changed
- **SidePanel 锁定遮罩优化**
  - 遮罩透明度提升至 98%，可清晰看到底层内容
  - 添加 4px 轻微模糊效果（glassmorphism 设计）
  - 锁定提示文字样式与 Tab 标题保持一致（黄色 #facc15）
  - 移除消息背景框，添加文字阴影提升可读性
  - 遮罩仅覆盖交易 Tab 内容区域，不影响导航和信息栏
- **浮动窗口输入框优化**
  - 输入框宽度自适应，填充剩余空间
  - 固定值按钮保持 50px 一致宽度
- **Popup UI 优化**
  - 二级按钮使用蓝色渐变背景
  - 提升视觉层次和交互体验

### Fixed
- **SidePanel 锁定遮罩显示问题**
  - 添加钱包状态轮询机制（每 3 秒检查一次）
  - SidePanel 作为特殊扩展页面无法接收广播消息，改用主动轮询
  - 添加页面可见性监听，自动暂停/恢复轮询以节省资源
  - 添加详细调试日志，便于问题排查
- **空指针错误修复**
  - 修复钱包状态处理中的 "Cannot read properties of null (reading 'address')" 错误
  - 在 `src/content/index.ts` 中添加可选链操作符（?.）
  - 确保安全访问可能为 null 的对象属性

## [1.1.2] - 2025-01-16

### Added
- **代币授权管理功能** - 全新的授权控制和管理界面
  - 三种自动授权模式配置
    - `buy` - 买入时自动授权
    - `sell` - 卖出时自动授权
    - `switch` - 切换通道时自动授权
  - 实时授权状态显示
    - 链上授权状态查询
    - "已授权"/"授权中..."状态提示
  - 手动授权/撤销功能
    - 一键手动授权代币
    - 一键撤销代币授权
    - 区分授权和撤销操作的 UI 显示
  - 授权状态缓存失效机制
    - 授权/撤销后自动清除缓存
    - 确保显示最新链上状态

### Changed
- 优化授权状态查询逻辑，改为查询实际链上状态而非假设状态
- 授权按钮样式优化，绿色授权按钮，红色撤销按钮
- "已授权"状态显示为纯文本，无背景色

### Fixed
- 修复手动授权后状态不更新的问题
- 修复买入时自动授权 UI 状态不显示的问题

## [1.1.1] - 2025-01-07

### Added
- **RPC 节点设置界面** - 在解锁界面提供 RPC 节点配置
  - 无需解锁钱包即可更改 RPC 节点
  - 支持自定义 BSC RPC 节点地址
  - 一键恢复默认节点
- **浮动窗口增强**
  - 买卖按钮显示交易计时器（精确到 0.1 秒）
  - 标题行显示 BNB 余额和代币余额
  - 实时余额更新

### Changed
- **统一 RPC 配置管理**
  - RPC 设置统一使用 `UserSettings.system.primaryRpc`
  - 移除冗余的 `customRpcUrl` 存储逻辑
  - 简化 RPC 节点优先级处理流程

### Fixed
- 修复浮动窗口按钮重复交易问题
- 修复交易计时显示超出按钮宽度
- 优化 RPC 设置界面关闭按钮样式

## [1.1.0] - 2025-01-05

### Added
- **浮动交易窗口** - 全新的轻量级交易界面
  - 可拖拽浮动窗口，支持收起/展开
  - 智能位置记忆，窗口状态持久化
  - 页面刷新后自动恢复窗口状态
  - GPU 加速拖拽，60fps 流畅动画
  - 自动适应浏览器窗口大小变化
  - 横向拖拽手柄 (⋯) 设计
- **智能内容脚本注入**
  - 自动检测内容脚本加载状态
  - 动态注入机制，无需手动刷新页面
  - 降低用户操作门槛
- **性能优化**
  - 使用 `transform` 替代 `left/top` 实现 GPU 加速
  - `requestAnimationFrame` 批处理拖拽更新
  - Pointer Events API 提升触控设备体验
  - ResizeObserver 监听视口变化
- **调试日志优化**
  - 交易监听日志降级为 debug 模式
  - 生产环境减少控制台噪音
  - 保持开发调试能力

### Changed
- 浮动窗口在代币切换时保持打开状态
- 浮动窗口在非代币页面保留之前状态
- 优化浮动窗口拖拽性能和流畅度
- 改进窗口边界检测逻辑

### Fixed
- 修复 "Could not establish connection" 连接错误
- 修复浏览器窗口缩放时浮动窗口位置错位
- 修复代币切换后交易失败的问题
- 修复页面刷新后浮动窗口消失的问题

### Documentation
- 新增[浮动窗口使用指南](docs/floating-window.md)
- README 添加浮动窗口界面展示
- 完善核心界面截图展示
- 文档统一迁移至 `docs/` 目录，采用 kebab-case 命名规范

## [1.0.0] - 2024-12-31

### Added
- Initial release of BSC Dog Bang Plugin
- Wallet management (import, lock, unlock)
- Four.meme trading integration
  - Buy tokens with BNB
  - Sell tokens for BNB
  - Real-time price quotes
- Flap.sh trading support
  - Native BNB swap
  - Token trading
- PancakeSwap integration
  - Any BEP20 token swap
  - Automatic path finding
- Content script injection on supported websites
  - gmgn.ai
  - four.meme
  - flap.sh
  - web3.binance.com
- Chrome extension UI
  - Popup wallet interface
  - Side panel trading panel (Chrome 114+)
- Security features
  - AES-256-GCM encryption for private keys
  - Password protection
  - Automatic wallet lock on refresh
- Transaction monitoring
  - WebSocket real-time tracking
  - HTTP polling fallback
  - Transaction status notifications
- Performance optimization
  - Promise deduplication
  - RPC request caching
  - Smart gas estimation
- Developer tools
  - Debug logging system
  - Performance monitoring
  - Detailed error messages

### Security
- Private keys encrypted and stored locally only
- No data sent to external servers
- Password-protected wallet access

## [0.9.0-beta] - 2024-12-25

### Added
- Beta release for testing
- Basic wallet functionality
- Four.meme buy/sell
- PancakeSwap integration

### Fixed
- Gas estimation issues
- Balance display bugs
- Transaction status tracking

## [0.8.0-alpha] - 2024-12-20

### Added
- Alpha testing release
- Wallet import and encryption
- Basic trading UI
- Content script injection

### Known Issues
- Occasional RPC connection failures
- UI responsiveness on slow networks

---

## Version History

- `1.1.6` - Sell performance & token switch fix (2025-01-27)
- `1.1.5` - Trading performance optimization (2025-01-26)
- `1.1.4` - Light/Dark theme system & UI optimization (2025-01-22)
- `1.1.3` - Platform support & UI optimization (2025-01-17)
- `1.1.2` - Token approval management (2025-01-16)
- `1.1.1` - RPC configuration management (2025-01-07)
- `1.1.0` - Floating trading window (2025-01-05)
- `1.0.0` - First stable release (2024-12-31)
- `0.9.0-beta` - Beta testing (2024-12-25)
- `0.8.0-alpha` - Alpha testing (2024-12-20)

## Upgrade Guide

### From 1.1.5 to 1.1.6

1. Download version 1.1.6 from Releases
2. Remove old version from Chrome
3. Load new version
4. 卖出交易性能优化自动生效
5. 代币切换后可立即交易，无需等待或重试
6. "迁移中"状态不再阻止交易

### From 1.1.4 to 1.1.5

1. Download version 1.1.5 from Releases
2. Remove old version from Chrome
3. Load new version
4. 交易性能优化自动生效
5. 首次交易速度提升 60-70%
6. 支持多代币和多标签页缓存
7. 迁移检测更加快速准确

### From 1.1.3 to 1.1.4

1. Download version 1.1.4 from Releases
2. Remove old version from Chrome
3. Load new version
4. 日夜间主题系统自动启用
5. Popup 和 SidePanel 界面支持主题切换
6. 所有界面元素自动适配当前主题
7. 可在 Popup 右上角点击图标切换主题

### From 1.1.2 to 1.1.3

1. Download version 1.1.3 from Releases
2. Remove old version from Chrome
3. Load new version
4. 钱包锁定遮罩显示修复自动生效
5. 新平台（Axiom.trade、Debot.ai）支持自动启用
6. Popup 界面点击钱包地址即可复制

### From 1.1.1 to 1.1.2

1. Download version 1.1.2 from Releases
2. Remove old version from Chrome
3. Load new version
4. 代币授权管理功能自动启用
5. 可在设置中配置自动授权模式（buy/sell/switch）
6. 交易面板将显示授权状态和管理按钮

### From 1.1.0 to 1.1.1

1. Download version 1.1.1 from Releases
2. Remove old version from Chrome
3. Load new version
4. RPC 配置会自动迁移到新的统一存储
5. 在解锁界面可以修改 RPC 节点设置

### From 1.0.x to 1.1.0

1. Download version 1.1.0 from Releases
2. Remove old version from Chrome
3. Load new version
4. Unlock wallet with existing password
5. Try new floating trading window feature

### From 0.9.x to 1.0.0

1. Backup your wallet private key
2. Remove old version
3. Install version 1.0.0
4. Import wallet with same password
5. Test with small transaction

### Breaking Changes

None in 1.0.0 release.

## Support

- Issues: https://github.com/0xyaofan/bsc-dog-bang-plugin/issues
- Documentation: https://github.com/0xyaofan/bsc-dog-bang-plugin/tree/main/docs

---

[Unreleased]: https://github.com/0xyaofan/bsc-dog-bang-plugin/compare/v1.1.6...HEAD
[1.1.6]: https://github.com/0xyaofan/bsc-dog-bang-plugin/releases/tag/v1.1.6
[1.1.5]: https://github.com/0xyaofan/bsc-dog-bang-plugin/releases/tag/v1.1.5
[1.1.4]: https://github.com/0xyaofan/bsc-dog-bang-plugin/releases/tag/v1.1.4
[1.1.3]: https://github.com/0xyaofan/bsc-dog-bang-plugin/releases/tag/v1.1.3
[1.1.2]: https://github.com/0xyaofan/bsc-dog-bang-plugin/releases/tag/v1.1.2
[1.1.1]: https://github.com/0xyaofan/bsc-dog-bang-plugin/releases/tag/v1.1.1
[1.1.0]: https://github.com/0xyaofan/bsc-dog-bang-plugin/releases/tag/v1.1.0
[1.0.0]: https://github.com/0xyaofan/bsc-dog-bang-plugin/releases/tag/v1.0.0
[0.9.0-beta]: https://github.com/0xyaofan/bsc-dog-bang-plugin/releases/tag/v0.9.0-beta
[0.8.0-alpha]: https://github.com/0xyaofan/bsc-dog-bang-plugin/releases/tag/v0.8.0-alpha
