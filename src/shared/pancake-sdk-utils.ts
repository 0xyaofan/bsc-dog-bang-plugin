/**
 * PancakeSwap SDK 工具函数
 *
 * 本文件展示如何选择性使用 @pancakeswap/swap-sdk-core 包
 *
 * 设计原则：
 * 1. 保留现有的 BigInt 计算逻辑（已经是最优方案）
 * 2. 仅在需要格式化显示时使用 SDK 的 Percent 类
 * 3. 不引入 Token 类（当前的地址字符串方式更简洁）
 */

import { Percent, Fraction } from '@pancakeswap/swap-sdk-core';

/**
 * 将滑点数值转换为 Percent 对象（用于显示）
 *
 * @param slippage - 滑点值，例如 0.5 表示 0.5%
 * @returns Percent 对象
 *
 * @example
 * const slippage = 0.5; // 0.5%
 * const percent = slippageToPercent(slippage);
 * console.log(percent.toSignificant(2)); // "0.5"
 * console.log(percent.toFixed(2)); // "0.50"
 */
export function slippageToPercent(slippage: number): Percent {
  // slippage 是百分比值，例如 0.5 表示 0.5%
  // Percent 构造函数接受 (numerator, denominator)
  // 0.5% = 50/10000
  return new Percent(Math.floor(slippage * 100), 10000);
}

/**
 * 计算考虑滑点后的最小输出金额（使用 BigInt，保持现有逻辑）
 *
 * 注意：这个函数保持使用 BigInt 计算，不使用 SDK，因为 BigInt 已经是最精确的方式
 *
 * @param amountOut - 预期输出金额
 * @param slippage - 滑点值，例如 0.5 表示 0.5%
 * @returns 最小输出金额
 *
 * @example
 * const amountOut = 1000000000000000000n; // 1 token
 * const slippage = 0.5; // 0.5%
 * const minAmount = calculateMinAmountOut(amountOut, slippage);
 * // minAmount = 995000000000000000n (0.995 token)
 */
export function calculateMinAmountOut(amountOut: bigint, slippage: number): bigint {
  // 保持现有的计算逻辑
  return amountOut * BigInt(10000 - slippage * 100) / 10000n;
}

/**
 * 计算价格影响百分比（使用 Percent 类进行格式化显示）
 *
 * @param expectedOut - 预期输出金额
 * @param actualOut - 实际输出金额
 * @returns Percent 对象
 *
 * @example
 * const expectedOut = 1000000000000000000n; // 1 token
 * const actualOut = 975000000000000000n; // 0.975 token
 * const impact = calculatePriceImpact(expectedOut, actualOut);
 * console.log(impact.toSignificant(2)); // "2.5" (表示 2.5% 的价格影响)
 */
export function calculatePriceImpact(expectedOut: bigint, actualOut: bigint): Percent {
  if (expectedOut === 0n) {
    return new Percent(0, 1);
  }

  // 价格影响 = (预期 - 实际) / 预期
  const diff = expectedOut - actualOut;

  // 使用 Fraction 进行精确计算
  const fraction = new Fraction(diff.toString(), expectedOut.toString());

  // 转换为 Percent
  return new Percent(fraction.numerator, fraction.denominator);
}

/**
 * 格式化滑点显示
 *
 * @param slippage - 滑点值，例如 0.5 表示 0.5%
 * @param significantDigits - 有效数字位数，默认 2
 * @returns 格式化的字符串，例如 "0.5%"
 *
 * @example
 * formatSlippage(0.5); // "0.5%"
 * formatSlippage(1.25); // "1.25%"
 * formatSlippage(0.123, 3); // "0.123%"
 */
export function formatSlippage(slippage: number, significantDigits: number = 2): string {
  const percent = slippageToPercent(slippage);
  return `${percent.toSignificant(significantDigits)}%`;
}

/**
 * 格式化价格影响显示
 *
 * @param impact - Percent 对象
 * @param significantDigits - 有效数字位数，默认 2
 * @returns 格式化的字符串，例如 "2.5%"
 *
 * @example
 * const impact = calculatePriceImpact(1000000n, 975000n);
 * formatPriceImpact(impact); // "2.5%"
 */
export function formatPriceImpact(impact: Percent, significantDigits: number = 2): string {
  return `${impact.toSignificant(significantDigits)}%`;
}

/**
 * 计算价格比率（使用 Fraction 进行精确计算）
 *
 * @param amountA - 金额 A
 * @param amountB - 金额 B
 * @returns Fraction 对象，表示 A/B 的比率
 *
 * @example
 * const ratio = calculateRatio(1000000000000000000n, 2000000000000000000n);
 * console.log(ratio.toSignificant(6)); // "0.5"
 * console.log(ratio.invert().toSignificant(6)); // "2"
 */
export function calculateRatio(amountA: bigint, amountB: bigint): Fraction {
  if (amountB === 0n) {
    return new Fraction(0, 1);
  }

  return new Fraction(amountA.toString(), amountB.toString());
}

/**
 * 示例：如何在交易中使用这些工具函数
 */
export function exampleUsage() {
  // 1. 计算最小输出金额（保持使用 BigInt）
  const amountOut = 1000000000000000000n; // 1 token
  const slippage = 0.5; // 0.5%
  const minAmountOut = calculateMinAmountOut(amountOut, slippage);
  console.log(`最小输出: ${minAmountOut.toString()}`);

  // 2. 格式化滑点显示
  const slippageText = formatSlippage(slippage);
  console.log(`滑点: ${slippageText}`); // "滑点: 0.5%"

  // 3. 计算并显示价格影响
  const expectedOut = 1000000000000000000n;
  const actualOut = 975000000000000000n;
  const priceImpact = calculatePriceImpact(expectedOut, actualOut);
  const impactText = formatPriceImpact(priceImpact);
  console.log(`价格影响: ${impactText}`); // "价格影响: 2.5%"

  // 4. 计算价格比率
  const ratio = calculateRatio(1000000000000000000n, 2000000000000000000n);
  console.log(`比率: ${ratio.toSignificant(6)}`); // "比率: 0.5"
}
