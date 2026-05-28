import { render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { BackupsPanel } from "./BackupsPanel";

function renderWithClient(ui: React.ReactNode) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>{ui}</QueryClientProvider>,
  );
}

interface Payload {
  backups: {
    id: string;
    name: string;
    detail: string;
    age: string;
    status: "ok" | "aging" | "failed";
  }[];
  next_run: string;
}

describe("BackupsPanel", () => {
  let payload: Payload = { backups: [], next_run: "" };

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

  it("renders backup rows including aging warn pill", async () => {
    payload = {
      backups: [
        {
          id: "postgres",
          name: "Postgres dump",
          detail: "12.4 MB gz · 14:00 today",
          age: "6h ago",
          status: "ok",
        },
        {
          id: "vault",
          name: "Vault snapshot",
          detail: "syncthing · Mac mirror",
          age: "2m ago",
          status: "ok",
        },
        {
          id: "offsite",
          name: "Off-site (DO Spaces)",
          detail: "last successful: 4 days ago",
          age: "4d ago",
          status: "aging",
        },
      ],
      next_run: "next 02:00",
    };
    renderWithClient(<BackupsPanel />);
    await waitFor(() => {
      expect(screen.getByText("Postgres dump")).toBeInTheDocument();
      expect(screen.getByText("Vault snapshot")).toBeInTheDocument();
      expect(screen.getByText("Off-site (DO Spaces)")).toBeInTheDocument();
      expect(screen.getByText("aging")).toBeInTheDocument();
      expect(screen.getByText("4d ago")).toBeInTheDocument();
      expect(screen.getByText("next 02:00")).toBeInTheDocument();
    });
  });

  it("renders empty state when no backups configured", async () => {
    payload = { backups: [], next_run: "—" };
    renderWithClient(<BackupsPanel />);
    await waitFor(() => {
      expect(screen.getByText(/no backups configured/i)).toBeInTheDocument();
    });
  });
});
