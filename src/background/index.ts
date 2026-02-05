/**
 * Background Service Worker
 * 功能：
 * 1. 钱包管理（加密存储私钥）
 * 2. 执行区块链交易
 * 3. 查询余额
 */

/// <reference types="chrome" />

import '../shared/sw-polyfills.js';
import { logger } from '../shared/logger.js';
import { PerformanceTimer, perf } from '../shared/performance.js';
import {
  WALLET_CONFIG,
  NETWORK_CONFIG,
  TX_WATCHER_CONFIG,
  TX_CONFIG,
  CONTRACTS,
  ROUTER_ABI,
  ERC20_ABI,
  FOUR_TOKEN_MANAGER_ABI,
  BACKGROUND_TASK_CONFIG,
  FLAP_PORTAL_ABI,
  CUSTOM_AGGREGATOR_CONFIG
} from '../shared/trading-config.js';
import {
  isBnbQuote,
  resolveQuoteTokenName,
  getQuoteBalance,
  resolveSwapSlippageBps,
  estimateQuoteToBnbAmount
} from './four-quote-bridge.js';
import {
  detectTokenPlatform,
  fetchRouteWithFallback,
  type TokenPlatform,
  type RouteFetchResult
} from '../shared/token-route.js';
import {
  buildChainConfig,
  createHttpClient,
  createNonceManager,
  createWallet,
  encodeFunctionData,
  formatEther,
  formatUnits,
  parseUnits,
  withCache
} from '../shared/viem-helper.js';
import { encodeAbiParameters, parseEther, type Address } from 'viem';
import { getChannel, setPancakePreferredMode, clearAllowanceCache, getTokenTradeHint, getCachedAllowance } from '../shared/trading-channels.js';
import { TxWatcher } from '../shared/tx-watcher.js';
import { dedupePromise } from '../shared/promise-dedupe.js';
import {
  DEFAULT_USER_SETTINGS,
  UserSettings,
  getRpcNodesFromSettings,
  loadUserSettings,
  onUserSettingsChange
} from '../shared/user-settings.js';
import { DEFAULT_FOUR_QUOTE_TOKENS } from '../shared/channel-config.js';
import {
  FOUR_CHANNEL_IDS,
  shouldUseFourQuote,
  requireFourQuoteToken,
  prepareFourQuoteBuy,
  finalizeFourQuoteSell as finalizeFourQuoteConversion
} from './four-quote-agent.js';
import {
  shouldUseFlapQuote,
  prepareFlapQuoteBuy
} from './flap-quote-agent.js';
import {
  shouldUseCustomAggregator,
  executeCustomAggregatorBuy,
  executeCustomAggregatorSell,
  type AggregatorRuntimeSettings,
  isAggregatorUnsupportedError
} from './custom-aggregator-agent.js';

// 全局变量
let publicClient = null;
let walletClient = null;
let walletAccount = null;
let walletPrivateKey = null;
let chainConfig = null;
let txWatcher = null;
let currentRpcUrl = null;
let walletNonceManager = null;

type NonceDiagnostics = {
  pending: number;
  latest: number;
  diff: number;
  timestamp: number;
  reason?: string;
};

let lastNonceDiagnostics: NonceDiagnostics | null = null;
let managedNonceCursor: number | null = null;
type AsyncMutex = {
  runExclusive<T>(task: () => Promise<T>): Promise<T>;
};

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function createAsyncMutex(): AsyncMutex {
  let current: Promise<void> = Promise.resolve();
  return {
    async runExclusive<T>(task: () => Promise<T>): Promise<T> {
      let release: () => void = () => {};
      const previous = current;
      current = new Promise<void>((resolve) => {
        release = resolve;
      });
      await previous;
      try {
        return await task();
      } finally {
        release();
      }
    }
  };
}

const nonceMutex = createAsyncMutex();

const CONTENT_PORT_NAME = 'dog-bang-content';
const OFFSCREEN_PORT_NAME = 'dog-bang-offscreen';
const OFFSCREEN_DOCUMENT_PATH = 'offscreen.html';
const CONTENT_SCRIPT_URL_PATTERNS = [
  'https://gmgn.ai/*',
  'https://web3.binance.com/*',
  'https://four.meme/*',
  'https://flap.sh/*'
];

const connectedContentPorts = new Map<number, Set<chrome.runtime.Port>>();
let offscreenPort = null;
let offscreenPortReadyResolver = null;
let offscreenPortReadyPromise = null;

const SIDE_PANEL_TOKEN_STORAGE_KEY = 'dogBangLastTokenContext';

type TokenContextSource = 'tabs' | 'storage' | 'trade' | 'unknown';

type TokenContext = {
  tokenAddress: string | null;
  url: string | null;
  source: TokenContextSource;
  tabId: number | null;
  updatedAt: number;
};

type SidePanelTokenContext = {
  tokenAddress?: string;
  url?: string;
  updatedAt?: number;
  preferredChannelId?: string;
};

const DEFAULT_TOKEN_CONTEXT: TokenContext = {
  tokenAddress: null,
  url: null,
  source: 'unknown',
  tabId: null,
  updatedAt: 0
};

let currentTokenContext: TokenContext = { ...DEFAULT_TOKEN_CONTEXT };

function removeContentPortReference(tabId: number, port: chrome.runtime.Port) {
  const ports = connectedContentPorts.get(tabId);
  if (!ports) {
    return;
  }
  ports.delete(port);
  if (ports.size === 0) {
    connectedContentPorts.delete(tabId);
  }
}

function normalizeRpcError(error: any): string {
  const fallback = '交易被节点拒绝，请稍后重试';
  const rawMessage = [
    error?.shortMessage,
    error?.cause?.shortMessage,
    error?.message,
    error?.cause?.message
  ].find((msg) => typeof msg === 'string' && msg.trim().length > 0)
    || String(error || '').trim()
    || fallback;

  const sanitized = rawMessage
    .replace(/URL:[\s\S]*/i, '')
    .replace(/Request body:[\s\S]*/i, '')
    .trim();

  const lower = sanitized.toLowerCase();

  if (lower.includes('gapped-nonce')) {
    if (lastNonceDiagnostics && Date.now() - lastNonceDiagnostics.timestamp < 15000) {
      const { pending, latest } = lastNonceDiagnostics;
      return `节点 nonce 不一致（pending: ${pending}, latest: ${latest}），已自动重试，请稍后重试`;
    }
    return '节点 nonce 不一致，已自动重试，请稍后重试';
  }
  if (lower.includes('missing or invalid parameters')) {
    return '节点拒绝：参数无效或 nonce 不匹配';
  }
  if (lower.includes('insufficient funds')) {
    return 'BNB 余额不足';
  }
  if (lower.includes('replacement transaction underpriced') || lower.includes('transaction underpriced')) {
    return 'Gas Price 过低，节点拒绝';
  }
  if (lower.includes('nonce too low')) {
    return '节点 nonce 过低，请重新同步后再试';
  }
  if (lower.includes('already known')) {
    return '节点已存在该交易，请稍后查看链上状态';
  }
  if (lower.includes('user rejected')) {
    return '您已取消本次交易';
  }
  if (lower.includes('execution reverted') || lower.includes('transactionexecutionerror')) {
    return '链上执行失败：滑点过低或流动性不足';
  }

  const message = sanitized || fallback;
  return message.length > 160 ? `${message.slice(0, 157)}...` : message;
}

function normalizeTokenAddressValue(address?: string | null) {
  const normalized = normalizeAddressValue(address);
  return normalized || null;
}

function updateTokenContext(partial: {
  tokenAddress?: string | null;
  url?: string | null;
  source?: TokenContextSource;
  tabId?: number | null;
  force?: boolean;
}) {
  const normalizedAddress = partial.tokenAddress === undefined
    ? currentTokenContext.tokenAddress
    : normalizeTokenAddressValue(partial.tokenAddress);

  const nextContext: TokenContext = {
    tokenAddress: normalizedAddress,
    url: partial.url === undefined ? currentTokenContext.url : partial.url ?? null,
    source: partial.source ?? currentTokenContext.source ?? 'unknown',
    tabId: partial.tabId === undefined ? currentTokenContext.tabId : partial.tabId ?? null,
    updatedAt: Date.now()
  };

  const changed =
    partial.force === true ||
    nextContext.tokenAddress !== currentTokenContext.tokenAddress ||
    nextContext.url !== currentTokenContext.url ||
    nextContext.source !== currentTokenContext.source ||
    nextContext.tabId !== currentTokenContext.tabId;

  if (changed) {
    currentTokenContext = nextContext;
  }

  return currentTokenContext;
}

function getActiveTokenAddressFromContext() {
  return currentTokenContext.tokenAddress;
}

function ensureTradeTokenContext(tokenAddress: string) {
  const normalized = normalizeTokenAddressValue(tokenAddress);
  if (!normalized) {
    throw new Error('未提供有效的代币地址');
  }
  // 修复：检测到代币切换时，直接更新上下文而不是抛出错误
  // 这允许用户在切换代币后立即交易，无需等待页面刷新
  if (currentTokenContext.tokenAddress && currentTokenContext.tokenAddress !== normalized) {
    logger.debug('[Token Context] 检测到代币切换，自动更新上下文:', {
      from: currentTokenContext.tokenAddress,
      to: normalized
    });
  }
  updateTokenContext({ tokenAddress: normalized, source: 'trade' });
  return normalized;
}

const SUPPORTED_CHANNEL_IDS = new Set(['pancake', 'four', 'xmode', 'flap']);
const buildQuoteSignature = (tokens: string[]) =>
  tokens.map((value) => value?.toLowerCase?.() || '').filter(Boolean).sort().join(',');
let currentFourQuoteSignature = buildQuoteSignature(DEFAULT_FOUR_QUOTE_TOKENS);

function assertWalletReadyForFourQuote() {
  if (!publicClient || !walletClient || !walletAccount || !chainConfig) {
    throw new Error('钱包未初始化，无法执行交易');
  }
}

function buildFourSwapContext(gasPriceWei: bigint, nonceExecutor: (label: string, sender: (nonce: number) => Promise<any>) => Promise<any>) {
  assertWalletReadyForFourQuote();
  return {
    publicClient,
    walletClient,
    account: walletAccount,
    chain: chainConfig,
    gasPrice: gasPriceWei,
    nonceExecutor
  };
}

type BuyTokenArgsStruct = {
  origin?: bigint;
  token: Address;
  to: Address;
  amount?: bigint;
  maxFunds?: bigint;
  funds?: bigint;
  minAmount?: bigint;
};

function encodeBuyTokenStruct(args: BuyTokenArgsStruct) {
  const {
    origin = 0n,
    token,
    to,
    amount = 0n,
    maxFunds = 0n,
    funds = 0n,
    minAmount = 1n
  } = args;
  return encodeAbiParameters(
    [
      { name: 'origin', type: 'uint256' },
      { name: 'token', type: 'address' },
      { name: 'to', type: 'address' },
      { name: 'amount', type: 'uint256' },
      { name: 'maxFunds', type: 'uint256' },
      { name: 'funds', type: 'uint256' },
      { name: 'minAmount', type: 'uint256' }
    ],
    [origin, token, to, amount, maxFunds, funds, minAmount]
  );
}

async function sendFourEncodedBuy(params: {
  tokenAddress: string;
  amount?: bigint;
  maxFunds?: bigint;
  funds?: bigint;
  minAmount?: bigint;
  msgValue: bigint;
  gasPriceWei: bigint;
  nonceExecutor: (label: string, sender: (nonce: number) => Promise<any>) => Promise<any>;
  label?: string;
}) {
  const { tokenAddress, amount, maxFunds, funds, minAmount, msgValue, gasPriceWei, nonceExecutor, label = 'four-buy-encoded' } = params;
  assertWalletReadyForFourQuote();
  const encodedArgs = encodeBuyTokenStruct({
    token: tokenAddress as Address,
    to: walletAccount.address,
    amount,
    maxFunds,
    funds,
    minAmount
  });

  const txHash = await nonceExecutor(label, async (nonce) => {
    const hash = await walletClient.sendTransaction({
      account: walletAccount,
      chain: chainConfig,
      to: CONTRACTS.FOUR_TOKEN_MANAGER_V2,
      nonce: BigInt(nonce),
      value: msgValue,
      gasPrice: gasPriceWei,
      data: encodeFunctionData({
        abi: FOUR_TOKEN_MANAGER_ABI,
        functionName: 'buyToken',
        args: [encodedArgs as `0x${string}`, 0n, '0x']
      })
    });
    return hash;
  });

  return txHash;
}

async function executeFourQuoteBuy(params: {
  tokenAddress: string;
  amountBnb: string | number;
  slippage: number;
  quoteToken: string;
  gasPriceWei: bigint;
  nonceExecutor: (label: string, sender: (nonce: number) => Promise<any>) => Promise<any>;
  useEncodedBuy?: boolean;
}) {
  const { tokenAddress, amountBnb, slippage, quoteToken, gasPriceWei, nonceExecutor, useEncodedBuy = false } = params;
  assertWalletReadyForFourQuote();
  const amountStr = typeof amountBnb === 'string' ? amountBnb : amountBnb?.toString?.() || '0';
  let amountWei: bigint;
  try {
    amountWei = parseUnits(amountStr, 18);
  } catch (error) {
    throw new Error('无效的买入数量');
  }
  if (amountWei <= 0n) {
    throw new Error('买入数量必须大于 0');
  }

  const swapContext = buildFourSwapContext(gasPriceWei, nonceExecutor);
  const { quoteAmount, usedWalletQuote } = await prepareFourQuoteBuy({
    tokenAddress,
    amountInWei: amountWei,
    slippage,
    quoteToken,
    swapContext,
    publicClient,
    walletAddress: walletAccount.address
  });

  let buyHash: string;
  if (useEncodedBuy) {
    buyHash = await sendFourEncodedBuy({
      tokenAddress,
      funds: quoteAmount,
      minAmount: 1n,
      msgValue: 0n,
      gasPriceWei,
      nonceExecutor,
      label: 'four-quote-buy'
    });
  } else {
    buyHash = await nonceExecutor('four-quote-buy', async (nonce) => {
      const hash = await walletClient.sendTransaction({
        account: walletAccount,
        chain: chainConfig,
        to: CONTRACTS.FOUR_TOKEN_MANAGER_V2,
        nonce: BigInt(nonce),
        value: 0n,
        gasPrice: gasPriceWei,
        data: encodeFunctionData({
          abi: FOUR_TOKEN_MANAGER_ABI,
          functionName: 'buyTokenAMAP',
          args: [tokenAddress as Address, quoteAmount, 1n]
        })
      });
      return hash;
    });
  }

  logger.debug('[FourQuote] 已使用募集币种完成买入', {
    token: tokenAddress,
    quoteToken,
    quoteAmount: quoteAmount.toString(),
    buyHash,
    usedWalletQuote
  });

  return buyHash;
}

async function executeFlapQuoteBuy(params: {
  tokenAddress: string;
  amountBnb: string | number;
  slippage: number;
  quoteToken: string;
  gasPriceWei: bigint;
  nonceExecutor: (label: string, sender: (nonce: number) => Promise<any>) => Promise<any>;
}) {
  const { tokenAddress, amountBnb, slippage, quoteToken, gasPriceWei, nonceExecutor } = params;
  assertWalletReadyForFourQuote();
  const amountStr = typeof amountBnb === 'string' ? amountBnb : amountBnb?.toString?.() || '0';
  let amountWei: bigint;
  try {
    amountWei = parseUnits(amountStr, 18);
  } catch (error) {
    throw new Error('无效的买入数量');
  }
  if (amountWei <= 0n) {
    throw new Error('买入数量必须大于 0');
  }

  const swapContext = buildFourSwapContext(gasPriceWei, nonceExecutor);
  const { quoteAmount, usedWalletQuote } = await prepareFlapQuoteBuy({
    tokenAddress,
    amountInWei: amountWei,
    slippage,
    quoteToken,
    swapContext,
    publicClient,
    walletAddress: walletAccount.address
  });

  const expected = await publicClient.readContract({
    address: CONTRACTS.FLAP_PORTAL,
    abi: FLAP_PORTAL_ABI,
    functionName: 'quoteExactInput',
    args: [{
      inputToken: quoteToken as Address,
      outputToken: tokenAddress as Address,
      inputAmount: quoteAmount
    }]
  });
  const expectedTokens = typeof expected === 'bigint' ? expected : BigInt((expected as any)?.amountOut ?? 0n);
  if (expectedTokens <= 0n) {
    throw new Error('Flap Portal 报价为 0，无法执行');
  }
  const slippageBps = resolveSwapSlippageBps(slippage);
  const minTokens = expectedTokens * BigInt(10000 - slippageBps) / 10000n;

  const txHash = await nonceExecutor('flap-quote-buy', async (nonce) => {
    const hash = await walletClient.sendTransaction({
      account: walletAccount,
      chain: chainConfig,
      to: CONTRACTS.FLAP_PORTAL,
      nonce: BigInt(nonce),
      value: 0n,
      gasPrice: gasPriceWei,
      data: encodeFunctionData({
        abi: FLAP_PORTAL_ABI,
        functionName: 'swapExactInput',
        args: [{
          inputToken: quoteToken as Address,
          outputToken: tokenAddress as Address,
          inputAmount: quoteAmount,
          minOutputAmount: minTokens,
          permitData: '0x'
        }]
      })
    });
    return hash;
  });

  logger.debug('[FlapQuote] 已使用募集币种完成买入', {
    token: tokenAddress,
    quoteToken,
    quoteAmount: quoteAmount.toString(),
    usedWalletQuote
  });

  return txHash;
}

