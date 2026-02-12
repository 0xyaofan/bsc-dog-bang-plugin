import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react-swc';
import { resolve } from 'path';

const popupHtml = resolve(__dirname, 'extension/popup.html');
const backgroundEntry = resolve(__dirname, 'src/background/index.ts');
const contentEntry = resolve(__dirname, 'src/content/index.ts');
const offscreenEntry = resolve(__dirname, 'src/offscreen/index.ts');
const sidepanelHtml = resolve(__dirname, 'extension/sidepanel.html');

const flattenExtensionHtml = () => ({
  name: 'flatten-extension-html',
  enforce: 'post',
  apply: 'build',
  generateBundle(_, bundle) {
    Object.values(bundle).forEach((chunk) => {
      if (chunk.type !== 'asset') return;
      if (typeof chunk.fileName !== 'string') return;
      if (!chunk.fileName.endsWith('.html')) return;

      if (typeof chunk.source === 'string') {
        chunk.source = chunk.source.replace(/(["'])\.\.\/assets\//g, '$1./assets/');
      }

      const parts = chunk.fileName.split('/');
      chunk.fileName = parts[parts.length - 1];
    });
  }
});

export default defineConfig({
  base: './',
  plugins: [react(), flattenExtensionHtml()],
  build: {
    outDir: 'extension/dist',
    emptyOutDir: true,
    rollupOptions: {
      input: {
        popup: popupHtml,
        background: backgroundEntry,
        content: contentEntry,
        offscreen: offscreenEntry,
        sidepanel: sidepanelHtml
      },
      output: {
        entryFileNames: (chunk) => {
          if (chunk.name === 'background') return 'background.js';
          if (chunk.name === 'content') return 'content.js';
           if (chunk.name === 'offscreen') return 'offscreen.js';
          return 'assets/[name]-[hash].js';
        },
        chunkFileNames: 'assets/[name]-[hash].js',
        assetFileNames: 'assets/[name]-[hash][extname]'
      },
      // 排除测试相关的依赖
      external: ['vitest', 'chai', '@vitest/utils'],
      // 抑制第三方依赖的 PURE 注释警告
      onwarn(warning, warn) {
        // 忽略 ox 包中的 PURE 注释位置警告
        if (
          warning.code === 'SOURCEMAP_ERROR' ||
          (warning.code === 'INVALID_ANNOTATION' && warning.message.includes('ox/_esm/core/Base64.js'))
        ) {
          return;
        }
        // 忽略 vitest/chai 相关的未解析导入警告
        if (warning.code === 'UNRESOLVED_IMPORT' && (
          warning.exporter?.includes('vitest') ||
          warning.exporter?.includes('chai') ||
          warning.exporter?.includes('@bsc-trading')
        )) {
          return;
        }
        // 其他警告正常显示
        warn(warning);
      }
    }
  }
});
