import { useState, useEffect, useCallback } from 'react';
import './index.css';

declare const chrome: any;

type MessageType = 'success' | 'error' | 'warning';
type ViewState = 'loading' | 'import' | 'locked' | 'unlocked';

interface StatusMessage {
  text: string;
  type: MessageType;
}

function useTimedMessage(initial: StatusMessage | null = null) {
  const [message, setMessage] = useState<StatusMessage | null>(initial);

  const showMessage = useCallback((text: string, type: MessageType) => {
    setMessage({ text, type });
    setTimeout(() => setMessage(null), 3000);
  }, []);

  return { message, showMessage };
}

const ICON_RESOURCE_PATH = 'icons/48x48.png';
const FALLBACK_ICON_URL = new URL('../../extension/icons/48x48.png', import.meta.url).href;

export default function App() {
  const iconUrl = chrome?.runtime?.getURL?.(ICON_RESOURCE_PATH) ?? FALLBACK_ICON_URL;
  const [view, setView] = useState<ViewState>('loading');
  const [walletAddress, setWalletAddress] = useState('');
  const [bnbBalance, setBnbBalance] = useState('0.00');
  const [privateKey, setPrivateKey] = useState('');
  const [importPassword, setImportPassword] = useState('');
  const [unlockPassword, setUnlockPassword] = useState('');
  const [isImporting, setImporting] = useState(false);
  const [isUnlocking, setUnlocking] = useState(false);
  const [sidePanelSupported, setSidePanelSupported] = useState<boolean>(false);

  const { message: importMessage, showMessage: showImportMessage } = useTimedMessage();
  const { message: unlockMessage, showMessage: showUnlockMessage } = useTimedMessage();
  const { message: warningMessage, showMessage: showWarningMessage } = useTimedMessage();

  const evaluateLocalStatus = useCallback(async (options: { silent?: boolean } = {}) => {
    const { silent = false } = options;
    const result = await chrome.storage.local.get([
      'encryptedKey',
      'walletLocked',
      'address',
      'lastRefreshTime',
      'lastUnlockTime'
    ]);

    if (!result.encryptedKey) {
      setView('import');
      return;
    }

    if (result.walletLocked === true) {
      setView('locked');
      return;
    }

    if (
      result.lastRefreshTime &&
      result.lastUnlockTime &&
      result.lastRefreshTime > result.lastUnlockTime
    ) {
      setView('locked');
      if (!silent) {
        showWarningMessage('插件已刷新，请重新解锁钱包', 'warning');
      }
      return;
    }

    if (result.address) {
      setWalletAddress(`${result.address.slice(0, 6)}...${result.address.slice(-4)}`);
    }

    setView('unlocked');
  }, [showWarningMessage]);

  const checkWalletStatus = useCallback(async () => {
    try {
      const response = await chrome.runtime.sendMessage({ action: 'get_wallet_status' });

      if (response?.success && response.data) {
        const { address, bnbBalance } = response.data;
        if (address) {
          setWalletAddress(`${address.slice(0, 6)}...${address.slice(-4)}`);
        }
        if (bnbBalance) {
          setBnbBalance(bnbBalance);
        }
        setView('unlocked');
        return;
      }

      const status = response?.status || response?.error;
      if (status === 'not_setup') {
        setView('import');
        return;
      }
      if (status === 'locked') {
        setView('locked');
        return;
      }
      if (status === 'not_loaded') {
        setView('locked');
        showWarningMessage('插件已刷新，请重新解锁钱包', 'warning');
        return;
      }
    } catch (error) {
      console.warn('[Popup] 获取钱包状态失败，使用本地缓存:', error);
    }

    await evaluateLocalStatus();
  }, [evaluateLocalStatus, showWarningMessage]);

  useEffect(() => {
    checkWalletStatus();
  }, [checkWalletStatus]);

  useEffect(() => {
    evaluateLocalStatus({ silent: true });
  }, [evaluateLocalStatus]);

  useEffect(() => {
    setSidePanelSupported(Boolean(chrome?.sidePanel?.open));
  }, []);

  const handleImport = async () => {
    if (!privateKey || !importPassword) {
      showImportMessage('请填写所有字段', 'error');
      return;
    }

    if (!privateKey.startsWith('0x') || privateKey.length !== 66) {
      showImportMessage('无效的私钥格式', 'error');
      return;
    }

    setImporting(true);

    try {
      const response = await chrome.runtime.sendMessage({
        action: 'import_wallet',
        data: { privateKey, password: importPassword }
      });

      if (response?.success) {
        showImportMessage('钱包导入成功！', 'success');
        setView('loading');
        await chrome.storage.local.set({ lastUnlockTime: Date.now() });
        setPrivateKey('');
        setImportPassword('');
        await checkWalletStatus();
      } else {
        showImportMessage(`导入失败: ${response?.error ?? '未知错误'}`, 'error');
      }
    } catch (error) {
      showImportMessage(`错误: ${(error as Error).message}`, 'error');
    } finally {
      setImporting(false);
    }
  };

  const handleUnlock = async () => {
    if (!unlockPassword) {
      showUnlockMessage('请输入密码', 'error');
      return;
    }

    setUnlocking(true);

    try {
      const response = await chrome.runtime.sendMessage({
        action: 'unlock_wallet',
        data: { password: unlockPassword }
      });

      if (response?.success) {
        setView('loading');
        await chrome.storage.local.set({ walletLocked: false, lastUnlockTime: Date.now() });
        setUnlockPassword('');
        await checkWalletStatus();
      } else {
        showUnlockMessage(response?.error ?? '解锁失败', 'error');
      }
    } catch (error) {
      showUnlockMessage(`错误: ${(error as Error).message}`, 'error');
    } finally {
      setUnlocking(false);
    }
  };

  const handleLock = async () => {
    await chrome.storage.local.set({ walletLocked: true });
    await chrome.runtime.sendMessage({ action: 'lock_wallet' });
    await checkWalletStatus();
  };

  const handleRemove = async () => {
    if (!confirm('确定要移除钱包吗？请确保已备份私钥！')) {
      return;
    }
    setView('loading');
    try {
      const response = await chrome.runtime.sendMessage({ action: 'remove_wallet' });
      if (response?.success) {
        setWalletAddress('');
        setBnbBalance('0.00');
        setPrivateKey('');
        setImportPassword('');
        setUnlockPassword('');
        showWarningMessage('钱包已移除', 'success');
      } else {
        showWarningMessage(response?.error ?? '移除失败', 'error');
      }
    } catch (error) {
      showWarningMessage(`移除失败: ${(error as Error).message}`, 'error');
    } finally {
      await checkWalletStatus();
    }
  };

  const handleOpenSidePanel = async () => {
    if (!chrome?.sidePanel?.open) {
      showWarningMessage('当前浏览器版本暂不支持 Side Panel', 'warning');
      return;
    }

    try {
      const currentWindow = await chrome.windows.getCurrent();
      const windowId = currentWindow?.id;

      if (!windowId && windowId !== 0) {
        throw new Error('无法获取当前窗口 ID');
      }

      if (chrome.sidePanel.setOptions) {
        await chrome.sidePanel.setOptions({
          path: 'dist/sidepanel.html',
          enabled: true
        });
      }
      await chrome.sidePanel.open({ windowId });
    } catch (error) {
      showWarningMessage(`打开 Side Panel 失败: ${(error as Error).message}`, 'error');
    }
  };

  const renderPanelMessage = (panelMessage: StatusMessage | null) => {
    const activeMessage = warningMessage ?? panelMessage;
    return (
      <div className="panel-footer">
        {activeMessage && (
          <div className={`message ${activeMessage.type}`}>{activeMessage.text}</div>
        )}
      </div>
    );
  };

  return (
    <div className="popup-root">
      <header className="popup-header">
        <img src={iconUrl} alt="BSC MEME Trade" width={28} height={28} />
        <h1>BSC 打狗棒</h1>
      </header>

      {view === 'loading' && (
        <section className="panel">
          <p className="hint">正在加载钱包状态...</p>
          {renderPanelMessage(null)}
        </section>
      )}

      {view === 'import' && (
        <section className="panel">
          <div className="input-group">
            <label>私钥</label>
            <input
              type="password"
              value={privateKey}
              placeholder="输入私钥 (0x...)"
              onChange={(e) => setPrivateKey(e.target.value.trim())}
            />
          </div>

          <div className="input-group">
            <label>密码（用于加密）</label>
            <input
              type="password"
              value={importPassword}
              placeholder="设置密码"
              onChange={(e) => setImportPassword(e.target.value)}
            />
          </div>

          <button className="btn-unlock" onClick={handleImport} disabled={isImporting}>
            {isImporting ? '导入中...' : '导入钱包'}
          </button>

          {renderPanelMessage(importMessage)}
        </section>
      )}

      {view === 'locked' && (
        <section className="panel">
          <p className="hint">钱包已锁定，请输入密码解锁</p>

          {!isUnlocking && (
            <div className="input-group">
              <label>密码</label>
              <input
                type="password"
                value={unlockPassword}
                placeholder="输入密码"
                onChange={(e) => setUnlockPassword(e.target.value)}
              />
            </div>
          )}

          {isUnlocking && <p className="hint">正在解锁，请稍候...</p>}

          <button className="btn-unlock" onClick={handleUnlock} disabled={isUnlocking}>
            {isUnlocking ? '解锁中...' : '解锁'}
          </button>

          {renderPanelMessage(unlockMessage)}
        </section>
      )}

      {view === 'unlocked' && (
        <section className="panel">
          <div className="wallet-status">
            <div className="status-row">
              <span>地址:</span>
              <span>{walletAddress}</span>
            </div>
            <div className="status-row">
              <span>BNB 余额:</span>
              <span>{bnbBalance}</span>
            </div>
          </div>

          <div className="button-row">
            <button className="btn-lock" onClick={handleLock}>
              锁定钱包
            </button>
            <button className="btn-danger" onClick={handleRemove}>
              移除钱包
            </button>
          </div>
          <button
            className="btn-secondary"
            onClick={handleOpenSidePanel}
            disabled={!sidePanelSupported}
          >
            {sidePanelSupported ? '打开交易面板' : '交易面板不可用'}
          </button>

          {renderPanelMessage(null)}
        </section>
      )}
    </div>
  );
}