async function executeXModeDirectBuy(params: {
  tokenAddress: string;
  amountBnb: string | number;
  gasPriceWei: bigint;
  nonceExecutor: (label: string, sender: (nonce: number) => Promise<any>) => Promise<any>;
}) {
  const { tokenAddress, amountBnb, gasPriceWei, nonceExecutor } = params;
  assertWalletReadyForFourQuote();
  const amountStr = typeof amountBnb === 'string' ? amountBnb : amountBnb?.toString?.() || '0';
  let amountWei: bigint;
  try {
    amountWei = parseUnits(amountStr, 18);
  } catch (error) {
    throw new Error('无效的买入数量');
  }
  if (amountWei <= 0n) {
    throw new Error('买入数量必须大于 0');
  }

  const buyHash = await sendFourEncodedBuy({
    tokenAddress,
    funds: amountWei,
    minAmount: 1n,
    msgValue: amountWei,
    gasPriceWei,
    nonceExecutor,
    label: 'xmode-buy'
  });

  logger.debug('[FourQuote] 已使用 X Mode 接口买入', {
    token: tokenAddress,
    amountWei: amountWei.toString(),
    buyHash
  });

  return buyHash;
}

type FourQuoteSettlementParams = {
  txHash: string;
  quoteToken: string;
  quoteBalanceBefore: bigint;
  slippage: number;
  gasPriceWei: bigint;
  nonceExecutor: (label: string, sender: (nonce: number) => Promise<any>) => Promise<any>;
};

function scheduleFourQuoteSellSettlement(params: FourQuoteSettlementParams) {
  const task = async () => {
    try {
      assertWalletReadyForFourQuote();
      const swapContext = buildFourSwapContext(params.gasPriceWei, params.nonceExecutor);
      const result = await finalizeFourQuoteConversion({
        txHash: params.txHash,
        quoteToken: params.quoteToken,
        quoteBalanceBefore: params.quoteBalanceBefore,
        slippage: params.slippage,
        swapContext,
        publicClient,
        walletAddress: walletAccount.address,
        delay
      });
      if (result.converted) {
        invalidateWalletDerivedCaches(walletAccount.address);
        pushWalletStatusToAllTabs();
      }
    } catch (error) {
      logger.error('[FourQuote] 处理自动兑换时出错:', error);
    }
  };
  nonceMutex.runExclusive(task).catch((error) => {
    logger.error('[FourQuote] 安排自动兑换失败:', error);
  });
}

function extractTokenAddressFromUrl(url?: string | null) {
  if (!url) return null;
  let pathname = '';
  let hostname = '';
  let parsed: URL | null = null;
  try {
    parsed = new URL(url);
  } catch {
    try {
      parsed = new URL(url, 'https://placeholder.invalid');
    } catch {
      parsed = null;
    }
  }
  if (parsed) {
    pathname = parsed.pathname || '';
    hostname = parsed.hostname?.toLowerCase() || '';
  } else {
    pathname = url;
  }

  const matchFirstGroup = (pattern: RegExp, target: string) => {
    const match = target.match(pattern);
    return match ? (match[1] || match[0]) : null;
  };

  type HostPattern = {
    hostIncludes: string;
    pathPattern: RegExp;
  };

  const hostPatterns: HostPattern[] = [
    { hostIncludes: 'gmgn.ai', pathPattern: /\/token\/(0x[a-fA-F0-9]{40})/i },
    { hostIncludes: 'four.meme', pathPattern: /\/token\/(0x[a-fA-F0-9]{40})/i },
    { hostIncludes: 'web3.binance.com', pathPattern: /\/token\/[a-z0-9-]+\/(0x[a-fA-F0-9]{40})/i },
    { hostIncludes: 'flap.sh', pathPattern: /\/(?:bnb|bsc|eth|arb|op)\/(0x[a-fA-F0-9]{40})(?:\/|$)/i }
  ];

  for (const pattern of hostPatterns) {
    if (hostname.includes(pattern.hostIncludes)) {
      return matchFirstGroup(pattern.pathPattern, pathname);
    }
  }

  return null;
}

function syncTokenContextFromUrl(url: string) {
  if (!chrome?.storage?.local) {
    return;
  }
  const tokenAddress = extractTokenAddressFromUrl(url);
  const normalized = normalizeTokenAddressValue(tokenAddress);
  if (!normalized) {
    return;
  }

  if (normalized === currentTokenContext.tokenAddress && url === currentTokenContext.url) {
    return;
  }

  const payload = {
    tokenAddress: normalized,
    url,
    updatedAt: Date.now()
  };

  chrome.storage.local.set({ [SIDE_PANEL_TOKEN_STORAGE_KEY]: payload }, () => {
    const err = chrome.runtime?.lastError;
    if (err) {
      logger.debug('[Background] 同步 token 上下文失败:', err.message);
    }
  });

  updateTokenContext({ tokenAddress: normalized, url, source: 'tabs', force: true });
}

const TOKEN_PAGE_URL_PATTERNS = [
  'https://gmgn.ai/*/token/*',
  'https://web3.binance.com/*/token/*',
  'https://four.meme/token/*',
  'https://flap.sh/*'
];

function resyncTokenContextFromExistingTabs() {
  if (!chrome?.tabs?.query) {
    return;
  }
  chrome.tabs.query({ url: TOKEN_PAGE_URL_PATTERNS }, (tabs) => {
    if (chrome.runtime?.lastError) {
      logger.debug('[Background] 查询代币标签失败:', chrome.runtime.lastError.message);
      return;
    }
    if (!tabs || tabs.length === 0) {
      return;
    }
    const activeTabs = tabs.filter((tab) => tab.active);
    const targets = activeTabs.length > 0 ? activeTabs : tabs;
    targets.forEach((tab) => {
      if (tab?.url) {
        syncTokenContextFromUrl(tab.url);
      }
    });
  });
}

function setupTokenContextSyncFromTabs() {
  if (!chrome?.tabs?.onUpdated) {
    return;
  }

  chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
    if (changeInfo?.url) {
      syncTokenContextFromUrl(changeInfo.url);
    }
  });

  if (chrome.tabs?.onActivated) {
    chrome.tabs.onActivated.addListener(({ tabId }) => {
      chrome.tabs.get(tabId, (tab) => {
        if (chrome.runtime?.lastError) {
          return;
        }
        if (tab?.url) {
          syncTokenContextFromUrl(tab.url);
        }
      });
    });
  }

  if (chrome.runtime?.onInstalled) {
    chrome.runtime.onInstalled.addListener(() => {
      resyncTokenContextFromExistingTabs();
    });
  }

  if (chrome.runtime?.onStartup) {
    chrome.runtime.onStartup.addListener(() => {
      resyncTokenContextFromExistingTabs();
    });
  }

  // Prime context for already-open Trade tabs when the service worker wakes up.
  resyncTokenContextFromExistingTabs();
}

setupTokenContextSyncFromTabs();

function setupTokenContextSyncFromStorage() {
  if (!chrome?.storage?.local || !chrome?.storage?.onChanged) {
    return;
  }

  chrome.storage.local.get([SIDE_PANEL_TOKEN_STORAGE_KEY], (result) => {
    const context = result?.[SIDE_PANEL_TOKEN_STORAGE_KEY] as SidePanelTokenContext | undefined;
    if (context?.tokenAddress) {
      updateTokenContext({ tokenAddress: context.tokenAddress, url: context.url, source: 'storage' });
    }
  });

  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName !== 'local' || !(SIDE_PANEL_TOKEN_STORAGE_KEY in changes)) {
      return;
    }
    const change = changes[SIDE_PANEL_TOKEN_STORAGE_KEY];
    const context = change?.newValue as SidePanelTokenContext | undefined;
    if (context?.tokenAddress) {
      updateTokenContext({ tokenAddress: context.tokenAddress, url: context.url, source: 'storage' });
    }
  });
}

setupTokenContextSyncFromStorage();

type PendingRpcRequest = {
  resolve: (value: any) => void;
  reject: (reason?: any) => void;
  timeoutId: ReturnType<typeof setTimeout>;
};
const pendingRpcRequests = new Map<string, PendingRpcRequest>();

let userSettings: UserSettings = DEFAULT_USER_SETTINGS;
let allRpcNodes: string[] = getRpcNodesFromSettings(userSettings);
let settingsReadyPromise: Promise<void> | null = loadUserSettings()
  .then((settings) => {
    applyUserSettings(settings);
  })
  .catch((error) => {
    logger.warn('[Background] 加载用户设置失败，使用默认配置:', error);
  });

onUserSettingsChange((settings) => {
  applyUserSettings(settings, { refreshClients: true, resetNonce: true });
});

const TOKEN_METADATA_TTL = 5 * 60 * 1000; // 5分钟缓存
const BALANCE_CACHE_TTL = 1500;
const TOKEN_INFO_CACHE_TTL = 2000;
type TokenMetadata = {
  decimals?: number;
  symbol?: string;
  totalSupply?: bigint;
  updatedAt: number;
};
type TokenInfoResult = {
  symbol: string;
  decimals: number;
  totalSupply: string;
  balance: string;
  allowances?: {
    pancake: string;
    four: string;
    flap: string;
    xmode: string;
  };
};
type TokenInfoCacheEntry = {
  data: TokenInfoResult;
  updatedAt: number;
  hasAllowances: boolean;
};
const tokenMetadataCache = new Map<string, TokenMetadata>();
const tokenInfoCache = new Map<string, TokenInfoCacheEntry>();
type PendingTradeContext = {
  tokenAddress: string;
  type: 'buy' | 'sell';
};
const pendingTradeContexts = new Map<string, PendingTradeContext>();
type TokenRouteCacheEntry = {
  tokenAddress: string;
  platform: TokenPlatform;
  preferredChannel: string;
  readyForPancake: boolean;
  migrationStatus: 'idle' | 'monitoring' | 'migrating' | 'completed';
  progress: number;
  ttl: number;
  updatedAt: number;
  expiresAt: number;
  quoteToken?: string;
  metadata?: {
    symbol?: string;
    name?: string;
  };
  notes?: string;
  lockReason?: string;
  lockType?: 'migration' | 'approve';
};

type ManualTokenLock = {
  type: 'approve';
  message: string;
  updatedAt: number;
  expiresAt: number;
};
const tokenRouteCache = new Map<string, TokenRouteCacheEntry>();
const tokenLocks = new Map<string, ManualTokenLock>();
const cacheKeyVersions = new Map<string, number>();

function normalizeAddressValue(address?: string | null) {
  return typeof address === 'string' ? address.toLowerCase() : '';
}

function getCacheScope() {
  return currentRpcUrl || 'default';
}

function getVersionedCacheKey(baseKey: string) {
  const version = cacheKeyVersions.get(baseKey) ?? 0;
  return `${baseKey}::v${version}`;
}

function invalidateCacheKey(baseKey: string) {
  const currentVersion = cacheKeyVersions.get(baseKey) ?? 0;
  cacheKeyVersions.set(baseKey, currentVersion + 1);
}

function invalidateCacheKeys(baseKeys: string[]) {
  baseKeys.forEach((key) => {
    if (key) {
      invalidateCacheKey(key);
    }
  });
}

function getTokenInfoCacheKey(walletAddress?: string | null, tokenAddress?: string | null) {
  const normalizedWallet = normalizeAddressValue(walletAddress);
  const normalizedToken = normalizeAddressValue(tokenAddress);
  if (!normalizedWallet || !normalizedToken) {
    return '';
  }
  return `${normalizedWallet}:${normalizedToken}`;
}

function readCachedTokenInfo(tokenAddress: string, walletAddress: string, needAllowances: boolean) {
  const key = getTokenInfoCacheKey(walletAddress, tokenAddress);
  if (!key) {
    return null;
  }
  const cached = tokenInfoCache.get(key);
  if (!cached) {
    return null;
  }
  if (Date.now() - cached.updatedAt > TOKEN_INFO_CACHE_TTL) {
    tokenInfoCache.delete(key);
    return null;
  }
  if (needAllowances && !cached.hasAllowances) {
    return null;
  }
  return cached.data;
}

function writeCachedTokenInfo(tokenAddress: string, walletAddress: string, data: TokenInfoResult) {
  const key = getTokenInfoCacheKey(walletAddress, tokenAddress);
  if (!key) {
    return;
  }
  tokenInfoCache.set(key, {
    data,
    updatedAt: Date.now(),
    hasAllowances: Boolean(data.allowances)
  });
}

function invalidateTokenInfoCache(walletAddress?: string | null, tokenAddress?: string | null) {
  const key = getTokenInfoCacheKey(walletAddress, tokenAddress);
  if (!key) {
    return;
  }
  tokenInfoCache.delete(key);
}

function computeRouteTtl(readyForPancake: boolean, progress: number, migrating: boolean) {
  if (readyForPancake) {
    return 20000;
  }
  if (migrating) {
    return 500;  // 迁移中：0.5秒（最频繁，快速检测迁移完成）
  }
  if (progress >= 0.9) {
    return 1200;
  }
  if (progress >= 0.7) {
    return 2000;
  }
  return 5000;
}

function applyManualLock(entry: TokenRouteCacheEntry) {
  const manualLock = tokenLocks.get(entry.tokenAddress);
  if (!manualLock) {
    return entry;
  }

  if (manualLock.expiresAt && Date.now() > manualLock.expiresAt) {
    tokenLocks.delete(entry.tokenAddress);
    return entry;
  }

  return {
    ...entry,
    lockReason: manualLock.message,
    lockType: manualLock.type
  };
}

function setManualTokenLock(tokenAddress: string, type: ManualTokenLock['type'], message: string) {
  const normalized = normalizeTokenAddressValue(tokenAddress);
  if (!normalized) {
    return;
  }
  tokenLocks.set(normalized, {
    type,
    message,
    updatedAt: Date.now(),
    expiresAt: Date.now() + BACKGROUND_TASK_CONFIG.APPROVE_LOCK_DURATION_MS
  });
  tokenRouteCache.delete(normalized);
}

function clearManualTokenLock(tokenAddress: string, type?: ManualTokenLock['type']) {
  const normalized = normalizeTokenAddressValue(tokenAddress);
  if (!normalized) {
    return;
  }
  const current = tokenLocks.get(normalized);
  if (!current) {
    return;
  }
  if (type && current.type !== type) {
    return;
  }
  tokenLocks.delete(normalized);
  tokenRouteCache.delete(normalized);
}

