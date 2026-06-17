import { describe, it, expect } from "vitest";
import { vikingUriFor } from "../src/ingest/viking-uri.js";

describe("vikingUriFor", () => {
  it("maps a loose top-level note into the notes/ scope", () => {
    expect(vikingUriFor("HELLO.md")).toBe("viking://resources/notes/HELLO.md");
  });

  it("keeps a scoped path verbatim", () => {
    expect(vikingUriFor("farming/x/y.md")).toBe("viking://resources/farming/x/y.md");
  });

  it("keeps a single-dir scoped path verbatim", () => {
    expect(vikingUriFor("dev/notes.md")).toBe("viking://resources/dev/notes.md");
  });
});
