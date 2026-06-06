import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi, afterEach } from "vitest";

vi.mock("@/lib/hooks/use-max-quota", () => ({ useMaxQuota: vi.fn() }));
import { useMaxQuota } from "@/lib/hooks/use-max-quota";
import { MaxQuotaChip } from "./MaxQuotaChip";

const mockHook = useMaxQuota as unknown as ReturnType<typeof vi.fn>;

describe("MaxQuotaChip", () => {
  afterEach(() => vi.clearAllMocks());

  it("renders the remaining percent", () => {
    mockHook.mockReturnValue({
      data: { remaining_pct: 73, remaining_tokens: 730_000, limit_tokens: 1_000_000 },
      isError: false,
    });
    render(<MaxQuotaChip />);
    expect(screen.getByText(/Max: 73%/)).toBeInTheDocument();
  });

  it("shows an em-dash on error", () => {
    mockHook.mockReturnValue({ data: undefined, isError: true });
    render(<MaxQuotaChip />);
    expect(screen.getByText(/Max: —/)).toBeInTheDocument();
  });

  it("shows an em-dash when remaining_pct is null (no limit data)", () => {
    mockHook.mockReturnValue({
      data: { remaining_pct: null, remaining_tokens: null, limit_tokens: null },
      isError: false,
    });
    render(<MaxQuotaChip />);
    expect(screen.getByText(/Max: —/)).toBeInTheDocument();
  });

  it("uses the red tier when nearly exhausted (<10%)", () => {
    mockHook.mockReturnValue({
      data: { remaining_pct: 5, remaining_tokens: 50_000, limit_tokens: 1_000_000 },
      isError: false,
    });
    const { container } = render(<MaxQuotaChip />);
    expect(container.querySelector(".text-red-100")).not.toBeNull();
  });
});
