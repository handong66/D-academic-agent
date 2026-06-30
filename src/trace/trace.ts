import { createHash } from "node:crypto";

const sha = (x: unknown) => createHash("sha256").update(JSON.stringify(x ?? null)).digest("hex");

export interface RetrievalScore {
  bm25_rank: number;
  vector_distance: number;
  rrf_score: number;
  final_rank: number;
}

// §10 versioned trace event. Tools return these; only the runner/CLI persists them.
export interface TraceEvent {
  schema_version: "1.0";
  event_type: string;
  step: number;
  ts: string;
  model_id: string;
  prompt_version: string;
  temperature?: number;
  context_pack_hash?: string;
  source_hashes: string[];
  retrieval?: RetrievalScore[];
  input_hash: string;
  output_hash: string;
  cost?: number;
  outbound_snippets: string[];
}

export class Tracer {
  private events: TraceEvent[] = [];
  private step = 0;
  constructor(private readonly ctx: { model_id: string; prompt_version: string }) {}
  add(e: {
    event_type: string;
    input?: unknown;
    output?: unknown;
    source_hashes?: string[];
    retrieval?: RetrievalScore[];
    outbound_snippets?: string[];
    temperature?: number;
    context_pack_hash?: string;
    cost?: number;
  }): void {
    this.events.push({
      schema_version: "1.0",
      event_type: e.event_type,
      step: this.step++,
      ts: new Date().toISOString(),
      model_id: this.ctx.model_id,
      prompt_version: this.ctx.prompt_version,
      temperature: e.temperature,
      context_pack_hash: e.context_pack_hash,
      source_hashes: e.source_hashes ?? [],
      retrieval: e.retrieval,
      input_hash: sha(e.input),
      output_hash: sha(e.output),
      cost: e.cost,
      outbound_snippets: e.outbound_snippets ?? [],
    });
  }
  drain(): TraceEvent[] {
    const e = this.events;
    this.events = [];
    return e;
  }
}
