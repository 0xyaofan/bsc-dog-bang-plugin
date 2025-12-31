/// <reference types="chrome" />

import './index.css';
import '../../extension/styles.css';
import {
  DEFAULT_USER_SETTINGS,
  UserSettings,
  loadUserSettings,
  saveUserSettings,
  onUserSettingsChange
} from '../shared/user-settings.js';
import { TX_CONFIG, CUSTOM_AGGREGATOR_CONFIG } from '../shared/trading-config.js';
import { DEFAULT_FOUR_QUOTE_TOKENS, resolveFourQuoteTokenLabel } from '../shared/channel-config.js';

const AUTO_APPROVE_GAS_DISPLAY = (() => {
  const fallback = TX_CONFIG.MIN_GAS_PRICE ?? 0.05;
  const value = Number(TX_CONFIG.APPROVE_GAS_PRICE ?? fallback);
  if (!Number.isFinite(value)) {
    return fallback.toString();
  }
  return value.toString();
})();

declare global {
  interface Window {
    __DOG_BANG_SIDE_PANEL_MODE__?: boolean;
  }
}

type TokenContext = {
  tokenAddress?: string;
  url?: string;
  updatedAt?: number;
  preferredChannelId?: string;
};

const STORAGE_KEY = 'dogBangLastTokenContext';
const EMPTY_HINT = '请先在代币详情页打开一个代币，然后再试一次。';

const BUY_PRESET_COUNT = 4;
const SELL_PRESET_COUNT = 4;
const SLIPPAGE_PRESET_COUNT = 2;
const GAS_PRESET_COUNT = 2;

const CHANNEL_CONFIG_OPTIONS = [
  { id: 'four', label: 'Four.meme', editable: true },
  { id: 'pancake', label: 'PancakeSwap', editable: false },
  { id: 'xmode', label: 'X Mode', editable: false },
  { id: 'flap', label: 'Flap Portal', editable: false }
] as const;

type ChannelConfigOption = typeof CHANNEL_CONFIG_OPTIONS[number];
type ChannelConfigId = ChannelConfigOption['id'];

const CHANNEL_SELECT_OPTIONS_HTML = CHANNEL_CONFIG_OPTIONS.map((option, index) => {
  const suffix = option.editable ? '' : '（敬请期待）';
  const selected = index === 0 ? ' selected' : '';
  return `<option value="${option.id}"${selected}>${option.label}${suffix}</option>`;
}).join('');

window.__DOG_BANG_SIDE_PANEL_MODE__ = true;

type TradingModule = typeof import('../content/index.js');
const tradingModulePromise = import('../content/index.js');
let tradingModule: TradingModule | null = null;

async function ensureTradingModule(): Promise<TradingModule> {
  if (tradingModule) {
    return tradingModule;
  }
  tradingModule = await tradingModulePromise;
  return tradingModule;
}

async function getActiveTabUrl(): Promise<string | null> {
  if (!chrome?.tabs?.query) {
    return null;
  }
  return new Promise((resolve) => {
    try {
      chrome.tabs.query({ active: true, lastFocusedWindow: true }, (tabs) => {
        const tab = tabs && tabs[0];
        resolve(typeof tab?.url === 'string' ? tab.url : null);
      });
    } catch (error) {
      console.error('[Dog Bang Side Panel] 无法读取活动标签页 URL:', error);
      resolve(null);
    }
  });
}

async function refreshActiveSourceUrl() {
  try {
    const pageUrl = await getActiveTabUrl();
    const module = await ensureTradingModule();
    module.updateTradingPanelSourceUrl(pageUrl ?? null);
  } catch (error) {
    console.error('[Dog Bang Side Panel] 同步活动标签页 URL 失败:', error);
  }
}

let activeTabWatcherInitialized = false;

function setupActiveTabWatcher() {
  if (activeTabWatcherInitialized || !chrome?.tabs?.onActivated || !chrome?.tabs?.onUpdated) {
    return;
  }
  activeTabWatcherInitialized = true;

  const handleChange = () => {
    refreshActiveSourceUrl();
  };

  chrome.tabs.onActivated.addListener(handleChange);
  chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
    if (tab?.active && (changeInfo.status === 'complete' || typeof changeInfo.url === 'string')) {
      handleChange();
    }
  });

  handleChange();
}

const root = document.getElementById('sidepanel-root');
if (!root) {
  throw new Error('[Dog Bang Side Panel] 未找到 sidepanel-root 容器');
}

const shell = document.createElement('div');
shell.className = 'sidepanel-shell';

const tabs = document.createElement('div');
tabs.className = 'sidepanel-tabs';

const tradeTab = document.createElement('button');
tradeTab.type = 'button';
tradeTab.className = 'tab-button active';
tradeTab.dataset.tab = 'trade';
tradeTab.textContent = '交易';

const configTab = document.createElement('button');
configTab.type = 'button';
configTab.className = 'tab-button';
configTab.dataset.tab = 'config';
configTab.textContent = '配置';

tabs.append(tradeTab, configTab);

const panes = document.createElement('div');
panes.className = 'sidepanel-panes';

const tradePane = document.createElement('div');
tradePane.className = 'tab-pane active';

const tradeContainer = document.createElement('div');
tradeContainer.id = 'dog-bang-sidepanel-container';
tradePane.appendChild(tradeContainer);

const configPane = document.createElement('div');
configPane.className = 'tab-pane';

const configContent = document.createElement('div');
configContent.id = 'dog-bang-config-container';
configPane.appendChild(configContent);

