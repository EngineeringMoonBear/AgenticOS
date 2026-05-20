import "server-only";
import { createParser, type EventSourceMessage } from "eventsource-parser";
import type { HermesEvent } from "./types";

/**
 * Parse a ReadableStream of bytes as SSE and yield typed HermesEvents.
 * Malformed JSON payloads are silently dropped; the iterator continues.
 */
export async function* parseSseStream(
  stream: ReadableStream<Uint8Array>,
): AsyncIterable<HermesEvent> {
  const queue: HermesEvent[] = [];
  const parser = createParser({
    onEvent(msg: EventSourceMessage) {
      if (!msg.data) return;
      try {
        const parsed = JSON.parse(msg.data) as HermesEvent;
        queue.push(parsed);
      } catch {
        // Skip malformed payloads
      }
    },
  });

  const reader = stream.getReader();
  const decoder = new TextDecoder();

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    parser.feed(decoder.decode(value, { stream: true }));
    while (queue.length > 0) yield queue.shift()!;
  }
  while (queue.length > 0) yield queue.shift()!;
}
