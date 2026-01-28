/// <reference types="chrome" />

import { logger, DEBUG_CONFIG } from '../shared/logger.js';
import { PerformanceTimer, perf } from '../shared/performance.js';
import {
  WALLET_CONFIG,
  UI_CONFIG,
  CHANNELS
} from '../shared/trading-config.js';
import { CONTENT_CONFIG } from '../shared/content-config.js';
import {
  DEFAULT_USER_SETTINGS,
  UserSettings,
  loadUserSettings,
  onUserSettingsChange
} from '../shared/user-settings.js';

declare global {
  interface Window {
    __DOG_BANG_SIDE_PANEL_MODE__?: boolean;
  }
}

const SIDE_PANEL_TOKEN_STORAGE_KEY = 'dogBangLastTokenContext';
const EMBEDDED_PANEL_ENABLED = false;

type SidePanelTokenContext = {
  tokenAddress: string;
  url: string;
  updatedAt: number;
  preferredChannelId?: string;
};

type TradingPanelOptions = {
  tokenAddressOverride?: string;
  mountPoint?: HTMLElement;
  defaultChannelId?: string;
  disableAutoChannelSelection?: boolean;
  sourceUrl?: string | null;
};

let backgroundPort: chrome.runtime.Port | null = null;
let backgroundPortReady = false;
let panelReady = false;
let pendingWalletStatus: any = null;
let pendingTokenBalance: any = null;
const pendingPortRequests = new Map<string, { resolve: (value: any) => void; reject: (reason?: any) => void; timeoutId: ReturnType<typeof setTimeout> }>();
let portRequestCounter = 0;
const PORT_REQUEST_TIMEOUT = CONTENT_CONFIG.PORT_REQUEST_TIMEOUT_MS;
let tokenContextObserverStarted = false;
let lastSyncedTokenAddress: string | null = null;
let lastSyncedUrl = '';
let tokenContextSyncPromise: Promise<void> | null = null;
let historyListenersInstalled = false;
let userSettings: UserSettings = DEFAULT_USER_SETTINGS;
export const tradingSettingsReady = loadUserSettings().then((settings) => {
  userSettings = settings;
});
onUserSettingsChange((settings) => {
  userSettings = settings;
});

type WalletDisplayState =
  | { type: 'link'; address: string }
  | { type: 'text'; text: string };

let walletDisplayState: WalletDisplayState = { type: 'text', text: '加载中...' };
let walletStatusClass: 'wallet-unlocked' | 'wallet-locked' | 'wallet-not-setup' | null = null;
let walletButtonsEnabled = false;
let currentTokenRoute: any = null;
let routeRefreshTimer: ReturnType<typeof setTimeout> | null = null;
let userChannelOverride = false;
let routeLockReason: string | null = null;
let routeLockType: 'approve' | 'migration' | null = null;
let walletStatusNoticeActive = false;
let globalUpdateSettingsDisplay: (() => void) | null = null;
let walletStatusNoticeMessage: string | null = null;
let statusHideTimer: ReturnType<typeof setTimeout> | null = null;
let sellEstimateTimer: ReturnType<typeof setInterval> | null = null;
let sellEstimateDebounceTimer: ReturnType<typeof setTimeout> | null = null;
let sellEstimatePending = false;
let sellEstimateRequestId = 0;
let panelSourceUrl: string | null = null;


const WEI_PER_BNB = 1000000000000000000n;
const SELL_PERCENT_SCALE = 100n * 10000n;

const GMGN_WALLET_BASE = 'https://gmgn.ai/bsc/address';
const BSCSCAN_WALLET_BASE = 'https://bscscan.com/address';

function getDefaultPanelSourceUrl() {
  if (typeof window === 'undefined') {
    return null;
  }
  try {
    return window.location?.href ?? null;
  } catch {
    return null;
  }
}

function updatePanelSourceUrl(sourceUrl?: string | null) {
  const resolved = sourceUrl ?? getDefaultPanelSourceUrl();
  if (resolved === panelSourceUrl) {
    return;
  }
  panelSourceUrl = resolved ?? null;
  if (walletDisplayState.type === 'link') {
    applyWalletDisplayState();
  }
}

function getHostnameFromSource(source?: string | null) {
  if (!source) {
    return '';
  }
  try {
    return new URL(source).hostname.toLowerCase();
  } catch {
    return '';
  }
}

function getEnvironmentHostname() {
  try {
    return window?.location?.hostname?.toLowerCase() ?? '';
  } catch {
    return '';
  }
}

function isExtensionEnvironment() {
  try {
    const protocol = window?.location?.protocol ?? '';
    return (
      protocol === 'chrome-extension:' ||
      protocol === 'moz-extension:' ||
      protocol === 'ms-browser-extension:' ||
      protocol === 'safari-web-extension:' ||
      protocol === 'edge-extension:'
    );
  } catch {
    return false;
  }
}

function getWalletExplorerBaseUrl() {
  const envHostname = getEnvironmentHostname();
  if (envHostname && !isExtensionEnvironment()) {
    return envHostname.includes('gmgn.ai') ? GMGN_WALLET_BASE : BSCSCAN_WALLET_BASE;
  }
  const sourceHostname =
    getHostnameFromSource(panelSourceUrl) || getHostnameFromSource(getDefaultPanelSourceUrl());
  return sourceHostname.includes('gmgn.ai') ? GMGN_WALLET_BASE : BSCSCAN_WALLET_BASE;
}

function applyWalletDisplayState() {
  const walletAddressEl = document.getElementById('wallet-address');
  if (!walletAddressEl) return;

  if (walletDisplayState.type === 'link') {
    const address = walletDisplayState.address;
    const short = `${address.slice(0, 6)}...${address.slice(-4)}`;
    const explorerUrl = `${getWalletExplorerBaseUrl()}/${address}`;
    walletAddressEl.innerHTML = `<a class="wallet-link" href="${explorerUrl}" target="_blank" rel="noopener noreferrer">${short}</a>`;
  } else {
    walletAddressEl.textContent = walletDisplayState.text;
  }
}

function applyWalletStatusClass() {
  const walletAddressEl = document.getElementById('wallet-address');
  if (!walletAddressEl) return;
  walletAddressEl.classList.remove('wallet-unlocked', 'wallet-locked', 'wallet-not-setup');
  if (walletStatusClass) {
    walletAddressEl.classList.add(walletStatusClass);
  }
}

function applyWalletUiState() {
  applyWalletDisplayState();
  applyWalletStatusClass();
  applyTradeButtonsState();
}

function setWalletDisplayText(text: string) {
  walletDisplayState = { type: 'text', text };
  applyWalletDisplayState();
}

function setTradeButtonsEnabled(enabled: boolean) {
  walletButtonsEnabled = enabled;
  applyTradeButtonsState();
}

function applyTradeButtonsState() {
  const buyBtn = document.getElementById('btn-buy') as HTMLButtonElement | null;
  const sellBtn = document.getElementById('btn-sell') as HTMLButtonElement | null;
  const locked = Boolean(routeLockReason && routeLockType !== 'approve');
  if (buyBtn) buyBtn.disabled = !walletButtonsEnabled || locked;
  if (sellBtn) sellBtn.disabled = !walletButtonsEnabled || locked;
}

function renderStatusMessage() {
  if (walletStatusNoticeActive && walletStatusNoticeMessage) {
    showStatus(walletStatusNoticeMessage, 'warning', { persist: true });
    return;
  }
  if (routeLockReason) {
    const isApproveLock = routeLockType === 'approve';
    showStatus(routeLockReason, isApproveLock ? 'info' : 'warning', { persist: !isApproveLock });
  } else {
    clearStatusMessage();
  }
}

function setRouteLock(reason: string | null, type: 'approve' | 'migration' | null = null) {
  routeLockReason = reason;
  const normalizedType = type === 'approve' ? 'approve' : type === 'migration' ? 'migration' : null;
  routeLockType = reason ? normalizedType : null;
  applyTradeButtonsState();
  renderStatusMessage();
  scheduleSellEstimate();
}

function showWalletStatusNotice(message: string) {
  // 在 SidePanel 模式下不显示钱包状态通知，因为有遮罩层处理
  if (window.__DOG_BANG_SIDE_PANEL_MODE__) {
    return;
  }
  walletStatusNoticeActive = true;
  walletStatusNoticeMessage = message;
  renderStatusMessage();
}

function clearWalletStatusNotice() {
  if (!walletStatusNoticeActive) {
    return;
  }
  walletStatusNoticeActive = false;
  walletStatusNoticeMessage = null;
  renderStatusMessage();
}

function getActiveTokenAddress() {
  const panel = document.getElementById('dog-bang-panel');
  const fromDataset = panel?.dataset?.tokenAddress;
  if (fromDataset && /^0x[a-fA-F0-9]{40}$/.test(fromDataset)) {
    return fromDataset;
  }
  const urlToken = getTokenAddressFromURL();
  if (urlToken) {
    return urlToken;
  }
  return currentTokenAddress;
}

