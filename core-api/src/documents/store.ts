import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";

/**
 * The private folder of PDFs. A file is named after its SHA-256, so the name is also the proof of what
 * it holds: reading verifies the bytes against it, and a file that was changed on disk is refused.
 * Files are written once and never overwritten.
 */

export class StoredFileError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "StoredFileError";
  }
}

const SHA256 = /^[0-9a-f]{64}$/;

export const sha256Of = (bytes: Buffer): string => createHash("sha256").update(bytes).digest("hex");

const pathOf = (dir: string, sha256: string): string => {
  if (!SHA256.test(sha256)) throw new StoredFileError("invalid file hash");
  return join(resolve(dir), `${sha256}.pdf`);
};

export const saveFile = async (dir: string, bytes: Buffer): Promise<{ sha256: string; sizeBytes: number }> => {
  const sha256 = sha256Of(bytes);
  await mkdir(resolve(dir), { recursive: true, mode: 0o700 });
  try {
    // "wx": never replaces a file that is already there.
    await writeFile(pathOf(dir, sha256), bytes, { flag: "wx", mode: 0o600 });
  } catch (cause) {
    if ((cause as NodeJS.ErrnoException).code !== "EEXIST") throw cause;
  }
  return { sha256, sizeBytes: bytes.length };
};

export const readStoredFile = async (dir: string, sha256: string): Promise<Buffer> => {
  let bytes: Buffer;
  try {
    bytes = await readFile(pathOf(dir, sha256));
  } catch (cause) {
    if ((cause as NodeJS.ErrnoException).code === "ENOENT") throw new StoredFileError("the stored file is missing");
    throw cause;
  }
  if (sha256Of(bytes) !== sha256) throw new StoredFileError("the stored file does not match its hash");
  return bytes;
};
