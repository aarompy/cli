import { stderr, stdout } from "node:process";
import { HELP_TEXT, parseCliArguments } from "./arguments.ts";
import { readHiddenPassword, readPasswordFromStdin } from "./password.ts";
import type { PrivateAssetScan } from "./private-assets.ts";
import {
  deriveEvmPrivateKey,
  deriveSolanaPrivateKey,
  formatPrivateKey,
  formatSolanaPrivateKey,
} from "./private-key.ts";
import { readWalletSeed } from "./wallet-file.ts";

type Output = Pick<NodeJS.WriteStream, "write">;

export type CliDependencies = {
  readPassword: (fromStdin: boolean) => Promise<string>;
  readSeed: (file: string, password: string) => Promise<Uint8Array>;
  scanPrivateAssets: (input: {
    seed: Uint8Array;
    rpcUrl: string;
    onProgress: (message: string) => void;
  }) => Promise<PrivateAssetScan>;
  stdout: Output;
  stderr: Output;
};

const defaultDependencies: CliDependencies = {
  readPassword: (fromStdin) => (fromStdin ? readPasswordFromStdin() : readHiddenPassword()),
  readSeed: readWalletSeed,
  scanPrivateAssets: async (input) => {
    // Keep the heavyweight Railgun engine out of the private-key startup path.
    const { listPrivateAssets } = await import("./private-assets.ts");
    return listPrivateAssets(input);
  },
  stdout,
  stderr,
};

/**
 * Writes an exhaustive private-asset scan in human-readable or stable JSON form.
 * It accepts the scan result, output mode, and the destination stream.
 */
export function writePrivateAssets(scan: PrivateAssetScan, json: boolean, output: Output): void {
  if (json) {
    output.write(`${JSON.stringify(scan, null, 2)}\n`);
    return;
  }

  output.write(`Network: ${scan.network} (${scan.chainId})\n`);
  if (scan.assets.length === 0) {
    output.write("No private assets found.\n");
    return;
  }

  output.write("TYPE\tADDRESS\tTOKEN_ID\tRAW_AMOUNT\n");
  for (const asset of scan.assets) {
    output.write(`${asset.type}\t${asset.address}\t${asset.tokenId ?? "-"}\t${asset.rawAmount}\n`);
  }
}

/**
 * Runs one Fiber recovery command with injectable I/O for deterministic security tests.
 * It accepts raw CLI arguments and returns the process exit code instead of exiting itself.
 */
export async function runCli(
  args: string[],
  dependencies: CliDependencies = defaultDependencies,
): Promise<number> {
  try {
    const parsed = parseCliArguments(args);
    if (parsed === "help") {
      dependencies.stdout.write(HELP_TEXT);
      return 0;
    }

    const password = await dependencies.readPassword(parsed.passwordStdin);
    const seed = await dependencies.readSeed(parsed.file, password);

    try {
      if (parsed.command === "private-key") {
        const privateKey = parsed.chain === "solana"
          ? deriveSolanaPrivateKey(seed, parsed.derivationIndex)
          : deriveEvmPrivateKey(seed, parsed.derivationIndex);
        try {
          dependencies.stderr.write(
            `WARNING: the next line is a live ${parsed.chain.toUpperCase()} private key. Keep it secret.\n`,
          );
          const formattedPrivateKey = parsed.chain === "solana"
            ? await formatSolanaPrivateKey(privateKey)
            : formatPrivateKey(privateKey);
          dependencies.stdout.write(`${formattedPrivateKey}\n`);
        } finally {
          privateKey.fill(0);
        }
        return 0;
      }

      const scan = await dependencies.scanPrivateAssets({
        seed,
        rpcUrl: parsed.rpcUrl,
        onProgress: (message) => dependencies.stderr.write(`${message}\n`),
      });
      writePrivateAssets(scan, parsed.json, dependencies.stdout);
      return 0;
    } finally {
      seed.fill(0);
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown failure";
    dependencies.stderr.write(`Error: ${message}\n`);
    return 1;
  }
}