async function copyTextToClipboard(text: string) {
  if (!text) return false;
  try {
    if (navigator?.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch (error: any) {
    logger.debug('[Dog Bang] navigator.clipboard 复制失败，使用后备方案:', error);
  }
  try {
    const textarea = document.createElement('textarea');
    textarea.value = text;
    textarea.style.position = 'fixed';
    textarea.style.left = '-9999px';
    document.body.appendChild(textarea);
    textarea.focus();
    textarea.select();
    const success = document.execCommand('copy');
    document.body.removeChild(textarea);
    return success;
  } catch (error) {
    logger.error('[Dog Bang] 复制地址失败:', error);
    return false;
  }
}

function escapeHtml(value: string) {
  const map: Record<string, string> = {
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
  };
  return value.replace(/[&<>"']/g, (char) => map[char]);
}

function renderQuickButtons(values: string[], action: 'buy' | 'sell', suffix = '', btnClass = 'btn-quick') {
  // Render buttons in a flat list; CSS grid controls wrapping into rows of 4
  return values.map((rawValue) => {
    const value = rawValue ?? '';
    const display = `${value}${suffix}`;
    return `<button class="${btnClass}" data-action="${action}" data-amount="${escapeHtml(value)}">${escapeHtml(display)}</button>`;
  }).join('');
}

function renderOptionButtons(values: string[], target: string, suffix = '') {
  return values.map((rawValue, index) => {
    const value = rawValue ?? '';
    const active = index === 0 ? 'active' : '';
    const display = `${value}${suffix}`;
    return `<button type="button" class="btn-option ${active}" data-target="${target}" data-value="${escapeHtml(value)}">${escapeHtml(display)}</button>`;
  }).join('');
}

function getMaxPresetValue(values: string[], fallback = '100') {
  let bestValue = fallback;
  let bestNum = Number(fallback);
  if (!Number.isFinite(bestNum)) {
    bestNum = -Infinity;
  }
  values.forEach((rawValue) => {
    const num = Number(rawValue);
    if (!Number.isFinite(num)) {
      return;
    }
    if (num > bestNum) {
      bestNum = num;
      bestValue = rawValue;
    }
  });
  return bestValue ?? fallback;
}

// ========== 页面层级错误拦截（兼容 SES Lockdown） ==========
function isSesLockdownException(source: unknown) {
  if (!source) return false;
  if (typeof source === 'string') {
    return source.includes('SES_UNCAUGHT_EXCEPTION') || source.includes('lockdown-install.js');
  }
  if (typeof source === 'object') {
    const message = (source as { message?: unknown })?.message;
    if (typeof message === 'string' && message.includes('SES_UNCAUGHT_EXCEPTION')) {
      return true;
    }
    const stack = (source as { stack?: unknown })?.stack;
    if (typeof stack === 'string' && stack.includes('lockdown-install.js')) {
      return true;
    }
  }
  return false;
}

function shouldSuppressSesError(event: ErrorEvent) {
  if (!event) return false;
  if (event.filename && event.filename.includes('lockdown-install.js')) {
    return true;
  }
  if (isSesLockdownException(event.message)) {
    return true;
  }
  if (isSesLockdownException(event.error)) {
    return true;
  }
  return false;
}

window.addEventListener('error', (event) => {
  if (shouldSuppressSesError(event)) {
    event.preventDefault();
    event.stopImmediatePropagation();
    return false;
  }
  return undefined;
}, true);

window.addEventListener('unhandledrejection', (event) => {
  if (isSesLockdownException(event?.reason)) {
    event.preventDefault();
    if (typeof event.stopImmediatePropagation === 'function') {
      event.stopImmediatePropagation();
    }
    return false;
  }
  return undefined;
}, true);

function getInputValue(id: string): string {
  const element = document.getElementById(id) as HTMLInputElement | HTMLSelectElement | null;
  return element?.value?.toString() ?? '';
}

function setInputValue(id: string, value: string) {
  const element = document.getElementById(id) as HTMLInputElement | HTMLSelectElement | null;
  if (element) {
    element.value = value;
  }
}

function setWalletAddressDisplay(address: string | null) {
  if (address && /^0x[a-fA-F0-9]{40}$/.test(address)) {
    walletDisplayState = { type: 'link', address };
  } else {
    walletDisplayState = { type: 'text', text: address ?? '加载中...' };
  }
  applyWalletDisplayState();
}

function setTextContent(id: string, value: string) {
  const element = document.getElementById(id);
  if (element) {
    element.textContent = value;
  }
}

function formatDuration(ms: number) {
  if (!Number.isFinite(ms) || ms < 0) {
    return '--';
  }
  return `${(ms / 1000).toFixed(1)}s`;
}

type ButtonTimerController = {
  getElapsed: () => number;
  stop: (finalLabel?: string) => number;
};

function startButtonTimer(button: HTMLButtonElement, runningLabel = '处理中'): ButtonTimerController {
  const start = performance.now();
  let stopped = false;
  let finalElapsed = 0;

  const update = () => {
    const elapsedSeconds = ((stopped ? finalElapsed : performance.now() - start) / 1000);
    if (runningLabel) {
      button.textContent = `${runningLabel}... (${elapsedSeconds.toFixed(1)}s)`;
    } else {
      // 只显示时间，不显示文字
      button.textContent = `${elapsedSeconds.toFixed(1)}s`;
    }
  };

  update();
  const interval = setInterval(update, CONTENT_CONFIG.BUTTON_TIMER_REFRESH_INTERVAL_MS);

  const stopTimer = () => {
    if (!stopped) {
      clearInterval(interval);
      finalElapsed = performance.now() - start;
      stopped = true;
    }
    return finalElapsed;
  };

  return {
    getElapsed: () => (stopped ? finalElapsed : performance.now() - start),
    stop: (finalLabel?: string) => {
      const elapsed = stopTimer();
      if (finalLabel) {
        button.textContent = finalLabel;
      }
      return elapsed;
    }
  };
}

function appendDurationSuffix(message: string, durationText: string) {
  if (!durationText || durationText === '--') {
    return message;
  }
  const separator = message.includes('· 耗时') ? '' : ' · ';
  return `${message}${separator}耗时 ${durationText}`;
}

function clearSidePanelTokenContext() {
  if (!chrome?.storage?.local) {
    return;
  }

  try {
    chrome.storage.local.remove(SIDE_PANEL_TOKEN_STORAGE_KEY, () => {
      const err = chrome.runtime?.lastError;
      if (err) {
        logger.debug('[Dog Bang] 无法清除 Side Panel token 缓存:', err.message);
      }
    });
  } catch (error) {
    logger.debug('[Dog Bang] 清除 Side Panel token 缓存失败:', error);
  }
}

function syncTokenContextToSidePanel(tokenAddress?: string | null, extra: Partial<SidePanelTokenContext> = {}) {
  if (!chrome?.storage?.local) {
    return;
  }

  if (!tokenAddress) {
    clearSidePanelTokenContext();
    return;
  }

  const payload: SidePanelTokenContext = {
    tokenAddress,
    url: extra.url ?? window.location.href,
    updatedAt: extra.updatedAt ?? Date.now(),
    preferredChannelId: extra.preferredChannelId
  };

  try {
    chrome.storage.local.set(
      {
        [SIDE_PANEL_TOKEN_STORAGE_KEY]: payload
      },
      () => {
        const err = chrome.runtime?.lastError;
        if (err) {
          logger.debug('[Dog Bang] 无法同步 Side Panel 代币信息:', err.message);
        }
      }
    );
  } catch (error) {
    logger.debug('[Dog Bang] 写入 Side Panel 代币缓存失败:', error);
  }
}

function syncTokenContextFromCurrentPage(force = false) {
  if (window.__DOG_BANG_SIDE_PANEL_MODE__) {
    return;
  }

  // 修复：只有当前标签页可见时才同步上下文
  // 避免后台标签页覆盖当前标签页的代币信息
  if (document.hidden && !force) {
    return;
  }

  if (tokenContextSyncPromise) {
    return tokenContextSyncPromise;
  }

  tokenContextSyncPromise = (async () => {
    const tokenAddress = getTokenAddressFromURL();

    if (!tokenAddress) {
      if (lastSyncedTokenAddress) {
        clearSidePanelTokenContext();
        lastSyncedTokenAddress = null;
        lastSyncedUrl = '';
      }
      return;
    }

    if (!force && tokenAddress === lastSyncedTokenAddress && window.location.href === lastSyncedUrl) {
      return;
    }

    // Update floating window when token changes
    const floatingWindow = document.getElementById('dog-bang-floating');
    if (floatingWindow && tokenAddress !== lastSyncedTokenAddress) {
      createFloatingTradingWindow(tokenAddress);
    }

    let preferredChannelId: string | undefined;
    try {
      const response = await safeSendMessage({
        action: 'get_token_route',
        data: { tokenAddress }
      });
      if (response && response.success && response.data?.preferredChannel) {
        preferredChannelId = response.data.preferredChannel;
      }

      // 预加载优化：在后台预加载余额和授权信息（不阻塞主流程）
      // 这样用户点击买入时，数据已经缓存好了
      Promise.all([
        // 预加载代币余额
        safeSendMessage({
          action: 'prefetch_token_balance',
          data: { tokenAddress }
        }).catch(() => {}), // 静默失败

        // 预加载授权状态（如果启用了切换页面授权）
        safeSendMessage({
          action: 'prefetch_approval_status',
          data: { tokenAddress }
        }).catch(() => {}) // 静默失败
      ]).catch(() => {}); // 整体静默失败，不影响主流程

    } catch (error) {
      logger.debug('[Dog Bang] 同步默认通道失败:', error);
    }

    syncTokenContextToSidePanel(tokenAddress, {
      preferredChannelId,
      url: window.location.href
    });

    lastSyncedTokenAddress = tokenAddress;
    lastSyncedUrl = window.location.href;
  })()
    .catch((error) => {
      logger.debug('[Dog Bang] 同步 Side Panel 上下文失败:', error);
    })
    .finally(() => {
      tokenContextSyncPromise = null;
    });

  return tokenContextSyncPromise;
}

function initializeTokenContextSync() {
  if (tokenContextObserverStarted || window.__DOG_BANG_SIDE_PANEL_MODE__) {
    return;
  }

  tokenContextObserverStarted = true;
  syncTokenContextFromCurrentPage(true);

  let observedUrl = window.location.href;
  const handleUrlChanged = (force = false) => {
    const currentUrl = window.location.href;
    if (!force && currentUrl === observedUrl) {
      return;
    }
    observedUrl = currentUrl;
    syncTokenContextFromCurrentPage(force);
  };

  const observer = new MutationObserver(() => handleUrlChanged());
  observer.observe(document, { subtree: true, childList: true });

  if (!historyListenersInstalled) {
    historyListenersInstalled = true;
    type HistoryMethod = typeof history['pushState'];
    const patchHistoryMethod = (method: 'pushState' | 'replaceState') => {
      const original = history[method] as HistoryMethod;
      if (typeof original !== 'function') {
        return;
      }
      const patched = function (this: History, ...args: Parameters<HistoryMethod>) {
        const result = original.apply(this, args);
        queueMicrotask(() => handleUrlChanged());
        return result;
      };
      history[method] = patched as HistoryMethod;
    };

    patchHistoryMethod('pushState');
    patchHistoryMethod('replaceState');
    window.addEventListener('popstate', () => handleUrlChanged());
    window.addEventListener('hashchange', () => handleUrlChanged());

    const handleVisibilityOrFocus = () => {
      if (document.hidden) {
        return;
      }
      syncTokenContextFromCurrentPage(true);
    };

    document.addEventListener('visibilitychange', handleVisibilityOrFocus);
    window.addEventListener('focus', handleVisibilityOrFocus);
    window.addEventListener('pageshow', handleVisibilityOrFocus);
  }
}


function rejectPendingPortRequests(reason: string) {
  pendingPortRequests.forEach(({ reject, timeoutId }) => {
    clearTimeout(timeoutId);
    reject(new Error(reason));
  });
  pendingPortRequests.clear();
}

function sendBackgroundPortRequest(message) {
  if (!backgroundPort) {
    return Promise.reject(new Error('Background port unavailable'));
  }

  const requestId = `port_req_${Date.now()}_${portRequestCounter++}`;

  return new Promise((resolve, reject) => {
    const timeoutId = setTimeout(() => {
      pendingPortRequests.delete(requestId);
      reject(new Error('Port request timeout'));
    }, PORT_REQUEST_TIMEOUT);

    pendingPortRequests.set(requestId, { resolve, reject, timeoutId });

    try {
      backgroundPort.postMessage({
        ...message,
        requestId
      });
    } catch (error) {
      clearTimeout(timeoutId);
      pendingPortRequests.delete(requestId);
      reject(error);
    }
  });
}

// ========== 全局状态 ==========
// 当前代币地址
let currentTokenAddress = null;

// 当前代币信息（从 background 获取，仅用于 UI 显示）
let currentTokenInfo = null;

// SidePanel 交易锁，防止并发交易
let isSidePanelTrading = false;

const pendingTransactions = new Map<string, { type: 'buy' | 'sell'; token: string }>();
const sellAutoApproveCache = new Set<string>();

// 快速轮询相关变量
let fastPollingTimer: number | null = null;
let fastPollingCount = 0;
const FAST_POLLING_INTERVAL = 1000; // 1秒
const FAST_POLLING_MAX_COUNT = 10; // 最多轮询10次

// 浮动窗口快速轮询相关变量
let floatingFastPollingTimer: number | null = null;
let floatingFastPollingCount = 0;

// Extension context 状态
let extensionContextValid = true;

// ========== Extension Context 错误处理 ==========
/**
 * 安全的 chrome.runtime.sendMessage 包装器
 * 处理 "Extension context invalidated" 错误
 */
async function safeSendMessage(message) {
  if (!extensionContextValid) {
    throw new Error('Extension context 已失效，请刷新页面');
  }

  try {
    if (backgroundPort && backgroundPortReady) {
      try {
        return await sendBackgroundPortRequest(message);
      } catch (portError: any) {
        const portMessage = (portError?.message || '').toLowerCase();
        const shouldFallback = portMessage.includes('background port') || portMessage.includes('port request');
        if (shouldFallback) {
          logger.debug('[Dog Bang] Background port 不可用，回退到 sendMessage');
          backgroundPortReady = false;
          backgroundPort = null;
          connectBackgroundPort();
        } else {
          throw portError;
        }
      }
    }
    return await chrome.runtime.sendMessage(message);
  } catch (error) {
    const errorMessage = typeof error?.message === 'string' ? error.message : String(error || '');
    if (errorMessage.includes('Extension context invalidated')) {
      logger.error('[Dog Bang] Extension context 已失效 - Service Worker 可能被重新加载');
      extensionContextValid = false;

      // 停止轮询
      stopPolling();

      // 显示友好的错误提示
      showStatus('⚠️ 扩展已更新，请刷新页面', 'warning');

      // 禁用交易按钮
      const buyBtn = document.getElementById('btn-buy');
      const sellBtn = document.getElementById('btn-sell');
      if (buyBtn) {
        buyBtn.disabled = true;
        buyBtn.textContent = '请刷新页面';
      }
      if (sellBtn) {
        sellBtn.disabled = true;
        sellBtn.textContent = '请刷新页面';
      }
    }
    throw error;
  }
}

/**
 * 安全发送消息（静默失败版本）
 * 用于通知等不需要响应的消息
 */
function safeSendMessageNoThrow(message) {
  if (!extensionContextValid) {
    return;
  }

  const sender: (msg: any) => Promise<any> = backgroundPort
    ? sendBackgroundPortRequest
    : (msg) => chrome.runtime.sendMessage(msg);

  sender(message).catch(error => {
    if (error.message && error.message.includes('Extension context invalidated')) {
      extensionContextValid = false;
    }
    // 静默失败，不抛出错误
  });
}

// ========== 性能监控 ==========
const performanceMetrics = {
  transactions: 0,          // 交易次数
  errors: 0,                // 错误次数
  startTime: Date.now()     // 监控开始时间
};

/**
 * 记录性能指标（仅 DEBUG 模式）
 */
function logPerformanceMetrics() {
  if (!DEBUG_CONFIG.ENABLED) return;

  const uptime = (Date.now() - performanceMetrics.startTime) / 1000;

  console.log(`[性能监控] ========== 性能统计 (运行时间: ${uptime.toFixed(1)}s) ==========`);
  console.log(`[性能监控] 交易次数: ${performanceMetrics.transactions}`);
  console.log(`[性能监控] 错误次数: ${performanceMetrics.errors}`);
  console.log(`[性能监控] ==================================================`);
}

/**
 * 每5分钟输出一次性能统计（仅 DEBUG 模式）
 */
if (DEBUG_CONFIG.ENABLED) {
  setInterval(() => {
    logPerformanceMetrics();
  }, CONTENT_CONFIG.PERF_LOG_INTERVAL_MS);
}

// ========== PUSH 模式：被动接收 background 推送 ==========
// 优化3: 移除定时轮询，改为 PUSH 模式
// 只在以下情况主动获取状态：
// 1. 页面首次加载
// 2. 页面重新可见
// 3. 用户点击交易按钮时

let pollingActive = false;
let walletStatusInterval: ReturnType<typeof setInterval> | null = null;

// 初始化钱包状态（只执行一次）
function initWalletStatus() {
  if (pollingActive) return;
  pollingActive = true;

  // 首次加载
  logger.debug('[Dog Bang] PUSH 模式：首次加载钱包状态');
  loadWalletStatus();

  if (walletStatusInterval) {
    clearInterval(walletStatusInterval);
  }
  walletStatusInterval = setInterval(() => {
    if (!document.hidden) {
      loadWalletStatus();
    }
  }, UI_CONFIG.BALANCE_UPDATE_INTERVAL ?? CONTENT_CONFIG.BALANCE_POLL_FALLBACK_MS);

  // 监听页面可见性变化 - 页面重新可见时刷新一次
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden && pollingActive) {
      logger.debug('[Dog Bang] 页面重新可见，刷新钱包状态');
      loadWalletStatus();
    }
  });
}

// 为了向后兼容，保留 startSmartPolling 函数名
export function startSmartPolling() {
  initWalletStatus();
}

// ========== TxWatcher 和保活机制由 background.js 管理 ==========
// 优化4: 删除了 initializeTxWatcher 和 enableTradingPageKeepAlive
// 优化6: 删除了 prewarmConnections
// background.js 会在 extension 激活时自动初始化这些服务

function stopPolling() {
  pollingActive = false;
  if (walletStatusInterval) {
    clearInterval(walletStatusInterval);
    walletStatusInterval = null;
  }
  logger.debug('[Dog Bang] 停止状态监听');
}

// ========== 快速轮询机制（买入/卖出后）==========
/**
 * 启动快速轮询，用于买入/卖出后快速更新余额
 * 每1秒查询一次，持续10秒或直到检测到余额变化
 */
function startFastPolling(tokenAddress: string, previousBalance: string) {
  // 停止之前的快速轮询
  stopFastPolling();

  fastPollingCount = 0;
  logger.debug('[Dog Bang] 启动快速轮询，检测余额变化');

  fastPollingTimer = setInterval(async () => {
    fastPollingCount++;

    try {
      // 查询最新余额
      await loadTokenInfo(tokenAddress);

      // 检查余额是否变化
      const currentBalance = currentTokenInfo?.balance || '0';
      if (currentBalance !== previousBalance) {
        logger.debug('[Dog Bang] 检测到余额变化，停止快速轮询', {
          previous: previousBalance,
          current: currentBalance
        });
        stopFastPolling();
        return;
      }

      // 达到最大轮询次数，停止
      if (fastPollingCount >= FAST_POLLING_MAX_COUNT) {
        logger.debug('[Dog Bang] 快速轮询达到最大次数，停止');
        stopFastPolling();
      }
    } catch (error) {
      logger.debug('[Dog Bang] 快速轮询查询余额失败:', error);
    }
  }, FAST_POLLING_INTERVAL);
}

/**
 * 停止快速轮询
 */
function stopFastPolling() {
  if (fastPollingTimer) {
    clearInterval(fastPollingTimer);
    fastPollingTimer = null;
    fastPollingCount = 0;
  }
}

// ========== 代币信息加载（从 background 获取）==========
// 优化1: 移除前端缓存，全部从 background 获取
async function loadTokenInfo(tokenAddress) {
  try {
    logger.debug('[Dog Bang] 从 background 获取代币信息');

    const response = await safeSendMessage({
      action: 'get_token_info',
      data: {
        tokenAddress,
        needApproval: true  // 获取授权信息，用于卖出时的性能优化
      }
    });

    if (response && response.success) {
      // 保存当前代币信息用于 UI 显示（包括授权信息）
      currentTokenInfo = {
        address: tokenAddress,
        symbol: response.data.symbol,
        decimals: response.data.decimals,
        totalSupply: response.data.totalSupply,
        balance: response.data.balance,
        allowances: response.data.allowances  // 保存授权信息
      };

      logger.debug('[Dog Bang] 代币信息已更新:', {
        symbol: currentTokenInfo.symbol,
        decimals: currentTokenInfo.decimals
      });

      // 更新余额显示（包括余额为0的情况）
      updateTokenBalanceDisplay(tokenAddress);
      scheduleSellEstimate();

      // 同时更新授权状态
      const panelElement = document.getElementById('dog-bang-panel');
      const channelSelector = panelElement?.querySelector('#channel-selector') as HTMLSelectElement | null;
      const currentChannel = channelSelector?.value || 'pancake';
      loadTokenApprovalStatus(tokenAddress, currentChannel);

      return currentTokenInfo;
    }
  } catch (error) {
    logger.error('[Dog Bang] Error loading token info:', error);
  }
  return null;
}

// ========== 授权状态加载和显示 ==========
async function loadTokenApprovalStatus(tokenAddress: string, channel?: string): Promise<boolean> {
  try {
    const panelElement = document.getElementById('dog-bang-panel');
    const channelSelector = panelElement?.querySelector('#channel-selector') as HTMLSelectElement | null;
    const currentChannel = channel || channelSelector?.value || 'pancake';

    logger.debug('[Dog Bang] 查询授权状态:', { tokenAddress, channel: currentChannel });

    const response = await safeSendMessage({
      action: 'check_token_approval',
      data: {
        tokenAddress,
        channel: currentChannel
      }
    });

    if (response && response.success) {
      const approved = response.approved === true;
      updateTokenApprovalDisplay(approved, false);
      return approved;
    } else {
      updateTokenApprovalDisplay(false, false, response?.error);
      return false;
    }
  } catch (error) {
    logger.error('[Dog Bang] 查询授权状态失败:', error);
    updateTokenApprovalDisplay(false, false, '查询失败');
    return false;
  }
}

function updateTokenApprovalDisplay(approved: boolean, approving: boolean = false, error?: string, operationType?: 'approve' | 'revoke') {
  const statusElement = document.getElementById('token-approval-status');
  const approveButton = document.getElementById('btn-manual-approve') as HTMLButtonElement | null;
  const revokeButton = document.getElementById('btn-revoke-approve') as HTMLButtonElement | null;

  if (!statusElement) return;

  if (approving) {
    // 根据操作类型显示不同的文本
    const loadingText = operationType === 'revoke' ? '撤销中...' : '授权中...';
    statusElement.textContent = loadingText;
    statusElement.className = 'approval-status approving';
    statusElement.style.display = 'inline-block';
    if (approveButton) {
      approveButton.style.display = 'none';
    }
    if (revokeButton) {
      revokeButton.style.display = 'none';
    }
  } else if (error) {
    statusElement.textContent = '';
    statusElement.style.display = 'none';
    if (approveButton) {
      approveButton.style.display = 'inline-block';
      approveButton.disabled = false;
    }
    if (revokeButton) {
      revokeButton.style.display = 'none';
    }
  } else if (approved) {
    statusElement.textContent = '已授权';
    statusElement.className = 'approval-status approved';
    statusElement.style.display = 'inline-block';
    if (approveButton) {
      approveButton.style.display = 'none';
    }
    if (revokeButton) {
      revokeButton.style.display = 'inline-block';
      revokeButton.disabled = false;
    }
  } else {
    // 未授权时不显示文本，只显示授权按钮
    statusElement.textContent = '';
    statusElement.style.display = 'none';
    if (approveButton) {
      approveButton.style.display = 'inline-block';
      approveButton.disabled = false;
    }
    if (revokeButton) {
      revokeButton.style.display = 'none';
    }
  }
}

// 手动授权
async function handleManualApprove() {
  const tokenAddress = currentTokenAddress;
  if (!tokenAddress) {
    showStatus('未找到代币地址', 'error');
    return;
  }

  const panelElement = document.getElementById('dog-bang-panel');
  const channelSelector = panelElement?.querySelector('#channel-selector') as HTMLSelectElement | null;
  const channel = channelSelector?.value || 'pancake';

  updateTokenApprovalDisplay(false, true, undefined, 'approve');
  showStatus('正在授权...', 'info');

  try {
    const response = await safeSendMessage({
      action: 'approve_token',
      data: {
        tokenAddress,
        channel
      }
    });

    if (response && response.success) {
      // 隐藏授权成功提示
      // showStatus('授权成功', 'success');

      // 延迟查询链上授权状态，确保 RPC 节点同步
      // 后端已经等待交易确认，但不同 RPC 节点间可能有同步延迟
      setTimeout(async () => {
        await loadTokenApprovalStatus(tokenAddress, channel);

        // 刷新代币信息以更新余额等
        if (currentTokenAddress) {
          loadTokenInfo(currentTokenAddress);
        }
      }, 1500); // 延迟 1.5 秒
    } else {
      showStatus(response?.error || '授权失败', 'error');
      updateTokenApprovalDisplay(false, false, response?.error);
    }
  } catch (error) {
    logger.error('[Dog Bang] 手动授权失败:', error);
    showStatus('授权失败', 'error');
    updateTokenApprovalDisplay(false, false, '授权失败');
  }
}

// 撤销授权
async function handleRevokeApproval() {
  const tokenAddress = currentTokenAddress;
  if (!tokenAddress) {
    showStatus('未找到代币地址', 'error');
    return;
  }

  const panelElement = document.getElementById('dog-bang-panel');
  const channelSelector = panelElement?.querySelector('#channel-selector') as HTMLSelectElement | null;
  const channel = channelSelector?.value || 'pancake';

  updateTokenApprovalDisplay(false, true, undefined, 'revoke');
  showStatus('正在撤销授权...', 'info');

  try {
    const response = await safeSendMessage({
      action: 'revoke_token_approval',
      data: {
        tokenAddress,
        channel
      }
    });

    if (response && response.success) {
      // 隐藏撤销授权成功提示
      // showStatus('撤销授权成功', 'success');

      // 延迟查询链上授权状态，确保 RPC 节点同步
      setTimeout(async () => {
        await loadTokenApprovalStatus(tokenAddress, channel);

        // 刷新代币信息以更新余额等
        if (currentTokenAddress) {
          loadTokenInfo(currentTokenAddress);
        }
      }, 1500); // 延迟 1.5 秒
    } else {
      showStatus(response?.error || '撤销授权失败', 'error');
      updateTokenApprovalDisplay(true, false);
    }
  } catch (error) {
    logger.error('[Dog Bang] 撤销授权失败:', error);
    showStatus('撤销授权失败', 'error');
    updateTokenApprovalDisplay(true, false);
  }
}

// 切换时自动授权（如果配置开启）
async function autoApproveOnSwitch(tokenAddress: string, channel?: string) {
  const settings = userSettings || DEFAULT_USER_SETTINGS;
  const autoApproveMode = settings.trading.autoApproveMode;

  logger.debug('[Dog Bang] Auto approve mode:', autoApproveMode);

  // 只有在 'switch' 模式下才自动授权
  if (autoApproveMode !== 'switch') {
    return;
  }

  const panelElement = document.getElementById('dog-bang-panel');
  const channelSelector = panelElement?.querySelector('#channel-selector') as HTMLSelectElement | null;
  const currentChannel = channel || channelSelector?.value || 'pancake';

  // 先查询当前授权状态
  const approved = await loadTokenApprovalStatus(tokenAddress, currentChannel);

  // 如果已授权,则不需要重新授权
  if (approved) {
    logger.debug('[Dog Bang] 代币已授权,跳过自动授权');
    return;
  }

  logger.debug('[Dog Bang] 执行切换时自动授权:', { tokenAddress, channel: currentChannel });

  updateTokenApprovalDisplay(false, true, undefined, 'approve');

  try {
    const response = await safeSendMessage({
      action: 'approve_token',
      data: {
        tokenAddress,
        channel: currentChannel
      }
    });

    if (response && response.success) {
      logger.debug('[Dog Bang] 自动授权成功');

      // 延迟查询链上授权状态，确保 RPC 节点同步
      setTimeout(async () => {
        await loadTokenApprovalStatus(tokenAddress, currentChannel);
      }, 1500);
    } else {
      logger.debug('[Dog Bang] 自动授权失败:', response?.error);
      updateTokenApprovalDisplay(false, false, response?.error);
    }
  } catch (error) {
    logger.error('[Dog Bang] 自动授权异常:', error);
    updateTokenApprovalDisplay(false, false, '自动授权失败');
  }
}

function clearRouteRefreshTimer() {
  if (routeRefreshTimer) {
    clearTimeout(routeRefreshTimer);
    routeRefreshTimer = null;
  }
}

function scheduleRouteRefresh(tokenAddress: string, delay = CONTENT_CONFIG.ROUTE_REFRESH_DEFAULT_DELAY_MS) {
  clearRouteRefreshTimer();
  routeRefreshTimer = setTimeout(() => {
    loadTokenRoute(tokenAddress).catch((error) => logger.debug('[Dog Bang] 刷新通道状态失败:', error));
  }, Math.max(CONTENT_CONFIG.ROUTE_REFRESH_MIN_DELAY_MS, delay));
}

async function loadTokenRoute(tokenAddress: string, options: { force?: boolean } = {}) {
  if (!tokenAddress) {
    return;
  }
  try {
    const response = await safeSendMessage({
      action: 'get_token_route',
      data: {
        tokenAddress,
        force: options.force ?? false
      }
    });
    if (response && response.success) {
      currentTokenRoute = response.data;
      applyTokenRouteToUI(currentTokenRoute);
      const nextDelay = typeof currentTokenRoute?.nextUpdateIn === 'number'
        ? currentTokenRoute.nextUpdateIn
        : CONTENT_CONFIG.ROUTE_REFRESH_DEFAULT_DELAY_MS;
      scheduleRouteRefresh(tokenAddress, nextDelay);
    } else {
      scheduleRouteRefresh(tokenAddress, CONTENT_CONFIG.ROUTE_REFRESH_DEFAULT_DELAY_MS);
    }
  } catch (error) {
    logger.error('[Dog Bang] 获取通道状态失败:', error);
    scheduleRouteRefresh(tokenAddress, CONTENT_CONFIG.ROUTE_REFRESH_DEFAULT_DELAY_MS);
  }
}

function applyTokenRouteToUI(route: any) {
  if (!route) {
    return;
  }
  const statusEl = document.getElementById('channel-status');
  if (statusEl) {
    const channelName = getChannelName(route.preferredChannel);
    let stateLabel = '';
    if (route.migrationStatus === 'migrating') {
      stateLabel = '迁移中';
    } else if (route.readyForPancake) {
      stateLabel = '已同步 Pancake';
    } else if (route.migrationStatus === 'monitoring' && typeof route.progress === 'number') {
      stateLabel = `进度 ${(route.progress * 100).toFixed(1)}%`;
    } else {
      stateLabel = '内盘';
    }
    statusEl.textContent = `${channelName} · ${stateLabel}`;
  }

  if (!userChannelOverride && route.preferredChannel) {
    const channelSelector = document.getElementById('channel-selector') as HTMLSelectElement | null;
    if (channelSelector && channelSelector.value !== route.preferredChannel) {
      channelSelector.value = route.preferredChannel;
      logger.debug('[Dog Bang] 根据通道状态自动切换到:', route.preferredChannel);
      scheduleSellEstimate();
    }
  }

  setRouteLock(route.lockReason || null, route.lockType || null);
  
  // Update floating window settings display if it exists
  if (globalUpdateSettingsDisplay) {
    globalUpdateSettingsDisplay();
  }
}

// ========== 优化的买入流程 ==========
async function handleBuy(tokenAddress) {
  // 检查钱包状态
  const walletAddressEl = document.getElementById('wallet-address');
  if (!walletAddressEl || !walletAddressEl.classList.contains('wallet-unlocked')) {
    showStatus('请先解锁钱包', 'error');
    return;
  }

  // 检查全局交易锁，防止并发交易
  if (isSidePanelTrading) {
    logger.debug('[SidePanel] 交易进行中，忽略重复点击');
    showStatus('交易进行中，请稍候', 'warning');
    return;
  }

  // 创建性能计时器
  const timer = new PerformanceTimer('buy');

  const amount = getInputValue('buy-amount');
  const slippage = getInputValue('slippage');
  const gasPrice = getInputValue('buy-gas-price');
  const channel = getInputValue('channel-selector');

  timer.step('读取交易参数');

  if (userSettings?.trading?.autoApproveMode === 'buy') {
    autoApproveToken(tokenAddress, channel);
  }

  if (!amount || parseFloat(amount) <= 0) {
    showStatus('请输入买入金额', 'error');
    return;
  }

  const btn = document.getElementById('btn-buy') as HTMLButtonElement | null;
  if (!btn) {
    return;
  }

  // 设置全局交易锁
  isSidePanelTrading = true;
  btn.disabled = true;
  const buttonTimer = startButtonTimer(btn, '买入中');

    timer.step('参数验证和UI更新');

  try {
    // showStatus(`正在通过 ${getChannelName(channel)} 买入...`, 'info');

    // 记录消息发送前的时间
    const messageSendStart = perf.now();

    // 买入不需要传递代币信息,后端会自己查询(有缓存)
    const response = await safeSendMessage({
      action: 'buy_token',
      data: {
        tokenAddress,
        amount,
        slippage: parseFloat(slippage),
        gasPrice: parseFloat(gasPrice),
        channel,
        forceChannel: userChannelOverride
      }
    });

    const totalMessageTime = perf.measure(messageSendStart);

    // 计算消息传递开销（总耗时 - 后端实际处理时间）
    const backendTime = response.performance ? response.performance.totalTime : 0;
    const messageOverhead = totalMessageTime - backendTime;

    timer.step(`发送买入请求并等待响应 (总计: ${totalMessageTime.toFixed(2)}ms, 后端: ${backendTime.toFixed(2)}ms, 消息开销: ${messageOverhead.toFixed(2)}ms)`);

    if (response.success) {
      pendingTransactions.set(response.txHash, { type: 'buy', token: tokenAddress });
      safeSendMessageNoThrow({
        action: 'show_notification',
        data: {
          title: '买入已提交',
          message: `等待链上确认: ${response.txHash.slice(0, 10)}...`
        }
      });

      // 买入成功后立即刷新余额
      const previousBalance = currentTokenInfo?.balance || '0';
      loadWalletStatus();
      loadTokenInfo(tokenAddress);
      loadTokenRoute(tokenAddress, { force: true });

      // 启动快速轮询，快速检测余额变化
      startFastPolling(tokenAddress, previousBalance);

      timer.step('处理成功响应和通知');

      const perfResult = timer.finish();
      const durationText = formatDuration(buttonTimer.stop('买入'));
      // 隐藏提交确认成功信息
      // const baseMessage = `⏳ 买入交易已提交，等待链上确认 (${response.txHash.slice(0, 10)}...)`;
      // showStatus(appendDurationSuffix(baseMessage, durationText), 'info');

      if (response.performance) {
        perf.printBackgroundReport('buy', response.performance);
      }
    } else {
      performanceMetrics.errors++;
      timer.step('处理失败响应');
      const perfResult = timer.finish();
      const durationText = formatDuration(buttonTimer.stop('买入'));
      const baseMessage = `❌ 买入失败: ${response.error}`;
      showStatus(appendDurationSuffix(baseMessage, durationText), 'error');

      // 失败时也打印 background 性能数据
      if (response.performance) {
        perf.printBackgroundReport('buy', response.performance);
      }
    }
  } catch (error) {
    performanceMetrics.errors++;
    timer.step(`捕获异常: ${error.message}`);
    const perfResult = timer.finish();
    const durationText = formatDuration(buttonTimer.stop('买入'));
    const baseMessage = `❌ 错误: ${error.message}`;
    showStatus(appendDurationSuffix(baseMessage, durationText), 'error');
  } finally {
    btn.disabled = false;
    // 释放全局交易锁
    isSidePanelTrading = false;
  }
}

// ========== 优化的卖出流程 ==========
async function handleSell(tokenAddress) {
  // 检查钱包状态
  const walletAddressEl = document.getElementById('wallet-address');
  if (!walletAddressEl || !walletAddressEl.classList.contains('wallet-unlocked')) {
    showStatus('请先解锁钱包', 'error');
    return;
  }

  // 检查全局交易锁，防止并发交易
  if (isSidePanelTrading) {
    logger.debug('[SidePanel] 交易进行中，忽略重复点击');
    showStatus('交易进行中，请稍候', 'warning');
    return;
  }

  // 检查代币余额是否为0
  // 如果有待确认的买入交易，跳过余额检查（允许立即卖出）
  const hasPendingBuy = Array.from(pendingTransactions.values()).some(
    tx => tx.type === 'buy' && tx.token === tokenAddress
  );

  if (!hasPendingBuy) {
    const tokenBalanceEl = document.getElementById('token-balance');
    const tokenBalanceText = tokenBalanceEl?.textContent?.trim() || '0.00';
    const tokenBalanceNum = parseFloat(tokenBalanceText);
    if (isNaN(tokenBalanceNum) || tokenBalanceNum < 0.001) {
      showStatus('代币余额为0，无法卖出', 'error');
      return;
    }
  }

  // 创建性能计时器
  const timer = new PerformanceTimer('sell');

  const percent = getInputValue('sell-percent');
  const slippage = getInputValue('slippage');
  const gasPrice = getInputValue('sell-gas-price');
  const channel = getInputValue('channel-selector');

  timer.step('读取交易参数');

  if (!percent || parseFloat(percent) <= 0 || parseFloat(percent) > 100) {
    showStatus('请输入有效的卖出百分比 (1-100)', 'error');
    return;
  }

  await waitForPendingApprovalIfNeeded('sell');

  const btn = document.getElementById('btn-sell') as HTMLButtonElement | null;
  if (!btn) {
    return;
  }

  // 设置全局交易锁
  isSidePanelTrading = true;
  btn.disabled = true;
  const buttonTimer = startButtonTimer(btn, '卖出中');

  timer.step('参数验证和UI更新');

  if (userSettings?.trading?.autoApproveMode === 'sell' && tokenAddress && channel) {
    const sellApprovalKey = `${tokenAddress.toLowerCase()}:${channel}`;
    if (!sellAutoApproveCache.has(sellApprovalKey)) {
      await autoApproveToken(tokenAddress, channel);
      sellAutoApproveCache.add(sellApprovalKey);
    }
  }

  try {
    // 优化1: 简化前端逻辑，数据查询全由 background 处理
    // showStatus(`正在通过 ${getChannelName(channel)} 卖出...`, 'info');

    // 记录消息发送前的时间
    const messageSendStart = perf.now();

    // 直接发送请求给 background，background 会处理所有数据获取
    const response = await safeSendMessage({
      action: 'sell_token',
      data: {
        tokenAddress,
        percent: parseFloat(percent),
        slippage: parseFloat(slippage),
        gasPrice: parseFloat(gasPrice),
        channel,
        forceChannel: userChannelOverride,
        tokenInfo: currentTokenInfo
      }
    });

    const totalMessageTime = perf.measure(messageSendStart);

    // 计算消息传递开销（总耗时 - 后端实际处理时间）
    const backendTime = response.performance ? response.performance.totalTime : 0;
    const messageOverhead = totalMessageTime - backendTime;

    timer.step(`发送卖出请求并等待响应 (总计: ${totalMessageTime.toFixed(2)}ms, 后端: ${backendTime.toFixed(2)}ms, 消息开销: ${messageOverhead.toFixed(2)}ms)`);

    if (response.success) {
      pendingTransactions.set(response.txHash, { type: 'sell', token: tokenAddress });
      safeSendMessageNoThrow({
        action: 'show_notification',
        data: {
          title: '卖出已提交',
          message: `等待链上确认: ${response.txHash.slice(0, 10)}...`
        }
      });

      // 卖出成功后立即刷新余额
      const is100PercentSell = parseFloat(percent) === 100;
      const previousBalance = currentTokenInfo?.balance || '0';
      loadWalletStatus();
      loadTokenInfo(tokenAddress);
      loadTokenRoute(tokenAddress, { force: true });

      // 启动快速轮询，快速检测余额变化（100%卖出除外，因为会直接清零）
      if (!is100PercentSell) {
        startFastPolling(tokenAddress, previousBalance);
      }

      // 特别处理：100% 卖出成功后直接清零余额
      // 使用 setTimeout 确保在刷新完成后设置
      if (is100PercentSell) {
        setTimeout(() => {
          const tokenBalanceEl = document.getElementById('token-balance');
          if (tokenBalanceEl) {
            tokenBalanceEl.textContent = '0.00';
            logger.debug('[SidePanel] 100% 卖出，余额已清零');
          }
        }, 100); // 等待刷新函数执行
      }

      timer.step('处理成功响应和通知');

      const perfResult = timer.finish();
      const durationText = formatDuration(buttonTimer.stop('卖出'));
      // 隐藏提交确认成功信息
      // const baseMessage = `⏳ 卖出交易已提交，等待链上确认 (${response.txHash.slice(0, 10)}...)`;
      // showStatus(appendDurationSuffix(baseMessage, durationText), 'info');

      if (response.performance) {
        perf.printBackgroundReport('sell', response.performance);
      }
      updateSellEstimateDisplay(null);
      stopSellEstimateTimer();
    } else {
      performanceMetrics.errors++;
      timer.step('处理失败响应');
      const perfResult = timer.finish();
      const durationText = formatDuration(buttonTimer.stop('卖出'));
      const baseMessage = `❌ 卖出失败: ${response.error}`;
      showStatus(appendDurationSuffix(baseMessage, durationText), 'error');

      // 失败时也打印 background 性能数据
      if (response.performance) {
        perf.printBackgroundReport('sell', response.performance);
      }
      updateSellEstimateDisplay(null);
    }
  } catch (error) {
    performanceMetrics.errors++;
    timer.step(`捕获异常: ${error.message}`);
    const perfResult = timer.finish();
    const durationText = formatDuration(buttonTimer.stop('卖出'));
    const baseMessage = `❌ 错误: ${error.message}`;
    showStatus(appendDurationSuffix(baseMessage, durationText), 'error');
    updateSellEstimateDisplay(null);
  } finally {
    btn.disabled = false;
    // 释放全局交易锁
    isSidePanelTrading = false;
  }
}

// ========== 优化的钱包状态加载 ==========
async function loadWalletStatus() {
  try {
    const response = await safeSendMessage({
      action: 'get_wallet_status',
      data: {
        tokenAddress: currentTokenAddress  // 只传递代币地址,让后端决定是否查询
      }
    });

    if (response.success) {
      const { address, bnbBalance, tokenBalance } = response.data;

      setWalletAddressDisplay(address);
      walletStatusClass = 'wallet-unlocked';
      applyWalletStatusClass();
      setTradeButtonsEnabled(true);
      clearWalletStatusNotice();

      setTextContent('bnb-balance', bnbBalance || '0.00');
      if (tokenBalance !== undefined) {
        setTextContent('token-balance', tokenBalance);
      }
    } else {
      // 处理各种错误状态(保持原有逻辑)
      const status = response?.status || response?.error;
      const isLockState = status === 'not_setup' || status === 'locked' || status === 'not_loaded';

      if (!isLockState) {
        showStatus(`钱包状态错误: ${response?.error || status || '未知错误'}`, 'error');
        return;
      }

      setTradeButtonsEnabled(false);

      if (status === 'not_setup') {
        setWalletDisplayText('未设置');
        walletStatusClass = 'wallet-not-setup';
        applyWalletStatusClass();
        clearWalletStatusNotice();
        // 在 SidePanel 模式下不显示状态消息，因为有遮罩层处理
        if (!window.__DOG_BANG_SIDE_PANEL_MODE__) {
          showStatus('请先在插件中设置钱包', 'warning', { persist: true });
        }
      } else if (status === 'locked' || status === 'not_loaded') {
        const address = response?.address;
        let messageText: string;
        if (address) {
          const lockIcon = status === 'locked' ? '🔒' : '⚠️';
          messageText = `${address.slice(0, 6)}...${address.slice(-4)} ${lockIcon}`;
        } else {
          messageText = status === 'locked' ? '已锁定 🔒' : '未加载 ⚠️';
        }
        setWalletDisplayText(messageText);
        walletStatusClass = 'wallet-locked';
        applyWalletStatusClass();

        const message = status === 'locked' ? '钱包已锁定,请在插件中解锁' : '钱包未加载,请在插件中重新解锁';
        // 在 SidePanel 模式下不显示状态消息，因为有遮罩层处理
        if (!window.__DOG_BANG_SIDE_PANEL_MODE__) {
          if (status === 'not_loaded') {
            showWalletStatusNotice(message);
          } else {
            clearWalletStatusNotice();
            const statusOptions = status === 'locked' ? { persist: true } : undefined;
            showStatus(message, 'warning', statusOptions);
          }
        }
      }

      setTextContent('bnb-balance', '--');
      setTextContent('token-balance', '--');
    }
  } catch (error) {
    logger.error('[Dog Bang] Failed to load wallet status:', error);
  }
}

// ========== 辅助函数 ==========
// 从URL获取代币地址（支持多平台）
function getTokenAddressFromURL() {
  const href = window.location.href || window.location.pathname || '';
  let pathname = window.location.pathname || '';
  let hostname = window.location.hostname?.toLowerCase() || '';
  try {
    const parsed = new URL(href);
    pathname = parsed.pathname || pathname;
    hostname = parsed.hostname?.toLowerCase() || hostname;
  } catch {
    // ignore parse errors
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
    { hostIncludes: 'flap.sh', pathPattern: /\/(?:bnb|bsc|eth|arb|op)\/(0x[a-fA-F0-9]{40})(?:\/|$)/i },
    { hostIncludes: 'axiom.trade', pathPattern: /\/meme\/(0x[a-fA-F0-9]{40})/i },
    { hostIncludes: 'debot.ai', pathPattern: /\/token\/(?:bsc|eth|bnb|arb|op)\/(0x[a-fA-F0-9]{40})/i }
  ];

  for (const pattern of hostPatterns) {
    if (hostname.includes(pattern.hostIncludes)) {
      return matchFirstGroup(pattern.pathPattern, pathname);
    }
  }

  return null;
}

// 获取通道显示名称
function getChannelName(channelId) {
  const channelNames = {
    'pancake': 'PancakeSwap',
    'four': 'Four.meme',
    'xmode': 'X Mode',
    'flap': 'Flap'
  };
  return channelNames[channelId] || channelId;
}

// 显示状态消息
type StatusOptions = {
  persist?: boolean;
};

function showStatus(message: string, type = 'info', options: StatusOptions = {}) {
  const { persist = false } = options;
  const statusEl = document.getElementById('status-message');
  if (!statusEl) return;

  if (statusHideTimer) {
    clearTimeout(statusHideTimer);
    statusHideTimer = null;
  }

  window.requestAnimationFrame(() => {
    statusEl.textContent = message;
    statusEl.className = `status-message status-${type}`;
    statusEl.style.display = 'block';
  });

  if (type !== 'error' && !persist) {
    const timeout = UI_CONFIG?.STATUS_MESSAGE_TIMEOUT ?? CONTENT_CONFIG.STATUS_MESSAGE_FALLBACK_MS;
    statusHideTimer = setTimeout(() => {
      statusHideTimer = null;
      if (statusEl.textContent === message) {
        statusEl.style.display = 'none';
      }
    }, timeout);
  }
}

function clearStatusMessage() {
  const statusEl = document.getElementById('status-message');
  if (!statusEl) return;
  if (statusHideTimer) {
    clearTimeout(statusHideTimer);
    statusHideTimer = null;
  }
  statusEl.textContent = '';
  statusEl.style.display = 'none';
}

function updateSellEstimateDisplay(value: string | null, symbol = 'BNB') {
  const estimateEl = document.getElementById('sell-estimate');
  if (!estimateEl) return;
  const safeSymbol = symbol || 'BNB';
  estimateEl.textContent = value ? `≈ ${value} ${safeSymbol}` : `≈ -- ${safeSymbol}`;
}

function stopSellEstimateTimer() {
  if (sellEstimateTimer) {
    clearInterval(sellEstimateTimer);
    sellEstimateTimer = null;
  }
  if (sellEstimateDebounceTimer) {
    clearTimeout(sellEstimateDebounceTimer);
    sellEstimateDebounceTimer = null;
  }
  sellEstimatePending = false;
  sellEstimateRequestId++;
}

function formatBnbAmount(weiValue: string | bigint, fractionDigits = 4) {
  try {
    const value = typeof weiValue === 'bigint' ? weiValue : BigInt(weiValue);
    const scale = BigInt(10 ** fractionDigits);
    const scaled = (value * scale) / WEI_PER_BNB;
    const integerPart = scaled / scale;
    let fractionalPart = (scaled % scale).toString().padStart(fractionDigits, '0');
    fractionalPart = fractionalPart.replace(/0+$/, '');
    return fractionalPart ? `${integerPart.toString()}.${fractionalPart}` : integerPart.toString();
  } catch (error) {
    logger.debug('[Dog Bang] 格式化 BNB 失败:', error);
    return '--';
  }
}

function clampFractionDigits(value: string | null | undefined, digits = 5) {
  if (!value) {
    return null;
  }
  if (digits <= 0) {
    return value.split('.')[0];
  }
  const [integerPart, fractionalPart = ''] = value.split('.');
  const trimmedFraction = fractionalPart.slice(0, digits);
  if (!trimmedFraction) {
    return integerPart;
  }
  return `${integerPart}.${trimmedFraction}`;
}

function getSellPercentValue() {
  const raw = getInputValue('sell-percent') || '0';
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) {
    return 0;
  }
  return Math.min(Math.max(parsed, 0), 100);
}

