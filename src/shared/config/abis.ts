/**
 * ABI 定义
 * 集中管理所有合约的 ABI
 */

import { parseAbi, type Abi } from 'viem';
import memeSwapAggregatorAbi from '../../../abis/MemeSwapContract.abi.json';

// ========== PancakeSwap ABIs ==========

/**
 * PancakeSwap Router V2 ABI
 */
export const ROUTER_ABI = parseAbi([
  'function swapExactETHForTokens(uint amountOutMin, address[] path, address to, uint deadline) payable returns (uint[] amounts)',
  'function swapExactTokensForETH(uint amountIn, uint amountOutMin, address[] path, address to, uint deadline) returns (uint[] amounts)',
  'function swapExactTokensForETHSupportingFeeOnTransferTokens(uint amountIn, uint amountOutMin, address[] path, address to, uint deadline)',
  'function swapExactTokensForTokens(uint amountIn, uint amountOutMin, address[] path, address to, uint deadline) returns (uint[] amounts)',
  'function getAmountsOut(uint amountIn, address[] path) view returns (uint[] amounts)'
]);

/**
 * PancakeSwap Factory V2 ABI
 */
export const PANCAKE_FACTORY_ABI = parseAbi([
  'function getPair(address tokenA, address tokenB) view returns (address pair)'
]);

/**
 * PancakeSwap V3 Factory ABI
 */
export const PANCAKE_V3_FACTORY_ABI = parseAbi([
  'function getPool(address tokenA, address tokenB, uint24 fee) view returns (address pool)'
]);

/**
 * PancakeSwap V3 Smart Router ABI
 */
export const PANCAKE_V3_SMART_ROUTER_ABI = parseAbi([
  'function exactInputSingle((address tokenIn, address tokenOut, uint24 fee, address recipient, uint256 amountIn, uint256 amountOutMinimum, uint160 sqrtPriceLimitX96) params) payable returns (uint256 amountOut)',
  'function exactInput((bytes path, address recipient, uint256 amountIn, uint256 amountOutMinimum) params) payable returns (uint256 amountOut)',
  'function unwrapWETH9(uint256 amountMinimum, address recipient) payable',
  'function multicall(bytes[] data) payable returns (bytes[] results)'
]);

/**
 * PancakeSwap V3 Quoter ABI
 */
export const PANCAKE_V3_QUOTER_ABI = parseAbi([
  'function quoteExactInputSingle((address tokenIn, address tokenOut, uint256 amountIn, uint24 fee, uint160 sqrtPriceLimitX96) params) returns (uint256 amountOut, uint160 sqrtPriceX96After, uint32 initializedTicksCrossed, uint256 gasEstimate)',
  'function quoteExactInput(bytes path, uint256 amountIn) returns (uint256 amountOut, uint160[] sqrtPriceX96AfterList, uint32[] initializedTicksCrossedList, uint256 gasEstimate)'
]);

// ========== ERC20 ABI ==========

/**
 * ERC20 标准 ABI（最小化）
 */
export const ERC20_ABI = parseAbi([
  'function balanceOf(address owner) view returns (uint256)',
  'function decimals() view returns (uint8)',
  'function approve(address spender, uint256 amount) returns (bool)',
  'function allowance(address owner, address spender) view returns (uint256)',
  'function symbol() view returns (string)',
  'function name() view returns (string)',
  'function totalSupply() view returns (uint256)'
]);

// ========== Four.meme ABIs ==========

/**
 * Four.meme Token Manager V2 ABI
 */
export const FOUR_TOKEN_MANAGER_ABI = parseAbi([
  'function buyToken(bytes args, uint256 time, bytes signature) payable',
  'function buyTokenAMAP(address token, uint256 amountIn, uint256 minAmountOut) payable returns (uint256)',
  'function sellToken(address token, uint256 amountIn, uint256 minFunds) returns (uint256)'
]);

// ========== Flap ABIs ==========

/**
 * Flap Portal ABI
 */
export const FLAP_PORTAL_ABI = parseAbi([
  'function quoteExactInput((address inputToken, address outputToken, uint256 inputAmount) params) view returns (uint256 amountOut)',
  'function swapExactInput((address inputToken, address outputToken, uint256 inputAmount, uint256 minOutputAmount, bytes permitData) params) payable returns (uint256 amountOut)'
]);

// ========== Luna.fun ABIs ==========

/**
 * Luna.fun Launchpad ABI
 */
export const LUNA_FUN_ABI = parseAbi([
  'function buy(uint256 amountIn, address tokenAddress, uint256 amountOutMin, uint256 deadline) returns (bool)',
  'function sell(uint256 amountIn, address tokenAddress, uint256 amountOutMin, uint256 deadline) returns (bool)'
]);

// ========== Custom Aggregator ABIs ==========

/**
 * MemeSwap Aggregator ABI
 * 自定义聚合器合约，支持 Four.meme 和 Flap 的买卖操作
 */
export const MEME_SWAP_AGGREGATOR_ABI = memeSwapAggregatorAbi as Abi;
