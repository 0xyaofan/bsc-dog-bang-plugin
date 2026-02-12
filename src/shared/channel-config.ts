import { CONTRACTS } from './config/index.js';

const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000';

type FourQuoteTokenEntry = {
  address: string;
  label: string;
};

const BUILTIN_FOUR_QUOTE_TOKENS: FourQuoteTokenEntry[] = [
  { address: CONTRACTS.CAKE ?? '', label: 'CAKE' },
  { address: CONTRACTS.USDT ?? '', label: 'USDT' },
  { address: CONTRACTS.USDC ?? '', label: 'USDC' },
  { address: CONTRACTS.USD1 ?? '', label: 'USD1' },
  { address: CONTRACTS.ASTER ?? '', label: 'ASTER' },
  { address: CONTRACTS.UNITED_STABLES_U ?? '', label: 'United Stables (U)' },
  { address: CONTRACTS.KGST ?? '', label: 'KGST' },
  { address: CONTRACTS.lisUSD ?? '', label: 'lisUSD' }
].filter((entry) => Boolean(entry.address));

const BASE_BRIDGE_TOKENS = [
  CONTRACTS.BUSD ?? '',
  CONTRACTS.USDT ?? '',
  CONTRACTS.USDC ?? '',
  CONTRACTS.USD1 ?? ''
].filter(Boolean);

const addressRegex = /^0x[a-fA-F0-9]{40}$/;

function normalizeAddress(value?: string | null) {
  if (typeof value !== 'string') {
    return null;
  }
  const trimmed = value.trim();
  if (!addressRegex.test(trimmed)) {
    return null;
  }
  return trimmed.toLowerCase();
}

function dedupeAddresses(addresses: string[]) {
  const seen = new Set<string>();
  const result: string[] = [];
  addresses.forEach((address) => {
    const normalized = normalizeAddress(address);
    if (!normalized || normalized === ZERO_ADDRESS) {
      return;
    }
    if (seen.has(normalized)) {
      return;
    }
    seen.add(normalized);
    result.push(`0x${normalized.slice(2)}`);
  });
  return result;
}

export const DEFAULT_FOUR_QUOTE_TOKENS = dedupeAddresses(
  BUILTIN_FOUR_QUOTE_TOKENS.map((entry) => entry.address)
);

let fourQuoteTokenList = DEFAULT_FOUR_QUOTE_TOKENS.slice();

export function setFourQuoteTokenList(addresses: string[]) {
  const normalized = dedupeAddresses(addresses.length ? addresses : DEFAULT_FOUR_QUOTE_TOKENS);
  fourQuoteTokenList = normalized.length > 0 ? normalized : DEFAULT_FOUR_QUOTE_TOKENS.slice();
}

export function getFourQuoteTokenList(): string[] {
  return fourQuoteTokenList.slice();
}

export function resolveFourQuoteTokenLabel(address?: string | null): string {
  const normalized = normalizeAddress(address);
  if (!normalized || normalized === ZERO_ADDRESS) {
    return 'BNB';
  }
  const builtin = BUILTIN_FOUR_QUOTE_TOKENS.find(
    (entry) => normalizeAddress(entry.address) === normalized
  );
  if (builtin?.label) {
    return builtin.label;
  }
  return `代币(${normalized.slice(0, 6)}...${normalized.slice(-4)})`;
}

export function getFourBridgeTokenList(): string[] {
  const bridgeBase = dedupeAddresses(BASE_BRIDGE_TOKENS);
  return dedupeAddresses([...bridgeBase, ...fourQuoteTokenList]);
}

export function getFourHelperTokenList(): string[] {
  return getFourQuoteTokenList();
}