function calculateSellAmount(amountPercent: number) {
  if (!currentTokenInfo?.balance) {
    return null;
  }
  const balance = BigInt(currentTokenInfo.balance);
  if (balance <= 0n) {
    return null;
  }
  const scaledPercent = Math.round(amountPercent * 10000);
  if (scaledPercent <= 0) {
    return null;
  }
  const numerator = BigInt(scaledPercent);
  return balance * numerator / SELL_PERCENT_SCALE;
}

function shouldEstimateSellAmount() {
  if (routeLockReason) {
    return false;
  }
  // 检查余额是否存在且大于0
  if (!currentTokenAddress || !currentTokenInfo?.balance) {
    return false;
  }
  // 确保余额大于0（无论是字符串还是数字）
  try {
    const balance = BigInt(currentTokenInfo.balance);
    if (balance <= 0n) {
      return false;
    }
  } catch {
    return false;
  }
  const percent = getSellPercentValue();
  return percent > 0;
}

async function refreshSellEstimate() {
  if (!shouldEstimateSellAmount()) {
    stopSellEstimateTimer();
    updateSellEstimateDisplay(null);
    return;
  }

  if (sellEstimatePending) {
    return;
  }

  const percent = getSellPercentValue();
  const amountToSell = calculateSellAmount(percent);
  if (!amountToSell || amountToSell <= 0n) {
    updateSellEstimateDisplay(null);
    return;
  }

  const channel = getInputValue('channel-selector') || currentTokenRoute?.preferredChannel || 'pancake';
  sellEstimatePending = true;
  const requestId = ++sellEstimateRequestId;

  try {
    const response = await safeSendMessage({
      action: 'estimate_sell_amount',
      data: {
        tokenAddress: currentTokenAddress,
        amount: amountToSell.toString(),
        channel
      }
    });

    if (requestId !== sellEstimateRequestId) {
      return;
    }

    const displaySymbol = response?.data?.symbol || 'BNB';
    if (response?.success && response.data?.amount) {
      const formattedValue =
        response.data.formatted ??
        formatBnbAmount(response.data.amount, 3);
      const trimmedValue = clampFractionDigits(formattedValue, 3);
      updateSellEstimateDisplay(trimmedValue, displaySymbol);
    } else {
      updateSellEstimateDisplay(null, displaySymbol);
    }
  } catch (error) {
    logger.debug('[Dog Bang] 获取卖出预估失败:', error);
    updateSellEstimateDisplay(null);
  } finally {
    sellEstimatePending = false;
  }
}