async function resolveTokenRoute(tokenAddress: string, options: { force?: boolean } = {}) {
  const normalized = normalizeTokenAddressValue(tokenAddress);
  if (!normalized) {
    throw new Error('无效的代币地址');
  }

  const now = Date.now();
  const cached = tokenRouteCache.get(normalized);
  if (cached && !options.force && now < cached.expiresAt) {
    return applyManualLock(cached);
  }

  if (!publicClient) {
    await createClients();
  }

  const platform = detectTokenPlatform(normalized);
  let routeResult: RouteFetchResult | null = null;
  try {
    routeResult = await fetchRouteWithFallback(publicClient, normalized as Address, platform);
  } catch (error) {
    logger.warn('[Route] 拉取通道状态失败，回退默认策略:', error);
    try {
      routeResult = await fetchRouteWithFallback(publicClient, normalized as Address, 'unknown');
    } catch (fallbackError) {
      logger.error('[Route] 默认策略也失败:', fallbackError);
      routeResult = {
        platform: 'unknown',
        preferredChannel: 'pancake',
        readyForPancake: true,
        progress: 1,
        migrating: false
      };
    }
  }

  if (!SUPPORTED_CHANNEL_IDS.has(routeResult.preferredChannel as string)) {
    logger.warn('[Route] 未知通道, 回退 Pancake:', routeResult.preferredChannel);
    routeResult.preferredChannel = 'pancake';
  }

  if (routeResult.preferredChannel === 'pancake') {
    setPancakePreferredMode(normalized, routeResult.metadata?.pancakePreferredMode ?? null);
  } else {
    setPancakePreferredMode(normalized, null);
  }

  const ttl = computeRouteTtl(routeResult.readyForPancake, routeResult.progress, routeResult.migrating);
  let metadata: Record<string, any> | undefined = routeResult.metadata
    ? { ...routeResult.metadata }
    : undefined;
  try {
    const tokenMeta = await ensureTokenMetadata(normalized, { needSymbol: true });
    metadata = {
      ...(routeResult.metadata ?? {}),
      symbol: routeResult.metadata?.symbol || tokenMeta.symbol,
      name: routeResult.metadata?.name || tokenMeta.symbol
    };
  } catch (metaError) {
    logger.debug('[Route] 读取代币元信息失败:', metaError);
  }

  const migrationStatus = routeResult.readyForPancake
    ? 'completed'
    : routeResult.migrating
      ? 'migrating'
      : routeResult.progress >= 0.7
        ? 'monitoring'
        : 'idle';

  // 修复：移除"迁移中"状态的交易锁定
  // "迁移中"是一个短暂的过渡状态（通常只有几秒），不应该阻止用户交易
  // 这样可以避免代币切换时的误判导致前几次交易失败
  // 用户仍然可以看到"迁移中"的状态提示，但不会被强制阻止交易
  const lockReason = undefined;

  const entry: TokenRouteCacheEntry = {
    tokenAddress: normalized,
    platform: routeResult.platform,
    preferredChannel: routeResult.preferredChannel,
    readyForPancake: routeResult.readyForPancake,
    migrationStatus,
    progress: routeResult.progress,
    ttl,
    updatedAt: now,
    expiresAt: now + ttl,
    quoteToken: routeResult.quoteToken,
    metadata: metadata || routeResult.metadata,
    notes: routeResult.notes,
    lockReason,
    lockType: lockReason ? 'migration' : undefined
  };

  tokenRouteCache.set(normalized, entry);
  return applyManualLock(entry);
}

function formatRouteForClient(entry: TokenRouteCacheEntry) {
  return {
    tokenAddress: entry.tokenAddress,
    platform: entry.platform,
    preferredChannel: entry.preferredChannel,
    readyForPancake: entry.readyForPancake,
    migrationStatus: entry.migrationStatus,
    progress: entry.progress,
    quoteToken: entry.quoteToken,
    metadata: entry.metadata,
    notes: entry.notes,
    lockReason: entry.lockReason,
    lockType: entry.lockType,
    nextUpdateIn: entry.ttl,
    updatedAt: entry.updatedAt
  };
}

function invalidateWalletDerivedCaches(
  walletAddress?: string | null,
  tokenAddress?: string | null,
  options: { allowances?: boolean } = {}
) {
  const normalizedWallet = normalizeAddressValue(walletAddress);
  if (!normalizedWallet) {
    return;
  }

  const cacheScope = getCacheScope();
  const normalizedToken = normalizeAddressValue(tokenAddress);
  const baseKeys = [`balance:${cacheScope}:${normalizedWallet}`];

  if (normalizedToken) {
    baseKeys.push(
      `tokenBalance:${cacheScope}:${normalizedWallet}:${normalizedToken}`,
      `token-info-balance:${cacheScope}:${normalizedToken}:${normalizedWallet}`
    );

    if (options.allowances) {
      baseKeys.push(`token-allowances:${cacheScope}:${normalizedToken}:${normalizedWallet}`);
    }
  }

  invalidateCacheKeys(baseKeys);
  if (normalizedToken) {
    invalidateTokenInfoCache(walletAddress, tokenAddress);
  }
}

function isOffscreenSupported() {
  return Boolean(chrome.offscreen && chrome.runtime.getContexts);
}

function ensureWalletNonceManager() {
  if (!walletNonceManager) {
    walletNonceManager = createNonceManager({
      source: {
        async get({ address }) {
          if (!publicClient) {
            await createClients();
          }
          const nonce = await publicClient.getTransactionCount({
            address,
            blockTag: 'pending'
          });
          return Number(nonce);
        },
        set() {}
      }
    });
  }
  return walletNonceManager;
}

function resetWalletNonce(reason = '') {
  if (!walletNonceManager || !walletAccount || !chainConfig) {
    return;
  }
  try {
    walletNonceManager.reset({ address: walletAccount.address, chainId: chainConfig.id });
    managedNonceCursor = null;
    logger.debug(`[NonceManager] 已重置 nonce${reason ? ` (${reason})` : ''}`);
  } catch (error) {
    logger.warn('[NonceManager] 重置失败:', error?.message || error);
  }
}

async function diagnoseNonceMismatch(reason = ''): Promise<NonceDiagnostics | null> {
  if (!walletAccount?.address) {
    return null;
  }

  try {
    if (!publicClient) {
      await createClients();
    }
    if (!publicClient) {
      return null;
    }

    const [pendingNonce, latestNonce] = await Promise.all([
      publicClient.getTransactionCount({
        address: walletAccount.address,
        blockTag: 'pending'
      }),
      publicClient.getTransactionCount({
        address: walletAccount.address,
        blockTag: 'latest'
      })
    ]);

    const pending = Number(pendingNonce);
    const latest = Number(latestNonce);
    const diagnostics: NonceDiagnostics = {
      pending,
      latest,
      diff: pending - latest,
      timestamp: Date.now(),
      reason
    };
    lastNonceDiagnostics = diagnostics;
    logger.warn(
      `[NonceManager] Nonce 诊断${reason ? ` (${reason})` : ''}: pending=${pending}, latest=${latest}, diff=${diagnostics.diff}`
    );
    return diagnostics;
  } catch (error) {
    logger.warn('[NonceManager] Nonce 诊断失败:', error?.message || error);
    return null;
  }
}

async function syncManagedNonce(reason = '') {
  if (!walletAccount?.address) {
    throw new Error('钱包未加载，无法同步 nonce');
  }
  if (!publicClient) {
    await createClients();
  }
  if (!publicClient) {
    throw new Error('RPC 未就绪，无法同步 nonce');
  }
  const pending = Number(
    await publicClient.getTransactionCount({
      address: walletAccount.address,
      blockTag: 'pending'
    })
  );
  if (managedNonceCursor === null || pending > managedNonceCursor) {
    managedNonceCursor = pending;
  }
  if (reason) {
    logger.debug(`[NonceManager] 已同步链上 nonce=${pending} (${reason})`);
  }
  return pending;
}

async function reserveManagedNonce(reason = '') {
  if (managedNonceCursor === null) {
    await syncManagedNonce(reason || 'reserve');
  }
  if (managedNonceCursor === null) {
    throw new Error('无法获取链上 nonce');
  }
  const reserved = managedNonceCursor;
  managedNonceCursor += 1;
  logger.debug(`[NonceManager] 预留 nonce=${reserved}${reason ? ` (${reason})` : ''}`);
  return reserved;
}

function rollbackManagedNonce(reserved: number) {
  if (managedNonceCursor !== null && reserved < managedNonceCursor) {
    managedNonceCursor = reserved;
    logger.debug(`[NonceManager] 回滚 nonce 游标至 ${reserved}`);
  }
}

function isNonceRelatedError(error: any) {
  const message = (error?.shortMessage || error?.message || String(error) || '').toLowerCase();
  if (!message) {
    return false;
  }
  return (
    message.includes('gapped-nonce') ||
    message.includes('nonce too') ||
    message.includes('nonce is too') ||
    (message.includes('nonce provided') && message.includes('lower')) ||
    message.includes('incorrect nonce') ||
    message.includes('nonce mismatch')
  );
}

async function executeWithNonceRetry(task: (nonce: number) => Promise<any>, context: string) {
  const MAX_ATTEMPTS = 3;
  let lastError;
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const reservedNonce = await reserveManagedNonce(`${context}_attempt_${attempt + 1}`);
    try {
      return await task(reservedNonce);
    } catch (error) {
      lastError = error;
      const message = (error?.shortMessage || error?.message || String(error) || '').toLowerCase();
      const isNonceIssue =
        isNonceRelatedError(error) || message.includes('missing or invalid parameters');
      if (isNonceIssue) {
        logger.warn(
          `[${context}] 检测到 nonce 不一致 (attempt ${attempt + 1}/${MAX_ATTEMPTS})，重置 nonce 并重新同步`
        );
        resetWalletNonce(`${context}_gapped_nonce`);
        await diagnoseNonceMismatch(`${context}_attempt_${attempt + 1}`);

        if (attempt < MAX_ATTEMPTS - 1) {
          await syncManagedNonce(`${context}_retry_${attempt + 1}`);
          // nonce 不一致一般与节点连通性无关，无需切换节点
          await createClients(false);
          continue;
        }
      } else {
        rollbackManagedNonce(reservedNonce);
      }
      throw error;
    }
  }
  throw lastError;
}

function createRpcRequestId() {
  if (typeof crypto.randomUUID === 'function') {
    return `rpc_${crypto.randomUUID()}`;
  }
  return `rpc_${Date.now()}_${Math.random().toString(16).slice(2)}`;
}

function rejectPendingRpcRequests(reason: string) {
  if (pendingRpcRequests.size === 0) {
    return;
  }

  pendingRpcRequests.forEach(({ reject, timeoutId }) => {
    clearTimeout(timeoutId);
    try {
      reject(new Error(reason));
    } catch (error) {
      logger.warn('[Background] 无法拒绝待处理的 RPC 请求:', error);
    }
  });
  pendingRpcRequests.clear();
}

function getTokenMetadataKey(address: string) {
  return (address || '').toLowerCase();
}

function readTokenMetadataCache(address: string): TokenMetadata | null {
  const key = getTokenMetadataKey(address);
  const cached = tokenMetadataCache.get(key);
  if (!cached) {
    return null;
  }
  if (Date.now() - cached.updatedAt > TOKEN_METADATA_TTL) {
    tokenMetadataCache.delete(key);
    return null;
  }
  return cached;
}

async function ensureTokenMetadata(
  tokenAddress: string,
  options: { needSymbol?: boolean; needTotalSupply?: boolean } = {}
): Promise<TokenMetadata> {
  const { needSymbol = false, needTotalSupply = false } = options;
  const key = getTokenMetadataKey(tokenAddress);
  let cached = readTokenMetadataCache(tokenAddress) || { updatedAt: 0 };
  const missingFields: Array<'decimals' | 'symbol' | 'totalSupply'> = [];

  if (typeof cached.decimals !== 'number') {
    missingFields.push('decimals');
  }
  if (needSymbol && !cached.symbol) {
    missingFields.push('symbol');
  }
  if (needTotalSupply && !cached.totalSupply) {
    missingFields.push('totalSupply');
  }

  if (missingFields.length > 0) {
    if (!publicClient) {
      await createClients();
    }

    const fetched = await executeWithRetry(async () => {
      const promises = missingFields.map((field) => {
        switch (field) {
          case 'symbol':
            return publicClient.readContract({
              address: tokenAddress,
              abi: ERC20_ABI,
              functionName: 'symbol'
            });
          case 'decimals':
            return publicClient.readContract({
              address: tokenAddress,
              abi: ERC20_ABI,
              functionName: 'decimals'
            });
          case 'totalSupply':
            return publicClient.readContract({
              address: tokenAddress,
              abi: ERC20_ABI,
              functionName: 'totalSupply'
            });
          default:
            return Promise.resolve(null);
        }
      });

      const values = await Promise.all(promises);
      const data: Partial<TokenMetadata> = {};
      missingFields.forEach((field, index) => {
        const value = values[index];
        if (field === 'decimals') {
          data.decimals = typeof value === 'number' ? value : Number(value);
        } else if (field === 'symbol') {
          data.symbol = value as string;
        } else if (field === 'totalSupply') {
          data.totalSupply = value as bigint;
        }
      });
      return data;
    });

    cached = {
      ...cached,
      ...fetched,
      updatedAt: Date.now()
    };
    tokenMetadataCache.set(key, cached);
  } else {
    cached.updatedAt = Date.now();
    tokenMetadataCache.set(key, cached);
  }

  return cached;
}

function getStorageLocal() {
  try {
    return chrome?.storage?.local ?? null;
  } catch (error) {
    logger.warn('[Background] 无法访问 chrome.storage.local:', error);
    return null;
  }
}

async function logPerformanceEvent(eventType: string, payload: Record<string, any>) {
  const entry = {
    eventType,
    payload,
    timestamp: Date.now()
  };

  if (isOffscreenSupported()) {
    try {
      await callOffscreenRpc('rpc_write_log', entry);
      return;
    } catch (error) {
      logger.warn('[Background] Offscreen 日志写入失败，回退到本地:', error);
    }
  }

  const storageLocal = getStorageLocal();
  if (!storageLocal) {
    logger.warn('[Background] 本地日志写入失败: storage.local 不可用');
    return;
  }

  try {
    const existing = await storageLocal.get(['performanceLogs']);
    const logs = Array.isArray(existing.performanceLogs) ? existing.performanceLogs : [];
    logs.push(entry);
    if (logs.length > 100) {
      logs.shift();
    }
    await storageLocal.set({ performanceLogs: logs });
  } catch (error) {
    logger.warn('[Background] 本地日志写入失败:', error);
  }
}

function cacheCall<T>(fn: () => Promise<T>, cacheKey: string, cacheTime: number) {
  const versionedKey = getVersionedCacheKey(cacheKey);
  return dedupePromise(versionedKey, () => withCache(fn, { cacheKey: versionedKey, cacheTime }));
}

async function callOffscreenRpc<T>(task: string, payload: any, timeout = BACKGROUND_TASK_CONFIG.OFFSCREEN_RPC_TIMEOUT_MS): Promise<T> {
  if (!isOffscreenSupported()) {
    throw new Error('Offscreen RPC unavailable');
  }

  await ensureOffscreenDocument();
  const port = await acquireOffscreenPort();

  if (!port) {
    throw new Error('No offscreen port available');
  }

  return new Promise<T>((resolve, reject) => {
    const requestId = createRpcRequestId();
    const timeoutId = setTimeout(() => {
      pendingRpcRequests.delete(requestId);
      reject(new Error('Offscreen RPC timeout'));
    }, timeout);

    pendingRpcRequests.set(requestId, { resolve, reject, timeoutId });

    try {
      port.postMessage({ action: 'rpc_task', requestId, task, payload });
    } catch (error) {
      clearTimeout(timeoutId);
      pendingRpcRequests.delete(requestId);
      reject(error);
    }
  });
}

// RPC 节点管理
let currentRpcIndex = 0;
async function applyUserSettings(
  settings: UserSettings,
  options: { refreshClients?: boolean; resetNonce?: boolean } = {}
) {
  userSettings = settings;
  const fourQuotes = settings.channels?.four?.quoteTokens ?? DEFAULT_FOUR_QUOTE_TOKENS;
  const newSignature = buildQuoteSignature(fourQuotes);
  if (newSignature !== currentFourQuoteSignature) {
    currentFourQuoteSignature = newSignature;
    tokenRouteCache.clear();
  }
  allRpcNodes = getRpcNodesFromSettings(settings);
  if (!allRpcNodes.length) {
    allRpcNodes = getRpcNodesFromSettings(DEFAULT_USER_SETTINGS);
  }
  if (!allRpcNodes.length) {
    allRpcNodes = [NETWORK_CONFIG.BSC_RPC];
  }

  currentRpcIndex = 0;
  if (options.resetNonce) {
    resetWalletNonce('settings_update');
  }
  if (options.refreshClients && publicClient) {
    createClients().catch((error) => {
      logger.warn('[Background] 重建 RPC 客户端失败:', error?.message || error);
    });
  }
}

function normalizeAggregatorAddress(address?: string | null) {
  const normalized = normalizeAddressValue(address);
  if (!normalized || normalized.length !== 42 || !normalized.startsWith('0x')) {
    return '';
  }
  return `0x${normalized.slice(2)}` as `0x${string}`;
}

function getAggregatorRuntimeSettings(): AggregatorRuntimeSettings {
  const raw = userSettings?.aggregator ?? DEFAULT_USER_SETTINGS.aggregator;
  const fallback = normalizeAggregatorAddress(CUSTOM_AGGREGATOR_CONFIG.DEFAULT_ADDRESS) || CUSTOM_AGGREGATOR_CONFIG.DEFAULT_ADDRESS;
  const address = normalizeAggregatorAddress(raw.contractAddress) || fallback;
  return {
    enabled: raw.enabled !== false,
    executionMode: raw.executionMode === 'legacy' ? 'legacy' : 'contract',
    contractAddress: address
  };
}

