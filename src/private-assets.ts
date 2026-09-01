import { randomBytes } from "node:crypto";
import {
  PollingJsonRpcProvider,
  RailgunEngine,
  TokenType,
  TXIDVersion,
  WalletBalanceBucket,
  type TokenBalancesAllTxidVersions,
} from "@railgun-community/engine";
import { NETWORK_CONFIG, type Network } from "@railgun-community/shared-models";
import { entropyToMnemonic } from "@scure/bip39";
import { wordlist } from "@scure/bip39/wordlists/english.js";
import memdown from "memdown";
import { getFiberEvmChain, getFiberPrivateDeployment } from "./chains.ts";

export type PrivateAsset = {
  type: "ERC20" | "ERC721" | "ERC1155";
  address: string;
  tokenId: string | null;
  rawAmount: string;
};

export type PrivateAssetScan = {
  chainId: number;
  network: string;
  assets: PrivateAsset[];
};

const TOKEN_TYPE_NAMES: Record<TokenType, PrivateAsset["type"]> = {
  [TokenType.ERC20]: "ERC20",
  [TokenType.ERC721]: "ERC721",
  [TokenType.ERC1155]: "ERC1155",
};

/**
 * Validates an explicit HTTP RPC URL before any wallet material is decrypted or scanned.
 * It accepts only a CLI-provided value and never consults environment variables.
 */
export function validateRpcUrl(rpcUrl: string): void {
  let parsedUrl: URL;
  try {
    parsedUrl = new URL(rpcUrl);
  } catch {
    throw new Error("--rpc-url must be a valid URL");
  }
  if (parsedUrl.protocol !== "https:" && parsedUrl.protocol !== "http:") {
    throw new Error("--rpc-url must use http or https");
  }
}

/**
 * Queries the supplied endpoint for its chain ID without trying a secondary provider.
 * It accepts one validated RPC URL and rejects malformed or timed-out responses.
 */
export async function getRpcChainId(rpcUrl: string): Promise<number> {
  validateRpcUrl(rpcUrl);
  let response: Response;
  try {
    response = await fetch(rpcUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_chainId", params: [] }),
      signal: AbortSignal.timeout(15_000),
    });
  } catch {
    // Do not echo an RPC URL because it can contain a provider credential.
    throw new Error("Could not connect to the supplied RPC");
  }
  if (!response.ok) throw new Error(`RPC returned HTTP ${response.status}`);

  const payload = (await response.json()) as { result?: unknown; error?: { message?: string } };
  if (typeof payload.result !== "string" || !/^0x[0-9a-f]+$/i.test(payload.result)) {
    throw new Error(payload.error?.message ? "RPC rejected eth_chainId" : "RPC returned an invalid chain ID");
  }

  const chainId = Number.parseInt(payload.result.slice(2), 16);
  if (!Number.isSafeInteger(chainId) || chainId <= 0) throw new Error("RPC returned an invalid chain ID");
  return chainId;
}

/**
 * Finds a current Railgun deployment for the RPC-reported EVM chain.
 * It accepts a positive chain ID and excludes deprecated or empty deployments.
 */
export function getRailgunNetwork(chainId: number): Network {
  const fiberChain = getFiberEvmChain(chainId);
  if (!fiberChain) {
    throw new Error(`Chain ${chainId} is not supported by Fiber`);
  }
  if (!fiberChain.privateAssets) {
    throw new Error(`Fiber private assets are not available on ${fiberChain.name} (${chainId})`);
  }

  const network = Object.values(NETWORK_CONFIG).find(
    (candidate) =>
      candidate.chain.id === chainId &&
      !candidate.deprecated &&
      candidate.proxyContract.length > 0,
  );
  if (!network) throw new Error(`Railgun private assets are not supported on chain ${chainId}`);

  const fiberDeployment = getFiberPrivateDeployment(chainId);
  if (!fiberDeployment) return network;
  if (network.proxyContract.toLowerCase() !== fiberDeployment.proxy.toLowerCase()) {
    throw new Error(`Railgun deployment metadata does not match Fiber chain ${chainId}`);
  }

  // Start from Fiber's original proxy deployment so recovery cannot miss older commitments.
  return { ...network, deploymentBlock: fiberDeployment.deploymentBlock };
}

/**
 * Combines positive spendable balances across active Railgun transaction versions.
 * It accepts the engine's per-version balance map and retains every supported asset type.
 */
