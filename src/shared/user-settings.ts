/// <reference types="chrome" />

import {
  DEBUG_CONFIG,
  NETWORK_CONFIG,
  TX_WATCHER_CONFIG,
  CUSTOM_AGGREGATOR_CONFIG
} from './trading-config.js';
import { DEFAULT_FOUR_QUOTE_TOKENS, setFourQuoteTokenList } from './channel-config.js';

export const USER_SETTINGS_STORAGE_KEY = 'dongBangUserSettings';

export type LogMode = 'quiet' | 'verbose';

export type SystemSettings = {
  primaryRpc: string;
  fallbackRpcs: string[];
  logMode: LogMode;
  enablePerformanceLogs: boolean;
  pollingIntervalMs: number;
};

export type TradingSettings = {
  buyPresets: string[];
  sellPresets: string[];
  slippagePresets: string[];
  buyGasPresets: string[];
  sellGasPresets: string[];
  defaultBuyValue: string;
  defaultSellValue: string;
  defaultSlippageValue: string;
  defaultBuyGasValue: string;
  defaultSellGasValue: string;
  autoApproveMode: 'buy' | 'sell' | 'switch';
  /**
   * @deprecated 仅用于兼容旧版本配置
   */
  defaultGasPriceValue?: string;
};

export type ChannelSettings = {
  four: {
    quoteTokens: string[];
    customQuoteTokens: string[];
  };
};

export type AggregatorSettings = {
  enabled: boolean;
  executionMode: 'contract' | 'legacy';
  contractAddress: string;
};

export type UserSettings = {
  system: SystemSettings;
  trading: TradingSettings;
  channels: ChannelSettings;
  aggregator: AggregatorSettings;
};

const DEFAULT_BUY_PRESETS = ['0.005', '0.01', '0.02', '0.05', '0.1', '0.2', '0.5', '1'];
const DEFAULT_SELL_PRESETS = ['5', '10', '25', '33', '50', '66', '75', '100'];
const DEFAULT_SLIPPAGE = ['10', '50'];
const DEFAULT_GAS_PRICE = ['0.05', '1'];
const DEFAULT_BUY_INPUT = DEFAULT_BUY_PRESETS[0];
const DEFAULT_SELL_INPUT = DEFAULT_SELL_PRESETS[DEFAULT_SELL_PRESETS.length - 1];
const DEFAULT_SLIPPAGE_INPUT = DEFAULT_SLIPPAGE[0];
const DEFAULT_GAS_INPUT = DEFAULT_GAS_PRICE[0];
const sortNumericAscending = (values: string[]) => {
  return values
    .map((value, index) => {
      const num = Number(value);
      return {
        value,
        index,
        num: Number.isFinite(num) ? num : -Infinity
      };
    })
    .sort((a, b) => {
      if (a.num === b.num) {
        return a.index - b.index;
      }
      return a.num - b.num;
    })
    .map((item) => item.value);
};

const DEFAULT_CHANNEL_SETTINGS: ChannelSettings = {
  four: {
    quoteTokens: DEFAULT_FOUR_QUOTE_TOKENS.slice(),
    customQuoteTokens: []
  }
};

const DEFAULT_AGGREGATOR_SETTINGS: AggregatorSettings = {
  enabled: true,
  executionMode: 'contract',
  contractAddress: CUSTOM_AGGREGATOR_CONFIG.DEFAULT_ADDRESS
};

const BUILTIN_FOUR_TOKEN_SET = new Set(
  DEFAULT_CHANNEL_SETTINGS.four.quoteTokens.map((token) => token.toLowerCase())
);

function mergeUniqueTokens(base: string[], extra: string[]) {
  const seen = new Set(base.map((token) => token.toLowerCase()));
  extra.forEach((token) => {
    const lowered = token.toLowerCase();
    if (BUILTIN_FOUR_TOKEN_SET.has(lowered) || seen.has(lowered)) {
      return;
    }
    seen.add(lowered);
    base.push(token);
  });
  return base;
}

