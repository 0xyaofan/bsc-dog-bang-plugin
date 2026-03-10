#!/bin/bash

RPC="https://bsc-dataseed1.binance.org"

KDOG_WBNB_PAIR="0xD995D5Dde44C49ea7aA712567fcA9ddaB842A1f1"
KDOG_KGST_PAIR="0x14C90904dD8868c8E748e42D092250Ec17f748d1"

KDOG="0x3753dd32cbc376ce6efd85f334b7289ae6d004af"
WBNB="0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c"
KGST="0x94be0bbA8E1E303fE998c9360B57b826F1A4f828"

echo "============================================================"
echo "Checking KDOG/WBNB Pair (System Selected)"
echo "Pair Address: $KDOG_WBNB_PAIR"
echo "============================================================"

# Get token0 for KDOG/WBNB
echo -e "\nQuerying token0..."
TOKEN0_WBNB=$(curl -s -X POST $RPC \
  -H "Content-Type: application/json" \
  -d '{
    "jsonrpc":"2.0",
    "method":"eth_call",
    "params":[{
      "to":"'$KDOG_WBNB_PAIR'",
      "data":"0x0dfe1681"
    },"latest"],
    "id":1
  }' | grep -o '"result":"[^"]*"' | cut -d'"' -f4)

echo "Token0 (raw): $TOKEN0_WBNB"
TOKEN0_WBNB_ADDR="0x${TOKEN0_WBNB:26:40}"
echo "Token0: $TOKEN0_WBNB_ADDR"

# Get token1 for KDOG/WBNB
echo -e "\nQuerying token1..."
TOKEN1_WBNB=$(curl -s -X POST $RPC \
  -H "Content-Type: application/json" \
  -d '{
    "jsonrpc":"2.0",
    "method":"eth_call",
    "params":[{
      "to":"'$KDOG_WBNB_PAIR'",
      "data":"0xd21220a7"
    },"latest"],
    "id":1
  }' | grep -o '"result":"[^"]*"' | cut -d'"' -f4)

echo "Token1 (raw): $TOKEN1_WBNB"
TOKEN1_WBNB_ADDR="0x${TOKEN1_WBNB:26:40}"
echo "Token1: $TOKEN1_WBNB_ADDR"

# Get reserves for KDOG/WBNB
echo -e "\nQuerying reserves..."
RESERVES_WBNB=$(curl -s -X POST $RPC \
  -H "Content-Type: application/json" \
  -d '{
    "jsonrpc":"2.0",
    "method":"eth_call",
    "params":[{
      "to":"'$KDOG_WBNB_PAIR'",
      "data":"0x0902f1ac"
    },"latest"],
    "id":1
  }' | grep -o '"result":"[^"]*"' | cut -d'"' -f4)

echo "Reserves (raw): $RESERVES_WBNB"
RESERVE0_WBNB_HEX="0x${RESERVES_WBNB:2:32}"
RESERVE1_WBNB_HEX="0x${RESERVES_WBNB:34:32}"
echo "Reserve0 (hex): $RESERVE0_WBNB_HEX"
echo "Reserve1 (hex): $RESERVE1_WBNB_HEX"

