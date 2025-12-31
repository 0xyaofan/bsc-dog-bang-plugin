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

- `1.0.0` - First stable release (2024-12-31)
- `0.9.0-beta` - Beta testing (2024-12-25)
- `0.8.0-alpha` - Alpha testing (2024-12-20)

## Upgrade Guide

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

[Unreleased]: https://github.com/0xyaofan/bsc-dog-bang-plugin/compare/v1.0.0...HEAD
[1.0.0]: https://github.com/0xyaofan/bsc-dog-bang-plugin/releases/tag/v1.0.0
[0.9.0-beta]: https://github.com/0xyaofan/bsc-dog-bang-plugin/releases/tag/v0.9.0-beta
[0.8.0-alpha]: https://github.com/0xyaofan/bsc-dog-bang-plugin/releases/tag/v0.8.0-alpha
