import { ethers } from "ethers";
import fs from "fs";
import axios from "axios";

// —— 配置 —— //

const RPC_URL = "https://api.zan.top/node/v1/bsc/mainnet/9ca4f22e10234d7ab736c8a8dc2911a6/";

const provider = new ethers.JsonRpcProvider(RPC_URL);

// 要查询的代币
const TOKEN = "0xe747e54783ba3f77a8e5251a3cba19ebe9c0e197";

// PancakeSwap 工具合约
const FACTORY_V2 = "0xca143ce32fe78f1f7019d7d551a6402fc5350c73";
const FACTORY_V3 = "0x0BFbCF9fa4f9C56B0F40a671Ad40E0805A091865";

// ERC20 ABI (必要部分)
const ERC20_ABI = [
  "function symbol() view returns (string)",
  "function decimals() view returns (uint8)",
  "function balanceOf(address) view returns (uint)",
];

// PancakeSwap V2 Factory ABI (仅需 getPair)
const FACTORY_V2_ABI = [
  "function getPair(address tokenA, address tokenB) external view returns (address pair)"
];

// PancakeSwap V2 Pair ABI (必要部分)
const PAIR_V2_ABI = [
  "function getReserves() view returns (uint112 reserve0, uint112 reserve1, uint32 blockTimestampLast)",
  "function token0() view returns (address)",
  "function token1() view returns (address)",
];

// PancakeSwap V3 Factory ABI
const FACTORY_V3_ABI = [
  "function getPool(address tokenA, address tokenB, uint24 fee) external view returns (address pool)"
];

// PancakeSwap V3 Pool ABI
const POOL_V3_ABI = [
  "function liquidity() view returns (uint128)",
  "function slot0() view returns (uint160 sqrtPriceX96, int24 tick, uint16 observationIndex,uint16 observationCardinality,uint16 observationCardinalityNext,uint8 feeProtocol,bool unlocked)",
];

// 常见 Fee 级别
const FEE_TIERS = [500, 3000, 10000];

async function check() {
  // 加载 Factory
  const factoryV2 = new ethers.Contract(FACTORY_V2, FACTORY_V2_ABI, provider);
  const factoryV3 = new ethers.Contract(FACTORY_V3, FACTORY_V3_ABI, provider);

  let results = {
    v2: [],
    v3: []
  };

  // 检查 V2（对所有基础资产）
  const BASES_V2 = [
    "0x55d398326f99059ff775485246999027b3197955", // USDT
    "0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c"  // WBNB
  ];
  
  for (let base of BASES_V2) {
    let pairAddr = await factoryV2.getPair(TOKEN, base);

    if (pairAddr && pairAddr !== ethers.ZeroAddress) {
      const pair = new ethers.Contract(pairAddr, PAIR_V2_ABI, provider);
      const [res0, res1] = await pair.getReserves();

      results.v2.push({
        pair: pairAddr,
        reserve0: res0.toString(),
        reserve1: res1.toString()
      });
    }
  }

  // 检查 V3（用 3 个 Fee 级别）
  for (let base of BASES_V2) {
    for (let fee of FEE_TIERS) {
      let poolAddr = await factoryV3.getPool(TOKEN, base, fee);

      if (poolAddr && poolAddr !== ethers.ZeroAddress) {
        const pool = new ethers.Contract(poolAddr, POOL_V3_ABI, provider);
        const liq = await pool.liquidity();
        results.v3.push({
          pool: poolAddr,
          fee,
          liquidity: liq.toString()
        });
      }
    }
  }

  console.log("===== Liquidity Check =====");
  console.log("V2 pools:", results.v2);
  console.log("V3 pools:", results.v3);
}

check().catch(console.error);