async function ensureTxWatcherInstance() {
  if (!publicClient) {
    await createClients();
  }

  if (!txWatcher) {
    txWatcher = new TxWatcher(publicClient);
  } else if (publicClient) {
    txWatcher.setClient(publicClient);
  }

  return txWatcher;
}

function normalizeGasPriceInput(value) {
  const minGas = TX_CONFIG.MIN_GAS_PRICE ?? TX_CONFIG.DEFAULT_GAS_PRICE ?? 1;
  const defaultGas = TX_CONFIG.DEFAULT_GAS_PRICE ?? minGas;
  let parsed = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    parsed = defaultGas;
  }
  if (parsed < minGas) {
    logger.warn(`[Background] Gas price ${parsed} gwei 低于网络允许的最小值，自动调整为 ${minGas} gwei`);
  }
  return Math.max(parsed, minGas);
}

function toWeiGasPrice(gwei: number) {
  try {
    return parseUnits(gwei.toString(), 9);
  } catch {
    const fallback = TX_CONFIG.DEFAULT_GAS_PRICE ?? 5;
    return parseUnits(fallback.toString(), 9);
  }
}

// ========== 钱包内存缓存（优化1：减少 storage 调用）==========
let walletCache = {
  encryptedKey: null,
  walletLocked: null,
  address: null,
  passwordHash: null,
  initialized: false
};

/**
 * 初始化钱包缓存
 * 从 storage 加载到内存，后续直接读缓存
 */
async function initWalletCache() {
  if (walletCache.initialized) return;

  const result = await chrome.storage.local.get(['encryptedKey', 'walletLocked', 'address', 'passwordHash']);
  Object.assign(walletCache, result);
  walletCache.initialized = true;

  logger.debug('[Background] 钱包缓存已初始化:', {
    hasKey: !!walletCache.encryptedKey,
    locked: walletCache.walletLocked,
    address: walletCache.address
  });
}

/**
 * 更新钱包缓存并同步到 storage
 */
async function updateWalletCache(updates) {
  Object.assign(walletCache, updates);
  await chrome.storage.local.set(updates);
  logger.debug('[Background] 钱包缓存已更新:', updates);
}

// ========== Service Worker 重启计数 ==========
let serviceWorkerRestarts = 0;
let warmupPromise: Promise<void> | null = null;

// 启动时初始化
(async function init() {
  // 初始化钱包缓存
  await initWalletCache();

  if (settingsReadyPromise) {
    try {
      await settingsReadyPromise;
    } catch (error) {
      logger.warn('[Background] 设置初始化失败，将使用默认配置:', error);
    } finally {
      settingsReadyPromise = null;
    }
  }

  // 初始化公共客户端（确保启动时就创建）
  if (!publicClient) {
    try {
      await createClients();
      logger.debug('[Background] Public client 启动时初始化成功');
    } catch (error) {
      logger.error('[Background] Public client 启动时初始化失败:', error);
    }
  }

  // 加载钱包状态（不自动解密）
  await loadWallet();

  // 读取重启次数
  const result = await chrome.storage.local.get(['swRestartCount']);
  const restartCount = Number(result.swRestartCount ?? 0);
  serviceWorkerRestarts = restartCount + 1;
  await chrome.storage.local.set({ swRestartCount: serviceWorkerRestarts });
  console.log(`[Background] Service Worker 启动次数: ${serviceWorkerRestarts}`);

  // 设置刷新标志
  const refreshFlag = Date.now();
  await chrome.storage.local.set({ lastRefreshTime: refreshFlag });
  logger.debug('[Background] Service Worker refreshed at:', new Date(refreshFlag).toLocaleString());

  warmupBackgroundServices().catch((error) => {
    logger.warn('[Background] 预热任务启动失败:', error);
  });
})();

// ========== Service Worker 保活机制 ==========
let keepAliveTimestamp = 0;
let keepAliveAutoExpireTimer = null;

async function enableKeepAlive(duration = 0) {
  try {
    if (!chrome.offscreen || !chrome.runtime.getContexts) {
      logger.warn('[Background] Offscreen API 不可用，无法启用 keep-alive');
      return;
    }

    await ensureOffscreenDocument();
    const port = await acquireOffscreenPort();

    if (keepAliveAutoExpireTimer) {
      clearTimeout(keepAliveAutoExpireTimer);
      keepAliveAutoExpireTimer = null;
    }

    const interval = WALLET_CONFIG?.KEEP_ALIVE_INTERVAL || 25000;
    keepAliveTimestamp = Date.now();
    port.postMessage({
      action: 'start_keep_alive',
      interval,
      duration
    });

    logger.debug(`[Background] Keep-alive via offscreen document started (interval=${interval}ms, duration=${duration})`);

    if (duration > 0) {
      keepAliveAutoExpireTimer = setTimeout(() => {
        logger.debug('[Background] Keep-alive duration reached, stopping');
        disableKeepAlive();
      }, duration);
    }
  } catch (error) {
    logger.error('[Background] Failed to enable offscreen keep-alive:', error);
  }
}

async function disableKeepAlive() {
  try {
    if (keepAliveAutoExpireTimer) {
      clearTimeout(keepAliveAutoExpireTimer);
      keepAliveAutoExpireTimer = null;
    }

    if (offscreenPort) {
      offscreenPort.postMessage({ action: 'stop_keep_alive' });
    }

    await closeOffscreenDocument();
    logger.debug('[Background] Offscreen keep-alive disabled');
  } catch (error) {
    logger.error('[Background] Failed to disable offscreen keep-alive:', error);
  }
}

async function ensureOffscreenDocument() {
  if (!chrome.offscreen || !chrome.runtime.getContexts) {
    return;
  }

  const hasDocument = await hasOffscreenDocument();
  if (hasDocument) {
    return;
  }

  await chrome.offscreen.createDocument({
    url: OFFSCREEN_DOCUMENT_PATH,
    reasons: ['WORKERS'],
    justification: '保持交易钱包在 Service Worker 中可用'
  });
}

async function closeOffscreenDocument() {
  if (!chrome.offscreen || !chrome.runtime.getContexts) {
    return;
  }

  const hasDocument = await hasOffscreenDocument();
  if (!hasDocument) {
    return;
  }

  await chrome.offscreen.closeDocument();
  offscreenPort = null;
  offscreenPortReadyPromise = null;
  offscreenPortReadyResolver = null;
  rejectPendingRpcRequests('Offscreen document closed');
}

async function hasOffscreenDocument() {
  if (!chrome.runtime.getContexts) {
    return false;
  }

  const contexts = await chrome.runtime.getContexts({
    contextTypes: ['OFFSCREEN_DOCUMENT'],
    documentOrigins: [self.location.origin]
  });

  return contexts.some((context) => context.documentUrl?.endsWith(OFFSCREEN_DOCUMENT_PATH));
}

function waitForOffscreenPort() {
  if (offscreenPort) {
    return Promise.resolve(offscreenPort);
  }

  if (!offscreenPortReadyPromise) {
    offscreenPortReadyPromise = new Promise((resolve) => {
      offscreenPortReadyResolver = resolve;
    });
  }

  return offscreenPortReadyPromise;
}

async function acquireOffscreenPort(timeoutMs = BACKGROUND_TASK_CONFIG.OFFSCREEN_PORT_TIMEOUT_MS ?? 5000) {
  const timeoutError = new Error('offscreen_port_timeout');
  try {
    const port = await Promise.race([
      waitForOffscreenPort(),
      new Promise((_, reject) => setTimeout(() => reject(timeoutError), timeoutMs))
    ]);
    if (!port) {
      throw timeoutError;
    }
    return port;
  } catch (error) {
    if (error === timeoutError || error?.message === timeoutError.message) {
      logger.warn('[Background] 等待 Offscreen 端口超时，重新创建文档');
      try {
        await closeOffscreenDocument();
      } catch (closeError) {
        logger.warn('[Background] 关闭 Offscreen 文档失败:', closeError);
      }
      await delay(200);
      await ensureOffscreenDocument();
      return acquireOffscreenPort(timeoutMs);
    }
    throw error;
  }
}

function broadcastToContentPorts(message) {
  let delivered = 0;

  connectedContentPorts.forEach((ports, tabId) => {
    ports.forEach((port) => {
      try {
        port.postMessage(message);
        delivered++;
      } catch (error) {
        logger.warn(`[Background] 无法推送消息到端口 (tab: ${tabId}):`, error);
        removeContentPortReference(tabId, port);
      }
    });
  });

  return delivered;
}

chrome.runtime.onConnect.addListener((port) => {
  if (port.name === CONTENT_PORT_NAME) {
    handleContentPort(port);
  } else if (port.name === OFFSCREEN_PORT_NAME) {
    handleOffscreenPort(port);
  }
});

function handleContentPort(port) {
  const tabId = port.sender?.tab?.id;
  if (tabId === undefined) {
    logger.debug('[Background] Content port connected without tab context');
    port.disconnect();
    return;
  }

  if (!connectedContentPorts.has(tabId)) {
    connectedContentPorts.set(tabId, new Set());
  }
  connectedContentPorts.get(tabId).add(port);

  let portDisconnected = false;
  const cleanupPort = () => {
    if (portDisconnected) return;
    portDisconnected = true;
    removeContentPortReference(tabId, port);
  };

  port.onDisconnect.addListener(() => {
    cleanupPort();
  });

  const safePortPost = (payload: any) => {
    if (portDisconnected) {
      return false;
    }
    try {
      port.postMessage(payload);
      return true;
    } catch (error) {
      logger.warn('[Background] 向 content port 发送消息失败:', error);
      cleanupPort();
      return false;
    }
  };

  port.onMessage.addListener(async (message) => {
    if (!message || !message.action) {
      return;
    }

    if (message.action === 'subscribe_wallet_updates') {
      const response = await handleGetWalletStatus({});
      const statusData = response.success && response.data
        ? { success: true, ...response.data }
        : response;
      safePortPost({
        action: 'wallet_status_updated',
        data: statusData
      });
      return;
    }

    if (message.requestId) {
      try {
        const result = await processExtensionRequest(message.action, message.data);
        safePortPost({
          requestId: message.requestId,
          data: result
        });
      } catch (error) {
        safePortPost({
          requestId: message.requestId,
          data: { success: false, error: error.message }
        });
      }
    }
  });
}

function handleOffscreenPort(port) {
  offscreenPort = port;
  if (offscreenPortReadyResolver) {
    offscreenPortReadyResolver(port);
    offscreenPortReadyResolver = null;
  }
  offscreenPortReadyPromise = null;

  port.onDisconnect.addListener(() => {
    offscreenPort = null;
    offscreenPortReadyPromise = null;
    offscreenPortReadyResolver = null;
    rejectPendingRpcRequests('Offscreen port disconnected');
  });

  port.onMessage.addListener((message) => {
    if (!message || !message.action) {
      return;
    }

    if (message.action === 'keep_alive_ping') {
      const uptime = ((Date.now() - keepAliveTimestamp) / 1000).toFixed(1);
      logger.debug(`[Background] Offscreen keep-alive ping (uptime: ${uptime}s)`);
    } else if (message.action === 'keep_alive_stopped') {
      logger.debug(`[Background] Offscreen keep-alive stopped (${message.reason || 'unknown'})`);
      if (message.reason === 'auto') {
        closeOffscreenDocument();
      }
    } else if (message.action === 'rpc_result') {
      const pendingRequest = pendingRpcRequests.get(message.requestId);
      if (!pendingRequest) {
        return;
      }
      clearTimeout(pendingRequest.timeoutId);
      pendingRpcRequests.delete(message.requestId);

      if (message.success) {
        pendingRequest.resolve(message.data);
      } else {
        pendingRequest.reject(new Error(message.error || 'Offscreen RPC error'));
      }
    }
  });
}

// ========== PUSH 模式：主动推送钱包状态到前端 ==========
/**
 * 推送钱包状态更新到所有标签页
 * @param {object} statusData - 要推送的状态数据
 */
async function pushWalletStatusToAllTabs(statusData = null) {
  try {
    // 如果没有提供状态数据，获取当前状态
    if (!statusData) {
      const response = await handleGetWalletStatus({ tokenAddress: getActiveTokenAddressFromContext() ?? undefined });
      // 将嵌套的数据结构展平
      if (response.success && response.data) {
        statusData = {
          success: true,
          ...response.data
        };
      } else {
        statusData = response;
      }
    }

    logger.debug('[Background] 推送钱包状态到所有标签页:', statusData.status || statusData.error || 'unknown');

    const delivered = broadcastToContentPorts({
      action: 'wallet_status_updated',
      data: statusData
    });

    if (delivered === 0) {
      chrome.tabs.query({ url: CONTENT_SCRIPT_URL_PATTERNS }, (tabs) => {
        logger.debug(`[Background] 找到 ${tabs.length} 个代币交易标签页（fallback 推送）`);
        tabs.forEach((tab) => {
          chrome.tabs.sendMessage(tab.id, {
            action: 'wallet_status_updated',
            data: statusData
          }).catch((error) => {
            logger.debug(`[Background] 无法推送到标签页 ${tab.id}: ${error.message}`);
          });
        });
      });
    }
  } catch (error) {
    logger.error('[Background] 推送钱包状态失败:', error);
  }
}

/**
 * 推送代币余额更新到所有标签页
 * @param {string} tokenAddress - 代币地址
 * @param {object} balanceData - 余额数据
 */
function pushTokenBalanceToAllTabs(tokenAddress, balanceData) {
  try {
    logger.debug('[Background] 推送代币余额更新:', tokenAddress);

    const delivered = broadcastToContentPorts({
      action: 'token_balance_updated',
      data: {
        tokenAddress,
        ...balanceData
      }
    });

    if (delivered === 0) {
      chrome.tabs.query({ url: CONTENT_SCRIPT_URL_PATTERNS }, (tabs) => {
        tabs.forEach((tab) => {
          chrome.tabs.sendMessage(tab.id, {
            action: 'token_balance_updated',
            data: {
              tokenAddress,
              ...balanceData
            }
          }).catch(() => {});
        });
      });
    }
  } catch (error) {
    logger.error('[Background] 推送代币余额失败:', error);
  }
}

function normalizeTxHashValue(txHash?: string | null) {
  return typeof txHash === 'string' ? txHash.toLowerCase() : '';
}

function trackPendingTrade(txHash: string | null | undefined, context: PendingTradeContext) {
  const key = normalizeTxHashValue(txHash);
  if (!key) {
    return;
  }
  pendingTradeContexts.set(key, context);
}

function consumePendingTradeContext(txHash: string | null | undefined): PendingTradeContext | null {
  const key = normalizeTxHashValue(txHash);
  if (!key) {
    return null;
  }
  const context = pendingTradeContexts.get(key) || null;
  if (context) {
    pendingTradeContexts.delete(key);
  }
  return context;
}

async function refreshTokenInfoAfterTx(tokenAddress: string, options: { includeAllowances?: boolean } = {}) {
  if (!walletAccount) {
    return;
  }
  const { includeAllowances = false } = options;
  try {
    const latestInfo = await fetchTokenInfoData(tokenAddress, walletAccount.address, includeAllowances);
    writeCachedTokenInfo(tokenAddress, walletAccount.address, latestInfo);
    if (typeof latestInfo.balance === 'string') {
      pushTokenBalanceToAllTabs(tokenAddress, { balance: latestInfo.balance });
    }
  } catch (error) {
    logger.warn('[Background] 刷新代币信息失败:', error?.message || error);
  }
}

// ========== 创建或切换 RPC 客户端 ==========
async function createClients(forceSwitch = false) {
  if (forceSwitch) {
    currentRpcIndex = (currentRpcIndex + 1) % allRpcNodes.length;
  }

  const rpcUrl = allRpcNodes[currentRpcIndex];
  const chain = buildChainConfig(rpcUrl);

  try {
    const client = createHttpClient(rpcUrl, chain);
    await client.getBlockNumber();
    publicClient = client;
    chainConfig = chain;
    currentRpcUrl = rpcUrl;
    logger.debug(`[Background] 已连接 RPC 节点: ${rpcUrl}`);
  } catch (error) {
    logger.warn(`[Background] 连接 RPC 节点失败 (${rpcUrl}): ${error.message}`);
    if (!forceSwitch && allRpcNodes.length > 1) {
      currentRpcIndex = (currentRpcIndex + 1) % allRpcNodes.length;
      return createClients(true);
    }
    throw error;
  }

  if (walletPrivateKey) {
    await createWalletClientInstance();
  }

  if (txWatcher) {
    txWatcher.setClient(publicClient);
    if (txWatcher.hasActiveWatchers()) {
      await txWatcher.forceReconnect();
    }
  }
}

