import { describe, it, expect } from "vitest";
import Fastify from "fastify";
import { registerHealthRoute } from "./health.js";

describe("GET /health", () => {
  it("returns {ok: true} with status 200", async () => {
    const app = Fastify();
    registerHealthRoute(app);

    const res = await app.inject({ method: "GET", url: "/health" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true });

    await app.close();
  });
});
