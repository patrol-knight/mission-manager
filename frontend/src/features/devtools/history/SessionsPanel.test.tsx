import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { historyApi, type HistoryStatus, type SessionRow } from "./historyApi";
import { SessionsPanel } from "./SessionsPanel";

vi.mock("./historyApi", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./historyApi")>();
  return {
    ...actual,
    historyApi: {
      ...actual.historyApi,
      sessions: vi.fn(),
      updateSession: vi.fn(),
      deleteSession: vi.fn(),
    },
  };
});

const STATUS: HistoryStatus = {
  database: { configured: true, connected: true, schema_ready: true, error: null },
  map_name: "nsh",
  estimator_installed: true,
  write_enabled: false,
  current_session_id: "bbbbbbbb-0000-0000-0000-000000000000",
  heatmap: { sources: ["sim"], bandwidth_m: 4, half_life_days: 21, prior_hours: 2, floor_per_hour: 0.05, ceiling_per_hour: 5 },
};

function session(id: string, overrides: Partial<SessionRow> = {}): SessionRow {
  return {
    id,
    map_name: "nsh",
    map_hash: null,
    source: "sim",
    started_at: "2026-11-01T09:00:00Z",
    ended_at: "2026-11-01T11:00:00Z",
    last_seen_at: "2026-11-01T11:00:00Z",
    excluded: false,
    label: "Morning run",
    total: 10,
    true_positive: 2,
    false_positive: 3,
    unclear: 1,
    expired: 4,
    last_at: "2026-11-01T10:59:00Z",
    ...overrides,
  };
}

describe("SessionsPanel", () => {
  beforeEach(() => {
    vi.mocked(historyApi.sessions).mockResolvedValue([
      session("aaaaaaaa-0000-0000-0000-000000000000"),
      session("bbbbbbbb-0000-0000-0000-000000000000", { label: null, ended_at: null, source: "real" }),
      session("cccccccc-0000-0000-0000-000000000000", { map_name: "ks" }),
    ]);
    vi.mocked(historyApi.updateSession).mockResolvedValue(undefined);
  });

  it("shows the current map's sessions and marks this run", async () => {
    render(<SessionsPanel status={STATUS} />);
    expect(await screen.findByText(/this run/)).toBeInTheDocument();
    expect(screen.getByText("2 of 3")).toBeInTheDocument();
    expect(screen.getByText("Open")).toBeInTheDocument();
  });

  it("keeps destructive actions off unless the backend allows them", async () => {
    render(<SessionsPanel status={STATUS} />);
    await screen.findByText("2 of 3");
    for (const name of ["Purge…", "Load scenario…", "Seed dummy data"]) {
      expect(screen.getByRole("button", { name })).toBeDisabled();
    }
    screen.getAllByRole("button", { name: "Delete" }).forEach((b) => expect(b).toBeDisabled());
  });

  it("excludes a session from the heatmap", async () => {
    const user = userEvent.setup();
    render(<SessionsPanel status={STATUS} />);
    await screen.findByText("2 of 3");
    await user.click(screen.getAllByRole("switch", { name: "Include in heatmap" })[0]);
    await waitFor(() =>
      expect(historyApi.updateSession).toHaveBeenCalledWith("aaaaaaaa-0000-0000-0000-000000000000", { excluded: true }),
    );
    expect(screen.getAllByRole("switch", { name: "Include in heatmap" })[0]).toHaveAttribute("aria-checked", "false");
  });

  it("renames on Enter", async () => {
    const user = userEvent.setup();
    render(<SessionsPanel status={STATUS} />);
    const input = await screen.findByDisplayValue("Morning run");
    await user.clear(input);
    await user.type(input, "Gate test{Enter}");
    await waitFor(() =>
      expect(historyApi.updateSession).toHaveBeenCalledWith("aaaaaaaa-0000-0000-0000-000000000000", { label: "Gate test" }),
    );
  });
});
