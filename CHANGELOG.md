# Changelog

All notable changes to BSC Dog Bang Plugin will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Planned
- Luna.fun trading support
- Multi-wallet management
- Trading bot features
- Chrome Web Store publication

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

- `1.1.4` - Light/Dark theme system & UI optimization (2025-01-22)
- `1.1.3` - Platform support & UI optimization (2025-01-17)
- `1.1.2` - Token approval management (2025-01-16)
- `1.1.1` - RPC configuration management (2025-01-07)
- `1.1.0` - Floating trading window (2025-01-05)
- `1.0.0` - First stable release (2024-12-31)
- `0.9.0-beta` - Beta testing (2024-12-25)
- `0.8.0-alpha` - Alpha testing (2024-12-20)

## Upgrade Guide

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

[Unreleased]: https://github.com/0xyaofan/bsc-dog-bang-plugin/compare/v1.1.4...HEAD
[1.1.4]: https://github.com/0xyaofan/bsc-dog-bang-plugin/releases/tag/v1.1.4
[1.1.3]: https://github.com/0xyaofan/bsc-dog-bang-plugin/releases/tag/v1.1.3
[1.1.2]: https://github.com/0xyaofan/bsc-dog-bang-plugin/releases/tag/v1.1.2
[1.1.1]: https://github.com/0xyaofan/bsc-dog-bang-plugin/releases/tag/v1.1.1
[1.1.0]: https://github.com/0xyaofan/bsc-dog-bang-plugin/releases/tag/v1.1.0
[1.0.0]: https://github.com/0xyaofan/bsc-dog-bang-plugin/releases/tag/v1.0.0
[0.9.0-beta]: https://github.com/0xyaofan/bsc-dog-bang-plugin/releases/tag/v0.9.0-beta
[0.8.0-alpha]: https://github.com/0xyaofan/bsc-dog-bang-plugin/releases/tag/v0.8.0-alpha
