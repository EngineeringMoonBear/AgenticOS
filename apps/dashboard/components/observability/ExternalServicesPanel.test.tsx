import { render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { ExternalServicesPanel } from "./ExternalServicesPanel";

function renderWithClient(ui: React.ReactNode) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>{ui}</QueryClientProvider>,
  );
}

interface Payload {
  services: { name: string; status: string; ok: boolean }[];
  checked_at: string;
}

describe("ExternalServicesPanel", () => {
  let payload: Payload = { services: [], checked_at: "" };

  beforeEach(() => {
    vi.spyOn(global, "fetch").mockImplementation(async () => {
      return new Response(JSON.stringify(payload), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    });
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("renders external service rows with status", async () => {
    payload = {
      services: [
        { name: "OpenAI API", status: "82ms", ok: true },
        { name: "DigitalOcean", status: "ok", ok: true },
        { name: "GitHub", status: "ok", ok: true },
        { name: "Cloudflare Access", status: "ok", ok: true },
      ],
      checked_at: new Date().toISOString(),
    };
    renderWithClient(<ExternalServicesPanel />);
    await waitFor(() => {
      expect(screen.getByText("OpenAI API")).toBeInTheDocument();
      expect(screen.getByText("82ms")).toBeInTheDocument();
      expect(screen.getByText("Cloudflare Access")).toBeInTheDocument();
      expect(screen.getByText("External services")).toBeInTheDocument();
    });
  });

  it("renders empty state when no services configured", async () => {
    payload = { services: [], checked_at: new Date().toISOString() };
    renderWithClient(<ExternalServicesPanel />);
    await waitFor(() => {
      expect(
        screen.getByText(/no external services configured/i),
      ).toBeInTheDocument();
    });
  });
});
