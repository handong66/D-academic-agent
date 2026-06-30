import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { app, safeStorage } from "electron";
import type { KeyStore } from "../src/providers/keystore.js";

type StoredKeys = Record<string, string>;

export class ElectronKeyStore implements KeyStore {
  private readonly filePath: string;
  private warnedUnavailable = false;

  constructor(filePath = join(app.getPath("userData"), "provider-keystore.json")) {
    if (!app.isReady()) {
      throw new Error("ElectronKeyStore must be constructed after app.whenReady()");
    }
    this.filePath = filePath;
  }

  async get(key: string): Promise<string | undefined> {
    const store = await this.readStore();
    const encrypted = store[key];
    if (!encrypted) return undefined;
    if (!this.encryptionAvailable()) return undefined;
    return safeStorage.decryptString(Buffer.from(encrypted, "base64"));
  }

  async set(key: string, value: string): Promise<void> {
    if (!key.trim()) throw new Error("keyRef must be a non-empty string");
    if (!this.encryptionAvailable()) {
      throw new Error("safeStorage encryption is unavailable; refusing to store API key");
    }

    const store = await this.readStore();
    store[key] = safeStorage.encryptString(value).toString("base64");
    await this.writeStore(store);
  }

  async delete(key: string): Promise<void> {
    const store = await this.readStore();
    delete store[key];
    if (Object.keys(store).length === 0) {
      await rm(this.filePath, { force: true });
      return;
    }
    await this.writeStore(store);
  }

  private encryptionAvailable(): boolean {
    const available = safeStorage.isEncryptionAvailable();
    if (!available && !this.warnedUnavailable) {
      this.warnedUnavailable = true;
      console.warn("Electron safeStorage encryption is unavailable; API keys will not be persisted.");
    }
    return available;
  }

  private async readStore(): Promise<StoredKeys> {
    try {
      const raw = await readFile(this.filePath, "utf8");
      const parsed: unknown = JSON.parse(raw);
      if (!isStoredKeys(parsed)) return {};
      return parsed;
    } catch (error) {
      if (isNodeError(error) && error.code === "ENOENT") return {};
      throw error;
    }
  }

  private async writeStore(store: StoredKeys): Promise<void> {
    await mkdir(dirname(this.filePath), { recursive: true });
    await writeFile(this.filePath, `${JSON.stringify(store, null, 2)}\n`, "utf8");
  }
}

function isStoredKeys(value: unknown): value is StoredKeys {
  if (typeof value !== "object" || value === null) return false;
  return Object.values(value).every((entry) => typeof entry === "string");
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}