panes.append(tradePane, configPane);

const infoBar = document.createElement('div');
infoBar.id = 'dog-bang-sidepanel-infobar';
infoBar.className = 'sidepanel-hint';

shell.append(tabs, panes, infoBar);
root.appendChild(shell);

setupActiveTabWatcher();

const configShell = document.createElement('div');
configShell.className = 'settings-shell';

const configSubTabs = document.createElement('div');
configSubTabs.className = 'config-subtabs';

const tradeConfigTab = document.createElement('button');
tradeConfigTab.type = 'button';
tradeConfigTab.className = 'config-subtab active';
tradeConfigTab.dataset.section = 'trade';
tradeConfigTab.textContent = '交易';

const channelConfigTab = document.createElement('button');
channelConfigTab.type = 'button';
channelConfigTab.className = 'config-subtab';
channelConfigTab.dataset.section = 'channel';
channelConfigTab.textContent = '通道';

const aggregatorConfigTab = document.createElement('button');
aggregatorConfigTab.type = 'button';
aggregatorConfigTab.className = 'config-subtab';
aggregatorConfigTab.dataset.section = 'aggregator';
aggregatorConfigTab.textContent = '合约';

const systemConfigTab = document.createElement('button');
systemConfigTab.type = 'button';
systemConfigTab.className = 'config-subtab';
systemConfigTab.dataset.section = 'system';
systemConfigTab.textContent = '系统';

configSubTabs.append(tradeConfigTab, channelConfigTab, aggregatorConfigTab, systemConfigTab);

const configSubPanes = document.createElement('div');
configSubPanes.className = 'config-subpanes';

const tradeConfigPane = document.createElement('div');
tradeConfigPane.className = 'config-subpane active';
tradeConfigPane.dataset.section = 'trade';

const tradeForm = document.createElement('form');
tradeForm.className = 'config-sub-form';
tradeForm.innerHTML = `
  <section class="config-section">
    <div class="config-field">
      <label class="config-label">
        自动授权
        <span class="config-hint">(Gas Price ≈ ${AUTO_APPROVE_GAS_DISPLAY} Gwei)</span>
      </label>
      <div class="config-option-group">
        <label class="config-toggle radio">
          <input type="radio" name="autoApproveMode" value="buy" checked />
          <span>买入时自动授权</span>
        </label>
        <label class="config-toggle radio">
          <input type="radio" name="autoApproveMode" value="sell" />
          <span>首次卖出时自动授权</span>
        </label>
      </div>
    </div>

    <div class="config-field preset-field">
      <label>买入固定值 (BNB)</label>
      <div class="config-multi fixed-presets">
        ${Array.from({ length: BUY_PRESET_COUNT }).map((_, index) =>
          `<input type="number" step="0.001" min="0" class="config-input" name="buyPreset${index}" />`
        ).join('')}
      </div>
      <div class="config-default-inline">
        <span>输入框默认值</span>
        <input type="number" step="0.001" min="0" class="config-input" name="defaultBuyValue" />
      </div>
    </div>

    <div class="config-field preset-field">
      <label>卖出固定值 (%)</label>
      <div class="config-multi fixed-presets">
        ${Array.from({ length: SELL_PRESET_COUNT }).map((_, index) =>
          `<input type="number" step="1" min="1" max="100" class="config-input" name="sellPreset${index}" />`
        ).join('')}
      </div>
      <div class="config-default-inline">
        <span>输入框默认值 (%)</span>
        <input type="number" step="1" min="1" max="100" class="config-input" name="defaultSellValue" />
      </div>
    </div>

    <div class="config-field">
      <label>滑点 (%)</label>
      <div class="config-multi">
        ${Array.from({ length: SLIPPAGE_PRESET_COUNT }).map((_, index) =>
          `<input type="number" step="0.1" min="0.1" max="90" class="config-input" name="slippagePreset${index}" />`
        ).join('')}
      </div>
    </div>

    <div class="config-field">
      <label>Buy Gas 固定值 (Gwei)</label>
      <div class="config-multi fixed-presets">
        ${Array.from({ length: GAS_PRESET_COUNT }).map((_, index) =>
          `<input type="number" step="0.01" min="0.01" class="config-input" name="buyGasPreset${index}" />`
        ).join('')}
      </div>
    </div>

    <div class="config-field">
      <label>Sell Gas 固定值 (Gwei)</label>
      <div class="config-multi fixed-presets">
        ${Array.from({ length: GAS_PRESET_COUNT }).map((_, index) =>
          `<input type="number" step="0.01" min="0.01" class="config-input" name="sellGasPreset${index}" />`
        ).join('')}
      </div>
    </div>

    <div class="config-field">
      <label>滑点 / Gas 默认值</label>
      <div class="config-defaults">
        <div>
          <span>滑点 (%)</span>
          <input type="number" step="0.1" min="0.1" max="90" class="config-input" name="defaultSlippageValue" />
        </div>
        <div>
          <span>买入 Gas (Gwei)</span>
          <input type="number" step="0.01" min="0.01" class="config-input" name="defaultBuyGasValue" />
        </div>
        <div>
          <span>卖出 Gas (Gwei)</span>
          <input type="number" step="0.01" min="0.01" class="config-input" name="defaultSellGasValue" />
        </div>
      </div>
    </div>
  </section>
  <div class="config-actions">
    <button type="submit" class="config-action-button primary">保存</button>
    <button type="button" class="config-action-button secondary trade-reset">重置</button>
  </div>
`;
const tradeStatus = document.createElement('div');
tradeStatus.className = 'config-status';
tradeConfigPane.append(tradeForm, tradeStatus);