export const DEFAULT_USER_SETTINGS: UserSettings = {
  system: {
    primaryRpc: NETWORK_CONFIG.BSC_RPC,
    fallbackRpcs: NETWORK_CONFIG.BSC_RPC_FALLBACK ?? [],
    logMode: 'quiet',
    enablePerformanceLogs: false,
    pollingIntervalMs: TX_WATCHER_CONFIG.POLLING_INTERVAL
  },
  trading: {
    buyPresets: DEFAULT_BUY_PRESETS,
    sellPresets: DEFAULT_SELL_PRESETS,
    slippagePresets: DEFAULT_SLIPPAGE,
    buyGasPresets: DEFAULT_GAS_PRICE,
    sellGasPresets: DEFAULT_GAS_PRICE,
    defaultBuyValue: DEFAULT_BUY_INPUT,
    defaultSellValue: DEFAULT_SELL_INPUT,
    defaultSlippageValue: DEFAULT_SLIPPAGE_INPUT,
    defaultBuyGasValue: DEFAULT_GAS_INPUT,
    defaultSellGasValue: DEFAULT_GAS_INPUT,
    autoApproveMode: 'buy'
  },
  channels: {
    four: {
      quoteTokens: DEFAULT_CHANNEL_SETTINGS.four.quoteTokens.slice(),
      customQuoteTokens: []
    }
  },
  aggregator: { ...DEFAULT_AGGREGATOR_SETTINGS }
};

let cachedSettings: UserSettings = DEFAULT_USER_SETTINGS;
let loadPromise: Promise<UserSettings> | null = null;
const listeners = new Set<(settings: UserSettings) => void>();
let storageListenerReady = false;

function normalizeArray(source: unknown, fallback: string[], fixedLength = fallback.length): string[] {
  if (!Array.isArray(source)) {
    if (typeof source === 'string' && source.trim()) {
      return source
        .split(/[\n,]+/)
        .map((value) => value.trim())
        .filter(Boolean)
        .slice(0, fixedLength) || fallback;
    }
    return fallback.slice();
  }
  const cleaned = source
    .map((value) => (value ?? '').toString().trim())
    .filter(Boolean);
  if (cleaned.length === 0) {
    return fallback.slice();
  }
  const result: string[] = [];
  for (let i = 0; i < fixedLength; i += 1) {
    const fallbackValue = fallback[i] ?? fallback[fallback.length - 1] ?? '';
    result.push(cleaned[i] ?? fallbackValue);
  }
  return result;
}

function normalizeDefaultValue(value: unknown, fallback: string): string {
  const val = (value ?? '').toString().trim();
  return val || fallback;
}

const ADDRESS_REGEX = /^0x[a-fA-F0-9]{40}$/;

function normalizeAddressList(source: unknown, fallback: string[]): string[] {
  let values: string[] = [];
  if (Array.isArray(source)) {
    values = source.map((value) => value?.toString().trim());
  } else if (typeof source === 'string') {
    values = source
      .split(/[\n,]+/)
      .map((value) => value.trim());
  }
  const seen = new Set<string>();
  const cleaned = values.filter((value) => {
    if (!ADDRESS_REGEX.test(value)) {
      return false;
    }
    const lowered = value.toLowerCase();
    if (seen.has(lowered)) {
      return false;
    }
    seen.add(lowered);
    return true;
  });
  if (cleaned.length === 0) {
    return fallback.slice();
  }
  return cleaned;
}

function normalizeSingleAddress(source: unknown, fallback: string): string {
  const value = (source ?? '').toString().trim();
  if (ADDRESS_REGEX.test(value)) {
    return `0x${value.slice(2).toLowerCase()}`;
  }
  return fallback;
}