function scheduleSellEstimate() {
  stopSellEstimateTimer();
  if (!shouldEstimateSellAmount()) {
    updateSellEstimateDisplay(null);
    return;
  }

  // 优化：添加防抖机制，用户停止输入后才触发估算
  // 首次立即执行一次估算
  refreshSellEstimate();

  // 设置定时轮询（间隔已从1秒优化到3秒）
  sellEstimateTimer = setInterval(() => {
    refreshSellEstimate();
  }, CONTENT_CONFIG.SELL_ESTIMATE_INTERVAL_MS);
}

// 优化：用于卖出百分比输入的防抖版本
function debouncedScheduleSellEstimate() {
  // 清除之前的防抖定时器
  if (sellEstimateDebounceTimer) {
    clearTimeout(sellEstimateDebounceTimer);
  }

  // 用户停止输入后才触发估算
  sellEstimateDebounceTimer = setTimeout(() => {
    scheduleSellEstimate();
  }, CONTENT_CONFIG.SELL_ESTIMATE_DEBOUNCE_MS);
}

// 更新代币余额显示
function updateTokenBalanceDisplay(tokenAddress) {
  try {
    if (currentTokenAddress !== tokenAddress) {
      return;
    }

    // 使用 currentTokenInfo 代替旧的缓存变量
    // 修改条件：允许余额为0的情况，只要balance和decimals存在
    if (currentTokenInfo &&
        currentTokenInfo.address === tokenAddress &&
        currentTokenInfo.balance !== undefined &&
        currentTokenInfo.balance !== null &&
        currentTokenInfo.decimals) {
      const balance = BigInt(currentTokenInfo.balance);
      const decimals = currentTokenInfo.decimals;

      const decimalsBigInt = BigInt(decimals);
      const divisor = 10n ** decimalsBigInt;
      const integerPart = balance / divisor;

      // 只显示整数部分，不显示小数
      const formattedBalance = integerPart.toString();

      const balanceEl = document.getElementById('token-balance');
      if (balanceEl) {
        balanceEl.textContent = formattedBalance;
      }
      logger.debug('[Dog Bang] 更新余额显示:', formattedBalance);
    }
  } catch (error) {
    logger.error('[Dog Bang] 更新余额显示失败:', error);
  }
}