const channelConfigPane = document.createElement('div');
channelConfigPane.className = 'config-subpane';
channelConfigPane.dataset.section = 'channel';

const channelForm = document.createElement('form');
channelForm.className = 'config-sub-form';
channelForm.innerHTML = `
  <div class="channel-switch">
    <label class="channel-switch-select">
      <span>选择通道</span>
      <select id="channelConfigSelect">
        ${CHANNEL_SELECT_OPTIONS_HTML}
      </select>
    </label>
  </div>
  <p class="channel-switch-hint" id="channelConfigHint"></p>

  <div class="channel-panel channel-panel-four active" data-channel-panel="four">
    <div class="channel-card">
      <div class="channel-card-header">
        <div class="channel-title-row">
          <div class="channel-title">募集币种</div>
          <span class="channel-tag">Four.meme</span>
        </div>
        <p class="channel-subtitle">用于交易的募集币种列表，新增后会自动识别和应用。</p>
      </div>
      <div class="channel-token-list" id="fourQuoteTokenList"></div>
      <div class="channel-token-actions">
        <input type="text" class="config-input" name="fourQuoteTokenInput" placeholder="0x..." />
        <button type="button" class="config-action-button tertiary four-quote-add">添加募集币种</button>
      </div>
    </div>
  </div>
  <div class="config-actions">
    <button type="submit" class="config-action-button primary">保存</button>
    <button type="button" class="config-action-button secondary channel-reset">重置</button>
  </div>
`;
const channelStatus = document.createElement('div');
channelStatus.className = 'config-status';
channelConfigPane.append(channelForm, channelStatus);

const aggregatorConfigPane = document.createElement('div');
aggregatorConfigPane.className = 'config-subpane';
aggregatorConfigPane.dataset.section = 'aggregator';

const aggregatorForm = document.createElement('form');
aggregatorForm.className = 'config-sub-form';
const defaultAggregatorAddress = CUSTOM_AGGREGATOR_CONFIG.DEFAULT_ADDRESS;
const defaultAggregatorLink = `https://bscscan.com/address/${defaultAggregatorAddress}`;
aggregatorForm.innerHTML = `
  <section class="config-section">
    <div class="config-field">
      <label class="config-label">启用自定义合约</label>
      <label class="config-toggle">
        <input type="checkbox" name="aggregatorEnabled" />
        <span>使用合约处理非 BNB 募集币种</span>
      </label>
    </div>

    <div class="config-field">
      <label class="config-label">执行方式</label>
      <div class="config-option-group">
        <label class="config-toggle radio">
          <input type="radio" name="aggregatorMode" value="contract" checked />
          <span>合约执行</span>
        </label>
        <label class="config-toggle radio">
          <input type="radio" name="aggregatorMode" value="legacy" />
          <span>代码执行</span>
        </label>
      </div>
      <p class="config-hint">切换为代码执行后，将回退至原有流程。</p>
    </div>

    <div class="config-field">
      <label class="config-label">合约地址</label>
      <input type="text" class="config-input" name="aggregatorAddress" placeholder="0x..." />
      <p class="config-hint">
        默认值:
        <a href="${defaultAggregatorLink}" class="config-link" target="_blank" rel="noopener noreferrer">
          ${defaultAggregatorAddress}
        </a>
      </p>
    </div>
  </section>
  <div class="config-actions">
    <button type="submit" class="config-action-button primary">保存</button>
    <button type="button" class="config-action-button secondary aggregator-reset">重置</button>
  </div>
`;
const aggregatorStatus = document.createElement('div');
aggregatorStatus.className = 'config-status';
aggregatorConfigPane.append(aggregatorForm, aggregatorStatus);

const systemConfigPane = document.createElement('div');
systemConfigPane.className = 'config-subpane';
systemConfigPane.dataset.section = 'system';

const systemForm = document.createElement('form');
systemForm.className = 'config-sub-form';
systemForm.innerHTML = `
  <section class="config-section">
    <div class="config-field">
      <label class="config-label">主节点</label>
      <input type="text" name="primaryRpc" class="config-input" placeholder="https://..." />
    </div>

    <div class="config-field">
      <label class="config-label">备用节点 (每行一个)</label>
      <textarea name="fallbackRpcs" class="config-textarea" rows="3" placeholder="https://node-1.example.com"></textarea>
    </div>

    <div class="config-field">
      <label class="config-label">日志模式</label>
      <select name="logMode" class="config-input">
        <option value="quiet">基础模式</option>
        <option value="verbose">调试模式</option>
      </select>
      <label class="config-toggle">
        <input type="checkbox" name="perfLogs" />
        <span>启用性能日志</span>
      </label>
    </div>

    <div class="config-field">
      <label class="config-label">消息确认查询间隔 (毫秒)</label>
      <input type="number" name="pollingInterval" class="config-input" min="200" step="100" placeholder="1000" />
    </div>
  </section>
  <div class="config-actions">
    <button type="submit" class="config-action-button primary">保存</button>
    <button type="button" class="config-action-button secondary system-reset">重置</button>
  </div>
`;
const systemStatus = document.createElement('div');
systemStatus.className = 'config-status';
systemConfigPane.append(systemForm, systemStatus);

configSubPanes.append(tradeConfigPane, channelConfigPane, aggregatorConfigPane, systemConfigPane);
configShell.append(configSubTabs, configSubPanes);
configContent.append(configShell);