async function createWalletClientInstance() {
  if (!walletPrivateKey || !currentRpcUrl || !chainConfig) {
    return;
  }

  const { account, client } = createWallet(walletPrivateKey, currentRpcUrl, chainConfig, {
    nonceManager: ensureWalletNonceManager()
  });
  walletAccount = account;
  walletClient = client;
  logger.debug('[Background] Wallet client 已更新:', walletAccount.address);
}

// RPC 调用包装器 - 自动重试并切换节点
async function executeWithRetry(asyncFunc, maxRetries = 2) {
  let lastError;

  for (let i = 0; i <= maxRetries; i++) {
    try {
      return await asyncFunc();
    } catch (error) {
      lastError = error;
      const errorMsg = error.message || error.toString();

      // 检查是否是 RPC 节点错误（401, 429, 503 等）
      if (errorMsg.includes('401') || errorMsg.includes('429') ||
          errorMsg.includes('503') || errorMsg.includes('SERVER_ERROR')) {

        logger.warn(`[Background] RPC 错误 (尝试 ${i + 1}/${maxRetries + 1}):`, errorMsg);

        // 如果还有重试次数，切换节点
        if (i < maxRetries) {
          await createClients(true);  // 切换到下一个节点
          continue;
        }
      }

      // 其他错误直接抛出
      throw error;
    }
  }

  throw lastError;
}

// 加载钱包
async function loadWallet() {
  try {
    // 使用内存缓存而不是重新读取 storage
    if (!walletCache.encryptedKey) {
      logger.debug('[Background] No wallet found');
      return;
    }

    // 只有明确被锁定时才不加载
    if (walletCache.walletLocked === true) {
      logger.debug('[Background] Wallet is locked');
      walletPrivateKey = null;
      walletAccount = null;
      walletClient = null;
      return;
    }

    // Service Worker 重启后，钱包需要重新解锁
    // 不自动解密，确保安全性
    logger.debug('[Background] Service Worker restarted, wallet needs re-unlock');
    walletPrivateKey = null;
    walletAccount = null;
    walletClient = null;
    // handleGetWalletStatus 会返回 not_loaded 状态
  } catch (error) {
    logger.error('[Background] Failed to load wallet:', error);
  }
}

// 加密私钥（简化版）
async function encryptPrivateKey(privateKey, password) {
  // 实际应该使用 crypto.subtle API 进行 AES-256-GCM 加密
  // 这里简化处理，仅做演示
  const encoder = new TextEncoder();
  const data = encoder.encode(privateKey);

  // 使用密码派生密钥
  const passwordKey = await crypto.subtle.importKey(
    'raw',
    encoder.encode(password),
    { name: 'PBKDF2' },
    false,
    ['deriveKey']
  );

  const salt = crypto.getRandomValues(new Uint8Array(16));
  const key = await crypto.subtle.deriveKey(
    {
      name: 'PBKDF2',
      salt: salt,
      iterations: 100000,
      hash: 'SHA-256'
    },
    passwordKey,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt']
  );

  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encrypted = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv: iv },
    key,
    data
  );

  return {
    encrypted: Array.from(new Uint8Array(encrypted)),
    salt: Array.from(salt),
    iv: Array.from(iv)
  };
}

// 解密私钥（简化版）
async function decryptPrivateKey(encryptedData, password = 'default') {
  // 实际解密逻辑
  const encoder = new TextEncoder();

  const passwordKey = await crypto.subtle.importKey(
    'raw',
    encoder.encode(password),
    { name: 'PBKDF2' },
    false,
    ['deriveKey']
  );

  const salt = new Uint8Array(encryptedData.salt);
  const key = await crypto.subtle.deriveKey(
    {
      name: 'PBKDF2',
      salt: salt,
      iterations: 100000,
      hash: 'SHA-256'
    },
    passwordKey,
    { name: 'AES-GCM', length: 256 },
    false,
    ['decrypt']
  );

  const iv = new Uint8Array(encryptedData.iv);
  const encrypted = new Uint8Array(encryptedData.encrypted);

  const decrypted = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: iv },
    key,
    encrypted
  );

  const decoder = new TextDecoder();
  return decoder.decode(decrypted);
}

