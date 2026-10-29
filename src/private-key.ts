import { getPublicKeyAsync } from "@noble/ed25519";
import { hmac } from "@noble/hashes/hmac.js";
import { sha512 } from "@noble/hashes/sha2.js";
import { bytesToHex } from "@noble/hashes/utils.js";
import { base58 } from "@scure/base";
import { HDKey } from "@scure/bip32";
// The transaction subpath keeps the full ethers bundle out of the private-key startup path.
import { computeAddress } from "ethers/transaction";
import type { FiberKeyNetwork } from "./chains.ts";

const SLIP10_ED25519_MASTER_KEY = new TextEncoder().encode("ed25519 seed");

type Slip10Node = {
  key: Uint8Array;
  chainCode: Uint8Array;
};

/** Creates the SLIP-0010 Ed25519 master node used by Fiber and Phantom. */
function createSlip10Master(seed: Uint8Array): Slip10Node {
  const digest = hmac(sha512, SLIP10_ED25519_MASTER_KEY, seed);
  try {
    return { key: digest.slice(0, 32), chainCode: digest.slice(32) };
  } finally {
    digest.fill(0);
  }
}

/** Derives one hardened SLIP-0010 child and clears its temporary HMAC input. */
function deriveSlip10HardenedChild(parent: Slip10Node, index: number): Slip10Node {
  const data = new Uint8Array(37);
  data[0] = 0;
  data.set(parent.key, 1);
  new DataView(data.buffer).setUint32(33, (index | 0x80000000) >>> 0, false);
  const digest = hmac(sha512, parent.chainCode, data);

  try {
    return { key: digest.slice(0, 32), chainCode: digest.slice(32) };
  } finally {
    data.fill(0);
    digest.fill(0);
  }
}

/** Returns the BIP-44 path Fiber uses for one account index on the selected key network. */
export function getDerivationPath(chain: FiberKeyNetwork, derivationIndex: number): string {
  return chain === "solana"
    ? `m/44'/501'/${derivationIndex}'/0'`
    : `m/44'/60'/0'/0/${derivationIndex}`;
}

/**
 * Derives the EVM account exactly as Fiber's enclave does for normal wallet operations.
 * It accepts decrypted master seed bytes and a non-hardened account index.
 */
export function deriveEvmPrivateKey(seed: Uint8Array, derivationIndex: number): Uint8Array {
  const child = HDKey.fromMasterSeed(seed).derive(getDerivationPath("evm", derivationIndex));
  if (!child.privateKey) throw new Error("Failed to derive the EVM private key");
  return child.privateKey.slice();
}

/**
 * Derives the Phantom-compatible Ed25519 seed used by Fiber's Solana backend.
 * It accepts the decrypted master seed and account index for m/44'/501'/index'/0'.
 */
export function deriveSolanaPrivateKey(seed: Uint8Array, derivationIndex: number): Uint8Array {
  let node = createSlip10Master(seed);

  try {
    for (const index of [44, 501, derivationIndex, 0]) {
      const child = deriveSlip10HardenedChild(node, index);
      node.key.fill(0);
      node.chainCode.fill(0);
      node = child;
    }
    return node.key.slice();
  } finally {
    node.key.fill(0);
    node.chainCode.fill(0);
  }
}

/**
 * Formats a private key for recovery tools without adding labels to standard output.
 * It accepts exactly 32 key bytes and returns the conventional 0x-prefixed value.
 */
export function formatPrivateKey(privateKey: Uint8Array): string {
  if (privateKey.length !== 32) throw new Error("Invalid EVM private key");
  return `0x${bytesToHex(privateKey)}`;
}

/**
 * Formats a Solana key as the standard base58 64-byte secret key accepted by wallet importers.
 * It accepts Fiber's 32-byte Ed25519 seed and clears the combined secret after encoding.
 */
export async function formatSolanaPrivateKey(privateKey: Uint8Array): Promise<string> {
  if (privateKey.length !== 32) throw new Error("Invalid Solana private key");

  const publicKey = await getPublicKeyAsync(privateKey);
  const secretKey = new Uint8Array(64);
  secretKey.set(privateKey, 0);
  secretKey.set(publicKey, 32);

  try {
    return base58.encode(secretKey);
  } finally {
    secretKey.fill(0);
    publicKey.fill(0);
  }
}

/** Returns the checksummed EVM address for a 32-byte private key. */
export function formatEvmAddress(privateKey: Uint8Array): string {
  return computeAddress(formatPrivateKey(privateKey));
}

/** Returns the base58 Solana address (the Ed25519 public key) for Fiber's 32-byte seed. */
export async function formatSolanaAddress(privateKey: Uint8Array): Promise<string> {
  if (privateKey.length !== 32) throw new Error("Invalid Solana private key");
  return base58.encode(await getPublicKeyAsync(privateKey));
}

export type DerivedKey = {
  chain: FiberKeyNetwork;
  derivationIndex: number;
  derivationPath: string;
  address: string;
  privateKey: string;
};

/**
 * Derives and formats one recovery key with the address it controls.
 * It accepts the decrypted master seed and clears the raw key bytes before returning.
 */
export async function deriveKey(
  seed: Uint8Array,
  chain: FiberKeyNetwork,
  derivationIndex: number,
): Promise<DerivedKey> {
  const privateKey = chain === "solana"
    ? deriveSolanaPrivateKey(seed, derivationIndex)
    : deriveEvmPrivateKey(seed, derivationIndex);
  try {
    return {
      chain,
      derivationIndex,
      derivationPath: getDerivationPath(chain, derivationIndex),
      address: chain === "solana" ? await formatSolanaAddress(privateKey) : formatEvmAddress(privateKey),
      privateKey: chain === "solana"
        ? await formatSolanaPrivateKey(privateKey)
        : formatPrivateKey(privateKey),
    };
  } finally {
    privateKey.fill(0);
  }
}
