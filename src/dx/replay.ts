import { readFileSync } from "node:fs";
import type { TraceEvent } from "../trace/trace.js";

// DX replay (spec §10): load a persisted JSONL trace, summarize it, and reconstruct ordered steps.
export function loadTrace(path: string): TraceEvent[] {
  return readFileSync(path, "utf8").split("\n").filter((l) => l.trim()).map((l, i) => {
    try {
      return JSON.parse(l) as TraceEvent;
    } catch {
      throw new Error(`replay: malformed trace line ${i + 1}`);
    }
  });
}

export function summarizeTrace(events: TraceEvent[]): { total: number; byEventType: Record<string, number>; models: string[]; outbound_snippet_count: number } {
  const byEventType: Record<string, number> = {};
  for (const e of events) byEventType[e.event_type] = (byEventType[e.event_type] ?? 0) + 1;
  return {
    total: events.length,
    byEventType,
    models: [...new Set(events.map((e) => e.model_id))],
    outbound_snippet_count: events.reduce((s, e) => s + (e.outbound_snippets?.length ?? 0), 0),
  };
}

export function reconstruct(events: TraceEvent[]): { step: number; event_type: string; retrieval_count: number; outbound: number }[] {
  return [...events].sort((a, b) => a.step - b.step).map((e) => ({ step: e.step, event_type: e.event_type, retrieval_count: e.retrieval?.length ?? 0, outbound: e.outbound_snippets?.length ?? 0 }));
}