const configSubTabButtons: Record<'trade' | 'channel' | 'aggregator' | 'system', HTMLButtonElement> = {
  trade: tradeConfigTab,
  channel: channelConfigTab,
  aggregator: aggregatorConfigTab,
  system: systemConfigTab
};
const configSubPaneMap: Record<'trade' | 'channel' | 'aggregator' | 'system', HTMLElement> = {
  trade: tradeConfigPane,
  channel: channelConfigPane,
  aggregator: aggregatorConfigPane,
  system: systemConfigPane
};

let activeConfigSection: 'trade' | 'channel' | 'aggregator' | 'system' = 'trade';

function setActiveConfigSection(section: 'trade' | 'channel' | 'aggregator' | 'system') {
  if (activeConfigSection === section) {
    return;
  }
  activeConfigSection = section;
  (Object.keys(configSubPaneMap) as Array<'trade' | 'channel' | 'aggregator' | 'system'>).forEach((key) => {
    configSubPaneMap[key].classList.toggle('active', key === section);
    configSubTabButtons[key].classList.toggle('active', key === section);
  });
}

tradeConfigTab.addEventListener('click', () => setActiveConfigSection('trade'));
channelConfigTab.addEventListener('click', () => setActiveConfigSection('channel'));
aggregatorConfigTab.addEventListener('click', () => setActiveConfigSection('aggregator'));
systemConfigTab.addEventListener('click', () => setActiveConfigSection('system'));

const perfToggle = systemForm.querySelector<HTMLInputElement>('input[name="perfLogs"]');
const logModeSelect = systemForm.querySelector<HTMLSelectElement>('select[name="logMode"]');
const tradeResetButton = tradeForm.querySelector<HTMLButtonElement>('.trade-reset');
const channelResetButton = channelForm.querySelector<HTMLButtonElement>('.channel-reset');
const aggregatorResetButton = aggregatorForm.querySelector<HTMLButtonElement>('.aggregator-reset');
const systemResetButton = systemForm.querySelector<HTMLButtonElement>('.system-reset');
const channelSwitchSelect = channelForm.querySelector<HTMLSelectElement>('#channelConfigSelect');
const channelPanelFour = channelForm.querySelector<HTMLElement>('[data-channel-panel="four"]');
const channelConfigHint = channelForm.querySelector<HTMLElement>('#channelConfigHint');
const fourQuoteTokenListEl = channelForm.querySelector<HTMLDivElement>('#fourQuoteTokenList');
const fourQuoteTokenInput = channelForm.querySelector<HTMLInputElement>('input[name="fourQuoteTokenInput"]');
const fourQuoteTokenAddButton = channelForm.querySelector<HTMLButtonElement>('.four-quote-add');
const ADDRESS_INPUT_REGEX = /^0x[a-fA-F0-9]{40}$/;
const builtinFourQuoteTokenSet = new Set(
  DEFAULT_FOUR_QUOTE_TOKENS.map((token) => token.toLowerCase())
);
let fourQuoteTokenState: string[] = DEFAULT_FOUR_QUOTE_TOKENS.slice();
let fourCustomTokenState: string[] = [];
let activeChannelConfigId: ChannelConfigId = CHANNEL_CONFIG_OPTIONS[0].id;

function formatQuoteTokenAddress(value?: string | null) {
  if (!value) {
    return null;
  }
  const trimmed = value.trim();
  if (!ADDRESS_INPUT_REGEX.test(trimmed)) {
    return null;
  }
  return `0x${trimmed.slice(2).toLowerCase()}`;
}

function isBuiltinQuoteToken(address: string) {
  return builtinFourQuoteTokenSet.has(address.toLowerCase());
}

function dedupeTokenList(tokens: string[]): string[] {
  const seen = new Set<string>();
  const normalized: string[] = [];
  tokens.forEach((token) => {
    const formatted = formatQuoteTokenAddress(token);
    if (!formatted) {
      return;
    }
    if (!seen.has(formatted)) {
      seen.add(formatted);
      normalized.push(formatted);
    }
  });
  return normalized;
}

function rebuildFourQuoteTokenState() {
  fourQuoteTokenState = dedupeTokenList([
    ...DEFAULT_FOUR_QUOTE_TOKENS,
    ...fourCustomTokenState
  ]);
  renderFourQuoteTokenList();
}

function setFourCustomTokenState(tokens: string[]) {
  const normalized = dedupeTokenList(tokens).filter((token) => !isBuiltinQuoteToken(token));
  fourCustomTokenState = normalized;
  rebuildFourQuoteTokenState();
}

function deriveCustomTokensFromQuoteList(tokens: string[] = []): string[] {
  return dedupeTokenList(tokens).filter((token) => !isBuiltinQuoteToken(token));
}

function getChannelOption(channelId: string) {
  return CHANNEL_CONFIG_OPTIONS.find((option) => option.id === channelId);
}

function setActiveChannelConfig(channelId: ChannelConfigId) {
  activeChannelConfigId = channelId;
  const isFour = channelId === 'four';
  channelPanelFour?.classList.toggle('active', isFour);
  if (channelSwitchSelect && channelSwitchSelect.value !== channelId) {
    channelSwitchSelect.value = channelId;
  }
  if (channelConfigHint) {
    if (isFour) {
      channelConfigHint.textContent = '';
    } else {
      const option = getChannelOption(channelId);
      channelConfigHint.textContent = option
        ? `${option.label} 通道暂未开放配置`
        : '当前通道暂未开放配置';
    }
  }
}

