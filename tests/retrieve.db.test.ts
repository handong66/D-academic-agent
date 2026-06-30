import { describe, it, expect } from "vitest";
import { openDb } from "../src/retrieve/db.js";

describe("openDb", () => {
  it("opens an in-memory db with FTS5 available", () => {
    const db = openDb(":memory:");
    db.exec("CREATE VIRTUAL TABLE t USING fts5(body)");
    db.prepare("INSERT INTO t(body) VALUES (?)").run("social media adolescents");
    const row = db.prepare("SELECT body FROM t WHERE t MATCH ?").get("media") as { body: string };
    expect(row.body).toContain("media");
    db.close();
  });
});