export function normalizeUserSettings(raw?: Partial<UserSettings> | null): UserSettings {
  if (!raw) {
    return JSON.parse(JSON.stringify(DEFAULT_USER_SETTINGS));
  }

  const base = JSON.parse(JSON.stringify(DEFAULT_USER_SETTINGS)) as UserSettings;

  const primaryRpc = typeof raw.system?.primaryRpc === 'string'
    ? raw.system.primaryRpc.trim()
    : base.system.primaryRpc;
  const fallbackRpcsSource = raw.system?.fallbackRpcs as unknown;
  let fallbackRpcs: string[] = [];
  if (Array.isArray(fallbackRpcsSource)) {
    fallbackRpcs = fallbackRpcsSource.map((value) => value?.toString().trim()).filter(Boolean);
  } else if (typeof fallbackRpcsSource === 'string') {
    fallbackRpcs = fallbackRpcsSource
      .split(/[\n,]+/)
      .map((value) => value.trim())
      .filter(Boolean);
  }
  const seen = new Set<string>();
  const normalizedFallbacks = fallbackRpcs.filter((url) => {
    if (!url) return false;
    if (seen.has(url)) return false;
    seen.add(url);
    return true;
  });
  if (normalizedFallbacks.length === 0) {
    normalizedFallbacks.push(...base.system.fallbackRpcs);
  }
  const logMode = raw.system?.logMode === 'verbose' ? 'verbose' : 'quiet';
  const enablePerformanceLogsRaw = Boolean(
    raw.system?.enablePerformanceLogs ?? base.system.enablePerformanceLogs
  );
  const enablePerformanceLogs = logMode === 'verbose' && enablePerformanceLogsRaw;
  let pollingIntervalMs = Number(raw.system?.pollingIntervalMs ?? base.system.pollingIntervalMs);
  if (!Number.isFinite(pollingIntervalMs) || pollingIntervalMs <= 0) {
    pollingIntervalMs = base.system.pollingIntervalMs;
  }
  pollingIntervalMs = Math.max(200, Math.round(pollingIntervalMs));

  const buyPresets = normalizeArray(raw.trading?.buyPresets, DEFAULT_BUY_PRESETS, DEFAULT_BUY_PRESETS.length);
  const sellPresets = sortNumericAscending(
    normalizeArray(raw.trading?.sellPresets, DEFAULT_SELL_PRESETS, DEFAULT_SELL_PRESETS.length)
  );
  const slippagePresets = normalizeArray(raw.trading?.slippagePresets, DEFAULT_SLIPPAGE, DEFAULT_SLIPPAGE.length);
  const buyGasPresets = normalizeArray(
    raw.trading?.buyGasPresets ?? (raw.trading as any)?.gasPricePresets,
    DEFAULT_GAS_PRICE,
    DEFAULT_GAS_PRICE.length
  );
  const sellGasPresets = normalizeArray(
    raw.trading?.sellGasPresets ?? (raw.trading as any)?.gasPricePresets,
    DEFAULT_GAS_PRICE,
    DEFAULT_GAS_PRICE.length
  );
  const defaultBuyValue = normalizeDefaultValue(raw.trading?.defaultBuyValue, buyPresets[0] ?? DEFAULT_BUY_INPUT);
  const defaultSellValue = normalizeDefaultValue(
    raw.trading?.defaultSellValue,
    sellPresets[sellPresets.length - 1] ?? DEFAULT_SELL_INPUT
  );
  const defaultSlippageValue = normalizeDefaultValue(
    raw.trading?.defaultSlippageValue,
    slippagePresets[0] ?? DEFAULT_SLIPPAGE_INPUT
  );
  const legacyGasDefault = raw.trading?.defaultGasPriceValue;
  const defaultBuyGasValue = normalizeDefaultValue(
    raw.trading?.defaultBuyGasValue ?? legacyGasDefault,
    buyGasPresets[0] ?? DEFAULT_GAS_INPUT
  );
  const sellGasFallback = defaultBuyGasValue || sellGasPresets[0] || DEFAULT_GAS_INPUT;
  const defaultSellGasValue = normalizeDefaultValue(
    raw.trading?.defaultSellGasValue ?? legacyGasDefault,
    sellGasFallback
  );
  let autoApproveMode: 'buy' | 'sell' | 'switch' = 'buy';
  const modeRaw = (raw.trading as any)?.autoApproveMode;
  if (typeof modeRaw === 'string') {
    if (modeRaw === 'buy' || modeRaw === 'sell' || modeRaw === 'switch') {
      autoApproveMode = modeRaw;
    }
  } else if ((raw.trading as any)?.autoApproveEnabled === false) {
    autoApproveMode = 'buy';
  } else if ((raw.trading as any)?.autoApproveEnabled === true) {
    autoApproveMode = 'buy';
  }

  const rawCustomQuoteTokens = (raw.channels?.four as any)?.customQuoteTokens;
  const normalizedCustomQuoteTokens = normalizeAddressList(rawCustomQuoteTokens, []);
  const customQuoteTokenSet = new Set<string>();
  const filteredCustomTokens: string[] = [];
  normalizedCustomQuoteTokens.forEach((token) => {
    const lowered = token.toLowerCase();
    if (BUILTIN_FOUR_TOKEN_SET.has(lowered) || customQuoteTokenSet.has(lowered)) {
      return;
    }
    customQuoteTokenSet.add(lowered);
    filteredCustomTokens.push(token);
  });

  const normalizedSavedQuoteTokens = normalizeAddressList(
    raw.channels?.four?.quoteTokens,
    DEFAULT_CHANNEL_SETTINGS.four.quoteTokens
  );

  if (rawCustomQuoteTokens === undefined) {
    normalizedSavedQuoteTokens.forEach((token) => {
      const lowered = token.toLowerCase();
      if (BUILTIN_FOUR_TOKEN_SET.has(lowered) || customQuoteTokenSet.has(lowered)) {
        return;
      }
      customQuoteTokenSet.add(lowered);
      filteredCustomTokens.push(token);
    });
  }

  const mergedQuoteTokens = mergeUniqueTokens(
    DEFAULT_CHANNEL_SETTINGS.four.quoteTokens.slice(),
    filteredCustomTokens.slice()
  );

  const fourQuoteTokens = normalizeAddressList(
    mergedQuoteTokens,
    DEFAULT_CHANNEL_SETTINGS.four.quoteTokens
  );

  const rawAggregator = raw.aggregator as Partial<AggregatorSettings> | undefined;
  const aggregatorEnabled = rawAggregator?.enabled !== false;
  const aggregatorExecutionMode =
    rawAggregator?.executionMode === 'legacy' ? 'legacy' : 'contract';
  const aggregatorAddress = normalizeSingleAddress(
    rawAggregator?.contractAddress,
    DEFAULT_AGGREGATOR_SETTINGS.contractAddress
  );

  return {
    system: {
      primaryRpc: primaryRpc || base.system.primaryRpc,
      fallbackRpcs: normalizedFallbacks,
      logMode,
      enablePerformanceLogs,
      pollingIntervalMs
    },
    trading: {
      buyPresets,
      sellPresets,
      slippagePresets,
      buyGasPresets,
      sellGasPresets,
      defaultBuyValue,
      defaultSellValue,
      defaultSlippageValue,
      defaultBuyGasValue,
      defaultSellGasValue,
      autoApproveMode
    },
    channels: {
      four: {
        quoteTokens: fourQuoteTokens,
        customQuoteTokens: filteredCustomTokens
      }
    },
    aggregator: {
      enabled: aggregatorEnabled,
      executionMode: aggregatorExecutionMode,
      contractAddress: aggregatorAddress
    }
  };
}