function renderFourQuoteTokenList() {
  if (!fourQuoteTokenListEl) return;
  fourQuoteTokenListEl.innerHTML = '';
  fourQuoteTokenState.forEach((address) => {
    const item = document.createElement('div');
    item.className = 'channel-token-item';
    item.dataset.address = address;

    const label = document.createElement('span');
    label.className = 'token-label';
    label.textContent = resolveFourQuoteTokenLabel(address);

    const shortLabel = `${address.slice(0, 6)}...${address.slice(-4)}`;
    const copyButton = document.createElement('button');
    copyButton.type = 'button';
    copyButton.className = 'token-copy';
    copyButton.dataset.address = address;
    copyButton.dataset.label = shortLabel;
    copyButton.textContent = shortLabel;
    copyButton.title = '点击复制地址';

    item.append(label, copyButton);

    if (!isBuiltinQuoteToken(address)) {
      const removeButton = document.createElement('button');
      removeButton.type = 'button';
      removeButton.className = 'token-remove';
      removeButton.dataset.address = address;
      removeButton.textContent = '移除';
      removeButton.title = '移除该募集币种';
      item.append(removeButton);
    }

    fourQuoteTokenListEl.appendChild(item);
  });
}

function handleAddFourQuoteToken() {
  if (!fourQuoteTokenInput) return;
  const value = fourQuoteTokenInput.value;
  const formatted = formatQuoteTokenAddress(value);
  if (!formatted) {
    showConfigStatus(channelStatus, '请输入有效的 0x 开头募集币种地址', 'error');
    return;
  }
  if (isBuiltinQuoteToken(formatted)) {
    showConfigStatus(channelStatus, '该募集币种已内置，无需添加', 'error');
    return;
  }
  if (fourCustomTokenState.includes(formatted)) {
    showConfigStatus(channelStatus, '该募集币种已在列表中', 'error');
    return;
  }
  fourCustomTokenState = [...fourCustomTokenState, formatted];
  rebuildFourQuoteTokenState();
  fourQuoteTokenInput.value = '';
  showConfigStatus(channelStatus, '已添加募集币种，记得保存配置', 'success');
}

rebuildFourQuoteTokenState();

function removeCustomQuoteToken(address: string) {
  if (isBuiltinQuoteToken(address)) {
    showConfigStatus(channelStatus, '该募集币种为系统默认，无法移除', 'error');
    return;
  }
  const next = fourCustomTokenState.filter((token) => token !== address);
  if (next.length === fourCustomTokenState.length) {
    return;
  }
  fourCustomTokenState = next;
  rebuildFourQuoteTokenState();
  showConfigStatus(channelStatus, '已移除募集币种，记得保存配置', 'success');
}

async function copyQuoteTokenAddress(address: string, trigger?: HTMLButtonElement) {
  try {
    if (navigator?.clipboard?.writeText) {
      await navigator.clipboard.writeText(address);
    } else {
      const textarea = document.createElement('textarea');
      textarea.value = address;
      textarea.style.position = 'fixed';
      textarea.style.opacity = '0';
      document.body.appendChild(textarea);
      textarea.focus();
      textarea.select();
      document.execCommand('copy');
      document.body.removeChild(textarea);
    }
    if (trigger) {
      const originalLabel = trigger.dataset.label || trigger.textContent || '';
      trigger.textContent = '已复制';
      trigger.classList.add('copied');
      setTimeout(() => {
        trigger.textContent = originalLabel;
        trigger.classList.remove('copied');
      }, 1500);
    }
    showConfigStatus(channelStatus, `已复制 ${address.slice(0, 6)}...${address.slice(-4)}`, 'success');
  } catch (error) {
    showConfigStatus(channelStatus, `复制失败: ${(error as Error).message}`, 'error');
  }
}

fourQuoteTokenAddButton?.addEventListener('click', (event) => {
  event.preventDefault();
  handleAddFourQuoteToken();
});

fourQuoteTokenInput?.addEventListener('keydown', (event) => {
  if (event.key === 'Enter') {
    event.preventDefault();
    handleAddFourQuoteToken();
  }
});

channelSwitchSelect?.addEventListener('change', (event) => {
  const channelId = (event.target as HTMLSelectElement).value as ChannelConfigId;
  if (!channelId || channelId === activeChannelConfigId) {
    return;
  }
  setActiveChannelConfig(channelId);
});

fourQuoteTokenListEl?.addEventListener('click', (event) => {
  const target = event.target as HTMLElement;
  const removeButton = target.closest<HTMLButtonElement>('.token-remove');
  if (removeButton?.dataset.address) {
    event.preventDefault();
    removeCustomQuoteToken(removeButton.dataset.address);
    return;
  }
  const copyButton = target.closest<HTMLButtonElement>('.token-copy');
  if (copyButton?.dataset.address) {
    event.preventDefault();
    copyQuoteTokenAddress(copyButton.dataset.address, copyButton);
  }
});

setActiveChannelConfig(activeChannelConfigId);

function syncPerfToggleState() {
  if (!perfToggle || !logModeSelect) return;
  const verbose = logModeSelect.value === 'verbose';
  perfToggle.disabled = !verbose;
  if (!verbose) {
    perfToggle.checked = false;
  }
}

let userSettings: UserSettings = DEFAULT_USER_SETTINGS;
let currentToken: string | null = null;
let lastTokenContext: TokenContext | null = null;
let pollingStarted = false;
let panelInitialized = false;
let activeTab: 'trade' | 'config' = 'trade';

