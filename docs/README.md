# Documentation

Welcome to the BSC Dog Bang Plugin documentation!

## Quick Links

- [README](../README.md) - Project overview and quick start
- [CHANGELOG](../CHANGELOG.md) - Version history and updates
- [CONTRIBUTING](../CONTRIBUTING.md) - How to contribute
- [LICENSE](../LICENSE) - MIT License

## User Documentation

### Getting Started
- [User Guide](user-guide.md) - Complete user manual
  - Installation
  - Wallet setup
  - Trading guide
  - Security tips
  - Troubleshooting

### Features
- [Feature Documentation](features.md) - Detailed feature descriptions
  - Multi-platform support
  - Wallet management
  - Trading capabilities
  - Advanced features

## Developer Documentation

### Setup and Configuration
- [Environment Setup](setup.md) - Development environment configuration
  - System requirements
  - Dependencies installation
  - IDE configuration
  - Network setup

### Development
- [Development Guide](development.md) - Developer handbook
  - Project architecture
  - Code structure
  - Development workflow
  - Coding standards
  - Debugging tips

### Deployment
- [Deployment Guide](deployment.md) - Build and release guide
  - Build process
  - Packaging for release
  - GitHub Releases
  - Chrome Web Store
  - CI/CD setup

## API Documentation

- [Four.meme API](../doc/Four-MEME-API-Documents.30-10-2025.md) - Four.meme platform API documentation

## Project Structure

```
bsc-dog-bang-plugin/
├── docs/                    # 📚 Documentation
│   ├── README.md           # This file
│   ├── features.md         # Feature documentation
│   ├── setup.md            # Environment setup
│   ├── development.md      # Development guide
│   ├── deployment.md       # Deployment guide
│   └── user-guide.md       # User manual
│
├── src/                    # 💻 Source code
│   ├── background/         # Service Worker
│   ├── content/            # Content scripts
│   ├── popup/              # Popup UI
│   ├── sidepanel/          # Side panel UI
│   ├── offscreen/          # Offscreen document
│   └── shared/             # Shared modules
│
├── extension/              # 🔌 Extension files
│   ├── manifest.json       # Extension manifest
│   ├── icons/              # Icon assets
│   └── dist/               # Build output
│
├── abis/                   # 📜 Contract ABIs
├── scripts/                # 🛠️ Build scripts
├── .github/                # ⚙️ GitHub configuration
│   ├── workflows/          # CI/CD workflows
│   └── ISSUE_TEMPLATE/     # Issue templates
│
├── README.md               # Main README
├── CHANGELOG.md            # Version history
├── CONTRIBUTING.md         # Contribution guide
├── LICENSE                 # MIT License
└── package.json            # Project config
```

## Documentation Guidelines

### For Users

If you're a user looking to:
- **Install and use the plugin**: Start with [User Guide](user-guide.md)
- **Understand features**: Read [Features](features.md)
- **Troubleshoot issues**: Check [User Guide - Troubleshooting](user-guide.md#故障排除)

### For Contributors

If you want to contribute:
1. Read [CONTRIBUTING.md](../CONTRIBUTING.md)
2. Setup your environment: [Setup Guide](setup.md)
3. Understand the architecture: [Development Guide](development.md)
4. Follow deployment process: [Deployment Guide](deployment.md)

### For Maintainers

If you're maintaining the project:
- **Release new version**: Follow [Deployment Guide](deployment.md)
- **Manage issues**: Use GitHub issue templates in `.github/ISSUE_TEMPLATE/`
- **Review PRs**: Use PR template in `.github/PULL_REQUEST_TEMPLATE.md`
- **Update changelog**: Keep [CHANGELOG.md](../CHANGELOG.md) up to date

## Documentation Maintenance

### Updating Documentation

When updating documentation:
1. Keep it concise and clear
2. Use examples and screenshots where helpful
3. Update table of contents
4. Check all links are working
5. Follow markdown best practices

### Documentation Standards

- Use clear headings (H1, H2, H3)
- Include code examples with syntax highlighting
- Add table of contents for long documents
- Use consistent formatting
- Keep line length reasonable
- Add emoji sparingly (only in headings/lists for visual aid)

### Style Guide

**Code blocks:**
```typescript
// TypeScript code with language tag
const example = "hello";
```

**Links:**
- Relative: `[Development Guide](development.md)`
- Absolute: `[GitHub](https://github.com/...)`

**Emphasis:**
- Bold: `**important**`
- Italic: `*emphasis*`
- Code: `` `code` ``

**Lists:**
- Unordered: `- Item`
- Ordered: `1. Item`
- Checklist: `- [ ] Task`

## Getting Help

### Documentation Issues

If you find issues with the documentation:
1. [Open an issue](https://github.com/0xyaofan/bsc-dog-bang-plugin/issues/new)
2. Use the label `documentation`
3. Describe what's unclear or incorrect
4. Suggest improvements

### Questions

For questions:
- Check [User Guide FAQ](user-guide.md#常见问题)
- Search [GitHub Issues](https://github.com/0xyaofan/bsc-dog-bang-plugin/issues)
- Create a new issue with `question` label

## Contributing to Documentation

We welcome documentation improvements!

**How to contribute:**
1. Fork the repository
2. Make changes to docs
3. Submit a pull request
4. Reference the issue (if any)

**What to contribute:**
- Fix typos or errors
- Improve clarity
- Add missing information
- Create tutorials
- Translate to other languages

## Documentation Roadmap

### Planned Documentation

- [ ] Video tutorials
- [ ] API reference (auto-generated)
- [ ] Architecture diagrams
- [ ] Performance optimization guide
- [ ] Security audit report
- [ ] Multi-language support (中文, English)

## License

Documentation is licensed under [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/).
Code is licensed under [MIT License](../LICENSE).

---

Last updated: 2024-12-31

For the latest documentation, visit the [GitHub repository](https://github.com/0xyaofan/bsc-dog-bang-plugin).
