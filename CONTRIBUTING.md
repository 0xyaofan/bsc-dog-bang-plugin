# Contributing to BSC Dog Bang Plugin

First off, thank you for considering contributing to BSC Dog Bang Plugin! It's people like you that make this tool better for everyone.

## Table of Contents

- [Code of Conduct](#code-of-conduct)
- [How Can I Contribute?](#how-can-i-contribute)
- [Development Setup](#development-setup)
- [Pull Request Process](#pull-request-process)
- [Coding Standards](#coding-standards)
- [Commit Message Guidelines](#commit-message-guidelines)
- [Issue and PR Labels](#issue-and-pr-labels)

## Code of Conduct

### Our Pledge

We are committed to providing a welcoming and inspiring community for all. Please be respectful and constructive.

### Our Standards

Examples of behavior that contributes to a positive environment:

- Using welcoming and inclusive language
- Being respectful of differing viewpoints and experiences
- Gracefully accepting constructive criticism
- Focusing on what is best for the community
- Showing empathy towards other community members

### Unacceptable Behavior

- Trolling, insulting/derogatory comments, and personal attacks
- Public or private harassment
- Publishing others' private information without permission
- Other conduct which could reasonably be considered inappropriate

## How Can I Contribute?

### Reporting Bugs

Before creating bug reports, please check existing issues to avoid duplicates.

**When reporting bugs, include**:
- BSC Dog Bang version
- Chrome version
- Steps to reproduce
- Expected vs actual behavior
- Screenshots if applicable
- Console logs

**Bug Report Template**:

```markdown
**Describe the bug**
A clear description of what the bug is.

**To Reproduce**
Steps to reproduce:
1. Go to '...'
2. Click on '...'
3. See error

**Expected behavior**
What you expected to happen.

**Screenshots**
If applicable, add screenshots.

**Environment:**
 - Plugin Version: [e.g. 1.0.0]
 - Chrome Version: [e.g. 120]
 - OS: [e.g. macOS]

**Additional context**
Any other context about the problem.
```

### Suggesting Enhancements

Enhancement suggestions are tracked as GitHub issues.

**When suggesting enhancements, include**:
- Clear description of the feature
- Why this enhancement would be useful
- Possible implementation approach
- Examples from other projects (if applicable)

**Feature Request Template**:

```markdown
**Is your feature request related to a problem?**
A clear description of the problem.

**Describe the solution you'd like**
What you want to happen.

**Describe alternatives you've considered**
Other solutions you've thought about.

**Additional context**
Any other context or screenshots.
```

### Your First Code Contribution

Unsure where to begin? Look for issues labeled:
- `good first issue` - Good for newcomers
- `help wanted` - We need help on these
- `beginner friendly` - Easy to get started

### Pull Requests

1. **Fork the repository**
2. **Create a branch**:
   ```bash
   git checkout -b feature/amazing-feature
   ```
3. **Make your changes**
4. **Test thoroughly**
5. **Commit with conventional commits**
6. **Push to your fork**
7. **Open a Pull Request**

## Development Setup

### Prerequisites

- Node.js 18+
- Git
- Chrome 114+

### Setup Steps

```bash
# Clone your fork
git clone https://github.com/YOUR_USERNAME/bsc-dog-bang-plugin.git
cd bsc-dog-bang-plugin

# Add upstream remote
git remote add upstream https://github.com/0xyaofan/bsc-dog-bang-plugin.git

# Install dependencies
npm install

# Start development
npm run dev

# Run build
npm run build

# Load extension in Chrome
# 1. Visit chrome://extensions/
# 2. Enable Developer Mode
# 3. Load unpacked extension from ./extension
```

### Project Structure

```
src/
├── background/      # Service Worker
├── content/         # Content Scripts
├── popup/           # Popup UI
├── sidepanel/       # Side Panel UI
├── offscreen/       # Offscreen Document
└── shared/          # Shared Modules
```

### Running Tests

```bash
# Run all tests (when available)
npm test

# Run specific test
npm test -- trading-channels
```

## Pull Request Process

### Before Submitting

- [ ] Code follows the style guidelines
- [ ] Self-review completed
- [ ] Comments added to complex code
- [ ] Documentation updated
- [ ] No new warnings
- [ ] Tests added/updated
- [ ] All tests passing
- [ ] Build successful

### PR Title Format

Use [Conventional Commits](https://www.conventionalcommits.org/):

```
<type>(<scope>): <description>

Examples:
feat(trading): add Luna.fun support
fix(wallet): resolve unlock issue
docs(readme): update installation guide
style(popup): improve button spacing
refactor(channels): optimize gas estimation
test(trading): add buy/sell tests
chore(deps): update viem to 2.43.2
```

**Types**:
- `feat`: New feature
- `fix`: Bug fix
- `docs`: Documentation
- `style`: Code style (formatting, etc.)
- `refactor`: Code restructuring
- `perf`: Performance improvement
- `test`: Adding tests
- `chore`: Maintenance tasks

**Scopes**:
- `wallet`: Wallet management
- `trading`: Trading functionality
- `ui`: User interface
- `content`: Content scripts
- `background`: Background script
- `deps`: Dependencies

### PR Description Template

```markdown
## Description
Brief description of changes.

## Type of Change
- [ ] Bug fix (non-breaking change fixing an issue)
- [ ] New feature (non-breaking change adding functionality)
- [ ] Breaking change (fix or feature causing existing functionality to not work as expected)
- [ ] Documentation update

## How Has This Been Tested?
Describe the tests you ran.

## Checklist
- [ ] My code follows the style guidelines
- [ ] I have performed a self-review
- [ ] I have commented my code
- [ ] I have updated the documentation
- [ ] My changes generate no new warnings
- [ ] I have added tests
- [ ] All tests pass
- [ ] Build succeeds

## Screenshots (if applicable)

## Related Issues
Closes #123
```

### Review Process

1. **Automated checks** must pass:
   - Build successful
   - No linting errors
   - Tests passing (when available)

2. **Code review** by maintainer:
   - Code quality
   - Follows conventions
   - Adequate testing
   - Documentation complete

3. **Approval and merge**:
   - Squash and merge (default)
   - Merge commit (for features)
   - Rebase and merge (for hotfixes)

## Coding Standards

### TypeScript

```typescript
// ✅ Good
interface BuyParams {
  tokenAddress: `0x${string}`;
  amountIn: bigint;
  slippage: number;
}

async function executeBuy(params: BuyParams): Promise<`0x${string}`> {
  // Implementation
}

// ❌ Bad
function executeBuy(tokenAddress, amountIn, slippage) {
  // No types
}
```

### Naming Conventions

```typescript
// Files: kebab-case
// four-quote-agent.ts

// Variables/Functions: camelCase
const tokenAddress = '0x...';
function getBalance() {}

// Classes/Interfaces: PascalCase
class WalletManager {}
interface TradeParams {}

// Constants: UPPER_SNAKE_CASE
const DEFAULT_GAS_LIMIT = 300000;

// Private: _camelCase
class Foo {
  private _value: string;
}
```

### Code Organization

```typescript
// 1. Imports
import { createPublicClient } from 'viem';
import { logger } from '../shared/logger';

// 2. Types
interface Params {}

// 3. Constants
const CONFIG = {};

// 4. Functions
function helper() {}

// 5. Main logic
export async function main() {}
```

### Comments

```typescript
/**
 * Execute a token buy transaction.
 *
 * @param params - Trading parameters
 * @returns Transaction hash
 * @throws {Error} If balance insufficient
 *
 * @example
 * ```typescript
 * const hash = await executeBuy({
 *   tokenAddress: '0x...',
 *   amountIn: parseEther('0.1')
 * });
 * ```
 */
async function executeBuy(params: BuyParams) {}
```

### Error Handling

```typescript
// ✅ Good
try {
  const result = await riskyOperation();
  logger.info('Success', result);
} catch (error) {
  logger.error('Failed', error);
  throw new Error(`Operation failed: ${(error as Error).message}`);
}

// ❌ Bad
try {
  riskyOperation();
} catch (e) {
  console.log(e);
}
```

## Commit Message Guidelines

### Format

```
<type>(<scope>): <subject>

<body>

<footer>
```

### Examples

```
feat(trading): add Luna.fun trading support

Implement Luna.fun buy/sell functionality with:
- Contract interaction
- Price quotes
- Transaction monitoring

Closes #42

---

fix(wallet): resolve unlock timing issue

Fix race condition when unlocking wallet after
plugin refresh by adding proper state synchronization.

Fixes #156

---

docs(setup): update Node.js version requirement

Update minimum Node.js version from 16 to 18
to match viem requirements.
```

### Rules

1. **Use imperative mood**: "add" not "added"
2. **First line max 72 characters**
3. **Reference issues**: "Closes #123"
4. **Explain why, not what**

## Issue and PR Labels

### Type Labels
- `bug` - Something isn't working
- `feature` - New feature request
- `enhancement` - Improve existing feature
- `documentation` - Documentation improvements
- `question` - Questions about usage

### Priority Labels
- `critical` - Critical bug, immediate fix needed
- `high` - High priority
- `medium` - Medium priority
- `low` - Low priority

### Status Labels
- `in-progress` - Currently being worked on
- `needs-review` - Ready for review
- `blocked` - Blocked by dependency
- `wontfix` - Will not be fixed

### Difficulty Labels
- `good first issue` - Good for newcomers
- `help wanted` - Need help from community
- `beginner friendly` - Easy difficulty

## Getting Help

- **Questions**: Open a GitHub Discussion
- **Bugs**: Open a GitHub Issue
- **Security**: Email maintainer directly (see README)

## Recognition

Contributors will be recognized in:
- README.md Contributors section
- Release notes
- GitHub contributors page

## License

By contributing, you agree that your contributions will be licensed under the MIT License.

---

Thank you for contributing to BSC Dog Bang Plugin! 🚀