// 密码哈希（用于验证）
async function hashPassword(password) {
  const encoder = new TextEncoder();
  const data = encoder.encode(password);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

type RuntimeRequest = {
  action?: string;
  data?: any;
};

// ========================================
// 预加载处理器 - 用于页面切换时预加载数据
// ========================================

/**
 * 预加载代币余额
 * 在用户切换到代币页面时后台预加载，这样点击买入时数据已缓存
 */
async function handlePrefetchTokenBalance({ tokenAddress }: { tokenAddress?: string } = {}) {
  try {
    if (!tokenAddress || !walletAccount) {
      return { success: false, cached: false };
    }

    // 预加载代币余额（会自动缓存）
    await fetchWalletBalances(walletAccount.address, tokenAddress);

    // 同时预加载 quote token 余额（如果需要）
    try {
      const route = await resolveTokenRoute(tokenAddress, { force: false });
      if (route?.quoteToken && route.quoteToken.toLowerCase() !== CONTRACTS.WBNB.toLowerCase()) {
        // 非 BNB 筹集，预加载 quote token 余额
        await getQuoteBalance(publicClient, route.quoteToken, walletAccount.address);
      }
    } catch {
      // Quote token 余额预加载失败不影响主流程
    }

    return { success: true, cached: true };
  } catch (error) {
    // 预加载失败静默处理
    logger.debug('[Prefetch] Token balance prefetch failed:', error);
    return { success: false, cached: false };
  }
}

/**
 * 预加载授权状态
 * 如果启用了切换页面授权，在页面切换时检查并执行授权
 */
async function handlePrefetchApprovalStatus({ tokenAddress }: { tokenAddress?: string } = {}) {
  try {
    if (!tokenAddress || !walletAccount) {
      return { success: false };
    }

    // 获取路由信息
    const route = await resolveTokenRoute(tokenAddress, { force: false });
    if (!route) {
      return { success: false };
    }

    // 根据路由信息判断需要授权的代币
    let tokenToApprove: string | null = null;
    let spender: string | null = null;

    if (route.readyForPancake) {
      // 已迁移：需要授权 quote token 给 PancakeRouter
      if (route.quoteToken && route.quoteToken.toLowerCase() !== CONTRACTS.WBNB.toLowerCase()) {
        tokenToApprove = route.quoteToken;
        spender = CONTRACTS.PANCAKE_ROUTER;
      }
    } else {
      // 未迁移：需要授权 quote token 给平台合约
      if (route.quoteToken && route.quoteToken.toLowerCase() !== CONTRACTS.WBNB.toLowerCase()) {
        tokenToApprove = route.quoteToken;
        // 根据平台选择 spender
        if (route.platform === 'four') {
          spender = CONTRACTS.FOUR_TOKEN_MANAGER_V2;
        } else if (route.platform === 'flap') {
          spender = CONTRACTS.FLAP_PORTAL;
        }
      }
    }

    // 如果需要授权，检查授权状态（会自动缓存）
    if (tokenToApprove && spender && publicClient) {
      try {
        await publicClient.readContract({
          address: tokenToApprove as Address,
          abi: ERC20_ABI,
          functionName: 'allowance',
          args: [walletAccount.address, spender as Address]
        });
      } catch {
        // 授权查询失败不影响主流程
      }
    }

    return { success: true };
  } catch (error) {
    // 预加载失败静默处理
    logger.debug('[Prefetch] Approval status prefetch failed:', error);
    return { success: false };
  }
}

/**
 * 查询缓存信息（调试用）
 */
async function handleGetCacheInfo({ tokenAddress }: { tokenAddress?: string } = {}) {
  try {
    if (!tokenAddress) {
      return { success: false, error: '缺少 tokenAddress 参数' };
    }

    const normalizedAddress = normalizeAddressValue(tokenAddress);

    // 获取路由缓存
    const tradeHint = getTokenTradeHint(normalizedAddress);

    // 获取授权缓存
    const allowances: Record<string, string> = {};
    if (walletAccount) {
      const pancakeRouter = '0x10ED43C718714eb63d5aA57B78B54704E256024E';
      const smartRouter = '0x13f4EA83D0bd40E75C8222255bc855a974568Dd4';

      const pancakeAllowance = getCachedAllowance(normalizedAddress, pancakeRouter);
      const smartRouterAllowance = getCachedAllowance(normalizedAddress, smartRouter);

      if (pancakeAllowance !== null) {
        allowances.pancake = pancakeAllowance.toString();
      }
      if (smartRouterAllowance !== null) {
        allowances.smartRouter = smartRouterAllowance.toString();
      }
    }

    // 格式化时间戳
    const formatTimestamp = (ts?: number) => {
      if (!ts) return null;
      const age = Math.floor((Date.now() - ts) / 1000);
      return {
        timestamp: ts,
        ageSeconds: age,
        ageMinutes: Math.floor(age / 60)
      };
    };

    return {
      success: true,
      tokenAddress: normalizedAddress,
      cache: {
        route: tradeHint ? {
          buyRouteStatus: tradeHint.buyRouteStatus || 'idle',
          sellRouteStatus: tradeHint.sellRouteStatus || 'idle',
          buyRouteLoadedAt: formatTimestamp(tradeHint.buyRouteLoadedAt),
          sellRouteLoadedAt: formatTimestamp(tradeHint.sellRouteLoadedAt),
          lastMode: tradeHint.lastMode,
          lastBuyPath: tradeHint.lastBuyPath,
          lastSellPath: tradeHint.lastSellPath,
          channelId: tradeHint.channelId,
          updatedAt: formatTimestamp(tradeHint.updatedAt)
        } : null,
        allowances
      }
    };
  } catch (error) {
    logger.error('[GetCacheInfo] Error:', error);
    return { success: false, error: error.message };
  }
}

/**
 * 预加载交易路由
 * 在用户切换到代币页面时后台预加载买入和卖出路由
 * 买入路由优先，卖出路由并发执行但不阻塞
 */
async function handlePrefetchRoute({ tokenAddress }: { tokenAddress?: string } = {}) {
  try {
    if (!tokenAddress || !walletAccount || !publicClient) {
      return { success: false, cached: false };
    }

    // 获取路由信息
    const route = await resolveTokenRoute(tokenAddress, { force: false });
    if (!route || route.lockReason) {
      return { success: false, cached: false };
    }

    const channelId = route.preferredChannel || 'pancake';
    let channelHandler: any;
    try {
      channelHandler = getChannel(channelId);
    } catch (error) {
      logger.debug('[Prefetch] 未知通道，使用 Pancake:', error);
      channelHandler = getChannel('pancake');
    }

    // 预加载买入路由（使用小额 BNB）
    const buyAmount = parseEther('0.001'); // 0.001 BNB
    const buyPromise = channelHandler.quoteBuy?.({
      publicClient,
      tokenAddress,
      amount: buyAmount
    }).catch(() => null);

    // 预加载卖出路由（使用 1 token）
    const sellAmount = parseEther('1'); // 1 token
    const sellPromise = channelHandler.quoteSell?.({
      publicClient,
      tokenAddress,
      amount: sellAmount,
      routeInfo: route
    }).catch(() => null);

    // 并发执行，但不等待结果（后台预加载）
    Promise.all([buyPromise, sellPromise]).catch(() => {});

    return { success: true, cached: true };
  } catch (error) {
    // 预加载失败静默处理
    logger.debug('[Prefetch] Route prefetch failed:', error);
    return { success: false, cached: false };
  }
}

const ACTION_HANDLER_MAP = {
  import_wallet: handleImportWallet,
  unlock_wallet: handleUnlockWallet,
  lock_wallet: handleLockWallet,
  remove_wallet: handleRemoveWallet,
  get_wallet_status: handleGetWalletStatus,
  buy_token: handleBuyToken,
  sell_token: handleSellToken,
  approve_token: handleApproveToken,
  check_token_approval: handleCheckTokenApproval,
  revoke_token_approval: handleRevokeTokenApproval,
  init_tx_watcher: handleInitTxWatcher,
  get_tx_watcher_status: handleGetTxWatcherStatus,
  get_token_info: handleGetTokenInfo,
  get_token_route: handleGetTokenRoute,
  estimate_sell_amount: handleEstimateSellAmount,
  // 预加载处理器
  prefetch_token_balance: handlePrefetchTokenBalance,
  prefetch_approval_status: handlePrefetchApprovalStatus,
  prefetch_route: handlePrefetchRoute,
  // 调试工具
  get_cache_info: handleGetCacheInfo
};

async function processExtensionRequest(action: string, data: any = {}) {
  const handler = ACTION_HANDLER_MAP[action];
  if (handler) {
    return handler(data);
  }

  if (action === 'show_notification') {
    chrome.notifications.create({
      type: 'basic',
      iconUrl: 'icons/icon48.png',
      title: data?.title ?? 'BSC Dog Bang Trade Plugin',
      message: data?.message ?? ''
    });
    return { success: true };
  }

  return { success: false, error: 'Unknown action' };
}

// 消息处理
chrome.runtime.onMessage.addListener((request: RuntimeRequest, sender, sendResponse) => {
  if (!request || !request.action) {
    sendResponse({ success: false, error: 'Invalid request' });
    return false;
  }

  logger.debug('[Background] Received message:', request.action);

  processExtensionRequest(request.action, request.data)
    .then((result) => sendResponse(result))
    .catch((error) => {
      logger.error('[Background] runtime request error:', error);
      sendResponse({ success: false, error: error.message });
    });

  return true;
});

// 导入钱包
async function handleImportWallet({ privateKey, password }) {
  try {
    if (!publicClient) {
      await createClients();
    }

    const { account, client } = createWallet(privateKey, currentRpcUrl, chainConfig, {
      nonceManager: ensureWalletNonceManager()
    });

    // 加密存储
    const encrypted = await encryptPrivateKey(privateKey, password);
    const passwordHash = await hashPassword(password);

    // 更新缓存和storage（使用优化后的方法）
    await updateWalletCache({
      encryptedKey: encrypted,
      walletLocked: false,
      address: account.address,
      passwordHash
    });

    walletPrivateKey = privateKey;
    walletAccount = account;
    walletClient = client;
    logger.debug('[Background] Wallet imported and loaded:', walletAccount.address);

    // 自动启用 Keep-Alive（如果配置了）
    if (WALLET_CONFIG?.AUTO_KEEP_ALIVE_ON_UNLOCK) {
      const duration = WALLET_CONFIG.KEEP_ALIVE_DURATION || 0;
      await enableKeepAlive(duration);
      logger.debug(`[Background] 导入后自动启用 Keep-Alive (${duration > 0 ? (duration / 1000 / 60).toFixed(0) + '分钟' : '永久'})`);
    }

    await warmupBackgroundServices();

    // PUSH 模式：立即推送完整的钱包状态到所有标签页
    logger.debug('[Background] 导入钱包成功，开始推送状态到所有标签页');
    await pushWalletStatusToAllTabs();
    logger.debug('[Background] 钱包状态推送完成');

    return { success: true, address: account.address };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

type UnlockPayload = {
  password?: string;
};

// 解锁钱包
async function handleUnlockWallet(data: UnlockPayload = {}) {
  try {
    const { password } = data;

    if (!password) {
      return { success: false, error: '请输入密码' };
    }

    // 使用内存缓存（优化1）
    if (!walletCache.encryptedKey) {
      return { success: false, error: '钱包未设置' };
    }

    // 验证密码
    const inputHash = await hashPassword(password);
    if (inputHash !== walletCache.passwordHash) {
      return { success: false, error: '密码错误' };
    }

    if (!publicClient) {
      logger.debug('[Background] Public client 未初始化，创建中...');
      await createClients();
    }

    // 用正确的密码解密私钥
    const privateKey = await decryptPrivateKey(walletCache.encryptedKey, password);
    walletPrivateKey = privateKey;
    await createWalletClientInstance();

    logger.debug('[Background] Wallet unlocked:', walletAccount.address);

    // 更新缓存中的锁定状态与最近解锁时间
    await updateWalletCache({ walletLocked: false, lastUnlockTime: Date.now() });

    // 自动启用 Keep-Alive（如果配置了）
    if (WALLET_CONFIG?.AUTO_KEEP_ALIVE_ON_UNLOCK) {
      const duration = WALLET_CONFIG.KEEP_ALIVE_DURATION || 0;
      await enableKeepAlive(duration);
      logger.debug(`[Background] 解锁后自动启用 Keep-Alive (${duration > 0 ? (duration / 1000 / 60).toFixed(0) + '分钟' : '永久'})`);
    }

    warmupBackgroundServices().catch((error) => {
      logger.warn('[Background] 解锁后预热服务失败:', error?.message || error);
    });

    // PUSH 模式：立即推送完整的钱包状态到所有标签页
    pushWalletStatusToAllTabs();

    return { success: true };
  } catch (error) {
    logger.error('[Background] Unlock failed:', error);
    return { success: false, error: '解锁失败：' + error.message };
  }
}

// 锁定钱包
async function handleLockWallet() {
  try {
    walletClient = null;
    walletAccount = null;
    walletPrivateKey = null;
    walletNonceManager = null;
    await updateWalletCache({ walletLocked: true });
    logger.debug('[Background] Wallet locked');

    // 禁用 Keep-Alive
    disableKeepAlive();
    logger.debug('[Background] 锁定钱包后禁用 Keep-Alive');

    // PUSH 模式：推送锁定状态
    pushWalletStatusToAllTabs({
      success: false,
      error: 'locked',
      status: 'locked',
      address: walletCache.address
    });

    return { success: true };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

async function handleRemoveWallet() {
  try {
    logger.debug('[Background] Removing wallet data');
    walletClient = null;
    walletAccount = null;
    walletPrivateKey = null;
    walletNonceManager = null;
    disableKeepAlive();

    Object.assign(walletCache, {
      encryptedKey: null,
      walletLocked: null,
      address: null,
      passwordHash: null
    });

    await chrome.storage.local.remove([
      'encryptedKey',
      'walletLocked',
      'address',
      'passwordHash',
      'lastUnlockTime'
    ]);

    await pushWalletStatusToAllTabs({
      success: false,
      error: 'not_setup',
      status: 'not_setup'
    });

    return { success: true };
  } catch (error) {
    logger.error('[Background] Remove wallet failed:', error);
    return { success: false, error: error.message };
  }
}

type WalletStatusResult = {
  address: string;
  bnbBalance: string;
  status: 'unlocked';
  tokenBalance?: string;
};

type WalletBalancePayload = {
  bnbBalance: string;
  tokenBalance?: string;
};

async function fetchWalletBalances(address: string, tokenAddress?: string): Promise<WalletBalancePayload> {
  if (isOffscreenSupported()) {
    try {
      return await callOffscreenRpc<WalletBalancePayload>('rpc_get_wallet_status', {
        address,
        tokenAddress
      });
    } catch (error) {
      logger.warn('[Background] Offscreen RPC 获取余额失败，回退到本地调用:', error);
    }
  }

  if (!publicClient) {
    logger.debug('[Background] Public client 未初始化，创建中...');
    await createClients();
  }

  const cacheScope = getCacheScope();
  const normalizedAddress = normalizeAddressValue(address);

  const balance = await cacheCall(
    () => executeWithRetry(async () => publicClient.getBalance({ address })),
    `balance:${cacheScope}:${normalizedAddress}`,
    BALANCE_CACHE_TTL
  );
  const bnbBalance = parseFloat(formatEther(balance)).toFixed(4);
  const result: WalletBalancePayload = { bnbBalance };

  if (tokenAddress) {
    const normalizedTokenAddress = normalizeAddressValue(tokenAddress);
    try {
      const metadata = await ensureTokenMetadata(tokenAddress);
      const tokenValue = await cacheCall(
        () =>
          executeWithRetry(async () =>
            publicClient.readContract({
              address: tokenAddress,
              abi: ERC20_ABI,
              functionName: 'balanceOf',
              args: [address]
            })
          ),
        `tokenBalance:${cacheScope}:${normalizedAddress}:${normalizedTokenAddress}`,
        BALANCE_CACHE_TTL
      );
      const decimals = metadata.decimals ?? 18;
      result.tokenBalance = parseFloat(formatUnits(tokenValue, decimals)).toFixed(4);
    } catch (error) {
      logger.error('[Background] Failed to get token balance:', error);
      result.tokenBalance = '0.00';
    }
  }

  return result;
}

// 获取钱包状态
async function handleGetWalletStatus(data: { tokenAddress?: string } = {}) {
  try {
    // 使用内存缓存（优化1：避免 storage IO）
    // 未设置钱包
    if (!walletCache.encryptedKey) {
      return {
        success: false,
        error: 'not_setup',
        status: 'not_setup'
      };
    }

    // 钱包已锁定
    if (walletCache.walletLocked === true) {
      return {
        success: false,
        error: 'locked',
        status: 'locked',
        address: walletCache.address  // 返回地址用于显示
      };
    }

    // 钱包实例未加载（可能需要重新解锁）
    if (!walletAccount || !walletClient) {
      return {
        success: false,
        error: 'not_loaded',
        status: 'not_loaded',
        address: walletCache.address
      };
    }

    const resolvedTokenAddress = data.tokenAddress
      ? normalizeTokenAddressValue(data.tokenAddress)
      : getActiveTokenAddressFromContext();

    if (data.tokenAddress && resolvedTokenAddress) {
      updateTokenContext({ tokenAddress: resolvedTokenAddress, source: 'trade' });
    }

    const walletBalances = await fetchWalletBalances(
      walletAccount.address,
      resolvedTokenAddress || undefined
    );
    const result: WalletStatusResult = {
      address: walletAccount.address,
      bnbBalance: walletBalances.bnbBalance,
      status: 'unlocked'
    };

    if (walletBalances.tokenBalance !== undefined) {
      result.tokenBalance = walletBalances.tokenBalance;
    }

    return {
      success: true,
      data: result
    };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

// 买入代币（多通道支持）
async function handleBuyToken({ tokenAddress, amount, slippage, gasPrice, channel = 'pancake', forceChannel = false }) {
  return nonceMutex.runExclusive(async () => {
    const timer = new PerformanceTimer('buy');
    let stepStart = perf.now();
    const normalizedTokenAddress = ensureTradeTokenContext(tokenAddress);
    let resolvedChannelId = channel;
    let clientRouteInfo = null;

    try {
      // 步骤1: 检查钱包状态
      stepStart = perf.now();
      if (!walletCache.encryptedKey) {
        throw new Error('请先导入钱包');
      }
      if (walletCache.walletLocked === true) {
        throw new Error('钱包已锁定，请先解锁');
      }
      if (!walletClient || !walletAccount) {
        throw new Error('钱包未加载，请重新解锁');
      }
      timer.step(`检查钱包状态 (${perf.measure(stepStart).toFixed(2)}ms)`);

      // 步骤2: 初始化客户端和预热服务
      stepStart = perf.now();
      const needCreateClient = !publicClient;
      await Promise.all([
        publicClient ? Promise.resolve() : createClients(),
        warmupBackgroundServices()
      ]);
      timer.step(`${needCreateClient ? '创建客户端+' : ''}预热服务 (${perf.measure(stepStart).toFixed(2)}ms)`);

      // 步骤2.5: 解析代币路由
      stepStart = perf.now();
      const routeInfo = await resolveTokenRoute(normalizedTokenAddress);
      timer.step(`解析代币路由 (${perf.measure(stepStart).toFixed(2)}ms)`);

      if (routeInfo.lockReason) {
        throw new Error(routeInfo.lockReason);
      }
      if (forceChannel && channel) {
        resolvedChannelId = channel;
      } else {
        resolvedChannelId = routeInfo?.preferredChannel || channel || 'pancake';
      }
      clientRouteInfo = routeInfo ? formatRouteForClient(routeInfo) : null;
      const slippageValue = Number(slippage);
      const resolvedSlippage = Number.isFinite(slippageValue) ? slippageValue : 0;
      logger.debug('[Buy] Starting buy transaction:', { tokenAddress: normalizedTokenAddress, amount, slippage, channel: resolvedChannelId });

      // 步骤3: 获取通道处理器
      stepStart = perf.now();
      const channelHandler = getChannel(resolvedChannelId);
      timer.step(`获取通道处理器 (${perf.measure(stepStart).toFixed(2)}ms)`);

      // 步骤4: 规范化 Gas Price
      stepStart = perf.now();
      const normalizedGasPrice = normalizeGasPriceInput(gasPrice);
      const gasPriceWei = toWeiGasPrice(normalizedGasPrice);
      timer.step(`规范化GasPrice (${perf.measure(stepStart).toFixed(2)}ms)`);

      // 步骤5: 执行区块链买入交易
      stepStart = perf.now();
      logger.debug('[Buy] 开始区块链操作...');
      const nonceExecutor = (label: string, sender: (nonce: number) => Promise<any>) =>
        executeWithNonceRetry(sender, `${resolvedChannelId}:${label}`);
      const useQuoteBridge = shouldUseFourQuote(routeInfo, resolvedChannelId);
      const useFlapQuote = shouldUseFlapQuote(routeInfo, resolvedChannelId);
      const aggregatorSettings = getAggregatorRuntimeSettings();
      const useCustomAggregator = shouldUseCustomAggregator(
        aggregatorSettings,
        resolvedChannelId,
        routeInfo
      );
      const isXModeToken = routeInfo?.platform === 'xmode';
      const shouldUseXModeBuy = isXModeToken && FOUR_CHANNEL_IDS.has(resolvedChannelId);
      const quoteTokenAddress = routeInfo?.quoteToken;
      let txHash;
      if (useCustomAggregator) {
        const quoteToken = routeInfo?.quoteToken;
        if (!quoteToken) {
          throw new Error('无法读取募集币种信息，请稍后重试');
        }
        try {
          txHash = await executeCustomAggregatorBuy({
            channelId: resolvedChannelId,
            tokenAddress: normalizedTokenAddress,
            amountBnb: amount,
            slippage: resolvedSlippage,
            quoteToken,
            aggregatorAddress: aggregatorSettings.contractAddress,
            routeInfo,
            publicClient,
            walletClient,
            chain: chainConfig,
            account: walletAccount,
            gasPriceWei,
            nonceExecutor
          });
        } catch (aggregatorError) {
          if (isAggregatorUnsupportedError(aggregatorError)) {
            logger.debug('[Aggregator] 当前募集币路径不支持合约交易，自动回退到默认逻辑', {
              channelId: resolvedChannelId,
              tokenAddress: normalizedTokenAddress
            });
          } else {
            logger.warn('[Aggregator] 合约执行失败，自动回退到默认逻辑:', aggregatorError?.message || aggregatorError);
          }
        }
      }
      if (!txHash && useQuoteBridge) {
        const quoteToken = requireFourQuoteToken(routeInfo);
        logger.debug('[Buy] 检测到非 BNB 支付，自动触发兑换流程', {
          quoteToken,
          quoteLabel: resolveQuoteTokenName(quoteToken)
        });
        txHash = await executeFourQuoteBuy({
          tokenAddress: normalizedTokenAddress,
          amountBnb: amount,
          slippage: resolvedSlippage,
          quoteToken,
          gasPriceWei,
          nonceExecutor,
          useEncodedBuy: shouldUseXModeBuy
        });
      }
      if (!txHash && useFlapQuote) {
        const quoteToken = routeInfo?.quoteToken;
        if (!quoteToken) {
          throw new Error('无法读取 Flap 募集币种信息，请稍后重试');
        }
        logger.debug('[Buy] 检测到 Flap 募集币种支付，自动触发兑换流程', {
          quoteToken,
          quoteLabel: resolveQuoteTokenName(quoteToken)
        });
        txHash = await executeFlapQuoteBuy({
          tokenAddress: normalizedTokenAddress,
          amountBnb: amount,
          slippage: resolvedSlippage,
          quoteToken,
          gasPriceWei,
          nonceExecutor
        });
      }
      if (!txHash && shouldUseXModeBuy && isBnbQuote(quoteTokenAddress)) {
        txHash = await executeXModeDirectBuy({
          tokenAddress: normalizedTokenAddress,
          amountBnb: amount,
          gasPriceWei,
          nonceExecutor
        });
      }
      if (!txHash) {
        txHash = await channelHandler.buy({
          publicClient,
          walletClient,
          account: walletAccount,
          chain: chainConfig,
          tokenAddress: normalizedTokenAddress,
          amount,
          slippage: resolvedSlippage,
          gasPrice: normalizedGasPrice,
          nonceExecutor,
          quoteToken: routeInfo?.quoteToken,
          routeInfo: routeInfo
        });
      }
      timer.step(`执行区块链买入交易 (${perf.measure(stepStart).toFixed(2)}ms)`);

      // 步骤6: 清除缓存
      stepStart = perf.now();
      invalidateWalletDerivedCaches(walletAccount.address, normalizedTokenAddress);
      timer.step(`清除缓存 (${perf.measure(stepStart).toFixed(2)}ms)`);

      logger.debug('[Buy] Transaction sent:', txHash);
      trackPendingTrade(txHash, {
        tokenAddress: normalizedTokenAddress,
        type: 'buy'
      });

      // 步骤7: 启动 TxWatcher 监听
      stepStart = perf.now();
      try {
        const watcher = await ensureTxWatcherInstance();
        const txStartTime = Date.now();
        await watcher.watchTransaction(txHash, onTxConfirmed, txStartTime);
        logger.debug('[Buy] TxWatcher 监听已启动');
        timer.step(`启动TxWatcher监听 (${perf.measure(stepStart).toFixed(2)}ms)`);
      } catch (watcherError) {
        logger.warn('[Buy] 启动 TxWatcher 失败:', watcherError);
        timer.step(`TxWatcher启动失败 (${perf.measure(stepStart).toFixed(2)}ms)`);
      }

      const perfResult = timer.finish();

      // 输出性能摘要
      logger.perf(`[Buy] 交易完成 - 总耗时: ${perfResult.totalTime.toFixed(2)}ms`);
      logger.perf(`[Buy] 性能明细:`, perfResult.steps);

      resolveTokenRoute(normalizedTokenAddress, { force: true }).catch((routeError) => {
        logger.debug('[Buy] 刷新通道状态失败:', routeError);
      });

      await logPerformanceEvent('buy_success', {
        tokenAddress: normalizedTokenAddress,
        txHash,
        channel: resolvedChannelId,
        performance: perfResult
      });

      return {
        success: true,
        txHash,
        channel: resolvedChannelId,
        route: clientRouteInfo || undefined,
        performance: {
          totalTime: perfResult.totalTime,
          steps: perfResult.steps
        }
      };
    } catch (error) {
      resetWalletNonce('buy_failed');
      logger.error('[Buy] Error:', error);

      timer.step(`交易失败: ${error.message}`);
      const perfResult = timer.finish();

      // 输出性能摘要（即使失败也记录）
      logger.perf(`[Buy] 交易失败 - 总耗时: ${perfResult.totalTime.toFixed(2)}ms`);
      logger.perf(`[Buy] 性能明细:`, perfResult.steps);

      const errorMessage = normalizeRpcError(error);

      const response = {
        success: false,
        error: errorMessage,
        performance: {
          totalTime: perfResult.totalTime,
          steps: perfResult.steps
        }
      };

      await logPerformanceEvent('buy_failed', {
        tokenAddress: normalizedTokenAddress,
        channel: resolvedChannelId,
        route: clientRouteInfo || undefined,
        error: errorMessage,
        performance: perfResult
      });

      return response;
    }
  });
}

// 卖出代币（多通道支持）
async function handleSellToken({ tokenAddress, percent, slippage, gasPrice, channel = 'pancake', forceChannel = false }) {
  return nonceMutex.runExclusive(async () => {
    const timer = new PerformanceTimer('sell');
    let stepStart = perf.now();
    const normalizedTokenAddress = ensureTradeTokenContext(tokenAddress);
    let resolvedChannelId = channel;
    let clientRouteInfo = null;

    try {
      // 步骤1: 检查钱包状态
      stepStart = perf.now();
      if (!walletCache.encryptedKey) {
        throw new Error('请先导入钱包');
      }
      if (walletCache.walletLocked === true) {
        throw new Error('钱包已锁定，请先解锁');
      }
      if (!walletClient || !walletAccount) {
        throw new Error('钱包未加载，请重新解锁');
      }
      timer.step(`检查钱包状态 (${perf.measure(stepStart).toFixed(2)}ms)`);

      // 步骤2: 初始化客户端和预热服务
      stepStart = perf.now();
      const needCreateClient = !publicClient;
      await Promise.all([
        publicClient ? Promise.resolve() : createClients(),
        warmupBackgroundServices()
      ]);
      timer.step(`${needCreateClient ? '创建客户端+' : ''}预热服务 (${perf.measure(stepStart).toFixed(2)}ms)`);

      // 步骤2.5: 解析代币路由
      stepStart = perf.now();
      const routeInfo = await resolveTokenRoute(normalizedTokenAddress);
      timer.step(`解析代币路由 (${perf.measure(stepStart).toFixed(2)}ms)`);

      if (routeInfo.lockReason) {
        throw new Error(routeInfo.lockReason);
      }
      if (forceChannel && channel) {
        resolvedChannelId = channel;
      } else {
        resolvedChannelId = routeInfo?.preferredChannel || channel || 'pancake';
      }
      clientRouteInfo = routeInfo ? formatRouteForClient(routeInfo) : null;
      const slippageValue = Number(slippage);
      const resolvedSlippage = Number.isFinite(slippageValue) ? slippageValue : 0;
      const percentValue = Number(percent);
      const resolvedPercent = Number.isFinite(percentValue) ? percentValue : 100;

      logger.debug('[Sell] Starting sell transaction:', { tokenAddress: normalizedTokenAddress, percent: resolvedPercent, slippage, channel: resolvedChannelId });

      // 步骤3: 获取通道处理器
      stepStart = perf.now();
      const channelHandler = getChannel(resolvedChannelId);
      timer.step(`获取通道处理器 (${perf.measure(stepStart).toFixed(2)}ms)`);

      // 步骤4: 规范化 Gas Price
      stepStart = perf.now();
      const normalizedGasPrice = normalizeGasPriceInput(gasPrice);
      const gasPriceWei = toWeiGasPrice(normalizedGasPrice);
      timer.step(`规范化GasPrice (${perf.measure(stepStart).toFixed(2)}ms)`);

      // 步骤5: 执行区块链卖出交易
      stepStart = perf.now();
      logger.debug('[Sell] 开始区块链操作...');
      const nonceExecutor = (label: string, sender: (nonce: number) => Promise<any>) =>
        executeWithNonceRetry(sender, `${resolvedChannelId}:${label}`);
      const useQuoteBridge = shouldUseFourQuote(routeInfo, resolvedChannelId);
      const aggregatorSettings = getAggregatorRuntimeSettings();
      const useCustomAggregator = shouldUseCustomAggregator(
        aggregatorSettings,
        resolvedChannelId,
        routeInfo
      );
      let txHash: string | null = null;
      if (useCustomAggregator) {
        try {
          txHash = await executeCustomAggregatorSell({
            channelId: resolvedChannelId,
            tokenAddress: normalizedTokenAddress,
            percent: resolvedPercent,
            slippage: resolvedSlippage,
            aggregatorAddress: aggregatorSettings.contractAddress,
            routeInfo,
            publicClient,
            walletClient,
            account: walletAccount,
            chain: chainConfig,
            gasPriceWei,
            nonceExecutor
          });
        } catch (aggregatorError) {
          if (isAggregatorUnsupportedError(aggregatorError)) {
            logger.debug('[Aggregator] 当前卖出路径不支持合约交易，自动回退到默认逻辑', {
              channelId: resolvedChannelId,
              tokenAddress: normalizedTokenAddress
            });
          } else {
            logger.warn('[Aggregator] 合约卖出失败，自动回退到默认逻辑:', aggregatorError?.message || aggregatorError);
          }
        }
      }

      let pendingQuoteSettlement: Omit<FourQuoteSettlementParams, 'txHash'> | null = null;
      if (!txHash) {
        // 性能优化：并发执行 quote balance 查询和卖出交易
        let quoteBalancePromise: Promise<bigint> | null = null;
        let quoteToken: string | null = null;

        if (useQuoteBridge) {
          quoteToken = requireFourQuoteToken(routeInfo);
          quoteBalancePromise = getQuoteBalance(publicClient, quoteToken, walletAccount.address);
          logger.debug('[Sell] 检测到非 BNB 支付，卖出后将自动兑换', {
            quoteToken,
            quoteLabel: resolveQuoteTokenName(quoteToken)
          });
        }

        // 并发执行：卖出交易和 quote balance 查询
        const [sellTxHash, quoteBalanceBefore] = await Promise.all([
          channelHandler.sell({
            publicClient,
            walletClient,
            account: walletAccount,
            chain: chainConfig,
            tokenAddress: normalizedTokenAddress,
            percent: resolvedPercent,
            slippage: resolvedSlippage,
            gasPrice: normalizedGasPrice,
            nonceExecutor,
            routeInfo: routeInfo
          }),
          quoteBalancePromise || Promise.resolve(0n)
        ]);

        txHash = sellTxHash;

        if (useQuoteBridge && quoteToken) {
          pendingQuoteSettlement = {
            quoteToken,
            quoteBalanceBefore,
            slippage: resolvedSlippage,
            gasPriceWei,
            nonceExecutor
          };
        }
      }
      if (!txHash) {
        throw new Error('未能发送卖出交易');
      }
      timer.step(`执行区块链卖出交易 (${perf.measure(stepStart).toFixed(2)}ms)`);

      // 步骤6: 清除缓存
      stepStart = perf.now();
      invalidateWalletDerivedCaches(walletAccount.address, normalizedTokenAddress, { allowances: true });
      timer.step(`清除缓存 (${perf.measure(stepStart).toFixed(2)}ms)`);

      logger.debug('[Sell] Transaction sent:', txHash);
      trackPendingTrade(txHash, {
        tokenAddress: normalizedTokenAddress,
        type: 'sell'
      });
      if (pendingQuoteSettlement) {
        scheduleFourQuoteSellSettlement({
          ...pendingQuoteSettlement,
          txHash
        });
      }

      // 步骤7: 启动 TxWatcher 监听
      stepStart = perf.now();
      try {
        const watcher = await ensureTxWatcherInstance();
        const txStartTime = Date.now();
        await watcher.watchTransaction(txHash, onTxConfirmed, txStartTime);
        logger.debug('[Sell] TxWatcher 监听已启动');
        timer.step(`启动TxWatcher监听 (${perf.measure(stepStart).toFixed(2)}ms)`);
      } catch (watcherError) {
        logger.warn('[Sell] 启动 TxWatcher 失败:', watcherError);
        timer.step(`TxWatcher启动失败 (${perf.measure(stepStart).toFixed(2)}ms)`);
      }

      const perfResult = timer.finish();

      // 输出性能摘要
      logger.perf(`[Sell] 交易完成 - 总耗时: ${perfResult.totalTime.toFixed(2)}ms`);
      logger.perf(`[Sell] 性能明细:`, perfResult.steps);

      resolveTokenRoute(normalizedTokenAddress, { force: true }).catch((routeError) => {
        logger.debug('[Sell] 刷新通道状态失败:', routeError);
      });

      await logPerformanceEvent('sell_success', {
        tokenAddress: normalizedTokenAddress,
        txHash,
        channel: resolvedChannelId,
        route: clientRouteInfo || undefined,
        performance: perfResult
      });

      return {
        success: true,
        txHash,
        channel: resolvedChannelId,
        route: clientRouteInfo || undefined,
        performance: {
          totalTime: perfResult.totalTime,
          steps: perfResult.steps
        }
      };
    } catch (error) {
      resetWalletNonce('sell_failed');
      logger.error('[Sell] Error:', error);

      timer.step(`交易失败: ${error.message}`);
      const perfResult = timer.finish();

      // 输出性能摘要（即使失败也记录）
      logger.perf(`[Sell] 交易失败 - 总耗时: ${perfResult.totalTime.toFixed(2)}ms`);
      logger.perf(`[Sell] 性能明细:`, perfResult.steps);

      const errorMessage = normalizeRpcError(error);

      const response = {
        success: false,
        error: errorMessage,
        performance: {
          totalTime: perfResult.totalTime,
          steps: perfResult.steps
        }
      };

      await logPerformanceEvent('sell_failed', {
        tokenAddress: normalizedTokenAddress,
        channel: resolvedChannelId,
        route: clientRouteInfo || undefined,
        error: errorMessage,
        performance: perfResult
      });

      return response;
    }
  });
}

// 授权代币（预授权功能）
async function handleApproveToken({ tokenAddress, channel = 'pancake' }) {
  return nonceMutex.runExclusive(async () => {
    let approveLockApplied = false;

    const ensureApproveLock = () => {
      if (!approveLockApplied) {
        setManualTokenLock(tokenAddress, 'approve', '正在执行代币授权...');
        approveLockApplied = true;
      }
    };

    try {
      logger.debug('[Approve] 开始预授权:', { tokenAddress, channel });

      // 使用内存缓存检查钱包状态（优化1）
      if (!walletCache.encryptedKey) {
        return { success: false, error: '请先导入钱包', needApproval: false };
      }

      if (walletCache.walletLocked === true) {
        return { success: false, error: '钱包已锁定，请先解锁', needApproval: false };
      }

      if (!walletClient || !walletAccount) {
        return { success: false, error: '钱包未加载，请重新解锁', needApproval: false };
      }

      if (!publicClient) {
        await createClients();
      }

      // 获取授权地址（根据通道）
      let spenderAddress;
      switch (channel) {
        case 'pancake':
          spenderAddress = CONTRACTS.PANCAKE_ROUTER;
          break;
        case 'four':
        case 'xmode':
          spenderAddress = CONTRACTS.FOUR_TOKEN_MANAGER_V2;
          break;
        case 'flap':
          spenderAddress = CONTRACTS.FLAP_PORTAL;
          break;
        default:
          spenderAddress = CONTRACTS.PANCAKE_ROUTER;
      }

      // 查询当前授权额度
      const allowance = await executeWithRetry(async () => publicClient.readContract({
        address: tokenAddress,
        abi: ERC20_ABI,
        functionName: 'allowance',
        args: [walletAccount.address, spenderAddress]
      }));
      const metadata = await ensureTokenMetadata(tokenAddress, { needTotalSupply: true });
      const totalSupply = metadata.totalSupply ?? 0n;

      logger.debug('[Approve] 当前授权额度:', allowance.toString());

      // 如果授权额度已经足够（大于总供应量的50%），则不需要重新授权
      if (allowance > totalSupply / 2n) {
        logger.debug('[Approve] 授权额度充足，无需重新授权');
        return {
          success: true,
          message: '授权已存在',
          needApproval: false,
          allowance: allowance.toString()
        };
      }

      // 执行授权
      ensureApproveLock();
      logger.debug('[Approve] 执行授权交易...');
      const approveRequest: any = {
        account: walletAccount,
        chain: chainConfig,
        to: tokenAddress,
        data: encodeFunctionData({
          abi: ERC20_ABI,
          functionName: 'approve',
          args: [spenderAddress, totalSupply]
        }),
        gasPrice: parseUnits('1', 9),
        value: 0n
      };

      let preparedApprove: any = approveRequest;
      try {
        preparedApprove = await walletClient.prepareTransactionRequest(approveRequest);
      } catch (error) {
        logger.warn('[Approve] prepareTransactionRequest 失败，使用保守 Gas 上限:', error?.message || error);
        preparedApprove = { ...approveRequest, gas: BigInt(TX_CONFIG.GAS_LIMIT.APPROVE) };
      }

      const hash = await executeWithNonceRetry(async (nonce) => {
        let requestToSend = { ...preparedApprove, nonce: BigInt(nonce) };
        try {
          requestToSend = await publicClient.fillTransaction(requestToSend);
        } catch (error) {
          logger.debug('[Approve] fillTransaction fallback:', error?.message || error);
          requestToSend = { ...preparedApprove, nonce: BigInt(nonce) };
        }

        const txHash = await walletClient.sendTransaction(requestToSend);
        logger.debug('[Approve] 等待交易确认...', txHash);
        await publicClient.waitForTransactionReceipt({ hash: txHash });
        return txHash;
      }, 'approve');
      invalidateWalletDerivedCaches(walletAccount.address, tokenAddress, { allowances: true });

      logger.debug('[Approve] 授权成功');
      return {
        success: true,
        message: '授权成功',
        needApproval: true,
        txHash: hash,
        allowance: totalSupply.toString()
      };

    } catch (error) {
      resetWalletNonce('approve_failed');
      logger.error('[Approve] 授权失败:', error);
      return {
        success: false,
        error: error.message,
        needApproval: false
      };
    } finally {
      if (approveLockApplied) {
        clearManualTokenLock(tokenAddress, 'approve');
      }
      resolveTokenRoute(tokenAddress, { force: true }).catch((routeError) => {
        logger.debug('[Approve] 刷新通道状态失败:', routeError);
      });
    }
  });
}

// 撤销代币授权
async function handleRevokeTokenApproval({ tokenAddress, channel = 'pancake' }) {
  return nonceMutex.runExclusive(async () => {
    let revokeLockApplied = false;

    const ensureRevokeLock = () => {
      if (!revokeLockApplied) {
        setManualTokenLock(tokenAddress, 'approve', '正在撤销授权...');
        revokeLockApplied = true;
      }
    };

    try {
      logger.debug('[Revoke] 开始撤销授权:', { tokenAddress, channel });

      // 使用内存缓存检查钱包状态
      if (!walletCache.encryptedKey) {
        return { success: false, error: '请先导入钱包' };
      }

      if (walletCache.walletLocked === true) {
        return { success: false, error: '钱包已锁定，请先解锁' };
      }

      if (!walletClient || !walletAccount) {
        return { success: false, error: '钱包未加载，请重新解锁' };
      }

      if (!publicClient) {
        await createClients();
      }

      // 获取授权地址（根据通道）
      let spenderAddress;
      switch (channel) {
        case 'pancake':
          spenderAddress = CONTRACTS.PANCAKE_ROUTER;
          break;
        case 'four':
        case 'xmode':
          spenderAddress = CONTRACTS.FOUR_TOKEN_MANAGER_V2;
          break;
        case 'flap':
          spenderAddress = CONTRACTS.FLAP_PORTAL;
          break;
        default:
          spenderAddress = CONTRACTS.PANCAKE_ROUTER;
      }

      // 执行撤销授权（设置为0）
      ensureRevokeLock();
      logger.debug('[Revoke] 执行撤销授权交易...');
      const revokeRequest: any = {
        account: walletAccount,
        chain: chainConfig,
        to: tokenAddress,
        data: encodeFunctionData({
          abi: ERC20_ABI,
          functionName: 'approve',
          args: [spenderAddress, 0n]  // 设置为0以撤销授权
        }),
        gasPrice: parseUnits('1', 9),
        value: 0n
      };

      let preparedRevoke: any = revokeRequest;
      try {
        preparedRevoke = await walletClient.prepareTransactionRequest(revokeRequest);
      } catch (error) {
        logger.warn('[Revoke] prepareTransactionRequest 失败，使用保守 Gas 上限:', error?.message || error);
        preparedRevoke = { ...revokeRequest, gas: BigInt(TX_CONFIG.GAS_LIMIT.APPROVE) };
      }

      const hash = await executeWithNonceRetry(async (nonce) => {
        let requestToSend = { ...preparedRevoke, nonce: BigInt(nonce) };
        try {
          requestToSend = await publicClient.fillTransaction(requestToSend);
        } catch (error) {
          logger.debug('[Revoke] fillTransaction fallback:', error?.message || error);
          requestToSend = { ...preparedRevoke, nonce: BigInt(nonce) };
        }

        const txHash = await walletClient.sendTransaction(requestToSend);
        logger.debug('[Revoke] 等待交易确认...', txHash);
        await publicClient.waitForTransactionReceipt({ hash: txHash });
        return txHash;
      }, 'revoke');
      invalidateWalletDerivedCaches(walletAccount.address, tokenAddress, { allowances: true });

      // 清除授权缓存
      clearAllowanceCache(tokenAddress, spenderAddress);

      logger.debug('[Revoke] 撤销授权成功');
      return {
        success: true,
        message: '撤销授权成功',
        txHash: hash
      };

    } catch (error) {
      resetWalletNonce('revoke_failed');
      logger.error('[Revoke] 撤销授权失败:', error);
      return {
        success: false,
        error: error.message
      };
    } finally {
      if (revokeLockApplied) {
        clearManualTokenLock(tokenAddress, 'approve');
      }
      resolveTokenRoute(tokenAddress, { force: true }).catch((routeError) => {
        logger.debug('[Revoke] 刷新通道状态失败:', routeError);
      });
    }
  });
}

// 查询代币授权状态
async function handleCheckTokenApproval({ tokenAddress, channel = 'pancake' }) {
  try {
    logger.debug('[Check Approval] 查询授权状态:', { tokenAddress, channel });

    if (!walletAccount) {
      return { success: false, error: '请先导入并解锁钱包', approved: false };
    }

    if (!publicClient) {
      await createClients();
    }

    // 获取授权地址（根据通道）
    let spenderAddress;
    switch (channel) {
      case 'pancake':
        spenderAddress = CONTRACTS.PANCAKE_ROUTER;
        break;
      case 'four':
      case 'xmode':
        spenderAddress = CONTRACTS.FOUR_TOKEN_MANAGER_V2;
        break;
      case 'flap':
        spenderAddress = CONTRACTS.FLAP_PORTAL;
        break;
      default:
        spenderAddress = CONTRACTS.PANCAKE_ROUTER;
    }

    // 🚀 性能优化：优先使用缓存，避免频繁查询链上
    // 1. 先尝试从 tokenInfo 缓存获取
    const normalizedTokenAddress = normalizeTokenAddressValue(tokenAddress);
    const tokenInfo = normalizedTokenAddress ? readCachedTokenInfo(normalizedTokenAddress, walletAccount.address, true) : null;

    let allowance: bigint | null = null;
    let totalSupply: bigint | null = null;

    // 从 tokenInfo 缓存获取授权信息
    if (tokenInfo?.allowances) {
      const channelKey = channel === 'pancake' ? 'pancake' : channel === 'four' || channel === 'xmode' ? 'four' : 'flap';
      if (tokenInfo.allowances[channelKey]) {
        allowance = BigInt(tokenInfo.allowances[channelKey]);
        logger.debug('[Check Approval] 使用 tokenInfo 缓存的授权:', allowance.toString());
      }
    }

    // 如果缓存未命中，查询链上
    if (allowance === null) {
      allowance = await executeWithRetry(async () => publicClient.readContract({
        address: tokenAddress,
        abi: ERC20_ABI,
        functionName: 'allowance',
        args: [walletAccount.address, spenderAddress]
      }));
      logger.debug('[Check Approval] 查询链上授权:', allowance.toString());
    }

    // 获取 totalSupply（优先使用缓存）
    if (tokenInfo?.totalSupply) {
      totalSupply = BigInt(tokenInfo.totalSupply);
    } else {
      const metadata = await ensureTokenMetadata(tokenAddress, { needTotalSupply: true });
      totalSupply = metadata.totalSupply ?? 0n;
    }

    // 如果授权额度大于总供应量的50%，认为已授权
    const approved = allowance > totalSupply / 2n;

    logger.debug('[Check Approval] 授权状态:', { approved, allowance: allowance.toString(), totalSupply: totalSupply.toString() });

    return {
      success: true,
      approved,
      allowance: allowance.toString(),
      totalSupply: totalSupply.toString()
    };
  } catch (error) {
    logger.error('[Check Approval] 查询失败:', error);
    return {
      success: false,
      error: error.message,
      approved: false
    };
  }
}

// 初始化 TxWatcher
async function handleInitTxWatcher() {
  try {
    if (!publicClient) {
      await createClients();
    }

    const watcher = await ensureTxWatcherInstance();
    const result = await watcher.initialize();

    if (result) {
      return {
        success: true,
        mode: watcher.getCurrentMode(),
        message: `TxWatcher 初始化成功 (模式: ${watcher.getCurrentMode()})`
      };
    }
    return { success: false, error: 'TxWatcher 初始化失败' };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

// 获取 TxWatcher 状态
async function handleGetTxWatcherStatus() {
  try {
    if (!txWatcher) {
      return {
        success: true,
        data: {
          available: false,
          mode: 'unavailable',
          connected: false
        }
      };
    }

    const data = {
      success: true,
      data: {
        available: true,
        mode: txWatcher.getCurrentMode(),
        connected: txWatcher.isConnected(),
        initialized: txWatcher.hasActiveWatchers() || txWatcher.isConnected()
      }
    };
    return data;
  } catch (error) {
    return { success: false, error: error.message };
  }
}

async function fetchTokenInfoData(tokenAddress: string, walletAddress: string, needApproval: boolean): Promise<TokenInfoResult> {
  if (isOffscreenSupported()) {
    try {
      return await callOffscreenRpc<TokenInfoResult>('rpc_get_token_info', {
        tokenAddress,
        walletAddress,
        needApproval
      });
    } catch (error) {
      logger.warn('[Background] Offscreen RPC 获取代币信息失败，回退到本地调用:', error);
    }
  }

  if (!publicClient) {
    await createClients();
  }

  const metadata = await ensureTokenMetadata(tokenAddress, { needSymbol: true, needTotalSupply: true });
  const cacheScope = getCacheScope();
  const normalizedTokenAddress = normalizeAddressValue(tokenAddress);
  const normalizedWalletAddress = normalizeAddressValue(walletAddress);

  const balanceValue = await cacheCall(
    () =>
      executeWithRetry(async () =>
        publicClient.readContract({
          address: tokenAddress,
          abi: ERC20_ABI,
          functionName: 'balanceOf',
          args: [walletAddress]
        })
      ),
    `token-info-balance:${cacheScope}:${normalizedTokenAddress}:${normalizedWalletAddress}`,
    TOKEN_INFO_CACHE_TTL
  );

  const result: TokenInfoResult = {
    symbol: metadata.symbol || '',
    decimals: metadata.decimals ?? 18,
    totalSupply: (metadata.totalSupply ?? 0n).toString(),
    balance: balanceValue.toString()
  };

  if (needApproval) {
    const [pancakeAllowance, fourAllowance, flapAllowance] = await cacheCall(
      () =>
        executeWithRetry(async () =>
          Promise.all([
            publicClient.readContract({
              address: tokenAddress,
              abi: ERC20_ABI,
              functionName: 'allowance',
              args: [walletAddress, CONTRACTS.PANCAKE_ROUTER]
            }),
            publicClient.readContract({
              address: tokenAddress,
              abi: ERC20_ABI,
              functionName: 'allowance',
              args: [walletAddress, CONTRACTS.FOUR_TOKEN_MANAGER_V2]
            }),
            publicClient.readContract({
              address: tokenAddress,
              abi: ERC20_ABI,
              functionName: 'allowance',
              args: [walletAddress, CONTRACTS.FLAP_PORTAL]
            })
          ])
        ),
      `token-allowances:${cacheScope}:${normalizedTokenAddress}:${normalizedWalletAddress}`,
      TOKEN_INFO_CACHE_TTL
    );

    result.allowances = {
      pancake: pancakeAllowance.toString(),
      four: fourAllowance.toString(),
      flap: flapAllowance.toString(),
      xmode: fourAllowance.toString()
    };
  }

  return result;
}

// 获取代币信息（用于缓存）
async function handleGetTokenInfo({ tokenAddress, needApproval = false }) {
  try {
    if (!walletAccount) {
      return { success: false, error: '钱包未加载' };
    }

    logger.debug('[Background] Getting token info:', tokenAddress, 'needApproval:', needApproval);

    const cached = readCachedTokenInfo(tokenAddress, walletAccount.address, needApproval);
    if (cached) {
      logger.debug('[Background] 命中代币信息缓存');
      return { success: true, data: cached };
    }

    const result = await fetchTokenInfoData(tokenAddress, walletAccount.address, needApproval);
    writeCachedTokenInfo(tokenAddress, walletAccount.address, result);

    logger.debug('[Background] Token info retrieved:', { symbol: result.symbol, decimals: result.decimals, hasApprovals: !!result.allowances });

    return { success: true, data: result };
  } catch (error) {
    logger.error('[Background] Failed to get token info:', error);
    return { success: false, error: error.message };
  }
}

async function handleGetTokenRoute({ tokenAddress, force = false }: { tokenAddress?: string; force?: boolean } = {}) {
  try {
    if (!tokenAddress) {
      return { success: false, error: '缺少代币地址' };
    }

    // 修复：更新 currentTokenContext，避免"检测到代币已切换"错误
    // 当前端查询新代币的路由时，说明用户已经切换到新代币
    const normalized = normalizeTokenAddressValue(tokenAddress);
    if (normalized) {
      updateTokenContext({ tokenAddress: normalized, source: 'tabs' });
    }

    const route = await resolveTokenRoute(tokenAddress, { force });
    return { success: true, data: formatRouteForClient(route) };
  } catch (error) {
    logger.error('[Background] Failed to resolve token route:', error);
    return { success: false, error: error.message };
  }
}

type SellEstimatePayload = {
  tokenAddress?: string;
  amount?: string;
  channel?: string;
};

async function handleEstimateSellAmount(payload: SellEstimatePayload = {}) {
  try {
    if (!walletAccount || !publicClient) {
      await createClients();
    }

    const normalizedToken = normalizeTokenAddressValue(payload.tokenAddress);
    if (!normalizedToken) {
      return { success: false, error: '无效的代币地址' };
    }

    let amountToSell: bigint;
    try {
      amountToSell = BigInt(payload.amount ?? '0');
    } catch {
      return { success: false, error: '无效的卖出数量' };
    }

    if (amountToSell <= 0n) {
      return { success: true, data: { amount: '0', formatted: '0.0000' } };
    }

    const route = await resolveTokenRoute(normalizedToken);
    if (route.lockReason) {
      return { success: false, error: route.lockReason };
    }

    const channelId = payload.channel || route.preferredChannel || 'pancake';
    let channelHandler: any;
    try {
      channelHandler = getChannel(channelId);
    } catch (error) {
      logger.debug('[Background] 未知通道，使用 Pancake 估算:', error);
      channelHandler = getChannel('pancake');
    }

    if (typeof channelHandler?.quoteSell !== 'function') {
      return { success: false, error: '当前通道不支持预估' };
    }

    const estimate = await channelHandler.quoteSell({
      publicClient,
      tokenAddress: normalizedToken,
      amount: amountToSell,
      routeInfo: route
    });

    if (estimate === null || estimate === undefined) {
      return { success: false, error: '无法获取预估' };
    }

    let finalAmount = estimate;
    let displaySymbol = 'BNB';
    let displayDecimals = 18;

    const requiresConversion = shouldConvertQuoteForChannel(channelId, route);
    const quoteToken = route.quoteToken;
    if (requiresConversion && quoteToken && !isBnbQuote(quoteToken)) {
      try {
        const conversion = await convertQuoteToBnbWithFallback({
          publicClient,
          quoteToken,
          amount: estimate
        });
        if (conversion?.amount && conversion.amount > 0n) {
          finalAmount = conversion.amount;
          displaySymbol = conversion.symbol ?? 'BNB';
          displayDecimals = 18;
        } else {
          finalAmount = estimate;
          displaySymbol = resolveQuoteTokenName(quoteToken);
          displayDecimals = await readTokenDecimalsSafe(publicClient, quoteToken);
        }
      } catch (error) {
        logger.debug('[Background] 募集币种卖出预估转换失败:', error);
        finalAmount = estimate;
        displaySymbol = resolveQuoteTokenName(quoteToken);
        displayDecimals = await readTokenDecimalsSafe(publicClient, quoteToken);
      }
    }

    const formatted = formatUnits(finalAmount, displayDecimals);
    return {
      success: true,
      data: {
        amount: finalAmount.toString(),
        formatted,
        symbol: displaySymbol
      }
    };
  } catch (error) {
    logger.error('[Background] 卖出预估失败:', error);
    return { success: false, error: error.message };
  }
}

type QuoteConversionResult = {
  amount: bigint | null;
  symbol?: string;
};

async function convertQuoteToBnb(params: { publicClient: any; quoteToken: string; amount: bigint }): Promise<QuoteConversionResult | null> {
  const { publicClient, quoteToken, amount } = params;
  if (!publicClient || !quoteToken || !amount || amount <= 0n) {
    return null;
  }
  if (isBnbQuote(quoteToken)) {
    return { amount, symbol: 'BNB' };
  }
  try {
    const converted = await estimateQuoteToBnbAmount({
      publicClient,
      quoteToken,
      amountInWei: amount
    });
    if (typeof converted === 'bigint' && converted > 0n) {
      return { amount: converted, symbol: 'BNB' };
    }
  } catch (error) {
    logger.debug('[Background] 募集币估值失败:', error?.message || error);
  }
  return null;
}

async function convertQuoteToBnbWithFallback(params: { publicClient: any; quoteToken: string; amount: bigint }) {
  const direct = await convertQuoteToBnb(params);
  if (direct?.amount && direct.amount > 0n) {
    return direct;
  }
  try {
    const pancakeChannel = getChannel('pancake');
    if (pancakeChannel?.quoteSell) {
      const fallbackAmount = await pancakeChannel.quoteSell({
        publicClient: params.publicClient,
        tokenAddress: params.quoteToken,
        amount: params.amount
      });
      if (fallbackAmount && fallbackAmount > 0n) {
        return { amount: fallbackAmount, symbol: 'BNB' };
      }
    }
  } catch (error) {
    logger.debug('[Background] Pancake fallback 估算失败:', error);
  }
  return null;
}

async function readTokenDecimalsSafe(publicClient: any, tokenAddress: string) {
  try {
    const result = await publicClient.readContract({
      address: tokenAddress as Address,
      abi: ERC20_ABI,
      functionName: 'decimals'
    });
    if (typeof result === 'number') {
      return result;
    }
    if (typeof result === 'bigint') {
      return Number(result);
    }
  } catch (error) {
    logger.debug('[Background] 读取 decimals 失败:', error?.message || error);
  }
  return 18;
}

function shouldConvertQuoteForChannel(channelId: string, route: any) {
  if (FOUR_CHANNEL_IDS.has(channelId)) {
    return true;
  }
  if (channelId === 'flap') {
    const nativeToQuoteSwapEnabled = route?.metadata?.nativeToQuoteSwapEnabled;
    return nativeToQuoteSwapEnabled !== true;
  }
  return false;
}

// 处理交易确认回调（发送通知给前端）
function onTxConfirmed(data) {
  if (!data) return;
  const { txHash, status, blockNumber, confirmationTime } = data;
  const normalizedReason = data.reason
    || (status === 'failed' ? '链上执行失败' : status === 'timeout' ? '交易未在规定时间内确认' : '');

  logger.debug('[Background] 交易状态更新:', data);

  const isSuccess = status === 'success';
  const isTimeout = status === 'timeout';

  const messageLines: string[] = [];
  if (isSuccess && typeof blockNumber === 'number' && blockNumber >= 0) {
    messageLines.push(`区块: ${blockNumber}`);
  }
  if (typeof confirmationTime === 'number') {
    messageLines.push(`耗时: ${(confirmationTime / 1000).toFixed(2)}s`);
  }
  if (normalizedReason) {
    messageLines.push(`原因: ${normalizedReason}`);
  }
  messageLines.push(`哈希: ${txHash.substring(0, 10)}...`);

  chrome.notifications.create({
    type: 'basic',
    iconUrl: 'icons/icon48.png',
    title: isSuccess ? '✅ 交易成功' : isTimeout ? '⚠️ 交易未确认' : '❌ 交易失败',
    message: messageLines.join('\n')
  });

  const delivered = broadcastToContentPorts({
    action: 'tx_confirmed',
    data: {
      ...data,
      reason: normalizedReason
    }
  });

  if (delivered === 0) {
    chrome.tabs.query({ url: CONTENT_SCRIPT_URL_PATTERNS }, (tabs) => {
      tabs.forEach((tab) => {
        chrome.tabs.sendMessage(tab.id, {
          action: 'tx_confirmed',
          data: {
            ...data,
            reason: normalizedReason
          }
        }).catch(() => {});
      });
    });
  }

  const tradeContext = consumePendingTradeContext(txHash);
  if (isSuccess) {
    setTimeout(() => {
      pushWalletStatusToAllTabs();
    }, 500);
    if (tradeContext?.tokenAddress && walletAccount?.address) {
      invalidateWalletDerivedCaches(walletAccount.address, tradeContext.tokenAddress, {
        allowances: tradeContext.type === 'sell'
      });
      refreshTokenInfoAfterTx(tradeContext.tokenAddress, {
        includeAllowances: tradeContext.type === 'sell'
      });
    }
  } else if (tradeContext && tradeContext.tokenAddress && walletAccount?.address) {
    invalidateWalletDerivedCaches(walletAccount.address, tradeContext.tokenAddress, {
      allowances: tradeContext.type === 'sell'
    });
  }
}

// 注意：初始化已在文件开头的 init() IIFE 中完成，无需重复调用 initialize()
async function warmupBackgroundServices() {
  if (warmupPromise) {
    return warmupPromise;
  }

  warmupPromise = (async () => {
    if (!publicClient) {
      await createClients();
    }

    if (walletPrivateKey && (!walletClient || !walletAccount)) {
      await createWalletClientInstance();
    }

    if (isOffscreenSupported()) {
      try {
        await ensureOffscreenDocument();
        await acquireOffscreenPort();
      } catch (error) {
        logger.warn('[Background] Offscreen 预热失败:', error);
      }
    }

  // 预热 TxWatcher，保持 WebSocket 连接
  if (!txWatcher) {
    txWatcher = new TxWatcher(publicClient);
  } else if (publicClient) {
    txWatcher.setClient(publicClient);
  }

  // 初始化 TxWatcher 的 WebSocket 连接
  if (walletPrivateKey && TX_WATCHER_CONFIG.ENABLED) {
    try {
      await txWatcher.initialize();
      logger.debug('[Background] TxWatcher WebSocket 预热成功');
    } catch (error) {
      logger.warn('[Background] TxWatcher WebSocket 预热失败，将使用轮询模式:', error);
    }
  }
})().finally(() => {
  warmupPromise = null;
});

  return warmupPromise;
}
