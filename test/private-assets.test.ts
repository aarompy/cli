import { describe, expect, it } from "bun:test";
import { TokenType, type TokenBalancesAllTxidVersions } from "@railgun-community/engine";
import {
  FIBER_EVM_CHAINS,
  FIBER_PRIVATE_DEPLOYMENTS,
  FIBER_SOLANA_CHAIN,
  getFiberPrivateDeployment,
} from "../src/chains.ts";
import {
  aggregatePrivateAssets,
  getRailgunNetwork,
  listPrivateAssets,
  validateRpcUrl,
} from "../src/private-assets.ts";

type RpcCall = {
  id: number;
  method: string;
  params: { address?: string; fromBlock?: string; toBlock?: string; to?: string; data?: string }[];
};

// rootHistory(uint256,bytes32): the engine checks each synced root against the pool.
const ROOT_HISTORY_SELECTOR = "0xc718dbda";

/**
 * Serves just enough Arbitrum JSON-RPC for one scan and records every log range it was asked for.
 * With refuseLogs set, eth_getLogs fails the way public RPCs refuse archive reads.
 */
function startArbitrumRpc({ refuseLogs }: { refuseLogs: boolean }) {
  const deployment = getFiberPrivateDeployment(42161)!;
  const head = deployment.deploymentBlock + 12_000;
  const logRequests: { address: string; fromBlock: number; toBlock: number }[] = [];

  const reply = (call: RpcCall) => {
    if (call.method === "eth_chainId") return { jsonrpc: "2.0", id: call.id, result: "0xa4b1" };
    if (call.method === "eth_blockNumber") {
      return { jsonrpc: "2.0", id: call.id, result: `0x${head.toString(16)}` };
    }
    const callTarget = call.params[0];
    if (
      call.method === "eth_call" &&
      callTarget?.to?.toLowerCase() === deployment.proxy.toLowerCase() &&
      callTarget.data?.startsWith(ROOT_HISTORY_SELECTOR)
    ) {
      // An empty pool's history includes the empty tree's root.
      return { jsonrpc: "2.0", id: call.id, result: `0x${"0".repeat(63)}1` };
    }
    if (call.method === "eth_getLogs") {
      const filter = call.params[0]!;
      logRequests.push({
        address: filter.address!.toLowerCase(),
        fromBlock: Number(filter.fromBlock),
        toBlock: Number(filter.toBlock),
      });
      return refuseLogs
        ? { jsonrpc: "2.0", id: call.id, error: { code: -32602, message: "Archive requests require a token" } }
        : { jsonrpc: "2.0", id: call.id, result: [] };
    }
    return { jsonrpc: "2.0", id: call.id, error: { code: -32601, message: `Unexpected ${call.method}` } };
  };

  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    async fetch(request) {
      const body = (await request.json()) as RpcCall | RpcCall[];
      return Response.json(Array.isArray(body) ? body.map(reply) : reply(body));
    },
  });
  return { server, deployment, head, logRequests, rpcUrl: `http://127.0.0.1:${server.port}` };
}

describe("private asset output", () => {
  it("includes and combines ERC-20, ERC-721, and ERC-1155 balances", () => {
    const balances = {
      V2: {
        usdc: {
          balance: 10n,
          tokenData: { tokenType: TokenType.ERC20, tokenAddress: "0x0000000000000000000000001111111111111111111111111111111111111111", tokenSubID: "0" },
          utxos: [],
        },
        nft: {
          balance: 1n,
          tokenData: { tokenType: TokenType.ERC721, tokenAddress: "0x2222222222222222222222222222222222222222", tokenSubID: "0x2a" },
          utxos: [],
        },
      },
      V3: {
        usdc: {
          balance: 5n,
          tokenData: { tokenType: TokenType.ERC20, tokenAddress: "0x1111111111111111111111111111111111111111", tokenSubID: "0" },
          utxos: [],
        },
        multiToken: {
          balance: 3n,
          tokenData: { tokenType: TokenType.ERC1155, tokenAddress: "0x3333333333333333333333333333333333333333", tokenSubID: "7" },
          utxos: [],
        },
      },
    } satisfies TokenBalancesAllTxidVersions;

    expect(aggregatePrivateAssets(balances)).toEqual([
      { type: "ERC1155", address: "0x3333333333333333333333333333333333333333", tokenId: "7", rawAmount: "3" },
      { type: "ERC20", address: "0x1111111111111111111111111111111111111111", tokenId: null, rawAmount: "15" },
      { type: "ERC721", address: "0x2222222222222222222222222222222222222222", tokenId: "42", rawAmount: "1" },
    ]);
  });

  it("rejects non-HTTP RPC transports", () => {
    expect(() => validateRpcUrl("file:///tmp/provider")).toThrow("must use http or https");
  });

  it("maps every declared private chain to a Railgun network", () => {
    for (const chain of FIBER_EVM_CHAINS) {
      if (chain.privateAssets) {
        expect(getRailgunNetwork(chain.chainId).chain.id).toBe(chain.chainId);
      } else {
        expect(() => getRailgunNetwork(chain.chainId)).toThrow(
          `Fiber private assets are not available on ${chain.name}`,
        );
      }
    }
  });

  it("uses every declared Fiber deployment and its full history", () => {
    for (const deployment of FIBER_PRIVATE_DEPLOYMENTS) {
      const network = getRailgunNetwork(deployment.chainId);
      expect(network.proxyContract.toLowerCase()).toBe(deployment.proxy.toLowerCase());
      expect(network.deploymentBlock).toBe(deployment.deploymentBlock);
    }
  });

  it("rejects Railgun chains that the Fiber backend does not support", () => {
    expect(() => getRailgunNetwork(10)).toThrow("Chain 10 is not supported by Fiber");
  });

  it("reads Fiber's Arbitrum pool from its deployment block to the chain head", async () => {
    const rpc = startArbitrumRpc({ refuseLogs: false });
    try {
      const scan = await listPrivateAssets({ seed: new Uint8Array(32).fill(0x42), rpcUrl: rpc.rpcUrl });

      expect(scan).toEqual({ chainId: 42161, network: "Arbitrum", assets: [] });
      expect([...new Set(rpc.logRequests.map(({ address }) => address))]).toEqual([
        rpc.deployment.proxy.toLowerCase(),
      ]);
      expect(Math.min(...rpc.logRequests.map(({ fromBlock }) => fromBlock))).toBe(
        rpc.deployment.deploymentBlock,
      );
      expect(Math.max(...rpc.logRequests.map(({ toBlock }) => toBlock))).toBe(rpc.head);
    } finally {
      await rpc.server.stop(true);
    }
  });

  it("fails instead of reporting an empty wallet when the RPC refuses old logs", async () => {
    const rpc = startArbitrumRpc({ refuseLogs: true });
    try {
      // Bun's expect().rejects waits out the engine's leftover timers (~6 s); capture the error instead.
      const error = await listPrivateAssets({
        seed: new Uint8Array(32).fill(0x42),
        rpcUrl: rpc.rpcUrl,
      }).then(
        () => undefined,
        (caught: unknown) => caught,
      );

      expect(error).toBeInstanceOf(Error);
      expect((error as Error).message).toContain("stopped before reading the pool's full history");
      expect(rpc.logRequests.length).toBeGreaterThan(0);
    } finally {
      await rpc.server.stop(true);
    }
  });

  it("declares the Solana recovery chain independently of EVM scans", () => {
    expect(FIBER_SOLANA_CHAIN).toEqual({
      chainId: 101,
      name: "Solana",
      privateAssets: false,
    });
  });
});
