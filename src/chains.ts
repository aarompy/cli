export type FiberKeyNetwork = "evm" | "solana";

/**
 * Mirrors the backend chain registry without making the public package depend on private workspace code.
 * The monorepo compatibility test fails if either registry changes without the other.
 */
export const FIBER_EVM_CHAINS = [
  { chainId: 1, name: "Ethereum", privateAssets: true },
  // bStocks stay public on BNB; Fiber's Railgun pool there settles USDT.
  { chainId: 56, name: "BNB Smart Chain", privateAssets: true },
  // Robinhood stock tokens settle publicly because Railgun is not deployed on this chain.
  { chainId: 4663, name: "Robinhood Chain", privateAssets: false },
  { chainId: 137, name: "Polygon", privateAssets: true },
  { chainId: 8453, name: "Base", privateAssets: true },
  { chainId: 42161, name: "Arbitrum", privateAssets: true },
  { chainId: 130, name: "Unichain", privateAssets: false },
  // These deposit networks use EVM keys but have no private-asset deployment.
  { chainId: 143, name: "Monad", privateAssets: false },
  { chainId: 5042, name: "Arc", privateAssets: false },
  { chainId: 999, name: "HyperEVM", privateAssets: false },
  // Plasma deposits share the EVM key and have no Fiber private-asset deployment.
  { chainId: 9745, name: "Plasma", privateAssets: false },
  { chainId: 11155111, name: "Sepolia", privateAssets: true },
] as const;

export const FIBER_SOLANA_CHAIN = {
  chainId: 101,
  name: "Solana",
  privateAssets: false,
} as const;

/** Authoritative Fiber deployments used to anchor private scans at their full history. */
export const FIBER_PRIVATE_DEPLOYMENTS = [
  {
    chainId: 1,
    proxy: "0xc835F7252338E1A7a533927C64fC148D6A940C5F",
    // Start just before Fiber's proxy was deployed at block 24,702,699.
    deploymentBlock: 24_702_692,
  },
  {
    chainId: 8453,
    proxy: "0x22F45899EE13042ae046f7Aa7C2292Ea74C7F1c6",
    deploymentBlock: 45_619_056,
  },
  {
    chainId: 42161,
    proxy: "0x7233d17ec3Ce855Acb8F7A9412Bf90757117A092",
    // Match the shared proxy creation block for complete recovery scans.
    deploymentBlock: 512_998_944,
  },
  {
    chainId: 56,
    proxy: "0x7233d17ec3Ce855Acb8F7A9412Bf90757117A092",
    deploymentBlock: 129_064_218,
  },
  {
    chainId: 11155111,
    proxy: "0x4020Fd6030b62889F2094de97f5F7Abd6933987C",
    deploymentBlock: 10_387_299,
  },
] as const;

/** Returns Fiber's metadata for one backend-supported EVM chain. */
export function getFiberEvmChain(chainId: number) {
  return FIBER_EVM_CHAINS.find((chain) => chain.chainId === chainId);
}

/** Returns Fiber's authoritative Railgun deployment metadata when one exists. */
export function getFiberPrivateDeployment(chainId: number) {
  return FIBER_PRIVATE_DEPLOYMENTS.find((deployment) => deployment.chainId === chainId);
}
