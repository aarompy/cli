import { describe, expect, it } from "bun:test";
import { TokenType, type TokenBalancesAllTxidVersions } from "@railgun-community/engine";
import {
  FIBER_EVM_CHAINS,
  FIBER_PRIVATE_DEPLOYMENTS,
  FIBER_SOLANA_CHAIN,
} from "../src/chains.ts";
import {
  aggregatePrivateAssets,
  getRailgunNetwork,
  validateRpcUrl,
} from "../src/private-assets.ts";

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
    expect(() => getRailgunNetwork(56)).toThrow("Chain 56 is not supported by Fiber");
  });

  it("declares the Solana recovery chain independently of EVM scans", () => {
    expect(FIBER_SOLANA_CHAIN).toEqual({
      chainId: 101,
      name: "Solana",
      privateAssets: false,
    });
  });
});
