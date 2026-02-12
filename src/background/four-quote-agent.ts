import { logger } from '../shared/logger.js';
import { BACKGROUND_TASK_CONFIG, CONTRACTS } from '../shared/config/index.js';
import {
  resolveQuoteTokenName,
  getQuoteBalance,
  swapQuoteForBnb,
  isBnbQuote,
  type SwapContext,
  prepareQuoteFunds
} from './four-quote-bridge.js';
import { perf } from '../shared/performance.js';

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
  const fnStart = perf.now();
  const { tokenAddress, amountInWei, slippage, quoteToken, swapContext, publicClient, walletAddress } = params;

  logger.debug('[PrepareFourQuoteBuy] 开始准备 Quote 买入', {
    tokenAddress: tokenAddress.slice(0, 10),
    amountInWei: amountInWei.toString(),
    quoteToken: quoteToken.slice(0, 10)
  });

  const prepareStart = perf.now();
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
  logger.debug(`[PrepareFourQuoteBuy] Quote 资金准备完成 (${perf.measure(prepareStart).toFixed(2)}ms)`, {
    quoteAmount: quoteAmount.toString(),
    usedWalletQuote
  });

  if (usedWalletQuote) {
    logger.debug('[FourQuote] 复用现有募集币种余额', {
      token: tokenAddress,
      quoteToken,
      quoteAmount: quoteAmount.toString()
    });
  } else {
    logger.debug('[FourQuote] 使用新兑换的募集币种', {
      token: tokenAddress,
      quoteToken,
      quoteAmount: quoteAmount.toString()
    });
  }

  logger.debug(`[PrepareFourQuoteBuy] ✅ 总耗时: ${perf.measure(fnStart).toFixed(2)}ms`);

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
  const fnStart = perf.now();
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

  logger.debug('[FinalizeFourQuoteSell] 开始 Quote 卖出结算', {
    txHash,
    quoteToken: quoteToken.slice(0, 10),
    quoteBalanceBefore: quoteBalanceBefore.toString()
  });

  // 等待交易确认
  const waitStart = perf.now();
  let receipt: any;
  try {
    receipt = await publicClient.waitForTransactionReceipt({ hash: txHash });
    logger.debug(`[FinalizeFourQuoteSell] 交易确认完成 (${perf.measure(waitStart).toFixed(2)}ms)`, {
      status: receipt?.status
    });
  } catch (error) {
    logger.warn('[FourQuote] 等待卖出确认失败，自动兑换已取消:', error?.message || error);
    logger.debug(`[FinalizeFourQuoteSell] ❌ 失败耗时: ${perf.measure(fnStart).toFixed(2)}ms`);
    return { converted: false };
  }

  if (!receipt || receipt.status !== 'success') {
    logger.warn('[FourQuote] 卖出交易未成功，跳过自动兑换');
    logger.debug(`[FinalizeFourQuoteSell] ❌ 交易失败，总耗时: ${perf.measure(fnStart).toFixed(2)}ms`);
    return { converted: false };
  }

  // 等待余额结算
  const delayStart = perf.now();
  await delay(FOUR_QUOTE_SETTLE_DELAY);
  logger.debug(`[FinalizeFourQuoteSell] 余额结算延迟完成 (${perf.measure(delayStart).toFixed(2)}ms)`);

  // 查询新的 Quote 余额
  const balanceStart = perf.now();
  let received = 0n;
  const quoteLabel = resolveQuoteTokenName(quoteToken);
  logger.debug(`[FinalizeFourQuoteSell] 开始查询 ${quoteLabel} 余额变化 (最多 ${QUOTE_BALANCE_RETRY_MAX} 次)`);

  for (let attempt = 0; attempt < QUOTE_BALANCE_RETRY_MAX; attempt += 1) {
    const attemptStart = perf.now();
    const afterBalance = await getQuoteBalance(publicClient, quoteToken, walletAddress);
    logger.debug(`[FinalizeFourQuoteSell] 查询余额 ${attempt + 1}/${QUOTE_BALANCE_RETRY_MAX} (${perf.measure(attemptStart).toFixed(2)}ms)`, {
      afterBalance: afterBalance.toString(),
      beforeBalance: quoteBalanceBefore.toString()
    });

    if (afterBalance > quoteBalanceBefore) {
      received = afterBalance - quoteBalanceBefore;
      logger.debug(`[FinalizeFourQuoteSell] ✅ 检测到新的 ${quoteLabel}: ${received.toString()}`);
      break;
    }

    if (attempt < QUOTE_BALANCE_RETRY_MAX - 1) {
      logger.debug(`[FinalizeFourQuoteSell] 未检测到余额变化，等待 ${QUOTE_BALANCE_RETRY_DELAY}ms 后重试`);
      await delay(QUOTE_BALANCE_RETRY_DELAY);
    }
  }
  logger.debug(`[FinalizeFourQuoteSell] 余额查询完成 (${perf.measure(balanceStart).toFixed(2)}ms)`);

  if (received <= 0n) {
    logger.debug(`[FourQuote] 卖出后未检测到新的 ${quoteLabel}，跳过自动兑换`);
    logger.debug(`[FinalizeFourQuoteSell] ⚠️ 无新余额，总耗时: ${perf.measure(fnStart).toFixed(2)}ms`);
    return { converted: false };
  }

  // 兑换 Quote 为 BNB
  const swapStart = perf.now();
  logger.debug(`[FinalizeFourQuoteSell] 开始兑换 ${quoteLabel} 为 BNB`);
  try {
    await swapQuoteForBnb({
      quoteToken,
      amountIn: received,
      slippage,
      context: swapContext
    });
    logger.debug(`[FinalizeFourQuoteSell] 兑换完成 (${perf.measure(swapStart).toFixed(2)}ms)`);
    logger.debug(`[FinalizeFourQuoteSell] ✅ 总耗时: ${perf.measure(fnStart).toFixed(2)}ms`);
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
    logger.debug(`[FinalizeFourQuoteSell] ❌ 兑换失败 (${perf.measure(swapStart).toFixed(2)}ms)`);
    logger.debug(`[FinalizeFourQuoteSell] ❌ 总耗时: ${perf.measure(fnStart).toFixed(2)}ms`);
    return { converted: false };
  }
}
