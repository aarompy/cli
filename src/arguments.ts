import type { FiberKeyNetwork } from "./chains.ts";

export type PrivateKeyCommand = {
  command: "private-key";
  file: string;
  derivationIndex: number;
  chain: FiberKeyNetwork;
  passwordStdin: boolean;
};

export type PrivateAssetsCommand = {
  command: "private-assets";
  file: string;
  rpcUrl: string;
  passwordStdin: boolean;
  json: boolean;
};

export type CliCommand = PrivateKeyCommand | PrivateAssetsCommand;

export const HELP_TEXT = `Fiber wallet recovery CLI

Usage:
  fiber private-key --file <backup.fiberseed> [--chain <evm|solana>] [--derivation-index <index>] [--password-stdin]
  fiber private-assets --file <backup.fiberseed> --rpc-url <url> [--json] [--password-stdin]

Security:
  Every file operation requires a password through a hidden prompt or stdin.
  Passwords are never accepted as a command-line value.
  private-assets has no default RPC URL and never reads one from the environment.
`;

/**
 * Parses the small recovery command surface and rejects ambiguous or unsafe flags.
 * It accepts only the CLI arguments after the executable name.
 */
export function parseCliArguments(args: string[]): CliCommand | "help" {
  const command = args[0];
  if (!command || command === "help" || command === "--help" || command === "-h") {
    return "help";
  }
  if (command !== "private-key" && command !== "private-assets") {
    throw new Error(`Unknown command: ${command}`);
  }

  let file: string | undefined;
  let rpcUrl: string | undefined;
  let derivationIndex = 0;
  let derivationIndexWasSet = false;
  let chain: FiberKeyNetwork = "evm";
  let chainWasSet = false;
  let passwordStdin = false;
  let json = false;

  for (let index = 1; index < args.length; index += 1) {
    const flag = args[index];
    if (flag === "--password") {
      throw new Error("Do not pass passwords as arguments; use the hidden prompt or --password-stdin");
    }
    if (flag === "--password-stdin") {
      passwordStdin = true;
      continue;
    }
    if (flag === "--json") {
      json = true;
      continue;
    }

    const value = args[index + 1];
    if (!value || value.startsWith("--")) {
      throw new Error(`${flag} requires a value`);
    }
    index += 1;

    if (flag === "--file") {
      file = value;
    } else if (flag === "--chain") {
      if (value !== "evm" && value !== "solana") {
        throw new Error("--chain must be evm or solana");
      }
      chain = value;
      chainWasSet = true;
    } else if (flag === "--rpc-url") {
      rpcUrl = value;
    } else if (flag === "--derivation-index") {
      derivationIndex = Number(value);
      derivationIndexWasSet = true;
    } else {
      throw new Error(`Unknown option: ${flag}`);
    }
  }

  if (!file) {
    throw new Error("--file is required");
  }
  if (!Number.isSafeInteger(derivationIndex) || derivationIndex < 0 || derivationIndex >= 2 ** 31) {
    throw new Error("--derivation-index must be an integer from 0 through 2147483647");
  }

  if (command === "private-key") {
    if (rpcUrl) throw new Error("--rpc-url is only valid for private-assets");
    if (json) throw new Error("--json is only valid for private-assets");
    return { command, file, derivationIndex, chain, passwordStdin };
  }

  if (!rpcUrl) {
    throw new Error("--rpc-url is required for private-assets; there is no default RPC URL");
  }
  try {
    const parsedRpcUrl = new URL(rpcUrl);
    if (parsedRpcUrl.protocol !== "https:" && parsedRpcUrl.protocol !== "http:") throw new Error();
  } catch {
    throw new Error("--rpc-url must be a valid http or https URL");
  }
  if (derivationIndexWasSet) {
    throw new Error("--derivation-index is only valid for private-key");
  }
  if (chainWasSet) {
    throw new Error("--chain is only valid for private-key");
  }
  return { command, file, rpcUrl, passwordStdin, json };
}
