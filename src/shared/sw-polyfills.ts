/**
 * Service Worker Polyfills
 * 提供在 Service Worker 环境中缺失的浏览器全局对象占位符
 */

const globalScope: Record<string, any> = typeof globalThis === 'object' ? (globalThis as any) : (self as any);

type EventCallback = (event?: any) => void;

const noop = () => undefined;
const emptyCollection: any[] = [];

function createEventTarget() {
  const listeners = new Map<string, Set<EventCallback>>();
  return {
    addEventListener: (type: string, listener: EventCallback | null) => {
      if (!type || typeof listener !== 'function') return;
      if (!listeners.has(type)) {
        listeners.set(type, new Set());
      }
      listeners.get(type)?.add(listener);
    },
    removeEventListener: (type: string, listener: EventCallback | null) => {
      if (!type || typeof listener !== 'function') return;
      listeners.get(type)?.delete(listener);
    },
    dispatchEvent: (event: { type?: string }) => {
      const type = event?.type;
      if (!type) {
        return true;
      }
      const handlers = listeners.get(type);
      if (!handlers) {
        return true;
      }
      handlers.forEach((handler) => {
        try {
          handler.call(globalScope, event);
        } catch {
          // ignore handler errors
        }
      });
      return true;
    }
  };
}

if (typeof globalScope.document === 'undefined') {
  const dummyElement = {
    style: {},
    appendChild: noop,
    removeChild: noop,
    setAttribute: noop,
    getAttribute: noop,
    addEventListener: noop,
    removeEventListener: noop,
    querySelector: () => null,
    querySelectorAll: () => emptyCollection,
    getElementsByTagName: () => emptyCollection,
    firstChild: null,
    innerHTML: ''
  };
  const dummyEventTarget = createEventTarget();
  const dummyDocument = {
    body: dummyElement,
    head: dummyElement,
    documentElement: dummyElement,
    createElement: () => ({ ...dummyElement }),
    createElementNS: () => ({ ...dummyElement }),
    createTextNode: () => ({ data: '', nodeType: 3 }),
    addEventListener: dummyEventTarget.addEventListener,
    removeEventListener: dummyEventTarget.removeEventListener,
    dispatchEvent: dummyEventTarget.dispatchEvent,
    querySelector: () => null,
    querySelectorAll: () => emptyCollection,
    getElementsByTagName: () => emptyCollection,
    readyState: 'complete'
  };

  try {
    Object.defineProperty(globalScope, 'document', {
      value: dummyDocument,
      configurable: true,
      writable: true
    });
  } catch {
    globalScope.document = dummyDocument;
  }
}

if (typeof globalScope.window === 'undefined') {
  const eventTarget = createEventTarget();
  const dummyWindow = {
    addEventListener: eventTarget.addEventListener,
    removeEventListener: eventTarget.removeEventListener,
    dispatchEvent: eventTarget.dispatchEvent,
    matchMedia: () => ({ matches: false, addListener: noop, removeListener: noop }),
    requestAnimationFrame: (cb: FrameRequestCallback) => {
      return typeof cb === 'function' ? (cb(0), 0) : 0;
    },
    cancelAnimationFrame: noop,
    getComputedStyle: () => ({ getPropertyValue: () => '' }),
    navigator: {},
    location: {},
    document: globalScope.document
  };

  try {
    Object.defineProperty(globalScope, 'window', {
      value: dummyWindow,
      configurable: true,
      writable: true
    });
  } catch {
    (globalScope as any).window = dummyWindow;
  }
}
