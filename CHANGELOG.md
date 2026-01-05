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

- `1.1.0` - Floating trading window (2025-01-05)
- `1.0.0` - First stable release (2024-12-31)
- `0.9.0-beta` - Beta testing (2024-12-25)
- `0.8.0-alpha` - Alpha testing (2024-12-20)

## Upgrade Guide

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

[Unreleased]: https://github.com/0xyaofan/bsc-dog-bang-plugin/compare/v1.1.0...HEAD
[1.1.0]: https://github.com/0xyaofan/bsc-dog-bang-plugin/releases/tag/v1.1.0
[1.0.0]: https://github.com/0xyaofan/bsc-dog-bang-plugin/releases/tag/v1.0.0
[0.9.0-beta]: https://github.com/0xyaofan/bsc-dog-bang-plugin/releases/tag/v0.9.0-beta
[0.8.0-alpha]: https://github.com/0xyaofan/bsc-dog-bang-plugin/releases/tag/v0.8.0-alpha
