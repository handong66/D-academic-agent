/**
 * Env-gated live Consensus smoke. This hits the real Consensus API only when explicitly enabled with:
 * - CONSENSUS_LIVE_TEST=1
 * - CONSENSUS_API_KEY
 *
 * The smoke confirms the REST quick_search response shape and x-api-key auth against the real API.
 */
import { describe, expect, it } from "vitest";
import { createConsensusRest, mapConsensusResultToExternalPaper } from "../src/external/providers/consensus-rest.js";

const requiredEnv = ["CONSENSUS_LIVE_TEST", "CONSENSUS_API_KEY"] as const;
const missingEnv = requiredEnv.filter((name) => (name === "CONSENSUS_LIVE_TEST" ? process.env[name] !== "1" : !process.env[name]));
const liveEnabled = missingEnv.length === 0;

if (!liveEnabled) {
  console.info(`Skipping live Consensus smoke; missing env vars: ${missingEnv.join(", ")}`);
}

describe.skipIf(!liveEnabled)("consensus live adapter smoke", () => {
  it("reads a real quick_search result and maps at least one DOI-bearing paper", async () => {
    const rest = createConsensusRest(
      { baseURL: "https://api.consensus.app", apiKey: process.env.CONSENSUS_API_KEY! },
      { fetch },
    );

    const response = await rest.quickSearch("sleep and academic performance");
    const papers = response.results.map(mapConsensusResultToExternalPaper);
    const doiBearingPaper = papers.find((paper) => paper.doi !== undefined && paper.title.length > 0);

    expect(papers.length).toBeGreaterThanOrEqual(1);
    expect(doiBearingPaper).toMatchObject({
      provider: "consensus",
      doi: expect.any(String),
      title: expect.any(String),
    });
  });
});
