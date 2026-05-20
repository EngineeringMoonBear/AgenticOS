import { describe, expect, it } from "vitest";
import { parseSseStream } from "../src/sse";

function makeStream(chunks: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
      controller.close();
    },
  });
}

describe("parseSseStream", () => {
  it("parses a single data event", async () => {
    const stream = makeStream([
      "data: {\"runId\":\"r1\",\"seq\":1,\"ts\":\"2026-01-01T00:00:00Z\",\"kind\":\"log\",\"payload\":\"hello\"}\n\n",
    ]);
    const events = [];
    for await (const evt of parseSseStream(stream)) events.push(evt);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ runId: "r1", seq: 1, kind: "log" });
  });

  it("parses multiple events across chunk boundaries", async () => {
    const stream = makeStream([
      "data: {\"runId\":\"r1\",\"seq\":1,\"ts\":\"2026\",\"kind\":\"log\",\"payload\":1}\n\n",
      "data: {\"runId\":\"r1\",\"seq\":2,\"ts\":\"2026\",\"kind",
      "\":\"log\",\"payload\":2}\n\nx",
    ]);
    const events = [];
    for await (const evt of parseSseStream(stream)) events.push(evt);
    expect(events).toHaveLength(2);
    expect(events.map((e) => e.seq)).toEqual([1, 2]);
  });

  it("ignores comment lines and event-type fields", async () => {
    const stream = makeStream([
      ": keepalive\nevent: message\ndata: {\"runId\":\"r1\",\"seq\":1,\"ts\":\"x\",\"kind\":\"log\",\"payload\":null}\n\n",
    ]);
    const events = [];
    for await (const evt of parseSseStream(stream)) events.push(evt);
    expect(events).toHaveLength(1);
  });

  it("skips malformed JSON without crashing", async () => {
    const stream = makeStream([
      "data: not-json\n\n",
      "data: {\"runId\":\"r1\",\"seq\":1,\"ts\":\"x\",\"kind\":\"log\",\"payload\":\"ok\"}\n\n",
    ]);
    const events = [];
    for await (const evt of parseSseStream(stream)) events.push(evt);
    expect(events).toHaveLength(1);
  });
});
