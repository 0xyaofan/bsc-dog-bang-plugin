# BSC 打狗棒插件 - Solana 集成架构方案

> **创建日期**: 2025-01-09
> **版本**: 1.0
> **目标**: 在不破坏现有 BSC 功能的前提下，添加 Solana 链支持

---

## 📋 目录

1. [现状分析](#现状分析)
2. [核心挑战](#核心挑战)
3. [架构重构方案](#架构重构方案)
4. [目录结构重组](#目录结构重组)
5. [代码抽象层设计](#代码抽象层设计)
6. [实现路线图](#实现路线图)
7. [Solana 生态调研](#solana-生态调研)
8. [风险评估](#风险评估)

---

## 现状分析

### 当前项目架构优势

你的 BSC 项目已经具备**良好的模块化架构**，非常适合扩展到多链支持：

#### ✅ 优秀的设计模式

1. **通道（Channel）系统** - `src/shared/trading-channels.ts`
   - 已经实现了插件化的交易通道（PancakeSwap, Four.meme, Flap）
   - 每个通道有独立的配置和处理逻辑
   - **可直接用于添加 Solana DEX**

2. **代理（Agent）模式** - `src/background/*-agent.ts`
   - `four-quote-agent.ts` - Four.meme 报价代理
   - `flap-quote-agent.ts` - Flap 报价代理
   - `custom-aggregator-agent.ts` - 自定义聚合器代理
   - **可扩展为 `jupiter-quote-agent.ts` 等**

3. **配置驱动** - `src/shared/trading-config.ts`
   - 网络配置、合约地址、ABI 集中管理
   - **易于添加 Solana 网络配置**

4. **Background Worker 架构** - `src/background/index.ts`
   - 集中式钱包管理
   - RPC 客户端管理
   - **可同时管理 EVM 和 Solana 连接**

5. **用户设置系统** - `src/shared/user-settings.ts`
   - 统一的配置存储
   - **可扩展为多链配置**

#### ⚠️ 需要重构的部分

1. **强耦合的 EVM 依赖**
   - `viem` 库深度集成在多个模块中
   - 钱包初始化直接使用 EVM 私钥格式
   - 交易构建逻辑完全基于 EVM

2. **单一链假设**
   - 配置文件假设只有一条链（BSC）
   - UI 没有链选择器
   - 钱包地址格式假设为 EVM 地址

3. **网络层单一**
   - RPC 管理只考虑了 HTTP/WebSocket
   - 没有针对不同链的 RPC 抽象

---

## 核心挑战

### 技术层面

| 差异点 | BSC/EVM | Solana | 影响范围 |
|--------|---------|--------|----------|
| **账户模型** | 账户余额模型 | 账户状态模型（Rent） | 钱包管理、余额查询 |
| **地址格式** | 0x + 40 hex (20 bytes) | Base58 编码 (32 bytes) | 地址验证、显示 |
| **私钥** | 32 bytes ECDSA | 64 bytes Ed25519 | 钱包导入、签名 |
| **交易结构** | RLP 编码，Gas 模型 | Borsh 序列化，Rent + Priority Fee | 交易构建、费用估算 |
| **合约交互** | ABI + 函数调用 | Program + Instruction 数据 | 所有 DEX 交互 |
| **SDK** | viem / ethers.js | @solana/web3.js | 整个技术栈 |
| **确认机制** | Block confirmations | Commitment levels | 交易监控 |

### 架构层面

1. **如何共享钱包管理逻辑？**
   - EVM 和 Solana 钱包有不同的派生路径
   - BIP44: `m/44'/60'/0'/0/0` vs `m/44'/501'/0'/0'`

2. **如何统一交易接口？**
   - 不同的交易参数、签名流程、广播机制

3. **如何复用 UI 组件？**
   - 地址显示、余额显示、交易状态

4. **如何管理不同的配置？**
   - RPC 节点、合约地址、Gas/Fee 参数

---

## 架构重构方案

### 设计原则

1. ⭐ **抽象层优先** - 定义统一接口，底层实现分离
2. ⭐ **最小改动** - 尽量不修改现有 BSC 代码
3. ⭐ **渐进式迁移** - 先重构，后添加 Solana
4. ⭐ **向后兼容** - 确保现有功能不受影响

### 核心抽象层

#### 1. Chain Adapter（链适配器）

创建统一的链适配器接口：

```typescript
// src/shared/chain-adapter.ts

export interface ChainAdapter {
  // 基础信息
  readonly chainId: string;
  readonly chainName: string;
  readonly nativeCurrency: {
    name: string;
    symbol: string;
    decimals: number;
  };

  // 连接管理
  connect(rpcUrl: string): Promise<void>;
  disconnect(): Promise<void>;

  // 钱包操作
  importWallet(privateKey: string): Promise<WalletAccount>;
  getBalance(address: string): Promise<string>;

  // 交易操作
  buildSwapTransaction(params: SwapParams): Promise<Transaction>;
  signTransaction(tx: Transaction, wallet: WalletAccount): Promise<SignedTransaction>;
  sendTransaction(signedTx: SignedTransaction): Promise<string>;
  waitForTransaction(txHash: string): Promise<TransactionReceipt>;

  // 代币操作
  getTokenBalance(tokenAddress: string, walletAddress: string): Promise<string>;
  approveToken(tokenAddress: string, spenderAddress: string, amount: string): Promise<string>;
}

// 通用类型定义
export interface SwapParams {
  inputToken: string;
  outputToken: string;
  amount: string;
  slippage: number;
  recipient: string;
}

export interface Transaction {
  chainType: 'evm' | 'solana';
  rawData: unknown; // EVM: viem TransactionRequest | Solana: Transaction
}

export interface WalletAccount {
  address: string;
  privateData: unknown; // EVM: privateKey | Solana: Keypair
}
```

#### 2. EVM Chain Adapter

基于现有代码实现 EVM 适配器：

```typescript
// src/chains/evm/evm-adapter.ts

import { createPublicClient, createWalletClient, http } from 'viem';
import { bsc } from 'viem/chains';
import { privateKeyToAccount } from 'viem/accounts';
import type { ChainAdapter, WalletAccount, SwapParams } from '../../shared/chain-adapter';

export class EvmChainAdapter implements ChainAdapter {
  chainId = 'bsc';
  chainName = 'BSC';
  nativeCurrency = { name: 'BNB', symbol: 'BNB', decimals: 18 };

  private publicClient: any;
  private walletClient: any;

  async connect(rpcUrl: string): Promise<void> {
    this.publicClient = createPublicClient({
      chain: bsc,
      transport: http(rpcUrl)
    });
  }

  async importWallet(privateKey: string): Promise<WalletAccount> {
    const account = privateKeyToAccount(privateKey as `0x${string}`);
    this.walletClient = createWalletClient({
      account,
      chain: bsc,
      transport: http()
    });

    return {
      address: account.address,
      privateData: account
    };
  }

  async getBalance(address: string): Promise<string> {
    const balance = await this.publicClient.getBalance({ address });
    return balance.toString();
  }

  async buildSwapTransaction(params: SwapParams) {
    // 使用现有的 PancakeSwap/Four.meme 逻辑
    // 这里可以复用你现有的交易构建代码
    throw new Error('To be implemented');
  }

  // ... 其他方法实现
}
```

#### 3. Solana Chain Adapter

新增 Solana 适配器：

```typescript
// src/chains/solana/solana-adapter.ts

import { Connection, Keypair, PublicKey, Transaction } from '@solana/web3.js';
import bs58 from 'bs58';
import type { ChainAdapter, WalletAccount } from '../../shared/chain-adapter';

export class SolanaChainAdapter implements ChainAdapter {
  chainId = 'solana';
  chainName = 'Solana';
  nativeCurrency = { name: 'Solana', symbol: 'SOL', decimals: 9 };

  private connection: Connection | null = null;

  async connect(rpcUrl: string): Promise<void> {
    this.connection = new Connection(rpcUrl, 'confirmed');
  }

  async importWallet(secretKey: string): Promise<WalletAccount> {
    // Solana 私钥格式：Base58 或 Uint8Array
    const keypair = Keypair.fromSecretKey(
      bs58.decode(secretKey)
    );

    return {
      address: keypair.publicKey.toBase58(),
      privateData: keypair
    };
  }

  async getBalance(address: string): Promise<string> {
    if (!this.connection) throw new Error('Not connected');

    const publicKey = new PublicKey(address);
    const balance = await this.connection.getBalance(publicKey);
    return balance.toString();
  }

  async buildSwapTransaction(params: SwapParams) {
    // 使用 Jupiter API 构建交易
    throw new Error('To be implemented');
  }

  // ... 其他方法实现
}
```

#### 4. Chain Factory（链工厂）

管理不同链的适配器实例：

```typescript
// src/shared/chain-factory.ts

import type { ChainAdapter } from './chain-adapter';
import { EvmChainAdapter } from '../chains/evm/evm-adapter';
import { SolanaChainAdapter } from '../chains/solana/solana-adapter';

export type ChainType = 'bsc' | 'solana';

const adapters = new Map<ChainType, ChainAdapter>();

export function getChainAdapter(chain: ChainType): ChainAdapter {
  if (!adapters.has(chain)) {
    switch (chain) {
      case 'bsc':
        adapters.set(chain, new EvmChainAdapter());
        break;
      case 'solana':
        adapters.set(chain, new SolanaChainAdapter());
        break;
      default:
        throw new Error(`Unsupported chain: ${chain}`);
    }
  }

  return adapters.get(chain)!;
}

export function getAllChains(): ChainType[] {
  return ['bsc', 'solana'];
}
```

#### 5. DEX Adapter（DEX 适配器）

为每个 DEX 创建统一接口：

```typescript
// src/shared/dex-adapter.ts

export interface DexAdapter {
  readonly id: string;
  readonly name: string;
  readonly chain: ChainType;
  readonly supportedTokens?: string[];

  getQuote(params: QuoteParams): Promise<Quote>;
  buildSwapTransaction(quote: Quote): Promise<Transaction>;
}

export interface QuoteParams {
  inputToken: string;
  outputToken: string;
  amount: string;
  slippage: number;
}

export interface Quote {
  dexId: string;
  inputAmount: string;
  outputAmount: string;
  priceImpact: string;
  route: string[];
  estimatedGas?: string;
}

// 现有的 BSC DEX 适配器
export class PancakeSwapAdapter implements DexAdapter {
  id = 'pancake';
  name = 'PancakeSwap';
  chain: ChainType = 'bsc';

  async getQuote(params: QuoteParams): Promise<Quote> {
    // 使用现有的 PancakeSwap 报价逻辑
  }

  async buildSwapTransaction(quote: Quote) {
    // 使用现有的交易构建逻辑
  }
}

// 新增 Solana DEX 适配器
export class JupiterAdapter implements DexAdapter {
  id = 'jupiter';
  name = 'Jupiter';
  chain: ChainType = 'solana';

  async getQuote(params: QuoteParams): Promise<Quote> {
    // 使用 Jupiter API
    const jupiterApi = createJupiterApiClient();
    const quote = await jupiterApi.quoteGet({
      inputMint: params.inputToken,
      outputMint: params.outputToken,
      amount: params.amount,
      slippageBps: params.slippage * 100
    });

    return {
      dexId: this.id,
      inputAmount: quote.inAmount,
      outputAmount: quote.outAmount,
      priceImpact: quote.priceImpactPct,
      route: quote.routePlan.map(r => r.swapInfo.label)
    };
  }

  async buildSwapTransaction(quote: Quote) {
    // 构建 Jupiter 交易
  }
}
```

---

## 目录结构重组

### 现有结构
```
src/
├── background/
│   ├── index.ts                    # 主背景脚本
│   ├── four-quote-agent.ts
│   ├── flap-quote-agent.ts
│   └── custom-aggregator-agent.ts
├── shared/
│   ├── trading-config.ts           # 交易配置
│   ├── trading-channels.ts         # 通道管理
│   ├── user-settings.ts
│   └── viem-helper.ts              # EVM 工具
├── popup/
├── sidepanel/
└── content/
```

### 重构后的结构

```
src/
├── chains/                          # 🆕 链层抽象
│   ├── evm/
│   │   ├── evm-adapter.ts          # EVM 链适配器
│   │   ├── evm-wallet.ts           # EVM 钱包管理
│   │   ├── evm-transaction.ts      # EVM 交易处理
│   │   └── viem-helper.ts          # 从 shared 移动过来
│   ├── solana/
│   │   ├── solana-adapter.ts       # Solana 链适配器
│   │   ├── solana-wallet.ts        # Solana 钱包管理
│   │   ├── solana-transaction.ts   # Solana 交易处理
│   │   └── solana-helper.ts        # Solana 工具函数
│   └── types.ts                     # 通用链类型定义
│
├── dex/                             # 🆕 DEX 层抽象
│   ├── bsc/
│   │   ├── pancake-adapter.ts      # PancakeSwap 适配器
│   │   ├── four-adapter.ts         # Four.meme 适配器
│   │   └── flap-adapter.ts         # Flap 适配器
│   ├── solana/
│   │   ├── jupiter-adapter.ts      # Jupiter 适配器
│   │   ├── raydium-adapter.ts      # Raydium 适配器
│   │   └── pumpfun-adapter.ts      # Pump.fun 适配器
│   └── types.ts                     # DEX 通用类型
│
├── background/
│   ├── index.ts                     # 主背景脚本（重构）
│   ├── wallet-manager.ts           # 🆕 多链钱包管理器
│   ├── chain-manager.ts            # 🆕 链管理器
│   ├── agents/                      # 🆕 代理目录
│   │   ├── bsc/
│   │   │   ├── four-quote-agent.ts
│   │   │   └── flap-quote-agent.ts
│   │   └── solana/
│   │       ├── jupiter-quote-agent.ts
│   │       └── raydium-quote-agent.ts
│   └── legacy/                      # 🆕 旧代码迁移目录（可选）
│
├── shared/
│   ├── chain-adapter.ts            # 🆕 链适配器接口
│   ├── chain-factory.ts            # 🆕 链工厂
│   ├── dex-adapter.ts              # 🆕 DEX 适配器接口
│   ├── multi-chain-config.ts       # 🆕 多链配置
│   ├── trading-config.ts           # 保留（BSC 配置）
│   ├── trading-channels.ts         # 重构为通用版本
│   ├── user-settings.ts            # 扩展支持多链
│   ├── logger.ts
│   └── performance.ts
│
├── config/                          # 🆕 配置目录
│   ├── chains/
│   │   ├── bsc.config.ts           # BSC 链配置
│   │   └── solana.config.ts        # Solana 链配置
│   ├── dex/
│   │   ├── bsc-dex.config.ts       # BSC DEX 配置
│   │   └── solana-dex.config.ts    # Solana DEX 配置
│   └── networks.ts                  # 网络常量
│
├── ui/                              # 🆕 UI 组件（可选重构）
│   ├── components/
│   │   ├── ChainSelector.tsx       # 链选择器
│   │   ├── AddressDisplay.tsx      # 地址显示（支持多链格式）
│   │   └── BalanceDisplay.tsx      # 余额显示
│   ├── popup/                       # 从 src/popup 移动
│   └── sidepanel/                   # 从 src/sidepanel 移动
│
└── content/
    └── index.ts                     # 内容脚本（可能需要支持 Solana 网站）
```

### 迁移步骤

#### 阶段 1：创建抽象层（不影响现有功能）
```bash
# 创建新目录结构
mkdir -p src/chains/{evm,solana}
mkdir -p src/dex/{bsc,solana}
mkdir -p src/config/{chains,dex}
mkdir -p src/background/agents/{bsc,solana}

# 创建接口文件
touch src/shared/chain-adapter.ts
touch src/shared/dex-adapter.ts
touch src/shared/chain-factory.ts
```

#### 阶段 2：迁移现有代码到 EVM 适配器
```bash
# 移动 viem-helper 到 chains/evm
mv src/shared/viem-helper.ts src/chains/evm/

# 移动 agents 到新位置
mv src/background/four-quote-agent.ts src/background/agents/bsc/
mv src/background/flap-quote-agent.ts src/background/agents/bsc/
```

#### 阶段 3：实现 Solana 适配器
```bash
# 创建 Solana 适配器
touch src/chains/solana/solana-adapter.ts
touch src/chains/solana/solana-wallet.ts

# 创建 Solana DEX 适配器
touch src/dex/solana/jupiter-adapter.ts
```

---

## 代码抽象层设计

### 1. 钱包管理抽象

```typescript
// src/background/wallet-manager.ts

import type { ChainType } from '../shared/chain-factory';

export interface MultiChainWallet {
  // 单一助记词派生所有链的密钥
  mnemonic: string;

  // 各链的钱包账户
  accounts: Map<ChainType, ChainAccount>;
}

export interface ChainAccount {
  chain: ChainType;
  address: string;
  derivationPath: string;
  privateData: unknown; // 链特定的私钥数据
}

export class WalletManager {
  private wallet: MultiChainWallet | null = null;

  // 从助记词导入多链钱包
  async importFromMnemonic(mnemonic: string, password: string): Promise<void> {
    // 使用 BIP39 生成种子
    const seed = await mnemonicToSeed(mnemonic);

    // 为每条链派生密钥
    const bscAccount = deriveBscAccount(seed);  // m/44'/60'/0'/0/0
    const solAccount = deriveSolanaAccount(seed); // m/44'/501'/0'/0'

    this.wallet = {
      mnemonic,
      accounts: new Map([
        ['bsc', bscAccount],
        ['solana', solAccount]
      ])
    };

    // 加密存储
    await this.encryptAndStore(password);
  }

  // 获取指定链的账户
  getAccount(chain: ChainType): ChainAccount | null {
    return this.wallet?.accounts.get(chain) ?? null;
  }

  // 获取所有链的地址
  getAllAddresses(): Map<ChainType, string> {
    const addresses = new Map<ChainType, string>();
    this.wallet?.accounts.forEach((account, chain) => {
      addresses.set(chain, account.address);
    });
    return addresses;
  }
}
```

### 2. 交易管理抽象

```typescript
// src/shared/transaction-manager.ts

export class TransactionManager {
  private chainAdapters: Map<ChainType, ChainAdapter>;

  async executeSwap(
    chain: ChainType,
    dexId: string,
    params: SwapParams
  ): Promise<string> {
    // 1. 获取链适配器
    const chainAdapter = this.chainAdapters.get(chain);
    if (!chainAdapter) throw new Error(`Chain ${chain} not supported`);

    // 2. 获取 DEX 适配器
    const dexAdapter = getDexAdapter(chain, dexId);

    // 3. 获取报价
    const quote = await dexAdapter.getQuote(params);

    // 4. 构建交易
    const transaction = await dexAdapter.buildSwapTransaction(quote);

    // 5. 签名交易
    const wallet = this.walletManager.getAccount(chain);
    const signedTx = await chainAdapter.signTransaction(transaction, wallet);

    // 6. 发送交易
    const txHash = await chainAdapter.sendTransaction(signedTx);

    // 7. 监控交易
    await chainAdapter.waitForTransaction(txHash);

    return txHash;
  }
}
```

### 3. 用户设置扩展

```typescript
// src/shared/user-settings.ts (扩展现有代码)

export type ChainSettings = {
  bsc: BscChainSettings;
  solana: SolanaChainSettings;
};

export type BscChainSettings = {
  primaryRpc: string;
  fallbackRpcs: string[];
  defaultDex: 'pancake' | 'four' | 'flap';
  quoteTokens: string[];
};

export type SolanaChainSettings = {
  primaryRpc: string;
  fallbackRpcs: string[];
  defaultDex: 'jupiter' | 'raydium' | 'orca';
  commitment: 'processed' | 'confirmed' | 'finalized';
};

export type UserSettings = {
  system: SystemSettings;
  trading: TradingSettings;
  chains: ChainSettings;  // 🆕 多链设置
  activeChain: ChainType; // 🆕 当前活跃链
  // ... 其他现有字段
};
```

### 4. UI 组件抽象

```tsx
// src/ui/components/ChainSelector.tsx

export function ChainSelector({
  value,
  onChange
}: {
  value: ChainType;
  onChange: (chain: ChainType) => void
}) {
  return (
    <select value={value} onChange={(e) => onChange(e.target.value as ChainType)}>
      <option value="bsc">
        <img src="/icons/bsc.png" /> BSC
      </option>
      <option value="solana">
        <img src="/icons/solana.png" /> Solana
      </option>
    </select>
  );
}

// src/ui/components/AddressDisplay.tsx

export function AddressDisplay({
  address,
  chain
}: {
  address: string;
  chain: ChainType
}) {
  const formatted = chain === 'bsc'
    ? `${address.slice(0, 6)}...${address.slice(-4)}` // EVM 格式
    : `${address.slice(0, 4)}...${address.slice(-4)}`; // Solana 格式

  return (
    <div className="address-display">
      <ChainIcon chain={chain} />
      <span>{formatted}</span>
      <CopyButton text={address} />
    </div>
  );
}
```

---

## 实现路线图

### 第一阶段：基础架构重构（2-3 周）

**目标**: 不改变现有功能，为多链支持打下基础

#### Week 1: 抽象层设计和接口定义
- [ ] 创建 `ChainAdapter` 接口
- [ ] 创建 `DexAdapter` 接口
- [ ] 创建 `ChainFactory` 工厂类
- [ ] 定义通用类型（Transaction, Quote, SwapParams 等）
- [ ] 编写单元测试框架

#### Week 2: EVM 代码迁移
- [ ] 将现有 BSC 代码包装为 `EvmChainAdapter`
- [ ] 将 PancakeSwap/Four/Flap 包装为 DEX 适配器
- [ ] 迁移 `viem-helper.ts` 到 `chains/evm/`
- [ ] 迁移 agents 到新目录结构
- [ ] **回归测试**: 确保 BSC 功能完全正常

#### Week 3: 配置系统升级
- [ ] 扩展 `UserSettings` 支持多链
- [ ] 创建 `multi-chain-config.ts`
- [ ] 实现 `WalletManager`（先仅支持 BSC）
- [ ] 更新配置存储逻辑
- [ ] **发布 v1.2.0**: 架构重构版本

### 第二阶段：Solana 基础集成（3-4 周）

**目标**: 添加 Solana 链支持，实现基本钱包和转账功能

#### Week 4-5: Solana 钱包集成
- [ ] 安装依赖：`@solana/web3.js`, `@solana/spl-token`
- [ ] 实现 `SolanaChainAdapter`
- [ ] 实现 `SolanaWallet`（导入、签名、发送交易）
- [ ] 实现 SOL 和 SPL Token 余额查询
- [ ] 添加 Solana RPC 节点管理
- [ ] **测试**: Devnet 上测试转账功能

#### Week 6: UI 多链支持
- [ ] 添加链选择器组件
- [ ] 更新 Popup 显示多链地址
- [ ] 更新 SidePanel 支持链切换
- [ ] 适配浮动窗口（如果需要）
- [ ] 添加 Solana 地址验证和格式化
- [ ] **发布 v1.3.0**: Solana 钱包支持

#### Week 7: 文档和测试
- [ ] 编写 Solana 集成文档
- [ ] 创建测试用例（钱包、签名、RPC）
- [ ] 性能测试和优化
- [ ] 安全审计（私钥管理）

### 第三阶段：Solana DEX 集成（4-5 周）

**目标**: 支持 Solana 上的 DEX 交易和 meme 币

#### Week 8-9: Jupiter 聚合器集成
- [ ] 安装 `@jup-ag/api`
- [ ] 实现 `JupiterAdapter`
- [ ] 实现报价获取（`getQuote`）
- [ ] 实现交易构建（`buildSwapTransaction`）
- [ ] 实现交易执行和确认
- [ ] 添加 Jupiter quote agent
- [ ] **测试**: Devnet 上测试 SOL/USDC 兑换

#### Week 10: Raydium AMM 集成
- [ ] 安装 Raydium SDK
- [ ] 实现 `RaydiumAdapter`
- [ ] 支持 Raydium V4/CLMM 池
- [ ] 实现流动性池查询
- [ ] **测试**: 特定交易对的 AMM swap

#### Week 11-12: Pump.fun Meme 币集成
- [ ] 研究 Pump.fun 程序接口
- [ ] 安装 `@cryptoscan/pumpfun-sdk` 或自建
- [ ] 实现 `PumpfunAdapter`
- [ ] 支持 meme 币买入/卖出
- [ ] 实现代币创建监听（可选）
- [ ] 添加 Pump.fun 反撸检测
- [ ] **测试**: 小金额测试 meme 币交易

#### Week 13: 综合测试和优化
- [ ] 端到端测试（BSC + Solana）
- [ ] 性能优化（RPC 请求、交易构建）
- [ ] UI/UX 优化（加载状态、错误处理）
- [ ] 安全审计（交易签名、私钥隔离）
- [ ] **发布 v1.4.0**: Solana DEX 完整支持

### 第四阶段：高级功能（可选，按需开发）

#### 功能扩展
- [ ] 支持更多 Solana DEX（Orca, Meteora）
- [ ] 支持跨链桥（Wormhole）
- [ ] 支持 Solana NFT 交易
- [ ] 实现 Jito MEV 保护
- [ ] 添加交易模拟（预执行）
- [ ] 实现批量交易（Solana Transaction v0）

#### 性能优化
- [ ] RPC 请求缓存和去重
- [ ] 交易路由优化（多 DEX 聚合）
- [ ] WebSocket 实时数据推送
- [ ] 离线签名和预构建交易

---

## Solana 生态调研

### 推荐的 Solana 技术栈

#### 核心库
```json
{
  "@solana/web3.js": "^1.87.0",
  "@solana/spl-token": "^0.3.9",
  "@jup-ag/api": "^6.0.0",
  "@raydium-io/raydium-sdk-v2": "^0.1.0",
  "bs58": "^5.0.0"
}
```

#### 工具库
```json
{
  "@coral-xyz/anchor": "^0.29.0",  // 如果需要与 Anchor 程序交互
  "@solana/wallet-adapter-base": "^0.9.23",
  "borsh": "^0.7.0"  // Solana 序列化格式
}
```

### Jupiter 集成示例

```typescript
// src/dex/solana/jupiter-adapter.ts

import { createJupiterApiClient } from '@jup-ag/api';
import { Connection, VersionedTransaction } from '@solana/web3.js';
import type { DexAdapter, QuoteParams, Quote } from '../../shared/dex-adapter';

export class JupiterAdapter implements DexAdapter {
  id = 'jupiter';
  name = 'Jupiter';
  chain = 'solana' as const;

  private api = createJupiterApiClient();
  private connection: Connection;

  constructor(rpcUrl: string) {
    this.connection = new Connection(rpcUrl, 'confirmed');
  }

  async getQuote(params: QuoteParams): Promise<Quote> {
    const quote = await this.api.quoteGet({
      inputMint: params.inputToken,
      outputMint: params.outputToken,
      amount: params.amount,
      slippageBps: Math.floor(params.slippage * 100)
    });

    if (!quote) throw new Error('No quote available');

    return {
      dexId: this.id,
      inputAmount: quote.inAmount,
      outputAmount: quote.outAmount,
      priceImpact: quote.priceImpactPct,
      route: quote.routePlan.map(r => r.swapInfo.label),
      estimatedGas: '5000' // Solana 交易费用约 5000 lamports
    };
  }

  async buildSwapTransaction(quote: Quote, userPublicKey: string) {
    const swapResult = await this.api.swapPost({
      swapRequest: {
        quoteResponse: quote.rawData, // 保存原始 Jupiter quote
        userPublicKey,
        wrapAndUnwrapSol: true,
        dynamicComputeUnitLimit: true,
        prioritizationFeeLamports: 'auto'
      }
    });

    // 反序列化交易
    const swapTransactionBuf = Buffer.from(swapResult.swapTransaction, 'base64');
    const transaction = VersionedTransaction.deserialize(swapTransactionBuf);

    return {
      chainType: 'solana' as const,
      rawData: transaction
    };
  }
}
```

### Pump.fun 集成示例

```typescript
// src/dex/solana/pumpfun-adapter.ts

import { Connection, PublicKey, Transaction } from '@solana/web3.js';

export class PumpfunAdapter implements DexAdapter {
  id = 'pumpfun';
  name = 'Pump.fun';
  chain = 'solana' as const;

  private connection: Connection;
  private PUMPFUN_PROGRAM_ID = new PublicKey('6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P');

  async buyToken(
    tokenMint: string,
    amountSol: number,
    minTokensOut: number,
    userPublicKey: string
  ): Promise<Transaction> {
    // 构建买入指令
    const buyInstruction = await this.createBuyInstruction({
      tokenMint: new PublicKey(tokenMint),
      user: new PublicKey(userPublicKey),
      amountIn: amountSol * 1e9, // SOL to lamports
      minAmountOut: minTokensOut
    });

    const transaction = new Transaction().add(buyInstruction);

    // 添加优先费用（Pump.fun 交易竞争激烈）
    transaction.add(
      ComputeBudgetProgram.setComputeUnitPrice({
        microLamports: 100000 // 0.0001 SOL 优先费
      })
    );

    return transaction;
  }

  async sellToken(
    tokenMint: string,
    amountToken: number,
    minSolOut: number,
    userPublicKey: string
  ): Promise<Transaction> {
    // 类似买入逻辑
  }

  private async createBuyInstruction(params: any) {
    // 根据 Pump.fun 程序 IDL 构建指令
    // 可以使用 Anchor 或手动构建
  }
}
```

### RPC 节点配置

```typescript
// src/config/chains/solana.config.ts

export const SOLANA_NETWORK_CONFIG = {
  CHAIN_ID: 101, // Mainnet Beta
  CHAIN_NAME: 'Solana',

  RPC_NODES: [
    'https://api.mainnet-beta.solana.com',
    'https://solana-api.projectserum.com',
    'https://rpc.ankr.com/solana',
    'https://api.syndica.io/access-token/YOUR_TOKEN/rpc'
  ],

  RPC_FALLBACK: [
    'https://solana.publicnode.com',
    'https://mainnet.helius-rpc.com/?api-key=YOUR_KEY'
  ],

  // Commitment levels
  DEFAULT_COMMITMENT: 'confirmed' as const,

  // WebSocket
  WS_URL: 'wss://api.mainnet-beta.solana.com'
};

export const SOLANA_CONTRACTS = {
  // 原生 SOL
  WSOL: 'So11111111111111111111111111111111111111112',

  // SPL Tokens
  USDC: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
  USDT: 'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB',

  // DEX Programs
  JUPITER_AGGREGATOR: 'JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4',
  RAYDIUM_V4: '675kPX9MHTjS2zt1qfr1NYHuzeLXfQM9H24wFSUt1Mp8',
  PUMP_FUN: '6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P'
};
```

---

## 风险评估

### 技术风险

| 风险 | 影响 | 概率 | 缓解措施 |
|------|------|------|----------|
| **Solana SDK 不稳定** | 高 | 中 | 锁定版本，充分测试 |
| **RPC 节点不可靠** | 高 | 高 | 多节点备份，自动切换 |
| **交易失败率高** | 中 | 中 | 添加重试机制，用户确认 |
| **私钥管理复杂** | 高 | 低 | 使用成熟的密钥派生库 |
| **Jupiter API 变更** | 中 | 中 | 版本锁定，监控更新 |
| **Pump.fun 合约变更** | 高 | 高 | 降级到只读模式，等待更新 |

### 业务风险

| 风险 | 影响 | 概率 | 缓解措施 |
|------|------|------|----------|
| **用户学习成本** | 中 | 高 | 详细文档，UI 引导 |
| **Solana 网络拥堵** | 高 | 中 | 动态费用，用户教育 |
| **Meme 币诈骗** | 高 | 高 | 风险提示，代币检测 |
| **跨链操作混淆** | 中 | 中 | 清晰的链标识 |

### 安全风险

| 风险 | 影响 | 概率 | 缓解措施 |
|------|------|------|----------|
| **私钥泄露** | 极高 | 低 | AES-256 加密，安全存储 |
| **恶意交易** | 高 | 中 | 交易预览，用户确认 |
| **Rug Pull** | 高 | 高 | 代币检测，风险评分 |
| **钓鱼网站** | 高 | 中 | 网站白名单 |

---

## 总结和建议

### ✅ 推荐方案

1. **采用抽象层架构** - 通过 ChainAdapter 和 DexAdapter 实现多链支持
2. **渐进式迁移** - 先重构 BSC 代码，后添加 Solana
3. **Jupiter 优先** - Solana DEX 首选 Jupiter 聚合器
4. **保守集成 Pump.fun** - 由于合约可能变更，建议后期再集成

### 📋 行动清单

**立即开始**:
- [ ] 创建 `chain-adapter.ts` 和 `dex-adapter.ts` 接口
- [ ] 设计新的目录结构
- [ ] 编写架构设计文档

**近期任务**（1-2 周）:
- [ ] 重构现有 BSC 代码为 EVM 适配器
- [ ] 创建配置系统升级方案
- [ ] 编写单元测试

**中期任务**（1-2 月）:
- [ ] 实现 Solana 钱包管理
- [ ] 集成 Jupiter DEX
- [ ] 更新 UI 支持多链

**长期任务**（3+ 月）:
- [ ] 集成更多 Solana DEX
- [ ] Pump.fun meme 币支持
- [ ] 性能优化和安全加固

### 🎯 成功指标

- ✅ BSC 功能完全不受影响
- ✅ Solana 基础钱包功能正常
- ✅ Jupiter swap 成功率 > 95%
- ✅ 代码覆盖率 > 80%
- ✅ 用户满意度 > 90%

---

**文档版本**: v1.0
**最后更新**: 2025-01-09
**维护者**: BSC 打狗棒团队
