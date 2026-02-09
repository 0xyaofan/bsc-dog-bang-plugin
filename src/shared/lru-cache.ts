/**
 * LRU (Least Recently Used) 缓存实现
 *
 * 提供高效的缓存管理，自动淘汰最近最少使用的条目
 */

/**
 * LRU 缓存节点
 */
class LRUNode<K, V> {
  constructor(
    public key: K,
    public value: V,
    public prev: LRUNode<K, V> | null = null,
    public next: LRUNode<K, V> | null = null
  ) {}
}

/**
 * LRU 缓存类
 *
 * 使用双向链表 + Map 实现 O(1) 的读写性能
 */
export class LRUCache<K, V> {
  private cache: Map<K, LRUNode<K, V>>;
  private head: LRUNode<K, V> | null;
  private tail: LRUNode<K, V> | null;
  private maxSize: number;

  constructor(maxSize: number) {
    if (maxSize <= 0) {
      throw new Error('maxSize must be greater than 0');
    }

    this.cache = new Map();
    this.head = null;
    this.tail = null;
    this.maxSize = maxSize;
  }

  /**
   * 获取缓存值
   *
   * @param key 缓存键
   * @returns 缓存值，如果不存在返回 undefined
   */
  get(key: K): V | undefined {
    const node = this.cache.get(key);

    if (!node) {
      return undefined;
    }

    // 移动到头部（最近使用）
    this.moveToHead(node);

    return node.value;
  }

  /**
   * 设置缓存值
   *
   * @param key 缓存键
   * @param value 缓存值
   */
  set(key: K, value: V): void {
    const existingNode = this.cache.get(key);

    if (existingNode) {
      // 更新现有节点
      existingNode.value = value;
      this.moveToHead(existingNode);
    } else {
      // 创建新节点
      const newNode = new LRUNode(key, value);
      this.cache.set(key, newNode);
      this.addToHead(newNode);

      // 检查是否超过容量
      if (this.cache.size > this.maxSize) {
        // 删除尾部节点（最久未使用）
        this.removeTail();
      }
    }
  }

  /**
   * 检查键是否存在
   *
   * @param key 缓存键
   * @returns 是否存在
   */
  has(key: K): boolean {
    return this.cache.has(key);
  }

  /**
   * 删除缓存项
   *
   * @param key 缓存键
   * @returns 是否删除成功
   */
  delete(key: K): boolean {
    const node = this.cache.get(key);

    if (!node) {
      return false;
    }

    this.removeNode(node);
    this.cache.delete(key);

    return true;
  }

  /**
   * 清空缓存
   */
  clear(): void {
    this.cache.clear();
    this.head = null;
    this.tail = null;
  }

  /**
   * 获取缓存大小
   */
  get size(): number {
    return this.cache.size;
  }

  /**
   * 获取最大容量
   */
  get capacity(): number {
    return this.maxSize;
  }

  /**
   * 获取所有键
   */
  keys(): K[] {
    const keys: K[] = [];
    let current = this.head;

    while (current) {
      keys.push(current.key);
      current = current.next;
    }

    return keys;
  }

  /**
   * 获取所有值
   */
  values(): V[] {
    const values: V[] = [];
    let current = this.head;

    while (current) {
      values.push(current.value);
      current = current.next;
    }

    return values;
  }

  /**
   * 获取所有条目
   */
  entries(): Array<[K, V]> {
    const entries: Array<[K, V]> = [];
    let current = this.head;

    while (current) {
      entries.push([current.key, current.value]);
      current = current.next;
    }

    return entries;
  }

  /**
   * 遍历缓存
   */
  forEach(callback: (value: V, key: K, cache: LRUCache<K, V>) => void): void {
    let current = this.head;

    while (current) {
      callback(current.value, current.key, this);
      current = current.next;
    }
  }

  /**
   * 获取最近使用的 N 个键
   */
  getMostRecent(count: number): K[] {
    const keys: K[] = [];
    let current = this.head;
    let n = 0;

    while (current && n < count) {
      keys.push(current.key);
      current = current.next;
      n++;
    }

    return keys;
  }

  /**
   * 获取最久未使用的 N 个键
   */
  getLeastRecent(count: number): K[] {
    const keys: K[] = [];
    let current = this.tail;
    let n = 0;

    while (current && n < count) {
      keys.push(current.key);
      current = current.prev;
      n++;
    }

    return keys;
  }

