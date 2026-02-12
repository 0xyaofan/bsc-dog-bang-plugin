import { CONTRACTS } from '../shared/config/index.js';
import {
  isBnbQuote,
  prepareQuoteFunds,
  type SwapContext
} from './four-quote-bridge.js';
import { logger } from '../shared/logger.js';
import { perf } from '../shared/performance.js';

export type FlapQuoteRouteInfo = {
  quoteToken?: string;
  readyForPancake?: boolean;
  platform?: string;
  metadata?: {
    nativeToQuoteSwapEnabled?: boolean;
    [key: string]: any;
  };
};

export function shouldUseFlapQuote(routeInfo?: FlapQuoteRouteInfo | null, channelId?: string) {
  if (!routeInfo) {
    return false;
  }
  if (channelId !== 'flap') {
    return false;
  }
  if (routeInfo.metadata?.nativeToQuoteSwapEnabled) {
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

type PrepareFlapQuoteParams = {
  tokenAddress: string;
  amountInWei: bigint;
  slippage: number;
  quoteToken: string;
  swapContext: SwapContext;
  publicClient: any;
  walletAddress: string;
};

export async function prepareFlapQuoteBuy(params: PrepareFlapQuoteParams) {
  const fnStart = perf.now();
  const { tokenAddress, amountInWei, slippage, quoteToken, swapContext, publicClient, walletAddress } = params;

  logger.debug('[PrepareFlapQuoteBuy] 开始准备 Flap Quote 买入', {
    tokenAddress: tokenAddress.slice(0, 10),
    amountInWei: amountInWei.toString(),
    quoteToken: quoteToken.slice(0, 10)
  });

  const prepareStart = perf.now();
  const result = await prepareQuoteFunds({
    tokenAddress,
    quoteToken,
    amountInWei,
    slippage,
    spender: CONTRACTS.FLAP_PORTAL,
    swapContext,
    publicClient,
    walletAddress
  });
  logger.debug(`[PrepareFlapQuoteBuy] Quote 资金准备完成 (${perf.measure(prepareStart).toFixed(2)}ms)`, {
    quoteAmount: result.quoteAmount.toString(),
    usedWalletQuote: result.usedWalletQuote
  });

  logger.debug(`[PrepareFlapQuoteBuy] ✅ 总耗时: ${perf.measure(fnStart).toFixed(2)}ms`);

  return result;
}