// ========== 页面卸载时清理 ==========
window.addEventListener('beforeunload', () => {
  stopPolling();
  clearRouteRefreshTimer();
  stopSellEstimateTimer();
});

// ========== UI创建和事件绑定 ==========
// 创建交易面板 UI
export function createTradingPanel(options: TradingPanelOptions = {}) {
  const {
    tokenAddressOverride,
    mountPoint,
    defaultChannelId,
    disableAutoChannelSelection = false,
    sourceUrl
  } = options;
  const shouldAutoSelectChannel = !disableAutoChannelSelection;
  updatePanelSourceUrl(sourceUrl);
  userChannelOverride = shouldAutoSelectChannel ? false : true;
  currentTokenRoute = null;
  clearRouteRefreshTimer();

  if (!mountPoint && window !== window.top) {
    logger.debug('[Dog Bang] 检测到 iframe 上下文，跳过面板创建');
    return;
  }

  panelReady = false;
  const tokenAddress = tokenAddressOverride || getTokenAddressFromURL();

  if (!tokenAddress) {
    logger.debug('[Dog Bang] No token address found');
    return;
  }

  const existingPanel = document.getElementById('dog-bang-panel');
  if (existingPanel) {
    existingPanel.remove();
    logger.debug('[Dog Bang] 已存在旧面板，已移除以避免重复渲染');
  }

  currentTokenAddress = tokenAddress;
  // 修复：代币切换时重置 userChannelOverride，让系统自动选择正确的通道
  // 避免使用旧代币的手动通道设置导致新代币交易失败
  userChannelOverride = false;
  if (!tokenAddressOverride) {
    syncTokenContextToSidePanel(tokenAddress);
  }

  const panel = document.createElement('div');
  panel.id = 'dog-bang-panel';
  if (mountPoint) {
    panel.classList.add('embedded-trader-panel');
  }
  panel.dataset.tokenAddress = tokenAddress;

  const tradingPresets = userSettings?.trading ?? DEFAULT_USER_SETTINGS.trading;
  const buyPresets = tradingPresets.buyPresets ?? DEFAULT_USER_SETTINGS.trading.buyPresets;
  const sellPresets = tradingPresets.sellPresets ?? DEFAULT_USER_SETTINGS.trading.sellPresets;
  const slippagePresets = tradingPresets.slippagePresets ?? DEFAULT_USER_SETTINGS.trading.slippagePresets;
  const buyGasPresets = tradingPresets.buyGasPresets ?? DEFAULT_USER_SETTINGS.trading.buyGasPresets;
  const sellGasPresets = tradingPresets.sellGasPresets ?? DEFAULT_USER_SETTINGS.trading.sellGasPresets;

  const buyButtonsHtml = renderQuickButtons(buyPresets, 'buy');
  const sellButtonsHtml = renderQuickButtons(sellPresets, 'sell', '%');
  const slippageButtonsHtml = renderOptionButtons(slippagePresets, 'slippage', '%');
  const buyGasButtonsHtml = renderOptionButtons(buyGasPresets, 'buy-gas-price', '');
  const sellGasButtonsHtml = renderOptionButtons(sellGasPresets, 'sell-gas-price', '');

  const defaultBuyValue = escapeHtml(
    tradingPresets.defaultBuyValue ?? buyPresets[0] ?? DEFAULT_USER_SETTINGS.trading.defaultBuyValue
  );
  const defaultSellValue = escapeHtml(
    tradingPresets.defaultSellValue ??
      getMaxPresetValue(sellPresets, DEFAULT_USER_SETTINGS.trading.defaultSellValue)
  );
  const defaultSlippageValue = escapeHtml(
    tradingPresets.defaultSlippageValue ?? slippagePresets[0] ?? DEFAULT_USER_SETTINGS.trading.defaultSlippageValue
  );
  const defaultBuyGasValue = escapeHtml(
    tradingPresets.defaultBuyGasValue ??
      buyGasPresets[0] ??
      DEFAULT_USER_SETTINGS.trading.defaultBuyGasValue
  );
  const defaultSellGasValue = escapeHtml(
    tradingPresets.defaultSellGasValue ??
      tradingPresets.defaultBuyGasValue ??
      sellGasPresets[0] ??
      DEFAULT_USER_SETTINGS.trading.defaultSellGasValue
  );

  panel.innerHTML = `
    <div class="trader-core">
      <div class="trader-body">
        <div class="wallet-token-info">
          <div class="info-row">
            <span>钱包:</span>
            <span id="wallet-address">加载中...</span>
          </div>
          <div class="info-row">
            <span>代币:</span>
            <span
              id="token-address"
              class="token-address-link"
              title="${tokenAddress}"
              data-full-address="${tokenAddress}"
              role="button"
              tabindex="0"
            >
              ${tokenAddress.slice(0, 6)}...${tokenAddress.slice(-4)}
            </span>
          </div>
          <div class="info-row">
            <span>授权:</span>
            <div class="approval-container">
              <span id="token-approval-status" class="approval-status">查询中...</span>
              <button id="btn-manual-approve" class="btn-manual-approve" style="display:none;" title="手动授权">授权</button>
              <button id="btn-revoke-approve" class="btn-revoke-approve" style="display:none;" title="撤销授权">撤销</button>
            </div>
          </div>
        </div>
        <div class="trade-section">
          <div class="label-with-balance">
            <label>买入 (BNB)</label>
            <span id="bnb-balance" class="balance-inline">0.00</span>
          </div>
          <div class="input-group">
            <input type="number" id="buy-amount" placeholder="0.1" step="0.01" min="0" value="${defaultBuyValue}"/>
            <div class="quick-amounts">
              ${buyButtonsHtml}
            </div>
          </div>
          <button id="btn-buy" class="btn-trade btn-buy" disabled>买入</button>
        </div>
        <div class="trade-section">
          <div class="label-with-balance">
            <label>卖出 (%) <span id="sell-estimate" class="sell-estimate">≈ -- BNB</span></label>
            <span id="token-balance" class="balance-inline">0.00</span>
          </div>
          <div class="input-group">
            <input type="number" id="sell-percent" placeholder="100" step="1" min="1" max="100" value="${defaultSellValue}" />
            <div class="quick-amounts">
              ${sellButtonsHtml}
            </div>
          </div>
          <button id="btn-sell" class="btn-trade btn-sell" disabled>卖出</button>
        </div>
        <div class="settings">
          <div class="setting-row">
            <label>交易通道:</label>
            <select id="channel-selector" class="channel-selector">
              <option value="pancake">PancakeSwap</option>
              <option value="four">Four.meme</option>
              <option value="xmode">X Mode</option>
              <option value="flap">Flap</option>
            </select>
          </div>
          <div class="setting-row">
            <label>滑点 (%):</label>
            <div class="option-control">
              <div class="option-buttons" role="group" aria-label="Slippage Options" data-target-group="slippage">
                ${slippageButtonsHtml}
              </div>
              <input type="number" id="slippage" class="option-input" value="${defaultSlippageValue}" min="1" max="90" step="1" />
            </div>
          </div>
          <div class="setting-row">
            <label>Buy Gas (Gwei):</label>
            <div class="option-control">
              <div class="option-buttons" role="group" aria-label="Buy Gas Options" data-target-group="buy-gas-price">
                ${buyGasButtonsHtml}
              </div>
              <input type="number" id="buy-gas-price" class="option-input" value="${defaultBuyGasValue}" min="0.01" max="100" step="0.01" />
            </div>
          </div>
          <div class="setting-row">
            <label>Sell Gas (Gwei):</label>
            <div class="option-control">
              <div class="option-buttons" role="group" aria-label="Sell Gas Options" data-target-group="sell-gas-price">
                ${sellGasButtonsHtml}
              </div>
              <input type="number" id="sell-gas-price" class="option-input" value="${defaultSellGasValue}" min="0.01" max="100" step="0.01" />
            </div>
          </div>
        </div>
        <div id="status-message" class="status-message"></div>
      </div>
    </div>
  `;


  const container = mountPoint ?? document.body;
  container.appendChild(panel);
  applyWalletUiState();

  if (defaultChannelId) {
    const channelSelector = panel.querySelector('#channel-selector') as HTMLSelectElement | null;
    if (channelSelector) {
      channelSelector.value = defaultChannelId;
      logger.debug('[Dog Bang] 应用默认通道:', defaultChannelId);
    }
  }

  panelReady = true;
  flushPendingUiUpdates();
  attachEventListeners();
  loadWalletStatus();
  loadTokenRoute(tokenAddress, { force: true });
  loadTokenInfo(tokenAddress);
  updateSellEstimateDisplay(null);
  stopSellEstimateTimer();

  // 查询授权状态和执行切换时自动授权
  const channelSelector = panel.querySelector('#channel-selector') as HTMLSelectElement | null;
  const currentChannel = defaultChannelId || channelSelector?.value || 'pancake';
  loadTokenApprovalStatus(tokenAddress, currentChannel);
  autoApproveOnSwitch(tokenAddress, currentChannel);

}

type SwitchTokenOptions = Pick<TradingPanelOptions, 'defaultChannelId' | 'disableAutoChannelSelection' | 'sourceUrl'>;

