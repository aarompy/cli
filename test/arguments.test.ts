import { describe, expect, it } from "bun:test";
import { parseCliArguments } from "../src/arguments.ts";

describe("Fiber CLI arguments", () => {
  it("requires an explicit RPC URL for private asset scans", () => {
    expect(() => parseCliArguments(["private-assets", "--file", "backup.fiberseed"])).toThrow(
      "there is no default RPC URL",
    );
  });

  it("rejects passwords in process-visible arguments", () => {
    expect(() =>
      parseCliArguments([
        "private-key",
        "--file",
        "backup.fiberseed",
        "--password",
        "do-not-leak-this",
      ]),
    ).toThrow("Do not pass passwords as arguments");
  });

  it("parses an explicit RPC and stdin password mode", () => {
    expect(
      parseCliArguments([
        "private-assets",
        "--file",
        "backup.fiberseed",
        "--rpc-url",
        "https://rpc.example",
        "--password-stdin",
        "--json",
      ]),
    ).toEqual({
      command: "private-assets",
      file: "backup.fiberseed",
      rpcUrl: "https://rpc.example",
      passwordStdin: true,
      json: true,
    });
  });

  it("selects EVM keys by default and accepts explicit Solana recovery", () => {
    expect(parseCliArguments(["private-key", "--file", "backup.fiberseed"])).toMatchObject({
      command: "private-key",
      chain: "evm",
    });
    expect(
      parseCliArguments([
        "private-key",
        "--file",
        "backup.fiberseed",
        "--chain",
        "solana",
      ]),
    ).toMatchObject({ command: "private-key", chain: "solana" });
  });

  it("rejects unsupported key chains", () => {
    expect(() =>
      parseCliArguments([
        "private-key",
        "--file",
        "backup.fiberseed",
        "--chain",
        "bitcoin",
      ]),
    ).toThrow("--chain must be evm or solana");
  });

  it("rejects EVM derivation options on a private asset scan", () => {
    expect(() =>
      parseCliArguments([
        "private-assets",
        "--file",
        "backup.fiberseed",
        "--rpc-url",
        "https://rpc.example",
        "--derivation-index",
        "1",
      ]),
    ).toThrow("only valid for private-key");
  });

  it("rejects unsafe RPC transports before asking for a password", () => {
    expect(() =>
      parseCliArguments([
        "private-assets",
        "--file",
        "backup.fiberseed",
        "--rpc-url",
        "file:///tmp/rpc",
      ]),
    ).toThrow("valid http or https URL");
  });

  it("does not accept key selection on a private asset scan", () => {
    expect(() =>
      parseCliArguments([
        "private-assets",
        "--file",
        "backup.fiberseed",
        "--rpc-url",
        "https://rpc.example",
        "--chain",
        "evm",
      ]),
    ).toThrow("--chain is only valid for private-key");
  });
});