export function getRpcNodesFromSettings(settings: UserSettings): string[] {
  const defaults = [NETWORK_CONFIG.BSC_RPC, ...NETWORK_CONFIG.BSC_RPC_FALLBACK];
  const nodes: string[] = [];

  const primary = settings.system.primaryRpc?.trim();
  if (primary) {
    nodes.push(primary);
  }

  settings.system.fallbackRpcs.forEach((url) => {
    const trimmed = url.trim();
    if (trimmed && !nodes.includes(trimmed)) {
      nodes.push(trimmed);
    }
  });

  defaults.forEach((url) => {
    if (url && !nodes.includes(url)) {
      nodes.push(url);
    }
  });

  return nodes;
}

function applySettingsToRuntime(settings: UserSettings) {
  DEBUG_CONFIG.ENABLED = settings.system.logMode === 'verbose';
  DEBUG_CONFIG.PERF_ENABLED = DEBUG_CONFIG.ENABLED && settings.system.enablePerformanceLogs;
  const interval = Math.max(200, Number(settings.system.pollingIntervalMs) || TX_WATCHER_CONFIG.POLLING_INTERVAL);
  TX_WATCHER_CONFIG.POLLING_INTERVAL = interval;
  setFourQuoteTokenList(settings.channels?.four?.quoteTokens ?? DEFAULT_CHANNEL_SETTINGS.four.quoteTokens);
}