RESERVE0_WBNB_DEC=$((16#${RESERVES_WBNB:2:32}))
RESERVE1_WBNB_DEC=$((16#${RESERVES_WBNB:34:32}))
echo "Reserve0 (wei): $RESERVE0_WBNB_DEC"
echo "Reserve1 (wei): $RESERVE1_WBNB_DEC"

echo -e "\n============================================================"
echo "Checking KDOG/KGST Pair (Correct Pair)"
echo "Pair Address: $KDOG_KGST_PAIR"
echo "============================================================"

# Get token0 for KDOG/KGST
echo -e "\nQuerying token0..."
TOKEN0_KGST=$(curl -s -X POST $RPC \
  -H "Content-Type: application/json" \
  -d '{
    "jsonrpc":"2.0",
    "method":"eth_call",
    "params":[{
      "to":"'$KDOG_KGST_PAIR'",
      "data":"0x0dfe1681"
    },"latest"],
    "id":1
  }' | grep -o '"result":"[^"]*"' | cut -d'"' -f4)

echo "Token0 (raw): $TOKEN0_KGST"
TOKEN0_KGST_ADDR="0x${TOKEN0_KGST:26:40}"
echo "Token0: $TOKEN0_KGST_ADDR"

# Get token1 for KDOG/KGST
echo -e "\nQuerying token1..."
TOKEN1_KGST=$(curl -s -X POST $RPC \
  -H "Content-Type: application/json" \
  -d '{
    "jsonrpc":"2.0",
    "method":"eth_call",
    "params":[{
      "to":"'$KDOG_KGST_PAIR'",
      "data":"0xd21220a7"
    },"latest"],
    "id":1
  }' | grep -o '"result":"[^"]*"' | cut -d'"' -f4)

echo "Token1 (raw): $TOKEN1_KGST"
TOKEN1_KGST_ADDR="0x${TOKEN1_KGST:26:40}"
echo "Token1: $TOKEN1_KGST_ADDR"

# Get reserves for KDOG/KGST
echo -e "\nQuerying reserves..."
RESERVES_KGST=$(curl -s -X POST $RPC \
  -H "Content-Type: application/json" \
  -d '{
    "jsonrpc":"2.0",
    "method":"eth_call",
    "params":[{
      "to":"'$KDOG_KGST_PAIR'",
      "data":"0x0902f1ac"
    },"latest"],
    "id":1
  }' | grep -o '"result":"[^"]*"' | cut -d'"' -f4)

echo "Reserves (raw): $RESERVES_KGST"
RESERVE0_KGST_HEX="0x${RESERVES_KGST:2:32}"
RESERVE1_KGST_HEX="0x${RESERVES_KGST:34:32}"
echo "Reserve0 (hex): $RESERVE0_KGST_HEX"
echo "Reserve1 (hex): $RESERVE1_KGST_HEX"

RESERVE0_KGST_DEC=$((16#${RESERVES_KGST:2:32}))
RESERVE1_KGST_DEC=$((16#${RESERVES_KGST:34:32}))
echo "Reserve0 (wei): $RESERVE0_KGST_DEC"
echo "Reserve1 (wei): $RESERVE1_KGST_DEC"

echo -e "\n============================================================"
echo "LIQUIDITY COMPARISON"
echo "============================================================"

# Determine which reserve is KDOG for each pair
if [ "${TOKEN0_WBNB_ADDR,,}" = "${KDOG,,}" ]; then
  KDOG_RESERVE_WBNB=$RESERVE0_WBNB_DEC
  OTHER_RESERVE_WBNB=$RESERVE1_WBNB_DEC
  echo -e "\nKDOG/WBNB: KDOG is token0"
else
  KDOG_RESERVE_WBNB=$RESERVE1_WBNB_DEC
  OTHER_RESERVE_WBNB=$RESERVE0_WBNB_DEC
  echo -e "\nKDOG/WBNB: KDOG is token1"
fi

if [ "${TOKEN0_KGST_ADDR,,}" = "${KDOG,,}" ]; then
  KDOG_RESERVE_KGST=$RESERVE0_KGST_DEC
  OTHER_RESERVE_KGST=$RESERVE1_KGST_DEC
  echo "KDOG/KGST: KDOG is token0"
else
  KDOG_RESERVE_KGST=$RESERVE1_KGST_DEC
  OTHER_RESERVE_KGST=$RESERVE0_KGST_DEC
  echo "KDOG/KGST: KDOG is token1"
fi

echo -e "\n--- KDOG Reserves (in wei) ---"
echo "KDOG/WBNB: $KDOG_RESERVE_WBNB wei"
echo "KDOG/KGST: $KDOG_RESERVE_KGST wei"

# Convert to human readable (divide by 10^18)
KDOG_WBNB_HUMAN=$(echo "scale=2; $KDOG_RESERVE_WBNB / 1000000000000000000" | bc)
KDOG_KGST_HUMAN=$(echo "scale=2; $KDOG_RESERVE_KGST / 1000000000000000000" | bc)

echo -e "\n--- KDOG Reserves (human readable) ---"
echo "KDOG/WBNB: $KDOG_WBNB_HUMAN KDOG"
echo "KDOG/KGST: $KDOG_KGST_HUMAN KDOG"

# Compare
if [ "$KDOG_RESERVE_KGST" -gt "$KDOG_RESERVE_WBNB" ]; then
  RATIO=$(echo "scale=2; $KDOG_RESERVE_KGST / $KDOG_RESERVE_WBNB" | bc)
  echo -e "\n✓ KDOG/KGST has ${RATIO}x more KDOG liquidity"
  echo "✓ KDOG/KGST should be selected (correct pair)"
else
  RATIO=$(echo "scale=2; $KDOG_RESERVE_WBNB / $KDOG_RESERVE_KGST" | bc)
  echo -e "\n✗ KDOG/WBNB has ${RATIO}x more KDOG liquidity"
  echo "✗ System selection might be correct based on KDOG reserves"
fi

# Also show the other token reserves
OTHER_WBNB_HUMAN=$(echo "scale=4; $OTHER_RESERVE_WBNB / 1000000000000000000" | bc)
OTHER_KGST_HUMAN=$(echo "scale=2; $OTHER_RESERVE_KGST / 1000000000000000000" | bc)

echo -e "\n--- Other Token Reserves ---"
echo "KDOG/WBNB - WBNB: $OTHER_WBNB_HUMAN WBNB"
echo "KDOG/KGST - KGST: $OTHER_KGST_HUMAN KGST"
