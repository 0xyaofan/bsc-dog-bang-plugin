import { logger } from '../shared/logger.js';
import { BACKGROUND_TASK_CONFIG, CONTRACTS } from '../shared/trading-config.js';
import {
  resolveQuoteTokenName,
  getQuoteBalance,
  swapQuoteForBnb,
  isBnbQuote,
  type SwapContext,
  prepareQuoteFunds
} from './four-quote-bridge.js';

export type FourQuoteRouteInfo = {
  quoteToken?: string;
  readyForPancake?: boolean;
};

export const FOUR_CHANNEL_IDS = new Set(['four', 'xmode']);

export function shouldUseFourQuote(routeInfo?: FourQuoteRouteInfo | null, channelId?: string) {
  if (!routeInfo) {
    return false;
  }
  if (!channelId || !FOUR_CHANNEL_IDS.has(channelId)) {
    return false;
  }
  if (routeInfo.readyForPancake) {
    return false;
  }
  if (isBnbQuote(routeInfo.quoteToken)) {
    return false;
  }
  return true;
}

export function requireFourQuoteToken(routeInfo?: FourQuoteRouteInfo | null) {
  const quote = routeInfo?.quoteToken;
  if (!quote) {
    throw new Error('无法读取代币的募集币种信息，请稍后重试');
  }
  return quote;
}

type PrepareQuoteBuyParams = {
  tokenAddress: string;
  amountInWei: bigint;
  slippage: number;
  quoteToken: string;
  swapContext: SwapContext;
  publicClient: any;
  walletAddress: string;
};

export type FourQuoteBuyResult = {
  quoteAmount: bigint;
  usedWalletQuote: boolean;
};

export async function prepareFourQuoteBuy(params: PrepareQuoteBuyParams): Promise<FourQuoteBuyResult> {
  const { tokenAddress, amountInWei, slippage, quoteToken, swapContext, publicClient, walletAddress } = params;
  const { quoteAmount, usedWalletQuote } = await prepareQuoteFunds({
    tokenAddress,
    quoteToken,
    amountInWei,
    slippage,
    spender: CONTRACTS.FOUR_TOKEN_MANAGER_V2,
    swapContext,
    publicClient,
    walletAddress
  });
  if (usedWalletQuote) {
    logger.debug('[FourQuote] 复用现有募集币种余额', {
      token: tokenAddress,
      quoteToken,
      quoteAmount: quoteAmount.toString()
    });
  }

  return {
    quoteAmount,
    usedWalletQuote
  };
}

const FOUR_QUOTE_SETTLE_DELAY = BACKGROUND_TASK_CONFIG.FOUR_QUOTE_BALANCE_SETTLE_DELAY_MS ?? 400;
const QUOTE_BALANCE_RETRY_MAX = BACKGROUND_TASK_CONFIG.FOUR_QUOTE_BALANCE_RETRY_MAX ?? 6;
const QUOTE_BALANCE_RETRY_DELAY = BACKGROUND_TASK_CONFIG.FOUR_QUOTE_BALANCE_RETRY_DELAY_MS ?? 500;

type FinalizeQuoteSellParams = {
  txHash: string;
  quoteToken: string;
  quoteBalanceBefore: bigint;
  slippage: number;
  swapContext: SwapContext;
  publicClient: any;
  walletAddress: string;
  delay: (ms: number) => Promise<void>;
};

export type FourQuoteSellResult = {
  converted: boolean;
  receivedQuote?: bigint;
};

export async function finalizeFourQuoteSell(params: FinalizeQuoteSellParams): Promise<FourQuoteSellResult> {
  const {
    txHash,
    quoteToken,
    quoteBalanceBefore,
    slippage,
    swapContext,
    publicClient,
    walletAddress,
    delay
  } = params;

  let receipt: any;
  try {
    receipt = await publicClient.waitForTransactionReceipt({ hash: txHash });
  } catch (error) {
    logger.warn('[FourQuote] 等待卖出确认失败，自动兑换已取消:', error?.message || error);
    return { converted: false };
  }

  if (!receipt || receipt.status !== 'success') {
    logger.warn('[FourQuote] 卖出交易未成功，跳过自动兑换');
    return { converted: false };
  }

  await delay(FOUR_QUOTE_SETTLE_DELAY);

  let received = 0n;
  const quoteLabel = resolveQuoteTokenName(quoteToken);
  for (let attempt = 0; attempt < QUOTE_BALANCE_RETRY_MAX; attempt += 1) {
    const afterBalance = await getQuoteBalance(publicClient, quoteToken, walletAddress);
    if (afterBalance > quoteBalanceBefore) {
      received = afterBalance - quoteBalanceBefore;
      break;
    }
    await delay(QUOTE_BALANCE_RETRY_DELAY);
  }

  if (received <= 0n) {
    logger.debug(`[FourQuote] 卖出后未检测到新的 ${quoteLabel}，跳过自动兑换`);
    return { converted: false };
  }

  try {
    await swapQuoteForBnb({
      quoteToken,
      amountIn: received,
      slippage,
      context: swapContext
    });
    logger.debug('[FourQuote] 已自动兑换为 BNB', {
      quoteToken,
      received: received.toString()
    });
    return {
      converted: true,
      receivedQuote: received
    };
  } catch (error) {
    logger.error('[FourQuote] 自动兑换 BNB 失败:', error);
    return { converted: false };
  }
}