function setActiveTab(tab: 'trade' | 'config') {
  activeTab = tab;
  tradeTab.classList.toggle('active', tab === 'trade');
  configTab.classList.toggle('active', tab === 'config');
  tradePane.classList.toggle('active', tab === 'trade');
  configPane.classList.toggle('active', tab === 'config');
}

function showPlaceholder(message: string) {
  tradeContainer.innerHTML = `<div class="sidepanel-placeholder">${message}</div>`;
  infoBar.textContent = '';
  panelInitialized = false;
}

function updateInfoBar(url?: string) {
  if (!url) {
    infoBar.textContent = '';
    return;
  }
  infoBar.textContent = `来源页面: ${url}`;
}

async function mountTradingPanel(tokenAddress: string, context?: TokenContext) {
  const module = await ensureTradingModule();
  await module.tradingSettingsReady;
  const activePageUrl = await getActiveTabUrl();
  const switchOptions = {
    defaultChannelId: context?.preferredChannelId,
    disableAutoChannelSelection: Boolean(context?.preferredChannelId),
    sourceUrl: activePageUrl ?? context?.url ?? null
  };

  if (!panelInitialized) {
    tradeContainer.innerHTML = '';
    module.createTradingPanel({
      tokenAddressOverride: tokenAddress,
      mountPoint: tradeContainer,
      ...switchOptions
    });
    panelInitialized = true;
  } else {
    module.switchTradingPanelToken(tokenAddress, switchOptions);
  }

  if (!pollingStarted) {
    module.startSmartPolling();
    pollingStarted = true;
  }
  currentToken = tokenAddress;
  updateInfoBar(context?.url);
}

function handleTokenContext(context?: TokenContext | null, force = false) {
  const tokenAddress = context?.tokenAddress;

  if (!tokenAddress) {
    currentToken = null;
    lastTokenContext = null;
    showPlaceholder(EMPTY_HINT);
    return;
  }

  lastTokenContext = context ?? {
    tokenAddress,
    url: context?.url,
    updatedAt: Date.now(),
    preferredChannelId: context?.preferredChannelId
  };

  if (!force && tokenAddress === currentToken) {
    refreshActiveSourceUrl();
    updateInfoBar(context?.url);
    return;
  }

  mountTradingPanel(tokenAddress, context).catch((error) => {
    console.error('[Dog Bang Side Panel] 初始化交易面板失败:', error);
    showPlaceholder('加载交易面板失败，请重新打开 Side Panel。');
  });
}

function getLastTokenContext(): Promise<TokenContext | null> {
  return new Promise((resolve, reject) => {
    if (!chrome?.storage?.local) {
      resolve(null);
      return;
    }

    try {
      chrome.storage.local.get([STORAGE_KEY], (result) => {
        if (chrome.runtime?.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
          return;
        }
        resolve(result?.[STORAGE_KEY] ?? null);
      });
    } catch (error) {
      reject(error);
    }
  });
}

function populateTradeForm(settings: UserSettings) {
  const autoApproveRadios = Array.from(
    tradeForm.querySelectorAll<HTMLInputElement>('input[name="autoApproveMode"]')
  );
  const selectedMode = settings.trading.autoApproveMode || 'buy';
  autoApproveRadios.forEach((radio) => {
    radio.checked = radio.value === selectedMode;
  });

  const fillGroup = (prefix: string, values: string[], count: number) => {
    for (let i = 0; i < count; i += 1) {
      const input = tradeForm.querySelector<HTMLInputElement>(`[name="${prefix}${i}"]`);
      if (input) {
        input.value = values[i] ?? '';
      }
    }
  };

  fillGroup('buyPreset', settings.trading.buyPresets, BUY_PRESET_COUNT);
  fillGroup('sellPreset', settings.trading.sellPresets, SELL_PRESET_COUNT);
  fillGroup('slippagePreset', settings.trading.slippagePresets, SLIPPAGE_PRESET_COUNT);
  fillGroup('buyGasPreset', settings.trading.buyGasPresets, GAS_PRESET_COUNT);
  fillGroup('sellGasPreset', settings.trading.sellGasPresets, GAS_PRESET_COUNT);

  const setInputValue = (name: string, value: string) => {
    const input = tradeForm.querySelector<HTMLInputElement>(`[name="${name}"]`);
    if (input) {
      input.value = value ?? '';
    }
  };

  setInputValue('defaultBuyValue', settings.trading.defaultBuyValue);
  setInputValue('defaultSellValue', settings.trading.defaultSellValue);
  setInputValue('defaultSlippageValue', settings.trading.defaultSlippageValue);
  setInputValue('defaultBuyGasValue', settings.trading.defaultBuyGasValue);
  setInputValue('defaultSellGasValue', settings.trading.defaultSellGasValue);
}

function populateChannelForm(settings: UserSettings) {
  const quoteTokens = settings.channels?.four?.quoteTokens ?? DEFAULT_FOUR_QUOTE_TOKENS;
  const customTokens = settings.channels?.four?.customQuoteTokens ?? [];
  const initialCustomTokens = customTokens.length
    ? customTokens
    : deriveCustomTokensFromQuoteList(quoteTokens);
  setFourCustomTokenState(initialCustomTokens);
  if (fourQuoteTokenInput) {
    fourQuoteTokenInput.value = '';
  }
}

