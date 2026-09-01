# Fiber CLI

Fiber CLI is a public recovery tool for password-encrypted Fiber `.fiberseed` exports. It can:

- derive and print Fiber EVM or Solana private keys; and
- scan an explicitly selected RPC for spendable private ERC-20, ERC-721, and ERC-1155 assets.

The CLI runs on [Bun](https://bun.sh/) 1.3 or newer. It never uploads the seed or password to Fiber.

## 1. Clone and install

Clone the public source and install its locked dependencies:

```bash
git clone https://github.com/fiberevm/cli.git
cd cli
bun install --frozen-lockfile
bun src/index.ts --help
```

You need the `.fiberseed` file downloaded from the Fiber profile page and the password that protected it.

## 2. Print a private key

Use the hidden password prompt. EVM is the backward-compatible default:

```bash
bun src/index.ts private-key --file ./fiber-wallet-backup-2026-08-31.fiberseed
```

The default account uses the same derivation path as Fiber's enclave: `m/44'/60'/0'/0/0`. To recover another Fiber derivation index:

```bash
bun src/index.ts private-key --file ./backup.fiberseed --derivation-index 1
```

All Fiber EVM networks use this same key derivation. This covers Ethereum, Polygon, Base, Arbitrum, Unichain, and Sepolia.

For Fiber's Phantom-compatible Solana key at `m/44'/501'/0'/0'`:

```bash
bun src/index.ts private-key --file ./backup.fiberseed --chain solana
```

Add `--derivation-index <index>` to recover another Solana account with the same backend-compatible path.

EVM output is a `0x`-prefixed 32-byte private key. Solana output is the standard base58 64-byte secret key accepted by wallet importers. The output is a live secret. Do not paste it into chat, logs, tickets, command arguments, or shell history.

For non-interactive use, pipe exactly one password line. `--password-stdin` is safer than putting the password in the process arguments:

```bash
printf '%s\n' "$FIBER_EXPORT_PASSWORD" | bun src/index.ts private-key \
  --file ./backup.fiberseed \
  --password-stdin
```

## 3. List private assets

Pass the RPC URL you want the CLI to use:

```bash
bun src/index.ts private-assets \
  --file ./backup.fiberseed \
  --rpc-url https://your-rpc.example
```

There is intentionally no default RPC URL. The CLI does not read one from an environment variable and does not fall back to a public provider. It detects the chain with `eth_chainId`, verifies that Railgun supports it, then scans from that network's deployment block through the supplied RPC only. A first scan can take time. The result is only as trustworthy as the RPC, so use a provider you trust.

Run the command once with the RPC for each chain you need to inspect. Railgun private pools compatible with the Fiber seed are available on Ethereum, Polygon, Base, Arbitrum, and Sepolia. Unichain and Solana are supported by the backend for public assets and key recovery, but they do not have compatible private pools to scan.

| Backend chain | Chain ID | Private-key recovery | Private-asset scan |
| --- | ---: | --- | --- |
| Ethereum | 1 | EVM | Yes |
| Polygon | 137 | EVM | Yes |
| Base | 8453 | EVM | Yes |
| Arbitrum | 42161 | EVM | Yes |
| Unichain | 130 | EVM | No private pool |
| Sepolia | 11155111 | EVM | Yes |
| Solana | 101 | Solana | No private pool |

The text output includes the token type, contract address, NFT token ID when applicable, and raw integer amount. Raw ERC-20 amounts are not adjusted for decimals.

Use JSON for scripts:

```bash
bun src/index.ts private-assets \
  --file ./backup.fiberseed \
  --rpc-url https://your-rpc.example \
  --json
```

## File format compatibility

Every `.fiberseed` file has a top-level `format` and numeric `version`. The current format is `fiber-wallet-export` version `1`. The encrypted, authenticated seed payload is versioned too, so changing its layout cannot silently reinterpret seed material.

The CLI currently decodes version 1 and rejects unknown versions before password-based decryption. Future format releases must keep the version 1 decoder so existing backups remain recoverable; new layouts or cryptographic parameters must use a new version instead of changing version 1 in place.

## Password handling

Every `.fiberseed` file requires a password. There is no passwordless file mode or CLI bypass. The default prompt disables terminal echo, and the CLI deliberately rejects `--password <value>` because command arguments are visible in shell history and process listings. Use the hidden prompt or `--password-stdin`; both modes still require a non-empty password. Decrypted scan state stays in memory and is not written to a recovery database on disk.

If the RPC URL contains a provider API key, avoid sharing command output that includes your shell history. Prefer a dedicated, rate-limited RPC credential for recovery.

## Security guidance

For private-key recovery, verify that you cloned `https://github.com/fiberevm/cli` and consider running the command on an offline machine. Review the source before entering a real backup password. The `private-key` command does not need an RPC or any other network service.

The `private-assets` command must contact only the RPC URL you provide. The RPC can observe your IP address and scan requests, so use a provider you trust. The seed and password are decrypted locally and are not sent to the RPC.

Treat the terminal output as a live signing key. Clear terminal scrollback after recovery, and never include the key, seed file, password, or unredacted output in screenshots, logs, support requests, or issue reports.

## Run from source

From the public repository:

```bash
bun install --frozen-lockfile
bun test
bun run typecheck
bun src/index.ts --help
```

The public repository is generated from an explicit file allowlist in Fiber's internal monorepo. Its CI tests the same TypeScript source used by the command, and `private: true` prevents accidental npm publication.
