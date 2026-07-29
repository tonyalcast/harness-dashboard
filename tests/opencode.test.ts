import { describe, expect, test } from "bun:test";
import { readFileSync } from "fs";
import { makeEventId } from "../src/adapters/util";
import { normalizeOpenCodeModel } from "../src/adapters/opencode";

describe("opencode cost:0 fixture", () => {
  test("treats zero cost with tokens as missing", () => {
    const raw = JSON.parse(
      readFileSync("tests/fixtures/opencode-message-cost0.json", "utf8"),
    ) as {
      id: string;
      sessionID: string;
      modelID: string;
      cost: number;
      tokens: {
        input: number;
        output: number;
        reasoning: number;
        cache: { write: number; read: number };
      };
      time: { created: number };
    };

    const inTok = raw.tokens.input;
    const outTok = raw.tokens.output + raw.tokens.reasoning;
    const costReported =
      typeof raw.cost === "number" &&
      raw.cost > 0 &&
      inTok + outTok + raw.tokens.cache.write + raw.tokens.cache.read > 0
        ? raw.cost
        : undefined;

    expect(costReported).toBeUndefined();
    expect(normalizeOpenCodeModel(raw.modelID)).toBe("claude-sonnet-4");
    expect(makeEventId("opencode", raw.sessionID, raw.id)).toHaveLength(32);
  });
});