function populateAggregatorForm(settings: UserSettings) {
  const enabledInput = aggregatorForm.querySelector<HTMLInputElement>('input[name="aggregatorEnabled"]');
  if (enabledInput) {
    enabledInput.checked = Boolean(settings.aggregator?.enabled);
  }
  const modeRadios = Array.from(
    aggregatorForm.querySelectorAll<HTMLInputElement>('input[name="aggregatorMode"]')
  );
  const mode = settings.aggregator?.executionMode || 'contract';
  modeRadios.forEach((radio) => {
    radio.checked = radio.value === mode;
  });
  const addressInput = aggregatorForm.querySelector<HTMLInputElement>('input[name="aggregatorAddress"]');
  if (addressInput) {
    addressInput.value = settings.aggregator?.contractAddress || '';
  }
}

function populateSystemForm(settings: UserSettings) {
  const primary = systemForm.querySelector<HTMLInputElement>('input[name="primaryRpc"]');
  const fallback = systemForm.querySelector<HTMLTextAreaElement>('textarea[name="fallbackRpcs"]');
  const logMode = systemForm.querySelector<HTMLSelectElement>('select[name="logMode"]');
  const perfInput = systemForm.querySelector<HTMLInputElement>('input[name="perfLogs"]');
  const polling = systemForm.querySelector<HTMLInputElement>('input[name="pollingInterval"]');

  if (primary) {
    primary.value = settings.system.primaryRpc || '';
  }
  if (fallback) {
    fallback.value = settings.system.fallbackRpcs.join('\n');
  }
  if (logMode) {
    logMode.value = settings.system.logMode;
  }
  if (perfInput) {
    perfInput.checked = Boolean(settings.system.enablePerformanceLogs);
  }
  if (polling) {
    polling.value = String(settings.system.pollingIntervalMs ?? '');
  }
  syncPerfToggleState();
}

function populateAllConfigForms(settings: UserSettings) {
  populateTradeForm(settings);
  populateChannelForm(settings);
  populateAggregatorForm(settings);
  populateSystemForm(settings);
}

function parseListInput(value: string | FormDataEntryValue | null) {
  if (!value) return [];
  return value.toString()
    .split(/[\n,]+/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function collectPresetValues(form: HTMLFormElement, prefix: string, count: number) {
  const values: string[] = [];
  for (let i = 0; i < count; i += 1) {
    const input = form.querySelector<HTMLInputElement>(`[name="${prefix}${i}"]`);
    const val = input?.value?.trim();
    if (val) {
      values.push(val);
    }
  }
  return values;
}

function showConfigStatus(target: HTMLElement | null, message: string, type: 'success' | 'error' = 'success') {
  if (!target) return;
  target.textContent = message;
  target.classList.remove('success', 'error');
  target.classList.add(type);
  if (message) {
    setTimeout(() => {
      target.textContent = '';
      target.classList.remove('success', 'error');
    }, type === 'success' ? 2000 : 4000);
  }
}

function refreshTradingPanel() {
  if (lastTokenContext?.tokenAddress) {
    panelInitialized = false;
    currentToken = null;
    handleTokenContext(lastTokenContext, true);
  }
}

async function savePartialSettings(patch: Partial<UserSettings>) {
  const next: UserSettings = {
    ...userSettings,
    ...patch,
    system: {
      ...userSettings.system,
      ...(patch.system ?? {})
    },
    trading: {
      ...userSettings.trading,
      ...(patch.trading ?? {})
    },
    channels: {
      ...userSettings.channels,
      ...(patch.channels ?? {}),
      four: {
        ...userSettings.channels.four,
        ...(patch.channels?.four ?? {})
      }
    },
    aggregator: {
      ...userSettings.aggregator,
      ...(patch.aggregator ?? {})
    }
  };
  userSettings = await saveUserSettings(next);
  return userSettings;
}

tradeResetButton?.addEventListener('click', (event) => {
  event.preventDefault();
  populateTradeForm({ ...userSettings, trading: DEFAULT_USER_SETTINGS.trading } as UserSettings);
  showConfigStatus(tradeStatus, '已恢复默认配置，请点击保存后生效', 'success');
});

channelResetButton?.addEventListener('click', (event) => {
  event.preventDefault();
  setFourCustomTokenState([]);
  if (fourQuoteTokenInput) {
    fourQuoteTokenInput.value = '';
  }
  showConfigStatus(channelStatus, '已恢复默认配置，请点击保存后生效', 'success');
});

aggregatorResetButton?.addEventListener('click', (event) => {
  event.preventDefault();
  populateAggregatorForm({ ...userSettings, aggregator: DEFAULT_USER_SETTINGS.aggregator } as UserSettings);
  showConfigStatus(aggregatorStatus, '已恢复默认配置，请点击保存后生效', 'success');
});

systemResetButton?.addEventListener('click', (event) => {
  event.preventDefault();
  populateSystemForm({ ...userSettings, system: DEFAULT_USER_SETTINGS.system } as UserSettings);
  showConfigStatus(systemStatus, '已恢复默认配置，请点击保存后生效', 'success');
});

tradeForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  const formData = new FormData(tradeForm);
  const autoApproveMode: 'buy' | 'sell' = (formData.get('autoApproveMode') as string) === 'sell' ? 'sell' : 'buy';
  const updatedTrading = {
    buyPresets: collectPresetValues(tradeForm, 'buyPreset', BUY_PRESET_COUNT),
    sellPresets: collectPresetValues(tradeForm, 'sellPreset', SELL_PRESET_COUNT),
    slippagePresets: collectPresetValues(tradeForm, 'slippagePreset', SLIPPAGE_PRESET_COUNT),
    buyGasPresets: collectPresetValues(tradeForm, 'buyGasPreset', GAS_PRESET_COUNT),
    sellGasPresets: collectPresetValues(tradeForm, 'sellGasPreset', GAS_PRESET_COUNT),
    defaultBuyValue: (formData.get('defaultBuyValue') as string || '').trim(),
    defaultSellValue: (formData.get('defaultSellValue') as string || '').trim(),
    defaultSlippageValue: (formData.get('defaultSlippageValue') as string || '').trim(),
    defaultBuyGasValue: (formData.get('defaultBuyGasValue') as string || '').trim(),
    defaultSellGasValue: (formData.get('defaultSellGasValue') as string || '').trim(),
    autoApproveMode
  };

  try {
    await savePartialSettings({ trading: updatedTrading });
    populateTradeForm(userSettings);
    showConfigStatus(tradeStatus, '设置已保存', 'success');
    refreshTradingPanel();
  } catch (error) {
    showConfigStatus(tradeStatus, `保存失败: ${(error as Error).message}`, 'error');
  }
});

channelForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  try {
    await savePartialSettings({
      channels: {
        four: {
          quoteTokens: fourQuoteTokenState.slice(),
          customQuoteTokens: fourCustomTokenState.slice()
        }
      }
    });
    populateChannelForm(userSettings);
    showConfigStatus(channelStatus, '设置已保存', 'success');
    refreshTradingPanel();
  } catch (error) {
    showConfigStatus(channelStatus, `保存失败: ${(error as Error).message}`, 'error');
  }
});

aggregatorForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  const formData = new FormData(aggregatorForm);
  const enabled = formData.get('aggregatorEnabled') === 'on';
  const executionMode = (formData.get('aggregatorMode') as string) === 'legacy' ? 'legacy' : 'contract';
  let address = (formData.get('aggregatorAddress') as string || '').trim();
  if (address && !ADDRESS_INPUT_REGEX.test(address)) {
    showConfigStatus(aggregatorStatus, '请输入有效的 0x 开头合约地址', 'error');
    return;
  }
  if (!address) {
    address = CUSTOM_AGGREGATOR_CONFIG.DEFAULT_ADDRESS;
  }
  try {
    await savePartialSettings({
      aggregator: {
        enabled,
        executionMode,
        contractAddress: address
      }
    });
    populateAggregatorForm(userSettings);
    showConfigStatus(aggregatorStatus, '设置已保存', 'success');
    refreshTradingPanel();
  } catch (error) {
    showConfigStatus(aggregatorStatus, `保存失败: ${(error as Error).message}`, 'error');
  }
});

systemForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  const formData = new FormData(systemForm);
  const logMode = (formData.get('logMode') as UserSettings['system']['logMode']) || 'quiet';
  const perfEnabled = logMode === 'verbose' && formData.get('perfLogs') === 'on';
  let pollingInterval = Number(formData.get('pollingInterval'));
  if (!Number.isFinite(pollingInterval) || pollingInterval <= 0) {
    pollingInterval = userSettings.system.pollingIntervalMs;
  }
  pollingInterval = Math.max(200, Math.round(pollingInterval));

  const updatedSystem = {
    primaryRpc: (formData.get('primaryRpc') as string || '').trim(),
    fallbackRpcs: parseListInput(formData.get('fallbackRpcs')),
    logMode,
    enablePerformanceLogs: perfEnabled,
    pollingIntervalMs: pollingInterval
  };

  try {
    await savePartialSettings({ system: updatedSystem });
    populateSystemForm(userSettings);
    showConfigStatus(systemStatus, '设置已保存', 'success');
    refreshTradingPanel();
  } catch (error) {
    showConfigStatus(systemStatus, `保存失败: ${(error as Error).message}`, 'error');
  }
});

tradeTab.addEventListener('click', () => setActiveTab('trade'));
configTab.addEventListener('click', () => setActiveTab('config'));
logModeSelect?.addEventListener('change', syncPerfToggleState);

getLastTokenContext()
  .then((context) => {
    if (!context) {
      showPlaceholder(EMPTY_HINT);
      return;
    }
    handleTokenContext(context);
  })
  .catch((error) => {
    console.error('[Dog Bang Side Panel] 读取代币上下文失败:', error);
    showPlaceholder('暂时无法获取代币信息，请稍后再试。');
  });

if (chrome?.storage?.onChanged) {
  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName !== 'local' || !(STORAGE_KEY in changes)) {
      return;
    }
    const newContext = changes[STORAGE_KEY]?.newValue as TokenContext | null;
    if (!newContext) {
      handleTokenContext(null, true);
      return;
    }
    if (newContext.tokenAddress && newContext.tokenAddress === currentToken) {
      lastTokenContext = newContext;
      updateInfoBar(newContext.url);
      return;
    }
    handleTokenContext(newContext, true);
  });
}

loadUserSettings()
  .then((settings) => {
    userSettings = settings;
    populateAllConfigForms(settings);
  })
  .catch((error) => {
    console.warn('[Dog Bang Side Panel] 读取设置失败:', error);
  });

onUserSettingsChange((settings) => {
  userSettings = settings;
  populateAllConfigForms(settings);
  if (lastTokenContext?.tokenAddress) {
    panelInitialized = false;
    currentToken = null;
    handleTokenContext(lastTokenContext, true);
  }
});
