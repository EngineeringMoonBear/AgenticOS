import { describe, it, expect } from "vitest";
import { serializeFilter, parseFilter } from "./codec";

describe("serializeFilter", () => {
  it("returns empty string for an empty array", () => {
    expect(serializeFilter([])).toBe("");
  });

  it("serializes a single tag", () => {
    expect(serializeFilter(["goldberry"])).toBe("goldberry");
  });

  it("joins multiple tags with commas", () => {
    expect(serializeFilter(["goldberry", "code"])).toBe("goldberry,code");
  });
});

describe("parseFilter", () => {
  it("returns empty array for null", () => {
    expect(parseFilter(null)).toEqual([]);
  });

  it("returns empty array for undefined", () => {
    expect(parseFilter(undefined)).toEqual([]);
  });

  it("returns empty array for empty string", () => {
    expect(parseFilter("")).toEqual([]);
  });

  it("parses a single tag", () => {
    expect(parseFilter("goldberry")).toEqual(["goldberry"]);
  });

  it("parses multiple tags", () => {
    expect(parseFilter("goldberry,code")).toEqual(["goldberry", "code"]);
  });

  it("trims whitespace from tags", () => {
    expect(parseFilter("goldberry, code ")).toEqual(["goldberry", "code"]);
  });

  it("deduplicates tags", () => {
    expect(parseFilter("a,a,b")).toEqual(["a", "b"]);
  });

  it("drops empty entries", () => {
    expect(parseFilter(",a,,b,")).toEqual(["a", "b"]);
  });

  it("lowercases tags", () => {
    expect(parseFilter("Goldberry,CODE")).toEqual(["goldberry", "code"]);
  });
});

describe("roundtrip", () => {
  it("parse(serialize(x)) === x for any valid input", () => {
    const inputs: string[][] = [
      [],
      ["goldberry"],
      ["goldberry", "code"],
      ["a", "b", "c"],
    ];
    for (const input of inputs) {
      expect(parseFilter(serializeFilter(input))).toEqual(input);
    }
  });
});