export function switchTradingPanelToken(tokenAddress: string, options: SwitchTokenOptions = {}) {
  if (!tokenAddress) {
    return;
  }
  const panel = document.getElementById('dog-bang-panel');
  const mountPoint = panel?.parentElement ?? undefined;
  if (panel) {
    panel.remove();
    panelReady = false;
  }
  currentTokenAddress = null;
  currentTokenInfo = null;
  currentTokenRoute = null;
  stopSellEstimateTimer();
  updateSellEstimateDisplay(null);
  clearRouteRefreshTimer();
  createTradingPanel({
    tokenAddressOverride: tokenAddress,
    mountPoint,
    defaultChannelId: options.defaultChannelId,
    disableAutoChannelSelection: options.disableAutoChannelSelection,
    sourceUrl: options.sourceUrl ?? null
  });
}

export function updateTradingPanelSourceUrl(sourceUrl?: string | null) {
  updatePanelSourceUrl(sourceUrl);
}

// ========== 浮动交易窗口 ==========
const FLOATING_WINDOW_STORAGE_KEY = 'dogBangFloatingWindow';
const FLOATING_WINDOW_MIN_WIDTH = 200;
const FLOATING_WINDOW_MIN_HEIGHT = 100;

type FloatingWindowState = {
  position: { x: number; y: number };
  collapsed: boolean;
  opened: boolean; // 记录浮动窗口是否打开
};

let floatingWindowDragging = false;
let floatingWindowDragOffset = { x: 0, y: 0 };

function getFloatingWindowState(): FloatingWindowState {
  try {
    const stored = localStorage.getItem(FLOATING_WINDOW_STORAGE_KEY);
    if (stored) {
      return JSON.parse(stored);
    }
  } catch (error) {
    logger.debug('[Floating Window] 读取状态失败:', error);
  }
  // 默认位置：右下角 (考虑新的尺寸 346x294)
  return {
    position: { x: window.innerWidth - 360, y: window.innerHeight - 320 },
    collapsed: true,
    opened: false
  };
}

function saveFloatingWindowState(state: FloatingWindowState) {
  try {
    localStorage.setItem(FLOATING_WINDOW_STORAGE_KEY, JSON.stringify(state));
  } catch (error) {
    logger.debug('[Floating Window] 保存状态失败:', error);
  }
}

export function createFloatingTradingWindow(tokenAddressOverride?: string) {
  const tokenAddress = tokenAddressOverride || getTokenAddressFromURL();

  if (!tokenAddress) {
    logger.debug('[Floating Window] No token address found');
    return;
  }

  // 移除已存在的浮动窗口
  const existing = document.getElementById('dog-bang-floating');
  if (existing) {
    existing.remove();
  }

  currentTokenAddress = tokenAddress;
  // 修复：代币切换时重置 userChannelOverride，让系统自动选择正确的通道
  // 避免使用旧代币的手动通道设置导致新代币交易失败
  userChannelOverride = false;

  // Ensure token route is loaded for the floating window to display correct channel
  if (!currentTokenRoute || currentTokenRoute.tokenAddress !== tokenAddress) {
    loadTokenRoute(tokenAddress).catch(err => {
      logger.debug('[Floating Window] Failed to load token route:', err);
    });
  }

  const tradingPresets = userSettings?.trading ?? DEFAULT_USER_SETTINGS.trading;
  const buyPresets = tradingPresets.buyPresets ?? DEFAULT_USER_SETTINGS.trading.buyPresets;
  const sellPresets = tradingPresets.sellPresets ?? DEFAULT_USER_SETTINGS.trading.sellPresets;
  const slippagePresets = tradingPresets.slippagePresets ?? DEFAULT_USER_SETTINGS.trading.slippagePresets;
  const buyGasPresets = tradingPresets.buyGasPresets ?? DEFAULT_USER_SETTINGS.trading.buyGasPresets;
  const sellGasPresets = tradingPresets.sellGasPresets ?? DEFAULT_USER_SETTINGS.trading.sellGasPresets;

  const defaultSlippageValue = escapeHtml(
    tradingPresets.defaultSlippageValue ?? slippagePresets[0] ?? DEFAULT_USER_SETTINGS.trading.defaultSlippageValue
  );
  const defaultBuyGasValue = escapeHtml(
    tradingPresets.defaultBuyGasValue ?? buyGasPresets[0] ?? DEFAULT_USER_SETTINGS.trading.defaultBuyGasValue
  );
  const defaultSellGasValue = escapeHtml(
    tradingPresets.defaultSellGasValue ?? sellGasPresets[0] ?? DEFAULT_USER_SETTINGS.trading.defaultSellGasValue
  );

  const state = getFloatingWindowState();

  const floatingWindow = document.createElement('div');
  floatingWindow.id = 'dog-bang-floating';
  floatingWindow.className = 'dog-bang-floating-window';
  // 使用 transform 代替 left/top 以获得更好的性能
  floatingWindow.style.transform = `translate(${state.position.x}px, ${state.position.y}px)`;
  floatingWindow.style.left = '0';
  floatingWindow.style.top = '0';

  // 生成买入/卖出按钮 HTML（支持多于4个，CSS grid 会换行为两行）
  const buyButtonsHtml = renderQuickButtons(buyPresets, 'buy', '', 'floating-quick-btn');
  const sellButtonsHtml = renderQuickButtons(sellPresets, 'sell', '%', 'floating-quick-btn');

  // 生成滑点按钮 HTML
  const slippageButtonsHtml = slippagePresets.map(value =>
    `<button class="floating-option-btn" data-target="slippage" data-value="${escapeHtml(value)}">${escapeHtml(value)}%</button>`
  ).join('');

  // 生成 Buy Gas 按钮 HTML
  const buyGasButtonsHtml = buyGasPresets.map(value =>
    `<button class="floating-option-btn" data-target="buy-gas" data-value="${escapeHtml(value)}">${escapeHtml(value)}</button>`
  ).join('');

  // 生成 Sell Gas 按钮 HTML
  const sellGasButtonsHtml = sellGasPresets.map(value =>
    `<button class="floating-option-btn" data-target="sell-gas" data-value="${escapeHtml(value)}">${escapeHtml(value)}</button>`
  ).join('');

  floatingWindow.innerHTML = `
    <div class="floating-header">
      <div class="floating-drag-handle">
        <svg width="12" height="12" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
          <circle cx="3" cy="3" r="2" fill="#9ca3af"/>
          <circle cx="8" cy="3" r="2" fill="#9ca3af"/>
          <circle cx="13" cy="3" r="2" fill="#9ca3af"/>
          <circle cx="3" cy="8" r="2" fill="#9ca3af"/>
          <circle cx="8" cy="8" r="2" fill="#9ca3af"/>
          <circle cx="13" cy="8" r="2" fill="#9ca3af"/>
        </svg>
      </div>
      <button class="floating-close-btn" title="关闭">✕</button>
    </div>
    <div class="floating-content">
      <div class="floating-trade-section">
        <div class="floating-trade-group">
          <div class="floating-label-row">
            <div class="floating-label">买入 (BNB)</div>
            <div class="floating-balance" id="floating-bnb-balance">--</div>
          </div>
          <div class="floating-buttons">
            ${buyButtonsHtml}
          </div>
        </div>
        <div class="floating-trade-group">
          <div class="floating-label-row">
            <div class="floating-label">卖出 (%)</div>
            <div class="floating-balance" id="floating-token-balance">--</div>
          </div>
          <div class="floating-buttons">
            ${sellButtonsHtml}
          </div>
        </div>
      </div>
      <div class="floating-settings-display">
        <span class="setting-item"><span class="setting-label">滑点:</span> <span class="setting-value" id="display-slippage">10%</span></span>
        <span class="setting-item"><span class="setting-label">Buy:</span> <span class="setting-value" id="display-buy-gas">1 Gwei</span></span>
        <span class="setting-item"><span class="setting-label">Sell:</span> <span class="setting-value" id="display-sell-gas">1 Gwei</span></span>
        <span class="setting-item"><span class="setting-label">CH:</span> <span class="setting-value" id="display-channel">pancake</span></span>
      </div>
      <div class="floating-settings-toggle">
        <button class="floating-toggle-btn" data-collapsed="${state.collapsed}">
          <span class="toggle-icon">${state.collapsed ? '▼' : '▲'}</span>
          <span class="toggle-text">设置</span>
        </button>
      </div>
      <div class="floating-settings-section" style="display: ${state.collapsed ? 'none' : 'block'}">
        <div class="floating-setting-row">
          <label>滑点 (%):</label>
          <div class="floating-option-group">
            ${slippageButtonsHtml}
            <input type="number" class="floating-input" data-setting="slippage" value="${defaultSlippageValue}" min="1" max="90" step="1" />
          </div>
        </div>
        <div class="floating-setting-row">
          <label>Buy Gas:</label>
          <div class="floating-option-group">
            ${buyGasButtonsHtml}
            <input type="number" class="floating-input" data-setting="buy-gas" value="${defaultBuyGasValue}" min="0.01" max="100" step="0.01" />
          </div>
        </div>
        <div class="floating-setting-row">
          <label>Sell Gas:</label>
          <div class="floating-option-group">
            ${sellGasButtonsHtml}
            <input type="number" class="floating-input" data-setting="sell-gas" value="${defaultSellGasValue}" min="0.01" max="100" step="0.01" />
          </div>
        </div>
      </div>
    </div>
  `;

  document.body.appendChild(floatingWindow);

  // 绑定事件
  attachFloatingWindowEvents(floatingWindow, state);

  // 保存打开状态
  state.opened = true;
  saveFloatingWindowState(state);

  logger.debug('[Floating Window] 浮动交易窗口已创建');
}

