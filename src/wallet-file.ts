import { open } from "node:fs/promises";
import { decryptPasswordEncryptedWalletExport } from "./wallet-export.ts";

const MAX_EXPORT_FILE_BYTES = 1024 * 1024;

/**
 * Opens and decrypts one bounded Fiber export file with the supplied password.
 * It accepts a user-selected path and refuses unexpectedly large input before reading it.
 */
export async function readWalletSeed(file: string, password: string): Promise<Uint8Array> {
  if (!password) {
    throw new Error("Wallet export password is required");
  }

  const handle = await open(file, "r");
  try {
    const fileStats = await handle.stat();
    if (!fileStats.isFile() || fileStats.size > MAX_EXPORT_FILE_BYTES) {
      throw new Error("Wallet export must be a file no larger than 1 MiB");
    }

    const serializedExport = await handle.readFile({ encoding: "utf8" });
    return await decryptPasswordEncryptedWalletExport({ serializedExport, password });
  } finally {
    await handle.close();
  }
}
