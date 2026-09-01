import { gcm } from "@noble/ciphers/aes.js";
import { pbkdf2Async } from "@noble/hashes/pbkdf2.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { utf8ToBytes } from "@noble/hashes/utils.js";
import { base64 } from "@scure/base";

const PASSWORD_FILE_AAD = utf8ToBytes("fiber.wallet-export.password.v1");
const PASSWORD_KDF_ITERATIONS = 600_000;
const FIBER_SEED_FORMAT_VERSION = 1 as const;

type PasswordEncryptedWalletExport = {
  format: "fiber-wallet-export";
  version: typeof FIBER_SEED_FORMAT_VERSION;
  kdf: {
    name: "PBKDF2-HMAC-SHA256";
    iterations: number;
    salt: string;
  };
  cipher: {
    name: "AES-256-GCM";
    nonce: string;
    ciphertext: string;
  };
};

type WalletSeedPayload = {
  format: "fiber-wallet-seed";
  version: typeof FIBER_SEED_FORMAT_VERSION;
  encoding: "base64";
  seed: string;
};

/**
 * Decrypts the public Fiber export format without importing private workspace code.
 * It accepts serialized `.fiberseed` JSON and the password supplied on the local device.
 */
export async function decryptPasswordEncryptedWalletExport({
  serializedExport,
  password,
}: {
  serializedExport: string;
  password: string;
}): Promise<Uint8Array> {
  if (!password) {
    throw new Error("Wallet export password is required");
  }

  const encryptedFile = JSON.parse(serializedExport) as Partial<PasswordEncryptedWalletExport>;
  if (
    encryptedFile.format !== "fiber-wallet-export" ||
    encryptedFile.version !== FIBER_SEED_FORMAT_VERSION ||
    encryptedFile.kdf?.name !== "PBKDF2-HMAC-SHA256" ||
    encryptedFile.kdf.iterations !== PASSWORD_KDF_ITERATIONS ||
    encryptedFile.cipher?.name !== "AES-256-GCM"
  ) {
    throw new Error("Unsupported wallet export file");
  }

  const passwordBytes = utf8ToBytes(password);
  const encryptionKey = await pbkdf2Async(
    sha256,
    passwordBytes,
    base64.decode(encryptedFile.kdf.salt),
    { c: encryptedFile.kdf.iterations, dkLen: 32 },
  );
  let payloadBytes: Uint8Array | undefined;

  try {
    payloadBytes = gcm(
      encryptionKey,
      base64.decode(encryptedFile.cipher.nonce),
      PASSWORD_FILE_AAD,
    ).decrypt(base64.decode(encryptedFile.cipher.ciphertext));
    const payload = JSON.parse(new TextDecoder().decode(payloadBytes)) as Partial<WalletSeedPayload>;
    if (
      payload.format !== "fiber-wallet-seed" ||
      payload.version !== FIBER_SEED_FORMAT_VERSION ||
      payload.encoding !== "base64" ||
      typeof payload.seed !== "string"
    ) {
      throw new Error("Invalid wallet seed payload");
    }

    const seed = base64.decode(payload.seed);
    if (seed.length < 16 || seed.length > 64) throw new Error("Invalid wallet seed payload");
    return seed;
  } finally {
    payloadBytes?.fill(0);
    passwordBytes.fill(0);
    encryptionKey.fill(0);
  }
}