function attachFloatingWindowEvents(floatingWindow: HTMLElement, state: FloatingWindowState) {
  // 关闭按钮
  const closeBtn = floatingWindow.querySelector('.floating-close-btn');
  closeBtn?.addEventListener('click', () => {
    // 保存关闭状态
    state.opened = false;
    saveFloatingWindowState(state);
    floatingWindow.remove();
  });

  // 拖拽功能 - 使用 transform 和 requestAnimationFrame 优化性能
  const dragHandle = floatingWindow.querySelector('.floating-drag-handle');
  let rafId: number | null = null;
  let currentX = state.position.x;
  let currentY = state.position.y;

  dragHandle?.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    floatingWindowDragging = true;

    // 计算初始偏移
    floatingWindowDragOffset.x = (e as PointerEvent).clientX - currentX;
    floatingWindowDragOffset.y = (e as PointerEvent).clientY - currentY;

    // 添加拖拽样式
    floatingWindow.classList.add('dragging');
    dragHandle.setPointerCapture((e as PointerEvent).pointerId);
  });

  const updatePosition = (clientX: number, clientY: number) => {
    if (!floatingWindowDragging) return;

    // 取消之前的动画帧
    if (rafId !== null) {
      cancelAnimationFrame(rafId);
    }

    rafId = requestAnimationFrame(() => {
      let newX = clientX - floatingWindowDragOffset.x;
      let newY = clientY - floatingWindowDragOffset.y;

      // 边界限制
      const rect = floatingWindow.getBoundingClientRect();
      const maxX = window.innerWidth - rect.width;
      const maxY = window.innerHeight - rect.height;
      newX = Math.max(0, Math.min(newX, maxX));
      newY = Math.max(0, Math.min(newY, maxY));

      currentX = newX;
      currentY = newY;

      // 使用 transform 而不是 left/top，利用 GPU 加速
      floatingWindow.style.transform = `translate(${newX}px, ${newY}px)`;
    });
  };

  document.addEventListener('pointermove', (e) => {
    if (!floatingWindowDragging) return;
    updatePosition(e.clientX, e.clientY);
  });

  document.addEventListener('pointerup', () => {
    if (floatingWindowDragging) {
      floatingWindowDragging = false;
      floatingWindow.classList.remove('dragging');

      // 取消任何待处理的动画帧
      if (rafId !== null) {
        cancelAnimationFrame(rafId);
        rafId = null;
      }

      // 保存位置
      state.position = {
        x: currentX,
        y: currentY
      };
      saveFloatingWindowState(state);
      
      // 恢复透明度到正常状态，避免拖拽后保持半透明
      floatingWindow.style.opacity = '';
    }
  });

  // 折叠/展开功能
  const toggleBtn = floatingWindow.querySelector('.floating-toggle-btn');
  const settingsSection = floatingWindow.querySelector('.floating-settings-section') as HTMLElement;

  toggleBtn?.addEventListener('click', () => {
    state.collapsed = !state.collapsed;
    toggleBtn.setAttribute('data-collapsed', String(state.collapsed));

    const icon = toggleBtn.querySelector('.toggle-icon');
    if (icon) {
      icon.textContent = state.collapsed ? '▼' : '▲';
    }

    if (settingsSection) {
      settingsSection.style.display = state.collapsed ? 'none' : 'block';
    }

    saveFloatingWindowState(state);
  });

  // 交易按钮事件
  let isTrading = false; // 全局交易锁，防止并发交易
  floatingWindow.querySelectorAll('.floating-quick-btn').forEach(btnElement => {
    const btn = btnElement as HTMLButtonElement;
    btn.addEventListener('click', async (e) => {
      // 阻止事件冒泡，避免重复触发
      e.stopPropagation();
      e.preventDefault();

      // 检查按钮是否已禁用，防止重复点击
      if (btn.disabled) {
        logger.debug('[Floating Window] 按钮已禁用，忽略重复点击');
        return;
      }

      // 检查全局交易锁，防止并发交易
      if (isTrading) {
        logger.debug('[Floating Window] 交易进行中，忽略重复点击');
        return;
      }

      // 使用 btn 而不是 e.target，确保获取正确的按钮数据
      const action = btn.dataset.action;
      const amount = btn.dataset.amount;

      if (!amount) return;

      // 每次交易前重新从 URL 获取当前代币地址，避免代币切换问题
      const latestTokenAddress = getTokenAddressFromURL();
      if (!latestTokenAddress) {
        logger.error('[Floating Window] 无法获取当前代币地址');
        return;
      }

      // 更新全局代币地址
      currentTokenAddress = latestTokenAddress;

      // Check token balance before starting timer for sell action
      // 如果有待确认的买入交易，跳过余额检查（允许立即卖出）
      if (action === 'sell') {
        const hasPendingBuy = Array.from(pendingTransactions.values()).some(
          tx => tx.type === 'buy' && tx.token === currentTokenAddress
        );

        if (!hasPendingBuy) {
          const tokenBalanceEl = floatingWindow.querySelector('#floating-token-balance');
          const tokenBalanceText = tokenBalanceEl?.textContent?.trim() || '0.00';
          const tokenBalance = parseFloat(tokenBalanceText);

          // If balance is 0, less than 0.001, or couldn't be parsed, return early
          if (isNaN(tokenBalance) || tokenBalance < 0.001) {
            showStatus('代币余额为0，无法卖出', 'error');
            return;
          }
        }
      }

      // 设置全局交易锁
      isTrading = true;

      // 禁用按钮并启动计时器
      btn.setAttribute('disabled', 'true');
      const originalText = btn.textContent || '';

      // 直接显示计时，不显示"买入中"/"卖出中"文字
      const timer = startButtonTimer(btn, '');

      // 获取当前设置（在 try 外面定义，方便 catch 块使用）
      const slippageInput = floatingWindow.querySelector('[data-setting="slippage"]') as HTMLInputElement;
      const slippage = parseFloat(slippageInput?.value || '10');
      const channelSelector = document.getElementById('channel-selector') as HTMLSelectElement | null;
      const channel = channelSelector?.value || 'pancake';

      try {
        let isSuccess = false;

        if (action === 'buy') {
          const gasInput = floatingWindow.querySelector('[data-setting="buy-gas"]') as HTMLInputElement;
          const gasPrice = parseFloat(gasInput?.value || '1');

          const response = await safeSendMessage({
            action: 'buy_token',
            data: {
              tokenAddress: currentTokenAddress,
              amount,
              slippage,
              gasPrice,
              channel,
              forceChannel: userChannelOverride
            }
          });

          if (response?.success) {
            timer.stop(`✓ ${formatDuration(timer.getElapsed())}`);
            logger.debug('[Floating Window] 买入成功');
            isSuccess = true;

            // 买入成功后立即刷新余额
            const tokenBalanceEl = floatingWindow.querySelector('#floating-token-balance');
            const previousBalance = tokenBalanceEl?.textContent?.trim() || '0';
            updateFloatingBalances().catch(err => {
              logger.debug('[Floating Window] 刷新余额失败:', err);
            });

            // 启动快速轮询，快速检测余额变化
            startFloatingFastPolling(previousBalance);
          } else {
            throw new Error(response?.error || '买入失败');
          }
        } else if (action === 'sell') {
          const gasInput = floatingWindow.querySelector('[data-setting="sell-gas"]') as HTMLInputElement;
          const gasPrice = parseFloat(gasInput?.value || '1');

          const response = await safeSendMessage({
            action: 'sell_token',
            data: {
              tokenAddress: currentTokenAddress,
              percent: amount,
              slippage,
              gasPrice,
              channel,
              forceChannel: userChannelOverride,
              tokenInfo: currentTokenInfo
            }
          });

          if (response?.success) {
            timer.stop(`✓ ${formatDuration(timer.getElapsed())}`);
            logger.debug('[Floating Window] 卖出成功');
            isSuccess = true;

            // 卖出成功后立即刷新余额
            const is100PercentSell = parseFloat(amount) === 100;
            const tokenBalanceEl = floatingWindow.querySelector('#floating-token-balance');
            const previousBalance = tokenBalanceEl?.textContent?.trim() || '0';

            updateFloatingBalances().catch(err => {
              logger.debug('[Floating Window] 刷新余额失败:', err);
            }).finally(() => {
              // 特别处理：100% 卖出成功后直接清零余额
              // 在刷新完成后设置，确保不会被查询结果覆盖
              if (is100PercentSell) {
                const tokenBalanceEl = floatingWindow.querySelector('#floating-token-balance');
                if (tokenBalanceEl) {
                  tokenBalanceEl.textContent = '0.00';
                  logger.debug('[Floating Window] 100% 卖出，余额已清零');
                }
              }
            });

            // 启动快速轮询，快速检测余额变化（100%卖出除外，因为会直接清零）
            if (!is100PercentSell) {
              startFloatingFastPolling(previousBalance);
            }
          } else {
            throw new Error(response?.error || '卖出失败');
          }
        }

        // 成功时立即恢复，无需延迟
        btn.textContent = originalText;
        btn.removeAttribute('disabled');
      } catch (error) {
        timer.stop(`✗ ${formatDuration(timer.getElapsed())}`);
        logger.error('[Floating Window] 交易失败:', error);
        // Debug 级别的详细日志
        logger.debug('[Floating Window] 错误详情:', {
          message: error?.message,
          tokenAddress: currentTokenAddress,
          channel,
          forceChannel: userChannelOverride,
          action
        });

        // 失败时延迟恢复，给用户看到失败提示
        setTimeout(() => {
          btn.textContent = originalText;
          btn.removeAttribute('disabled');
        }, 500);
      } finally {
        // 释放全局交易锁
        isTrading = false;
      }
    });
  });

  // 更新设置显示行的函数
  const updateSettingsDisplay = () => {
    const slippageInput = floatingWindow.querySelector('[data-setting="slippage"]') as HTMLInputElement;
    const buyGasInput = floatingWindow.querySelector('[data-setting="buy-gas"]') as HTMLInputElement;
    const sellGasInput = floatingWindow.querySelector('[data-setting="sell-gas"]') as HTMLInputElement;

    if (slippageInput) {
      const displaySlippage = floatingWindow.querySelector('#display-slippage');
      if (displaySlippage) displaySlippage.textContent = `${slippageInput.value}%`;
    }
    if (buyGasInput) {
      const displayBuyGas = floatingWindow.querySelector('#display-buy-gas');
      if (displayBuyGas) displayBuyGas.textContent = `${buyGasInput.value}Gwei`;
    }
    if (sellGasInput) {
      const displaySellGas = floatingWindow.querySelector('#display-sell-gas');
      if (displaySellGas) displaySellGas.textContent = `${sellGasInput.value}Gwei`;
    }
    
    // Display current token's preferred channel instead of global channel selector
    const displayChannel = floatingWindow.querySelector('#display-channel');
    if (displayChannel) {
      const currentChannel = currentTokenRoute?.preferredChannel || 'pancake';
      displayChannel.textContent = getChannelName(currentChannel);
    }
  };

  // Store reference for global access
  globalUpdateSettingsDisplay = updateSettingsDisplay;

  // 设置选项按钮事件
  floatingWindow.querySelectorAll('.floating-option-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      const target = e.target as HTMLElement;
      const settingTarget = target.dataset.target;
      const value = target.dataset.value;

      if (settingTarget && value) {
        const input = floatingWindow.querySelector(`[data-setting="${settingTarget}"]`) as HTMLInputElement;
        if (input) {
          input.value = value;
          updateSettingsDisplay();
        }
      }
    });
  });

  // 监听input变化
  floatingWindow.querySelectorAll('input[data-setting]').forEach(input => {
    input.addEventListener('change', updateSettingsDisplay);
    input.addEventListener('input', updateSettingsDisplay);
  });

  // 初始化显示
  updateSettingsDisplay();

  // 确保窗口位置在视口内的函数
  const ensureWindowInViewport = () => {
    const rect = floatingWindow.getBoundingClientRect();
    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;

    let newX = currentX;
    let newY = currentY;
    let changed = false;

    // 确保窗口不超出右边界
    if (rect.right > viewportWidth) {
      newX = viewportWidth - rect.width - 10;
      changed = true;
    }

    // 确保窗口不超出左边界
    if (rect.left < 0) {
      newX = 10;
      changed = true;
    }

    // 确保窗口不超出底部边界
    if (rect.bottom > viewportHeight) {
      newY = viewportHeight - rect.height - 10;
      changed = true;
    }

    // 确保窗口不超出顶部边界
    if (rect.top < 0) {
      newY = 10;
      changed = true;
    }

    if (changed) {
      currentX = newX;
      currentY = newY;
      floatingWindow.style.transform = `translate(${newX}px, ${newY}px)`;
      state.position = { x: newX, y: newY };
      saveFloatingWindowState(state);
    }
  };

  // 监听窗口大小变化
  const resizeObserver = new ResizeObserver(() => {
    ensureWindowInViewport();
  });
  resizeObserver.observe(document.body);

  // 监听页面缩放
  window.addEventListener('resize', ensureWindowInViewport);

  // 更新余额显示
  const updateFloatingBalances = async () => {
    try {
      const response = await safeSendMessage({
        action: 'get_wallet_status',
        data: {
          tokenAddress: currentTokenAddress
        }
      });

      if (response?.success) {
        const { bnbBalance, tokenBalance } = response.data;

        const bnbBalanceEl = floatingWindow.querySelector('#floating-bnb-balance');
        const tokenBalanceEl = floatingWindow.querySelector('#floating-token-balance');

        if (bnbBalanceEl) {
          bnbBalanceEl.textContent = bnbBalance || '0.00';
        }

        if (tokenBalanceEl && tokenBalance !== undefined) {
          tokenBalanceEl.textContent = tokenBalance;
        }
      }
    } catch (error) {
      logger.debug('[Floating Window] 更新余额失败:', error);
    }
  };

  // 浮动窗口快速轮询函数
  const startFloatingFastPolling = (previousBalance: string) => {
    // 停止之前的快速轮询
    stopFloatingFastPolling();

    floatingFastPollingCount = 0;
    logger.debug('[Floating Window] 启动快速轮询，检测余额变化');

    floatingFastPollingTimer = setInterval(async () => {
      floatingFastPollingCount++;

      try {
        // 查询最新余额
        await updateFloatingBalances();

        // 检查余额是否变化
        const tokenBalanceEl = floatingWindow.querySelector('#floating-token-balance');
        const currentBalance = tokenBalanceEl?.textContent?.trim() || '0';

        if (currentBalance !== previousBalance) {
          logger.debug('[Floating Window] 检测到余额变化，停止快速轮询', {
            previous: previousBalance,
            current: currentBalance
          });
          stopFloatingFastPolling();
          return;
        }

        // 达到最大轮询次数，停止
        if (floatingFastPollingCount >= FAST_POLLING_MAX_COUNT) {
          logger.debug('[Floating Window] 快速轮询达到最大次数，停止');
          stopFloatingFastPolling();
        }
      } catch (error) {
        logger.debug('[Floating Window] 快速轮询查询余额失败:', error);
      }
    }, FAST_POLLING_INTERVAL);
  };

  const stopFloatingFastPolling = () => {
    if (floatingFastPollingTimer) {
      clearInterval(floatingFastPollingTimer);
      floatingFastPollingTimer = null;
      floatingFastPollingCount = 0;
    }
  };

  // 初始加载余额
  updateFloatingBalances();

  // 定期更新余额（每10秒）
  const balanceInterval = setInterval(updateFloatingBalances, 10000);

  // 当浮动窗口被移除时清理监听器
  const observer = new MutationObserver((mutations) => {
    mutations.forEach((mutation) => {
      mutation.removedNodes.forEach((node) => {
        if (node === floatingWindow) {
          resizeObserver.disconnect();
          window.removeEventListener('resize', ensureWindowInViewport);
          clearInterval(balanceInterval);
          stopFloatingFastPolling();
          observer.disconnect();
        }
      });
    });
  });
  observer.observe(document.body, { childList: true });
}

// 绑定事件监听
function attachEventListeners() {
  document.querySelectorAll('.btn-quick').forEach(btn => {
    btn.addEventListener('click', (e) => {
      const target = e.target as HTMLElement;
      const action = target?.dataset?.action;
      const amount = target?.dataset?.amount ?? '';
      if (action === 'buy') {
        setInputValue('buy-amount', amount);
      } else if (action === 'sell') {
        setInputValue('sell-percent', amount);
        scheduleSellEstimate();
      }
    });
  });

  const sellPercentInput = document.getElementById('sell-percent') as HTMLInputElement | null;
  sellPercentInput?.addEventListener('input', () => {
    // 优化：用户输入时使用防抖版本，减少频繁的估算请求
    debouncedScheduleSellEstimate();
  });

  const updateOptionButtonState = (targetId: string, value: string) => {
    const group = document.querySelector(`.option-buttons[data-target-group="${targetId}"]`);
    if (!group) return;
    group.querySelectorAll<HTMLButtonElement>('.btn-option').forEach((btn) => {
      if (btn.dataset.value === value) {
        btn.classList.add('active');
      } else {
        btn.classList.remove('active');
      }
    });
  };

  document.querySelectorAll('.option-buttons').forEach(group => {
    group.addEventListener('click', (event) => {
      const button = (event.target as HTMLElement).closest<HTMLButtonElement>('.btn-option');
      if (!button) return;
      const targetId = button.dataset.target;
      if (!targetId) return;
      const value = button.dataset.value ?? '';

      setInputValue(targetId, value);
      updateOptionButtonState(targetId, value);
    });
  });

  document.querySelectorAll<HTMLInputElement>('.option-input').forEach((input) => {
    input.addEventListener('input', () => {
      updateOptionButtonState(input.id, input.value);
    });
  });

  document.getElementById('btn-buy')?.addEventListener('click', () => {
    const activeToken = getActiveTokenAddress();
    if (!activeToken) {
      showStatus('未找到当前代币地址', 'error');
      return;
    }
    handleBuy(activeToken);
  });

  document.getElementById('btn-sell')?.addEventListener('click', () => {
    const activeToken = getActiveTokenAddress();
    if (!activeToken) {
      showStatus('未找到当前代币地址', 'error');
      return;
    }
    handleSell(activeToken);
  });

  const tokenAddressEl = document.getElementById('token-address');
  if (tokenAddressEl) {
    const copyTokenAddress = async () => {
      const activeToken = tokenAddressEl.getAttribute('data-full-address') || getActiveTokenAddress();
      if (!activeToken) {
        showStatus('未找到当前代币地址', 'error');
        return;
      }
      const copied = await copyTextToClipboard(activeToken);
      if (copied) {
        showStatus('代币地址已复制', 'success');
      } else {
        showStatus('复制失败，请手动复制', 'error');
      }
    };

    tokenAddressEl.addEventListener('click', (event) => {
      event.preventDefault();
      copyTokenAddress();
    });

    tokenAddressEl.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        copyTokenAddress();
      }
    });
  }

  // 监听通道切换，检查新通道是否需要授权
  const channelSelector = document.getElementById('channel-selector') as HTMLSelectElement | null;
  channelSelector?.addEventListener('change', (e) => {
    const newChannel = (e.target as HTMLSelectElement).value;
    userChannelOverride = true;
    logger.debug('[Dog Bang] 通道已切换到:', newChannel);

    // 异步检查新通道是否需要授权
    const activeToken = getActiveTokenAddress();
    if (activeToken) {
      checkChannelApproval(activeToken, newChannel);
      // 重新查询授权状态
      loadTokenApprovalStatus(activeToken, newChannel);
    }
    scheduleSellEstimate();
  });

  // 手动授权按钮监听
  const manualApproveButton = document.getElementById('btn-manual-approve');
  manualApproveButton?.addEventListener('click', () => {
    handleManualApprove();
  });

  // 撤销授权按钮监听
  const revokeApproveButton = document.getElementById('btn-revoke-approve');
  revokeApproveButton?.addEventListener('click', () => {
    handleRevokeApproval();
  });
}