function notifyListeners(settings: UserSettings) {
  listeners.forEach((listener) => {
    try {
      listener(settings);
    } catch (error) {
      console.warn('[Settings] Listener error:', error);
    }
  });
}

function ensureStorageListener() {
  if (storageListenerReady || !chrome?.storage?.onChanged) {
    return;
  }
  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName !== 'local' || !(USER_SETTINGS_STORAGE_KEY in changes)) {
      return;
    }
    const newSettings = normalizeUserSettings(changes[USER_SETTINGS_STORAGE_KEY]?.newValue);
    cachedSettings = newSettings;
    applySettingsToRuntime(newSettings);
    notifyListeners(newSettings);
  });
  storageListenerReady = true;
}

export function getCachedUserSettings(): UserSettings {
  return cachedSettings;
}

export async function loadUserSettings(): Promise<UserSettings> {
  if (loadPromise) {
    return loadPromise;
  }

  ensureStorageListener();

  loadPromise = new Promise<UserSettings>((resolve) => {
    if (!chrome?.storage?.local) {
      const normalized = normalizeUserSettings(DEFAULT_USER_SETTINGS);
      cachedSettings = normalized;
      applySettingsToRuntime(normalized);
      resolve(normalized);
      loadPromise = null;
      return;
    }

    chrome.storage.local.get([USER_SETTINGS_STORAGE_KEY], (result) => {
      if (chrome.runtime?.lastError) {
        console.warn('[Settings] 读取失败，使用默认配置:', chrome.runtime.lastError.message);
      }
      const normalized = normalizeUserSettings(result?.[USER_SETTINGS_STORAGE_KEY]);
      cachedSettings = normalized;
      applySettingsToRuntime(normalized);
      resolve(normalized);
      loadPromise = null;
    });
  });

  return loadPromise;
}

export async function saveUserSettings(settings: UserSettings): Promise<UserSettings> {
  const normalized = normalizeUserSettings(settings);
  if (!chrome?.storage?.local) {
    cachedSettings = normalized;
    applySettingsToRuntime(normalized);
    notifyListeners(normalized);
    return normalized;
  }
  await chrome.storage.local.set({
    [USER_SETTINGS_STORAGE_KEY]: normalized
  });
  cachedSettings = normalized;
  applySettingsToRuntime(normalized);
  notifyListeners(normalized);
  return normalized;
}

export function onUserSettingsChange(listener: (settings: UserSettings) => void) {
  listeners.add(listener);
  ensureStorageListener();
  return () => listeners.delete(listener);
}
