#!/usr/bin/env node
/**
 * 简单的命令行脚本，用于快速查看代币在 Four.meme/Pancake 的状态。
 * 用法:
 *    node scripts/inspect-token.js <tokenAddress>
 */

import { createPublicClient, http, getAddress } from 'viem';
import { bsc } from 'viem/chains';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const RPC_URL = 'https://bsc-mainnet.nodereal.io/v1/cafa270f244d4dd0b3edd33c1665767f/';

const ADDRESSES = {
  FOUR_HELPER_V3: getAddress('0xF251F83e40a78868FcfA3FA4599Dad6494E46034'),
  LUNA_FUN_LAUNCHPAD: getAddress('0x7fdC3c5c4eC798150462D040526B6A89190b459c'),
  FLAP_PORTAL: getAddress('0xe2cE6ab80874Fa9Fa2aAE65D277Dd6B8e65C9De0'),
  PANCAKE_FACTORY: getAddress('0xCa143Ce32Fe78f1f7019d7d551a6402fC5350c73')
};

const PANCAKE_QUOTES = [
  '0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c', // WBNB
  '0x55d398326f99059fF775485246999027B3197955', // USDT
  '0xe9e7CEA3DedcA5984780Bafc599bD69ADd087D56', // BUSD
  '0x0E09FaBB73Bd3Ade0a17ECC321fD13a19e81cE82', // CAKE
  '0x000Ae314E2A2172a039B26378814C252734f556A', // ASTER
  '0x8d0D000Ee44948FC98c9B98A4FA4921476f08B0d', // USD1
  '0xcE24439F2D9C6a2289F741120FE202248B666666'  // United Stables (U)
].map((addr) => getAddress(addr));

function loadJson(relativePath) {
  const filePath = join(__dirname, '..', relativePath);
  return JSON.parse(readFileSync(filePath, 'utf8'));
}

const helperAbi = loadJson('abis/token-manager-helper-v3.json');
const lunaAbi = loadJson('abis/luna-fun-launchpad.json');
const flapAbi = loadJson('abis/flap-portal.json');
const pancakeFactoryAbi = loadJson('abis/pancake-factory.json');

const client = createPublicClient({
  chain: bsc,
  transport: http(RPC_URL)
});

function formatStruct(struct) {
  if (Array.isArray(struct)) {
    return struct.map((value) => (typeof value === 'bigint' ? value.toString() : value));
  }
  const formatted = {};
  Object.entries(struct ?? {}).forEach(([key, value]) => {
    formatted[key] = typeof value === 'bigint' ? value.toString() : value;
  });
  return formatted;
}

async function inspectToken(token) {
  console.log('=== Inspect Token ===');
  console.log('Token:', token);

  try {
    const info = await client.readContract({
      address: ADDRESSES.FOUR_HELPER_V3,
      abi: helperAbi,
      functionName: 'getTokenInfo',
      args: [token]
    });
    console.log('\n[Four.meme helper] getTokenInfo ->');
    console.log(formatStruct(info));
  } catch (error) {
    console.error('\n[Four.meme helper] 调用失败:', error?.shortMessage || error?.message || error);
  }

  try {
    const info = await client.readContract({
      address: ADDRESSES.LUNA_FUN_LAUNCHPAD,
      abi: lunaAbi,
      functionName: 'tokenInfo',
      args: [token]
    });
    console.log('\n[Luna.fun launchpad] tokenInfo ->');
    console.log(formatStruct(info));
  } catch (error) {
    console.error('\n[Luna.fun launchpad] 调用失败:', error?.shortMessage || error?.message || error);
  }

  const flapReaders = ['getTokenV7', 'getTokenV6', 'getTokenV5', 'getTokenV4', 'getTokenV3', 'getTokenV2'];
  console.log('\n[Flap Portal] token state ->');
  let flapState = null;
  for (const fn of flapReaders) {
    try {
      const result = await client.readContract({
        address: ADDRESSES.FLAP_PORTAL,
        abi: flapAbi,
        functionName: fn,
        args: [token]
      });
      flapState = result?.state ?? result ?? null;
      console.log(`  • ${fn}:`, formatStruct(flapState));
      break;
    } catch (error) {
      const msg = error?.shortMessage || error?.message || '';
      if (msg && msg.includes('TokenNotFound')) {
        console.log(`  • ${fn}: TokenNotFound`);
        flapState = null;
        break;
      }
    }
  }
  if (!flapState) {
    console.log('  (无有效 state，可能不属于 Flap)');
  }

  console.log('\n[Pancake Factory] getPair candidates:');
  for (const quote of PANCAKE_QUOTES) {
    try {
      const pair = await client.readContract({
        address: ADDRESSES.PANCAKE_FACTORY,
        abi: pancakeFactoryAbi,
        functionName: 'getPair',
        args: [token, quote]
      });
      console.log(`  - pair(${token}, ${quote}) = ${pair}`);
    } catch (error) {
      console.log(
        `  - pair(${token}, ${quote}) 调用失败:`,
        error?.shortMessage || error?.message || error
      );
    }
  }
}

async function main() {
  const [, , tokenArg] = process.argv;
  if (!tokenArg) {
    console.error('用法: node --input-type=module scripts/inspect-token.js <tokenAddress>');
    process.exit(1);
  }

  let token;
  try {
    token = getAddress(tokenArg);
  } catch {
    console.error('无效的代币地址:', tokenArg);
    process.exit(1);
  }

  await inspectToken(token);
}

main().catch((error) => {
  console.error('脚本执行失败:', error);
  process.exitCode = 1;
});
