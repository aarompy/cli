import { getPublicKeyAsync } from "@noble/ed25519";
import { hmac } from "@noble/hashes/hmac.js";
import { sha512 } from "@noble/hashes/sha2.js";
import { base58 } from "@scure/base";
import { HDKey } from "@scure/bip32";

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

/**
 * Derives the EVM account exactly as Fiber's enclave does for normal wallet operations.
 * It accepts decrypted master seed bytes and a non-hardened account index.
 */
export function deriveEvmPrivateKey(seed: Uint8Array, derivationIndex: number): Uint8Array {
  const child = HDKey.fromMasterSeed(seed).derive(`m/44'/60'/0'/0/${derivationIndex}`);
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
  return `0x${Buffer.from(privateKey).toString("hex")}`;
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
