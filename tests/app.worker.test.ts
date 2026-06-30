import { describe, it, expect } from "vitest";
import { spawn } from "node:child_process";
import { join } from "node:path";

const TSX_LOADER = join(process.cwd(), "node_modules", "tsx", "dist", "loader.mjs");

interface WorkerHarness {
  request(req: object): Promise<any>;
  writeLine(line: string): Promise<any>;
  sendLine(line: string): void;
  readLine(timeoutMs?: number): Promise<any>;
  close(): Promise<void>;
}

function spawnWorker(): WorkerHarness {
  const child = spawn(process.execPath, ["--import", TSX_LOADER, "src/app/worker.ts"], {
    cwd: process.cwd(),
  });
  let buf = "";
  let err = "";
  let exited = false;
  const waiters: Array<{ resolve: (value: any) => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout> }> = [];
  const pending: string[] = []; // lines that arrived with no reader waiting — buffered so bursts aren't dropped

  function rejectAll(error: Error): void {
    while (waiters.length > 0) {
      const waiter = waiters.shift()!;
      clearTimeout(waiter.timer);
      waiter.reject(error);
    }
  }

  function pushLine(line: string): void {
    const waiter = waiters.shift();
    if (!waiter) {
      pending.push(line); // no reader yet — buffer it instead of dropping (fixes the burst-drop race)
      return;
    }
    clearTimeout(waiter.timer);
    try {
      waiter.resolve(JSON.parse(line));
    } catch (error) {
      waiter.reject(error instanceof Error ? error : new Error(String(error)));
    }
  }

  child.stdout.on("data", (chunk) => {
    buf += chunk.toString();
    for (;;) {
      const nl = buf.indexOf("\n");
      if (nl < 0) break;
      const line = buf.slice(0, nl);
      buf = buf.slice(nl + 1);
      pushLine(line);
    }
  });
  child.stderr.on("data", (chunk) => {
    err += chunk.toString();
  });
  child.on("error", (error) => {
    rejectAll(error);
  });
  child.on("exit", (code, signal) => {
    exited = true;
    rejectAll(new Error(`worker exit code=${String(code)} signal=${String(signal)}\n${err}`));
  });

  function readNext(timeoutMs = 30000): Promise<any> {
    return new Promise((resolve, reject) => {
      const buffered = pending.shift();
      if (buffered !== undefined) {
        try {
          resolve(JSON.parse(buffered));
        } catch (error) {
          reject(error instanceof Error ? error : new Error(String(error)));
        }
        return;
      }
      const timer = setTimeout(() => {
        reject(new Error(`worker timeout\n${err}`));
      }, timeoutMs);
      waiters.push({ resolve, reject, timer });
    });
  }

  return {
    request(req: object): Promise<any> {
      return this.writeLine(JSON.stringify(req));
    },
    writeLine(line: string): Promise<any> {
      const response = readNext();
      child.stdin.write(`${line}\n`);
      return response;
    },
    sendLine(line: string): void {
      child.stdin.write(`${line}\n`);
    },
    readLine(timeoutMs?: number): Promise<any> {
      return readNext(timeoutMs);
    },
    async close(): Promise<void> {
      if (exited) return;
      await new Promise<void>((resolve) => {
        const timer = setTimeout(resolve, 1000);
        child.once("exit", () => {
          clearTimeout(timer);
          resolve();
        });
        child.kill();
      });
    },
  };
}

async function withWorker<T>(fn: (worker: WorkerHarness) => Promise<T>): Promise<T> {
  const worker = spawnWorker();
  try {
    return await fn(worker);
  } finally {
    await worker.close();
  }
}

describe("audit worker (child process)", () => {
  it("answers a stdin request with one stdout JSON line", async () => {
    await withWorker(async (worker) => {
      const res = await worker.request({ id: "1", type: "audit", draftText: "Linked to depression (Twenge, 2018)." });
      expect(res.id).toBe("1");
      expect(res.type).toBe("audit_result");
      expect(res.result.sentences.length).toBe(1);
    });
  }, 40000);

  it("emits an error response for a malformed JSON line", async () => {
    await withWorker(async (worker) => {
      const res = await worker.writeLine("not-json");
      expect(res.type).toBe("error");
      expect(typeof res.id).toBe("string");
      expect(res.message.length).toBeGreaterThan(0);
    });
  }, 40000);

  it("handles multiple sequential requests", async () => {
    await withWorker(async (worker) => {
      const first = await worker.request({ id: "1", type: "audit", draftText: "Linked to depression (Twenge, 2018)." });
      const second = await worker.request({ id: "2", type: "audit", draftText: "Sleep is discussed (Orben, 2019)." });
      expect(first.id).toBe("1");
      expect(first.type).toBe("audit_result");
      expect(second.id).toBe("2");
      expect(second.type).toBe("audit_result");
    });
  }, 40000);

  it("continues handling requests after an error response", async () => {
    await withWorker(async (worker) => {
      const error = await worker.writeLine("not-json");
      const next = await worker.request({ id: "after-error", type: "audit", draftText: "Linked to depression (Twenge, 2018)." });
      expect(error.type).toBe("error");
      expect(next.id).toBe("after-error");
      expect(next.type).toBe("audit_result");
    });
  }, 40000);

  it("streams plan_stage lines before the final plan_check_result", async () => {
    await withWorker(async (worker) => {
      const request = { id: "stream-plan", type: "plan_and_check", thesis: "social media use is associated with adolescent depression", judgeBudget: 3 };
      const lines: any[] = [];
      worker.sendLine(JSON.stringify(request));
      lines.push(await worker.readLine());

      while (lines.at(-1)?.type !== "plan_check_result") {
        lines.push(await worker.readLine(5000));
      }

      const finalIndex = lines.findIndex((line) => line.type === "plan_check_result");
      const stageLines = lines.filter((line) => line.type === "plan_stage");

      expect(finalIndex).toBeGreaterThan(0);
      expect(stageLines.length).toBeGreaterThanOrEqual(4);
      expect(stageLines.every((line) => line.id === "stream-plan")).toBe(true);
      expect(stageLines.map((line) => line.stage)).toEqual(expect.arrayContaining(["plan", "retrieve", "judge", "report"]));
      expect(lines.slice(0, finalIndex).every((line) => line.type === "plan_stage")).toBe(true);
      expect(lines[finalIndex]).toMatchObject({ id: "stream-plan", type: "plan_check_result" });
    });
  }, 40000);
});
