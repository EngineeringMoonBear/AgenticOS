import { describe, it, expect, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { CURATOR_AGENT_ID, runCurator } from "./curator";

describe("curator helper", () => {
  it("exposes a stable agent id", () => {
    expect(CURATOR_AGENT_ID).toBe("curator");
  });

  it("runCurator returns ok in scaffold mode", async () => {
    const result = await runCurator({ triggeredBy: "manual" });
    expect(result.ok).toBe(true);
  });
});
