(async () => {
  try {
    await import(chrome.runtime.getURL('dist/content.js'));
  } catch (error) {
    console.error('[Dog Bang Trade Plugin] Failed to load content script bundle:', error);
  }
})();
