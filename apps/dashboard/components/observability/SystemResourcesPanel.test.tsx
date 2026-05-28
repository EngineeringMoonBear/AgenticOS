import { render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { SystemResourcesPanel } from "./SystemResourcesPanel";

function renderWithClient(ui: React.ReactNode) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>{ui}</QueryClientProvider>,
  );
}

interface ResourcePayload {
  cpu: { name: string; percent: number; detail: string };
  ram: { name: string; percent: number; detail: string };
  disk: { name: string; percent: number; detail: string };
  meta: string;
}

describe("SystemResourcesPanel", () => {
  let payload: ResourcePayload = {
    cpu: { name: "CPU", percent: 0, detail: "" },
    ram: { name: "RAM", percent: 0, detail: "" },
    disk: { name: "Disk", percent: 0, detail: "" },
    meta: "",
  };

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

  it("renders CPU/RAM/Disk progress bars with details and meta", async () => {
    payload = {
      cpu: { name: "CPU", percent: 12, detail: "12% · 2 vCPU" },
      ram: { name: "RAM", percent: 65, detail: "2.6 / 4.0 GB · 65%" },
      disk: { name: "Disk", percent: 28, detail: "22.4 / 80 GB · 28%" },
      meta: "droplet · 4 GB · uptime 3d 14h",
    };
    renderWithClient(<SystemResourcesPanel />);
    await waitFor(() => {
      expect(screen.getByText("CPU")).toBeInTheDocument();
      expect(screen.getByText("RAM")).toBeInTheDocument();
      expect(screen.getByText("Disk")).toBeInTheDocument();
      expect(screen.getByText(/droplet · 4 GB/)).toBeInTheDocument();
      expect(screen.getByText("2.6 / 4.0 GB · 65%")).toBeInTheDocument();
    });
  });

  it("shows loading state initially", async () => {
    payload = {
      cpu: { name: "CPU", percent: 0, detail: "" },
      ram: { name: "RAM", percent: 0, detail: "" },
      disk: { name: "Disk", percent: 0, detail: "" },
      meta: "",
    };
    renderWithClient(<SystemResourcesPanel />);
    expect(screen.getByText(/loading/i)).toBeInTheDocument();
  });
});
