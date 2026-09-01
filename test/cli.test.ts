import { describe, expect, it } from "bun:test";
import { base58 } from "@scure/base";
import { HDKey } from "@scure/bip32";
import { runCli, type CliDependencies } from "../src/cli.ts";

function outputBuffer() {
  let value = "";
  return {
    stream: { write: (chunk: string | Uint8Array) => ((value += chunk.toString()), true) },
    read: () => value,
  };
}

describe("Fiber CLI commands", () => {
  it("prints the Fiber EVM private key and clears the supplied seed buffer", async () => {
    const seed = new Uint8Array(32).fill(0x42);
    const expectedKey = HDKey.fromMasterSeed(seed).derive("m/44'/60'/0'/0/0").privateKey;
    const standardOutput = outputBuffer();
    const standardError = outputBuffer();

    const dependencies: CliDependencies = {
      readPassword: async () => "correct horse battery staple",
      readSeed: async (_file, password) => {
        expect(password).toBe("correct horse battery staple");
        return seed;
      },
      scanPrivateAssets: async () => {
        throw new Error("not used");
      },
      stdout: standardOutput.stream,
      stderr: standardError.stream,
    };
    const exitCode = await runCli(["private-key", "--file", "backup.fiberseed"], dependencies);

    expect(exitCode).toBe(0);
    expect(standardOutput.read()).toBe(`0x${Buffer.from(expectedKey!).toString("hex")}\n`);
    expect(standardError.read()).toContain("live EVM private key");
    expect(seed.every((byte) => byte === 0)).toBe(true);
  });

  it("prints the Phantom-compatible Solana private key used by Fiber", async () => {
    const seed = Uint8Array.from([
      25, 21, 117, 29, 175, 18, 6, 213, 217, 118, 102, 185, 30, 152, 247, 183,
      184, 112, 74, 17, 73, 112, 103, 80, 129, 1, 240, 248, 88, 247, 58, 12,
    ]);
    const expectedPrivateSeed = "280868d081035690222240d6f975c357a65dec75fd060aeae4762477f2e9cef2";
    const standardOutput = outputBuffer();
    const standardError = outputBuffer();

    const dependencies: CliDependencies = {
      readPassword: async () => "correct horse battery staple",
      readSeed: async () => seed,
      scanPrivateAssets: async () => {
        throw new Error("not used");
      },
      stdout: standardOutput.stream,
      stderr: standardError.stream,
    };
    const exitCode = await runCli(
      ["private-key", "--file", "backup.fiberseed", "--chain", "solana"],
      dependencies,
    );
    const decodedSecretKey = base58.decode(standardOutput.read().trim());

    expect(exitCode).toBe(0);
    expect(Buffer.from(decodedSecretKey.slice(0, 32)).toString("hex")).toBe(expectedPrivateSeed);
    expect(decodedSecretKey).toHaveLength(64);
    expect(standardError.read()).toContain("SOLANA private key");
    expect(seed.every((byte) => byte === 0)).toBe(true);
    decodedSecretKey.fill(0);
  });

  it("passes only the explicit RPC URL into a private asset scan", async () => {
    const standardOutput = outputBuffer();
    const standardError = outputBuffer();
    let receivedRpcUrl: string | undefined;

    const dependencies: CliDependencies = {
      readPassword: async (fromStdin) => (fromStdin ? "password from stdin" : "wrong path"),
      readSeed: async (_file, password) => {
        expect(password).toBe("password from stdin");
        return new Uint8Array(32).fill(0x11);
      },
      scanPrivateAssets: async ({ rpcUrl }) => {
        receivedRpcUrl = rpcUrl;
        return { chainId: 8453, network: "Base", assets: [] };
      },
      stdout: standardOutput.stream,
      stderr: standardError.stream,
    };
    const exitCode = await runCli(
      [
        "private-assets",
        "--file",
        "backup.fiberseed",
        "--rpc-url",
        "https://base.example",
        "--password-stdin",
      ],
      dependencies,
    );

    expect(exitCode).toBe(0);
    expect(receivedRpcUrl).toBe("https://base.example");
    expect(standardOutput.read()).toContain("No private assets found");
  });
});
