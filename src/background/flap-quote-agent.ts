import { CONTRACTS } from '../shared/trading-config.js';
import {
  isBnbQuote,
  prepareQuoteFunds,
  type SwapContext
} from './four-quote-bridge.js';

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
  const { tokenAddress, amountInWei, slippage, quoteToken, swapContext, publicClient, walletAddress } = params;
  return await prepareQuoteFunds({
    tokenAddress,
    quoteToken,
    amountInWei,
    slippage,
    spender: CONTRACTS.FLAP_PORTAL,
    swapContext,
    publicClient,
    walletAddress
  });
}
