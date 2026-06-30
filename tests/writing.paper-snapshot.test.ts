import { describe, expect, it } from "vitest";
import type { ToolContext } from "../src/tools/tools.js";
import { paperSnapshot } from "../src/writing/paper-snapshot.js";

function context(texts: Map<string, string>): ToolContext {
  return { texts } as ToolContext;
}

describe("paperSnapshot", () => {
  it("extracts labelled sections with verbatim excerpts from clear headings", () => {
    const ctx = context(
      new Map([
        [
          "source-with-headings",
          [
            "Participants completed the protocol before analysis.",
            "",
            "Methods",
            "We sampled 42 participants and kept the interview guide unchanged.",
            "",
            "Results",
            "Scores improved by two points after the intervention.",
            "",
            "Limitations",
            "The fixture is small and synthetic.",
          ].join("\n"),
        ],
      ]),
    );

    expect(paperSnapshot("source-with-headings", ctx)).toEqual({
      sourceId: "source-with-headings",
      found: true,
      sparse: false,
      sections: [
        {
          label: "methods",
          heading: "Methods",
          excerpt: "We sampled 42 participants and kept the interview guide unchanged.",
        },
        {
          label: "results",
          heading: "Results",
          excerpt: "Scores improved by two points after the intervention.",
        },
        {
          label: "limitations",
          heading: "Limitations",
          excerpt: "The fixture is small and synthetic.",
        },
      ],
    });
  });

  it("returns a sparse snapshot for heading-less text", () => {
    const ctx = context(
      new Map([
        [
          "headingless",
          "Participants completed the protocol before analysis. Scores improved by two points after the intervention.",
        ],
      ]),
    );

    expect(paperSnapshot("headingless", ctx)).toEqual({
      sourceId: "headingless",
      found: true,
      sparse: true,
      sections: [],
    });
  });

  it("reports a missing source id as not found", () => {
    const ctx = context(new Map([["existing", "Methods\nA paragraph."]]));

    expect(paperSnapshot("missing", ctx)).toEqual({
      sourceId: "missing",
      found: false,
      sparse: true,
      sections: [],
    });
  });
});