  /**
   * 将节点移动到头部
   */
  private moveToHead(node: LRUNode<K, V>): void {
    if (node === this.head) {
      return;
    }

    this.removeNode(node);
    this.addToHead(node);
  }

  /**
   * 添加节点到头部
   */
  private addToHead(node: LRUNode<K, V>): void {
    node.prev = null;
    node.next = this.head;

    if (this.head) {
      this.head.prev = node;
    }

    this.head = node;

    if (!this.tail) {
      this.tail = node;
    }
  }

  /**
   * 从链表中移除节点
   */
  private removeNode(node: LRUNode<K, V>): void {
    if (node.prev) {
      node.prev.next = node.next;
    } else {
      this.head = node.next;
    }

    if (node.next) {
      node.next.prev = node.prev;
    } else {
      this.tail = node.prev;
    }
  }

  /**
   * 删除尾部节点
   */
  private removeTail(): void {
    if (!this.tail) {
      return;
    }

    const tailKey = this.tail.key;
    this.removeNode(this.tail);
    this.cache.delete(tailKey);
  }

  /**
   * 转换为 JSON
   */
  toJSON(): Record<string, any> {
    return {
      size: this.size,
      capacity: this.capacity,
      entries: this.entries()
    };
  }

  /**
   * 从 JSON 恢复
   */
  static fromJSON<K, V>(
    json: { capacity: number; entries: Array<[K, V]> }
  ): LRUCache<K, V> {
    const cache = new LRUCache<K, V>(json.capacity);

    // 按顺序添加条目（最新的在前）
    for (const [key, value] of json.entries) {
      cache.set(key, value);
    }

    return cache;
  }
}

/**
 * 带 TTL (Time To Live) 的 LRU 缓存
 *
 * 支持条目过期时间
 */
export class LRUCacheWithTTL<K, V> extends LRUCache<K, V> {
  private ttlMap: Map<K, number>;
  private defaultTTL: number;

  constructor(maxSize: number, defaultTTL: number = Infinity) {
    super(maxSize);
    this.ttlMap = new Map();
    this.defaultTTL = defaultTTL;
  }

  /**
   * 获取缓存值（检查过期）
   */
  get(key: K): V | undefined {
    const expireTime = this.ttlMap.get(key);

    if (expireTime !== undefined && Date.now() > expireTime) {
      // 已过期，删除
      this.delete(key);
      return undefined;
    }

    return super.get(key);
  }

  /**
   * 设置缓存值（带 TTL）
   */
  set(key: K, value: V, ttl?: number): void {
    super.set(key, value);

    const ttlMs = ttl ?? this.defaultTTL;

    if (ttlMs !== Infinity) {
      this.ttlMap.set(key, Date.now() + ttlMs);
    }
  }

  /**
   * 删除缓存项
   */
  delete(key: K): boolean {
    this.ttlMap.delete(key);
    return super.delete(key);
  }

  /**
   * 清空缓存
   */
  clear(): void {
    super.clear();
    this.ttlMap.clear();
  }

  /**
   * 获取剩余 TTL
   */
  getTTL(key: K): number | undefined {
    const expireTime = this.ttlMap.get(key);

    if (expireTime === undefined) {
      return undefined;
    }

    const remaining = expireTime - Date.now();
    return remaining > 0 ? remaining : 0;
  }

  /**
   * 清理过期条目
   */
  cleanup(): number {
    let cleaned = 0;
    const now = Date.now();

    for (const [key, expireTime] of this.ttlMap.entries()) {
      if (now > expireTime) {
        this.delete(key);
        cleaned++;
      }
    }

    return cleaned;
  }

  /**
   * 启动自动清理
   */
  startAutoCleanup(intervalMs: number = 60000): () => void {
    const timer = setInterval(() => {
      this.cleanup();
    }, intervalMs);

    // 返回停止函数
    return () => clearInterval(timer);
  }
}

/**
 * 创建 LRU 缓存的便捷函数
 */
export function createLRUCache<K, V>(maxSize: number): LRUCache<K, V> {
  return new LRUCache<K, V>(maxSize);
}

/**
 * 创建带 TTL 的 LRU 缓存的便捷函数
 */
export function createLRUCacheWithTTL<K, V>(
  maxSize: number,
  defaultTTL: number
): LRUCacheWithTTL<K, V> {
  return new LRUCacheWithTTL<K, V>(maxSize, defaultTTL);
}
