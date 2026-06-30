import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { InMemoryKeyStore, type KeyStore } from "../src/providers/keystore.js";

async function roundTrip(store: KeyStore): Promise<void> {
  expect(await store.get("openai")).toBeUndefined();
  await store.set("openai", "sk-x");
  expect(await store.get("openai")).toBe("sk-x");
  await store.delete("openai");
  expect(await store.get("openai")).toBeUndefined();
}

describe("InMemoryKeyStore", () => {
  it("round-trips values and deletes them", async () => {
    await roundTrip(new InMemoryKeyStore());
  });

  it("keeps independent keys isolated", async () => {
    const store = new InMemoryKeyStore();
    await store.set("embedder", "sk-embed");
    await store.set("judge", "sk-judge");
    expect(await store.get("embedder")).toBe("sk-embed");
    expect(await store.get("judge")).toBe("sk-judge");
    await store.delete("embedder");
    expect(await store.get("embedder")).toBeUndefined();
    expect(await store.get("judge")).toBe("sk-judge");
  });

  it("does not import Electron from the src implementation", async () => {
    const source = await readFile(new URL("../src/providers/keystore.ts", import.meta.url), "utf8");
    expect(source).not.toContain("electron");
  });
});
