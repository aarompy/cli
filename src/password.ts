import { stdin, stderr } from "node:process";
import { StringDecoder } from "node:string_decoder";

const MAX_PASSWORD_BYTES = 4_096;

/**
 * Reads one password line from redirected stdin without accepting unbounded input.
 * It accepts a readable stream so command tests do not need to replace process globals.
 */
export async function readPasswordFromStdin(input: NodeJS.ReadableStream = stdin): Promise<string> {
  let password = "";
  for await (const chunk of input) {
    password += chunk.toString();
    if (Buffer.byteLength(password) > MAX_PASSWORD_BYTES) {
      throw new Error("Password input is too large");
    }
  }

  const firstLine = password.split(/\r?\n/, 1)[0] ?? "";
  if (!firstLine) throw new Error("Password cannot be empty");
  return firstLine;
}

/**
 * Prompts on the terminal with echo disabled so the export password stays off-screen.
 * It accepts the process TTY streams and restores their original mode before returning.
 */
export async function readHiddenPassword(): Promise<string> {
  if (!stdin.isTTY || !stderr.isTTY || typeof stdin.setRawMode !== "function") {
    throw new Error("A terminal is required for the hidden password prompt; use --password-stdin");
  }

  stderr.write("Export password: ");
  stdin.setRawMode(true);
  stdin.resume();

  try {
    return await new Promise<string>((resolve, reject) => {
      let password = "";
      const decoder = new StringDecoder("utf8");

      const onData = (chunk: Buffer) => {
        for (const character of decoder.write(chunk)) {
          if (character === "\u0003" || character === "\u0004") {
            cleanup();
            reject(new Error("Cancelled"));
            return;
          }
          if (character === "\n" || character === "\r") {
            cleanup();
            if (!password) reject(new Error("Password cannot be empty"));
            else resolve(password);
            return;
          }
          if (character === "\b" || character === "\u007f") {
            password = [...password].slice(0, -1).join("");
            continue;
          }
          password += character;
          if (Buffer.byteLength(password) > MAX_PASSWORD_BYTES) {
            cleanup();
            reject(new Error("Password input is too large"));
            return;
          }
        }
      };

      const cleanup = () => {
        stdin.off("data", onData);
        stdin.setRawMode(false);
        stdin.pause();
        stderr.write("\n");
      };

      stdin.on("data", onData);
    });
  } finally {
    if (stdin.isRaw) stdin.setRawMode(false);
  }
}
