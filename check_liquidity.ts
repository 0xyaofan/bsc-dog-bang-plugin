import { createPublicClient, http, formatUnits } from 'viem';
import { bsc } from 'viem/chains';

const RPC_ENDPOINTS = [
  'https://api.zan.top/node/v1/bsc/mainnet/9ca4f22e10234d7ab736c8a8dc2911a6/',
  'https://bsc-mainnet.nodereal.io/v1/cafa270f244d4dd0b3edd33c1665767f/',
  'https://bsc-dataseed.bnbchain.org/'
];

const client = createPublicClient({
  chain: bsc,
  transport: http(RPC_ENDPOINTS[0], {
    timeout: 30000,
    retryCount: 3
  })
});

const PAIR_ABI = [
  {
    constant: true,
    inputs: [],
    name: 'getReserves',
    outputs: [
      { internalType: 'uint112', name: 'reserve0', type: 'uint112' },
      { internalType: 'uint112', name: 'reserve1', type: 'uint112' },
      { internalType: 'uint32', name: 'blockTimestampLast', type: 'uint32' }
    ],
    payable: false,
    stateMutability: 'view',
    type: 'function'
  },
  {
    constant: true,
    inputs: [],
    name: 'token0',
    outputs: [{ internalType: 'address', name: '', type: 'address' }],
    payable: false,
    stateMutability: 'view',
    type: 'function'
  },
  {
    constant: true,
    inputs: [],
    name: 'token1',
    outputs: [{ internalType: 'address', name: '', type: 'address' }],
    payable: false,
    stateMutability: 'view',
    type: 'function'
  }
] as const;

const KDOG_WBNB_PAIR = '0xD995D5Dde44C49ea7aA712567fcA9ddaB842A1f1' as const;
const KDOG_KGST_PAIR = '0x14C90904dD8868c8E748e42D092250Ec17f748d1' as const;

const KDOG = '0x3753dd32cbc376ce6efd85f334b7289ae6d004af';
const WBNB = '0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c';
const KGST = '0x94be0bbA8E1E303fE998c9360B57b826F1A4f828';

async function checkPairLiquidity(
  pairAddress: `0x${string}`,
  pairName: string,
  token0Name: string,
  token1Name: string
) {
  console.log(`\n${'='.repeat(60)}`);
  console.log(`${pairName}`);
  console.log(`Pair Address: ${pairAddress}`);
  console.log(`${'='.repeat(60)}`);

  try {
    // Get token0 and token1
    const token0 = await client.readContract({
      address: pairAddress,
      abi: PAIR_ABI,
      functionName: 'token0'
    });

    const token1 = await client.readContract({
      address: pairAddress,
      abi: PAIR_ABI,
      functionName: 'token1'
    });

    console.log(`\nToken0: ${token0}`);
    console.log(`Token1: ${token1}`);

    // Get reserves
    const reserves = await client.readContract({
      address: pairAddress,
      abi: PAIR_ABI,
      functionName: 'getReserves'
    });

    const reserve0 = reserves[0];
    const reserve1 = reserves[1];

    console.log(`\nReserve0 (raw): ${reserve0.toString()}`);
    console.log(`Reserve1 (raw): ${reserve1.toString()}`);

    // Format reserves (assuming 18 decimals)
    const reserve0Formatted = formatUnits(reserve0, 18);
    const reserve1Formatted = formatUnits(reserve1, 18);

    console.log(`Reserve0 (formatted): ${reserve0Formatted}`);
    console.log(`Reserve1 (formatted): ${reserve1Formatted}`);

    // Determine which token is which
    let kdogReserve: string, otherReserve: string, otherTokenName: string;
    if (token0.toLowerCase() === KDOG.toLowerCase()) {
      kdogReserve = reserve0Formatted;
      otherReserve = reserve1Formatted;
      otherTokenName = token1Name;
      console.log(`\nKDOG is token0`);
    } else {
      kdogReserve = reserve1Formatted;
      otherReserve = reserve0Formatted;
      otherTokenName = token0Name;
      console.log(`\nKDOG is token1`);
    }

    console.log(`\n--- Liquidity Summary ---`);
    console.log(`KDOG Reserve: ${kdogReserve}`);
    console.log(`${otherTokenName} Reserve: ${otherReserve}`);

    return {
      pairName,
      token0,
      token1,
      reserve0: reserve0Formatted,
      reserve1: reserve1Formatted,
      kdogReserve,
      otherReserve,
      otherTokenName
    };
  } catch (error) {
    console.error(`Error querying ${pairName}:`, error);
    return null;
  }
}

async function main() {
  console.log('Checking liquidity for KDOG pairs...\n');
  console.log(`Using RPC: ${RPC_ENDPOINTS[0]}\n`);

  const kdogWbnbData = await checkPairLiquidity(
    KDOG_WBNB_PAIR,
    'KDOG/WBNB Pair (System Selected)',
    'KDOG',
    'WBNB'
  );

  const kdogKgstData = await checkPairLiquidity(
    KDOG_KGST_PAIR,
    'KDOG/KGST Pair (Correct Pair)',
    'KDOG',
    'KGST'
  );

  // Compare liquidity
  console.log(`\n${'='.repeat(60)}`);
  console.log('LIQUIDITY COMPARISON');
  console.log(`${'='.repeat(60)}`);

  if (kdogWbnbData && kdogKgstData) {
    console.log(`\nKDOG/WBNB Pair:`);
    console.log(`  KDOG: ${kdogWbnbData.kdogReserve}`);
    console.log(`  WBNB: ${kdogWbnbData.otherReserve}`);

    console.log(`\nKDOG/KGST Pair:`);
    console.log(`  KDOG: ${kdogKgstData.kdogReserve}`);
    console.log(`  KGST: ${kdogKgstData.otherReserve}`);

    const kdogWbnb = parseFloat(kdogWbnbData.kdogReserve);
    const kdogKgst = parseFloat(kdogKgstData.kdogReserve);

    console.log(`\n--- KDOG Reserve Comparison ---`);
    console.log(`KDOG/WBNB: ${kdogWbnb.toFixed(2)} KDOG`);
    console.log(`KDOG/KGST: ${kdogKgst.toFixed(2)} KDOG`);

    if (kdogKgst > kdogWbnb) {
      const ratio = (kdogKgst / kdogWbnb).toFixed(2);
      console.log(`\n✓ KDOG/KGST has ${ratio}x more KDOG liquidity`);
      console.log(`✓ KDOG/KGST should be selected (correct pair)`);
    } else {
      const ratio = (kdogWbnb / kdogKgst).toFixed(2);
      console.log(`\n✗ KDOG/WBNB has ${ratio}x more KDOG liquidity`);
      console.log(`✗ System selection might be correct based on KDOG reserves`);
    }
    
    console.log(`\n--- Analysis ---`);
    console.log(`If KDOG/KGST has more liquidity but system selected KDOG/WBNB,`);
    console.log(`this indicates a bug in the pair selection logic.`);
  }
}

main().catch(console.error);