// 检查指定通道的授权状态并在需要时自动授权
async function checkChannelApproval(tokenAddress, channel) {
  await requestTokenApproval(tokenAddress, channel);
}

let pendingApprovalKey: string | null = null;
let pendingApprovalPromise: Promise<void> | null = null;

async function waitForPendingApprovalIfNeeded(action: 'sell' | 'buy' = 'sell') {
  if (!pendingApprovalPromise) {
    return;
  }
  const actionLabel = action === 'sell' ? '卖出' : '买入';
  showStatus(`⚙️ 正在完成代币授权，请稍候再${actionLabel}...`, 'info', { persist: true });
  try {
    await pendingApprovalPromise;
  } catch (error) {
    logger.debug('[Dog Bang] 等待授权完成失败:', error);
  }
}

async function requestTokenApproval(tokenAddress?: string | null, channel?: string | null) {
  if (!tokenAddress || !channel) {
    return;
  }
  const requestKey = `${tokenAddress}:${channel}`;
  if (pendingApprovalKey === requestKey && pendingApprovalPromise) {
    return pendingApprovalPromise;
  }

  const approvalPromise = (async () => {
    try {
      logger.debug('[Dog Bang] 检查通道授权:', { tokenAddress, channel });

      // 先查询当前授权状态
      const currentApprovalStatus = await loadTokenApprovalStatus(tokenAddress, channel);

      // 如果已授权，不需要重新授权
      if (currentApprovalStatus) {
        logger.debug('[Dog Bang] 代币已授权，跳过');
        return;
      }

      // 显示授权中状态
      updateTokenApprovalDisplay(false, true, undefined, 'approve');

      const response = await safeSendMessage({
        action: 'approve_token',
        data: {
          tokenAddress,
          channel
        }
      });

      if (response && response.success && response.needApproval) {
        logger.debug('[Dog Bang] ✓ 自动授权完成:', response.message);

        // 延迟查询链上授权状态，确保 RPC 节点同步
        setTimeout(async () => {
          await loadTokenApprovalStatus(tokenAddress, channel);
        }, 1500);
      } else if (response?.message) {
        logger.debug('[Dog Bang] 授权状态:', response.message);

        // 即使不需要授权，也更新一下状态（无需延迟，因为没有新交易）
        await loadTokenApprovalStatus(tokenAddress, channel);
      }
    } catch (error) {
      logger.debug('[Dog Bang] 授权检查异常:', error.message);

      // 授权失败，显示错误
      updateTokenApprovalDisplay(false, false, '授权失败');
    } finally {
      if (pendingApprovalKey === requestKey) {
        pendingApprovalKey = null;
        pendingApprovalPromise = null;
      }
    }
  })();

  pendingApprovalKey = requestKey;
  pendingApprovalPromise = approvalPromise;
  return approvalPromise;
}

// ========== 自动授权代币（简化版，由 background 处理判断逻辑）==========
async function autoApproveToken(tokenAddress, channelOverride?: string) {
  try {
    // 等待一小段时间，让钱包状态和通道选择先完成
    await new Promise(resolve => setTimeout(resolve, CONTENT_CONFIG.AUTO_APPROVE_DEBOUNCE_MS));

    logger.debug('[Dog Bang] 开始自动授权检查，token:', tokenAddress);

    // 获取当前选择的通道
    let channel = channelOverride;
    if (!channel) {
      const channelSelector = document.getElementById('channel-selector') as HTMLSelectElement | null;
      if (!channelSelector) {
        logger.warn('[Dog Bang] 找不到通道选择器，跳过自动授权');
        return;
      }
      channel = channelSelector.value;
    }
    logger.debug('[Dog Bang] 当前通道:', channel);

    await requestTokenApproval(tokenAddress, channel);

  } catch (error) {
    // 自动授权失败不应该影响用户体验，静默处理
    logger.debug('[Dog Bang] 自动授权异常:', error.message);
  }
}

function handleTxConfirmationPush(data) {
  if (!data || !data.txHash) {
    return;
  }

  const { txHash, status, reason } = data;
  const pendingInfo = pendingTransactions.get(txHash);
  if (pendingInfo) {
    pendingTransactions.delete(txHash);
  }

  let message: string | null = null;
  let statusType: 'success' | 'error' | 'warning' = 'success';

  const actionText = pendingInfo?.type === 'sell'
    ? '卖出'
    : pendingInfo?.type === 'buy'
      ? '买入'
      : '交易';

  if (status === 'success') {
    message = `✅ ${actionText}完成: ${txHash.slice(0, 10)}...`;
    statusType = 'success';
    performanceMetrics.transactions++;

    if ((pendingInfo?.token && pendingInfo.token === currentTokenAddress) || (!pendingInfo && currentTokenAddress)) {
      loadTokenInfo(currentTokenAddress);
    }
    loadWalletStatus();
  } else if (status === 'failed') {
    const actionText = pendingInfo?.type === 'sell' ? '卖出' : pendingInfo?.type === 'buy' ? '买入' : '交易';
    message = `❌ ${actionText}失败: ${reason || '链上执行失败'}`;
    statusType = 'error';
    performanceMetrics.errors++;
  } else if (status === 'timeout') {
    const actionText = pendingInfo?.type === 'sell' ? '卖出' : pendingInfo?.type === 'buy' ? '买入' : '交易';
    message = `⚠️ ${actionText}未确认: ${reason || '节点长时间未返回结果'}`;
    statusType = 'warning';
    performanceMetrics.errors++;
  }

  if (message) {
    showStatus(message, statusType);
  }
}

function handleExtensionMessage(request) {
  if (!request || !request.action) {
    return;
  }

  console.log('[Dog Bang] Received message:', request.action, request);

  if (request.action === 'wallet_status_updated') {
    logger.debug('[Dog Bang] PUSH: 收到钱包状态更新');
    handleWalletStatusPush(request.data);
  } else if (request.action === 'token_balance_updated') {
    logger.debug('[Dog Bang] PUSH: 收到代币余额更新');
    handleTokenBalancePush(request.data);
  } else if (request.action === 'wallet_unlocked') {
    logger.debug('[Dog Bang] Wallet unlocked (legacy)');
  } else if (request.action === 'tx_confirmed') {
    logger.debug('[Dog Bang] Transaction confirmed');
    handleTxConfirmationPush(request.data);
  } else if (request.action === 'open_floating_window') {
    logger.debug('[Dog Bang] 打开浮动交易窗口');
    const tokenAddress = request.tokenAddress || getTokenAddressFromURL();
    if (tokenAddress) {
      createFloatingTradingWindow(tokenAddress);
    } else {
      logger.warn('[Dog Bang] 无法打开浮动窗口：未找到代币地址');
    }
  }
}

function registerRuntimeListeners() {
  chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    // 处理 ping 消息，用于检测 content script 是否已加载
    if (request?.action === 'ping') {
      sendResponse({ status: 'ready' });
      return true;
    }

    handleExtensionMessage(request);
    return false;
  });
}

function connectBackgroundPort() {
  try {
    backgroundPort = chrome.runtime.connect({ name: 'dog-bang-content' });
    backgroundPortReady = true;
  } catch (error) {
    console.warn('[Dog Bang] 无法连接到 background port:', error);
    return;
  }

  backgroundPort.onMessage.addListener((message) => {
    if (message && message.requestId && pendingPortRequests.has(message.requestId)) {
      const pending = pendingPortRequests.get(message.requestId);
      pendingPortRequests.delete(message.requestId);
      clearTimeout(pending.timeoutId);
      if (message.data && message.data.success === false) {
        pending.reject(new Error(message.data.error || 'Port request failed'));
      } else {
        pending.resolve(message.data);
      }
      return;
    }

    handleExtensionMessage(message);
  });

  backgroundPort.onDisconnect.addListener(() => {
    backgroundPortReady = false;
    backgroundPort = null;
    rejectPendingPortRequests('Background port disconnected');

    // 关闭浮动窗口（插件重新加载）
    const floatingWindow = document.getElementById('dog-bang-floating');
    if (floatingWindow) {
      console.log('[Dog Bang] 检测到插件重新加载，关闭浮动窗口');
      // 保存关闭状态，避免重新加载后自动恢复
      const state = getFloatingWindowState();
      state.opened = false;
      saveFloatingWindowState(state);
      floatingWindow.remove();
    }

    // 尝试延迟重连
    setTimeout(() => {
      connectBackgroundPort();
    }, 3000);
  });

  backgroundPort.postMessage({ action: 'subscribe_wallet_updates' });
}

/**
 * 处理钱包状态推送
 */
function handleWalletStatusPush(data, options: { fromPending?: boolean } = {}) {
  const { fromPending = false } = options;

  if (!data) {
    logger.warn('[Dog Bang] PUSH: 收到空数据');
    return;
  }

  logger.debug('[Dog Bang] PUSH: 处理钱包状态', data);

  const walletAddressEl = document.getElementById('wallet-address');
  const buyBtn = document.getElementById('btn-buy');
  const sellBtn = document.getElementById('btn-sell');
  const bnbBalanceEl = document.getElementById('bnb-balance');
  const tokenBalanceEl = document.getElementById('token-balance');

  if (!walletAddressEl) {
    if (!fromPending) {
      pendingWalletStatus = data;
      logger.debug('[Dog Bang] PUSH: 面板未就绪，已缓存钱包状态');
    } else {
      logger.warn('[Dog Bang] PUSH: 面板仍未就绪，无法更新钱包状态');
    }
    return;
  }

  if (data.success) {
    // 钱包已解锁
    const address = data?.address;
    const bnbBalance = data?.bnbBalance;
    const tokenBalance = data?.tokenBalance;

    logger.debug('[Dog Bang] PUSH: 钱包已解锁', { address, bnbBalance, tokenBalance });

    setWalletAddressDisplay(address);
    walletStatusClass = 'wallet-unlocked';
    applyWalletStatusClass();
    setTradeButtonsEnabled(true);

    if (bnbBalanceEl) {
      bnbBalanceEl.textContent = bnbBalance || '0.00';
    }

    if (tokenBalance !== undefined && tokenBalanceEl) {
      tokenBalanceEl.textContent = tokenBalance;
    }

    logger.debug('[Dog Bang] PUSH: UI 已更新 (unlocked)');
  } else {
    // 钱包锁定或未设置
    const status = data.status || data.error;

    logger.debug('[Dog Bang] PUSH: 钱包状态', status);

    setTradeButtonsEnabled(false);

    if (status === 'not_setup') {
      setWalletDisplayText('未设置');
      walletStatusClass = 'wallet-not-setup';
      applyWalletStatusClass();
    } else if (status === 'locked' || status === 'not_loaded') {
      const address = data?.address;
      if (address) {
        setWalletDisplayText(`${address.slice(0, 6)}...${address.slice(-4)} 🔒`);
      } else {
        setWalletDisplayText('已锁定 🔒');
      }
      walletStatusClass = 'wallet-locked';
      applyWalletStatusClass();
    }

    logger.debug('[Dog Bang] PUSH: UI 已更新 (locked/not_setup)');
  }
}

/**
 * 处理代币余额推送
 */
function handleTokenBalancePush(data, options: { fromPending?: boolean } = {}) {
  const { fromPending = false } = options;

  if (!data || !data.tokenAddress) return;

  // 只更新当前代币的余额
  if (data.tokenAddress === currentTokenAddress) {
    const tokenBalanceEl = document.getElementById('token-balance');

    if (!tokenBalanceEl) {
      if (!fromPending) {
        pendingTokenBalance = data;
        logger.debug('[Dog Bang] PUSH: 面板未就绪，已缓存代币余额');
      } else {
        logger.warn('[Dog Bang] PUSH: 面板仍未就绪，无法更新代币余额');
      }
      return;
    }

    if (data.balance && currentTokenInfo) {
      currentTokenInfo.balance = data.balance;
    }
    if (tokenBalanceEl && data.balance !== undefined) {
      tokenBalanceEl.textContent = data.balance;
    }
    updateTokenBalanceDisplay(currentTokenAddress);
    logger.debug('[Dog Bang] PUSH: 代币余额已更新');
    scheduleSellEstimate();
  }
}

function flushPendingUiUpdates() {
  if (!panelReady) return;

  if (pendingWalletStatus) {
    const data = pendingWalletStatus;
    pendingWalletStatus = null;
    handleWalletStatusPush(data, { fromPending: true });
  }

  if (pendingTokenBalance) {
    const data = pendingTokenBalance;
    pendingTokenBalance = null;
    handleTokenBalancePush(data, { fromPending: true });
  }
}

const isSidePanelContext = Boolean(window.__DOG_BANG_SIDE_PANEL_MODE__);
const shouldMountEmbeddedPanel = !isSidePanelContext && EMBEDDED_PANEL_ENABLED;

if (!isSidePanelContext) {
  initializeTokenContextSync();
}

// ========== URL 变化监听（仅在嵌入模式启用时需要）==========
if (shouldMountEmbeddedPanel) {
  let lastUrl = location.href;
  new MutationObserver(() => {
    const url = location.href;
    if (url !== lastUrl) {
      lastUrl = url;
      logger.debug('[Dog Bang] URL changed');

      // 移除旧面板
      const oldPanel = document.getElementById('dog-bang-panel');
      if (oldPanel) {
        panelReady = false;
        oldPanel.remove();
      }

      // 重新创建面板
      setTimeout(() => {
        createTradingPanel();
      }, 1000);
    }
  }).observe(document, { subtree: true, childList: true });
}

// 确认 content script 已加载
console.log('[Dog Bang] Content script loaded on:', window.location.href);

registerRuntimeListeners();
connectBackgroundPort();

// 页面加载后自动恢复浮动窗口状态
function restoreFloatingWindow() {
  const state = getFloatingWindowState();
  if (state.opened) {
    const tokenAddress = getTokenAddressFromURL();
    if (tokenAddress) {
      // 延迟创建，确保页面已完全加载
      setTimeout(() => {
        createFloatingTradingWindow(tokenAddress);
        logger.debug('[Floating Window] 自动恢复浮动窗口');
      }, 500);
    }
  }
}

// 页面加载完成后检查是否需要恢复浮动窗口
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', restoreFloatingWindow, { once: true });
} else {
  restoreFloatingWindow();
}

function bootstrapTradingPanel() {
  createTradingPanel();
  startSmartPolling();
  logger.debug('[Dog Bang] 初始化交易页面');
}

if (shouldMountEmbeddedPanel) {
  const startWithSettings = () => tradingSettingsReady.then(() => {
    bootstrapTradingPanel();
  });
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', startWithSettings, { once: true });
  } else {
    startWithSettings();
  }
} else if (!isSidePanelContext) {
  logger.debug('[Dog Bang] 嵌入式交易面板已禁用，仅同步 Side Panel 上下文');
}
