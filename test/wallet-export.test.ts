import { describe, expect, it } from "bun:test";
import { decryptPasswordEncryptedWalletExport } from "../src/wallet-export.ts";

// This fixed test vector contains only a synthetic 0x42 seed and a documented test password.
// Keeping it static lets the public repository test its decoder without private Fiber imports.
const VERSION_ONE_TEST_EXPORT = `{
  "format": "fiber-wallet-export",
  "version": 1,
  "createdAt": "2026-09-01T17:26:28.877Z",
  "kdf": {
    "name": "PBKDF2-HMAC-SHA256",
    "iterations": 600000,
    "salt": "QM6Wvf5Sbcrg9MHxdhUUOt/m9fI2IxMHiKgew1QARVM="
  },
  "cipher": {
    "name": "AES-256-GCM",
    "nonce": "pfjbNuUfQtsFxWGM",
    "ciphertext": "U5yM8WP8a/6ry0W3v+zsp4m/BhrA99DbxKPiE5EheQgxubEVijZS0Ncd+Ln9Rxl7U10W7ywa/pHolyLg6/32p9T/agaQ6hvL1v0MQIEN9gFsYPjdTyrM71V6Kv7nnxsoGbzhdOEj0dsWhxFz6N+qJ0pKIAGeoGNc5kf91358vPTfGNLPv5KCNgQWnISGShwFZf6rgSApIdkFxvXsXOcl8DNFa3qGcQMh3GRK"
  }
}`;

describe("public wallet export decoder", () => {
  it("decrypts the published version one test vector", async () => {
    const password = "correct horse battery staple";

    const decryptedSeed = await decryptPasswordEncryptedWalletExport({
      serializedExport: VERSION_ONE_TEST_EXPORT,
      password,
    });
    expect(decryptedSeed).toEqual(new Uint8Array(32).fill(0x42));
    decryptedSeed.fill(0);
  });

  it("does not accept the wrong password", async () => {
    await expect(
      decryptPasswordEncryptedWalletExport({
        serializedExport: VERSION_ONE_TEST_EXPORT,
        password: "incorrect horse battery staple",
      }),
    ).rejects.toThrow();
  });

  it("never accepts a passwordless Fiber seed file", async () => {
    await expect(
      decryptPasswordEncryptedWalletExport({
        serializedExport: VERSION_ONE_TEST_EXPORT,
        password: "",
      }),
    ).rejects.toThrow("Wallet export password is required");
  });

  it("rejects unsupported future file versions explicitly", async () => {
    const password = "correct horse battery staple";
    const futureExport = JSON.parse(VERSION_ONE_TEST_EXPORT) as { version: number };
    futureExport.version = 2;

    await expect(
      decryptPasswordEncryptedWalletExport({
        serializedExport: JSON.stringify(futureExport),
        password,
      }),
    ).rejects.toThrow("Unsupported wallet export file");
  });
});