export function aggregatePrivateAssets(
  balancesByVersion: TokenBalancesAllTxidVersions,
): PrivateAsset[] {
  const assetsByIdentifier = new Map<string, PrivateAsset>();

  for (const tokenBalances of Object.values(balancesByVersion)) {
    for (const treeBalance of Object.values(tokenBalances)) {
      if (treeBalance.balance <= 0n) continue;

      const tokenType = TOKEN_TYPE_NAMES[treeBalance.tokenData.tokenType];
      if (!tokenType) continue;
      const addressHex = treeBalance.tokenData.tokenAddress.replace(/^0x/i, "").slice(-40);
      const address = `0x${addressHex.toLowerCase()}`;
      const tokenId = tokenType === "ERC20" ? null : BigInt(treeBalance.tokenData.tokenSubID).toString();
      const identifier = `${tokenType}:${address}:${tokenId ?? ""}`;
      const existingAsset = assetsByIdentifier.get(identifier);

      assetsByIdentifier.set(identifier, {
        type: tokenType,
        address,
        tokenId,
        rawAmount: (BigInt(existingAsset?.rawAmount ?? 0) + treeBalance.balance).toString(),
      });
    }
  }

  return [...assetsByIdentifier.values()].sort((left, right) =>
    `${left.type}:${left.address}:${left.tokenId ?? ""}`.localeCompare(
      `${right.type}:${right.address}:${right.tokenId ?? ""}`,
    ),
  );
}

/**
 * Reconstructs Fiber's Railgun wallet and scans private holdings through one explicit RPC.
 * It accepts decrypted seed bytes, the RPC URL, and an optional progress sink for stderr.
 */
export async function listPrivateAssets({
  seed,
  rpcUrl,
  onProgress = () => undefined,
}: {
  seed: Uint8Array;
  rpcUrl: string;
  onProgress?: (message: string) => void;
}): Promise<PrivateAssetScan> {
  const chainId = await getRpcChainId(rpcUrl);
  const network = getRailgunNetwork(chainId);
  const encryptionKeyBytes = randomBytes(32);
  let engine: RailgunEngine | undefined;
  let provider: PollingJsonRpcProvider | undefined;

  try {
    const unavailableArtifacts = {
      assertArtifactExists: () => undefined,
      getArtifacts: async () => {
        throw new Error("Proof artifacts are not available in the read-only Fiber CLI");
      },
      getArtifactsPOI: async () => {
        throw new Error("POI proof artifacts are not available in the read-only Fiber CLI");
      },
    } as unknown as Parameters<typeof RailgunEngine.initForWallet>[2];

    // Empty quick-sync callbacks keep recovery traffic on the user-supplied RPC.
    engine = await RailgunEngine.initForWallet(
      "fibercli",
      // Recovery state stays in this process and never touches the filesystem.
      memdown(),
      unavailableArtifacts,
      async () => ({ commitmentEvents: [], unshieldEvents: [], nullifierEvents: [] }),
      async () => [],
      async () => true,
      async () => ({ txidIndex: undefined, merkleroot: undefined }),
      undefined,
      false,
    );

    onProgress(`Scanning ${network.publicName} through the supplied RPC; the first scan can take time...`);
    provider = new PollingJsonRpcProvider(rpcUrl, chainId, 10_000);
    const deploymentBlocks = {
      [TXIDVersion.V2_PoseidonMerkle]: network.deploymentBlock,
      [TXIDVersion.V3_PoseidonMerkle]:
        network.deploymentBlockPoseidonMerkleAccumulatorV3 ?? 0,
    };
    const loadNetwork = engine.loadNetwork.bind(engine) as (...args: unknown[]) => Promise<void>;
    const networkArguments = [
      network.chain,
      network.proxyContract,
      network.relayAdaptContract,
      network.poseidonMerkleAccumulatorV3Contract,
      network.poseidonMerkleVerifierV3Contract,
      network.tokenVaultV3Contract,
      provider,
      provider,
      deploymentBlocks,
    ];

    // Railgun 9.6 added the POI launch block before the V3 capability flag.
    if (engine.loadNetwork.length >= 11) {
      await loadNetwork(...networkArguments, network.poi?.launchBlock, network.supportsV3);
    } else {
      await loadNetwork(...networkArguments, network.supportsV3);
    }

    const mnemonic = entropyToMnemonic(seed, wordlist);
    const creationBlockNumbers: number[][] = [];
    creationBlockNumbers[network.chain.type] ??= [];
    creationBlockNumbers[network.chain.type][network.chain.id] = network.deploymentBlock;

    const wallet = await engine.createWalletFromMnemonic(
      encryptionKeyBytes.toString("hex"),
      mnemonic,
      0,
      creationBlockNumbers,
    );
    await engine.scanContractHistory(network.chain, [wallet.id]);

    const balances = await wallet.getTokenBalancesAllTxidVersions(
      network.chain,
      [WalletBalanceBucket.Spendable],
    );
    return { chainId, network: network.publicName, assets: aggregatePrivateAssets(balances) };
  } catch {
    throw new Error(
      `Private asset scan failed on ${network.publicName}; verify the supplied RPC and try again`,
    );
  } finally {
    encryptionKeyBytes.fill(0);
    if (engine) await engine.unload().catch(() => undefined);
    provider?.destroy();
  }
}
