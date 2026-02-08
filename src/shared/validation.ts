/**
 * Input Validation and Invariant Checking
 * 输入验证和不变量检查工具
 */

/**
 * 验证以太坊地址格式
 */
export function validateAddress(address: any, paramName: string = 'address'): string {
  if (typeof address !== 'string') {
    throw new Error(`[Validation] ${paramName} must be a string, got ${typeof address}`);
  }

  const trimmed = address.trim();
  if (!/^0x[a-fA-F0-9]{40}$/i.test(trimmed)) {
    throw new Error(`[Validation] ${paramName} is not a valid Ethereum address: ${address}`);
  }

  return trimmed.toLowerCase();
}

/**
 * 验证平台类型
 */
export function validatePlatform(platform: any, paramName: string = 'platform'): string {
  const validPlatforms = ['four', 'xmode', 'flap', 'luna', 'unknown'];

  if (typeof platform !== 'string') {
    throw new Error(`[Validation] ${paramName} must be a string, got ${typeof platform}`);
  }

  if (!validPlatforms.includes(platform)) {
    throw new Error(`[Validation] ${paramName} must be one of ${validPlatforms.join(', ')}, got ${platform}`);
  }

  return platform;
}

/**
 * 验证 BigInt 值
 */
export function validateBigInt(value: any, paramName: string = 'value', options?: {
  min?: bigint;
  max?: bigint;
  allowZero?: boolean;
}): bigint {
  if (typeof value !== 'bigint') {
    throw new Error(`[Validation] ${paramName} must be a BigInt, got ${typeof value}`);
  }

  if (options?.min !== undefined && value < options.min) {
    throw new Error(`[Validation] ${paramName} must be >= ${options.min}, got ${value}`);
  }

  if (options?.max !== undefined && value > options.max) {
    throw new Error(`[Validation] ${paramName} must be <= ${options.max}, got ${value}`);
  }

  if (options?.allowZero === false && value === 0n) {
    throw new Error(`[Validation] ${paramName} cannot be zero`);
  }

  return value;
}

/**
 * 验证数字范围
 */
export function validateNumber(value: any, paramName: string = 'value', options?: {
  min?: number;
  max?: number;
  integer?: boolean;
}): number {
  if (typeof value !== 'number') {
    throw new Error(`[Validation] ${paramName} must be a number, got ${typeof value}`);
  }

  if (isNaN(value)) {
    throw new Error(`[Validation] ${paramName} cannot be NaN`);
  }

  if (!isFinite(value)) {
    throw new Error(`[Validation] ${paramName} must be finite`);
  }

  if (options?.integer && !Number.isInteger(value)) {
    throw new Error(`[Validation] ${paramName} must be an integer, got ${value}`);
  }

  if (options?.min !== undefined && value < options.min) {
    throw new Error(`[Validation] ${paramName} must be >= ${options.min}, got ${value}`);
  }

  if (options?.max !== undefined && value > options.max) {
    throw new Error(`[Validation] ${paramName} must be <= ${options.max}, got ${value}`);
  }

  return value;
}

/**
 * 验证对象不为空
 */
export function validateNotNull<T>(value: T | null | undefined, paramName: string = 'value'): T {
  if (value === null || value === undefined) {
    throw new Error(`[Validation] ${paramName} cannot be null or undefined`);
  }
  return value;
}

/**
 * 验证数组
 */
export function validateArray<T>(value: any, paramName: string = 'value', options?: {
  minLength?: number;
  maxLength?: number;
  itemValidator?: (item: any, index: number) => T;
}): T[] {
  if (!Array.isArray(value)) {
    throw new Error(`[Validation] ${paramName} must be an array, got ${typeof value}`);
  }

  if (options?.minLength !== undefined && value.length < options.minLength) {
    throw new Error(`[Validation] ${paramName} must have at least ${options.minLength} items, got ${value.length}`);
  }

  if (options?.maxLength !== undefined && value.length > options.maxLength) {
    throw new Error(`[Validation] ${paramName} must have at most ${options.maxLength} items, got ${value.length}`);
  }

  if (options?.itemValidator) {
    return value.map((item, index) => options.itemValidator!(item, index));
  }

  return value;
}

/**
 * 不变量检查：确保条件为真
 */
export function invariant(condition: boolean, message: string): asserts condition {
  if (!condition) {
    throw new Error(`[Invariant] ${message}`);
  }
}

/**
 * 不变量检查：确保值不为零地址
 */
export function invariantNotZeroAddress(address: string, paramName: string = 'address'): void {
  const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000';
  invariant(
    address.toLowerCase() !== ZERO_ADDRESS.toLowerCase(),
    `${paramName} cannot be zero address`
  );
}

/**
 * 不变量检查：确保进度在 0-1 之间
 */
export function invariantProgress(progress: number, paramName: string = 'progress'): void {
  invariant(
    progress >= 0 && progress <= 1,
    `${paramName} must be between 0 and 1, got ${progress}`
  );
}

/**
 * 不变量检查：确保路由结果有效
 */
export function invariantValidRoute(route: any): void {
  invariant(route !== null && route !== undefined, 'route cannot be null or undefined');
  invariant(typeof route === 'object', 'route must be an object');
  invariant(typeof route.platform === 'string', 'route.platform must be a string');
  invariant(typeof route.preferredChannel === 'string', 'route.preferredChannel must be a string');
  invariant(typeof route.readyForPancake === 'boolean', 'route.readyForPancake must be a boolean');
}

/**
 * 安全的 BigInt 转换
 */
export function safeBigInt(value: any, defaultValue: bigint = 0n): bigint {
  try {
    if (typeof value === 'bigint') {
      return value;
    }
    if (typeof value === 'number') {
      if (!Number.isInteger(value)) {
        return defaultValue;
      }
      return BigInt(value);
    }
    if (typeof value === 'string') {
      return BigInt(value);
    }
    return defaultValue;
  } catch {
    return defaultValue;
  }
}

/**
 * 安全的数字转换
 */
export function safeNumber(value: any, defaultValue: number = 0): number {
  try {
    const num = Number(value);
    if (isNaN(num) || !isFinite(num)) {
      return defaultValue;
    }
    return num;
  } catch {
    return defaultValue;
  }
}

/**
 * 安全的地址规范化
 */
export function safeNormalizeAddress(address: any): string | null {
  try {
    if (typeof address !== 'string') {
      return null;
    }
    const trimmed = address.trim();
    if (!/^0x[a-fA-F0-9]{40}$/i.test(trimmed)) {
      return null;
    }
    return trimmed.toLowerCase();
  } catch {
    return null;
  }
}

/**
 * 检查是否为零地址
 */
export function isZeroAddress(address: string): boolean {
  const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000';
  return address.toLowerCase() === ZERO_ADDRESS.toLowerCase();
}

/**
 * 检查是否为有效的以太坊地址
 */
export function isValidAddress(address: any): boolean {
  if (typeof address !== 'string') {
    return false;
  }
  return /^0x[a-fA-F0-9]{40}$/i.test(address.trim());
}
