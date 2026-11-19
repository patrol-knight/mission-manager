import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ToastProvider } from "../../components/Toast";
import { ExploreCard, ExplorePickCard } from "./ExploreCards";
import { useInvestigationStore } from "../../stores/investigationStore";
import * as investigationApi from "../../api/investigationApi";
import type { Investigation } from "./investigationTypes";

vi.mock("../../api/investigationApi", () => ({ explore: vi.fn(), cancelInvestigation: vi.fn() }));

const point = { x: 5, y: 5, frameId: "map", lat: 1, lon: 2 };
const exploring: Investigation = {
  kind: "manual",
  anomalyId: null,
  robotDeviceId: "robot-1",
  phase: "en_route",
  lookAt: point,
  target: point,
  route: { type: "Feature", geometry: { type: "LineString", coordinates: [] }, properties: { length_m: 40 } },
  etaSec: 63,
  draftVerdict: null,
  startedAt: new Date().toISOString(),
  arrivedAt: null,
};

function renderCards() {
  render(
    <ToastProvider>
      <ExploreCard />
      <ExplorePickCard />
    </ToastProvider>,
  );
}

describe("Explore cards", () => {
  beforeEach(() => {
    useInvestigationStore.setState({ investigation: null, picking: true, picked: null, selectedAnomalyId: null });
    vi.mocked(investigationApi.explore).mockReset();
  });

  it("shows a picked point's distance and ETA, and sends the robot with Investigate", async () => {
    useInvestigationStore.setState({
      picked: { lat: 1, lon: 2, preview: { lookAt: point, target: point, route: exploring.route, lengthM: 41, etaSec: 64 }, error: null },
    });
    vi.mocked(investigationApi.explore).mockResolvedValue(exploring);
    renderCards();
    expect(screen.getByText("41 m")).toBeInTheDocument();
    expect(screen.getByText("1 min")).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Investigate" }));
    expect(investigationApi.explore).toHaveBeenCalledWith(1, 2);
    const state = useInvestigationStore.getState();
    expect(state.investigation?.kind).toBe("manual");
    expect(state.picking).toBe(false);
    expect(state.picked).toBeNull();
  });

  it("can't Investigate a point the robot can't reach", () => {
    useInvestigationStore.setState({ picked: { lat: 1, lon: 2, preview: null, error: "No spot on the lanes" } });
    renderCards();
    expect(screen.getByText("No spot on the lanes")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Investigate" })).toBeDisabled();
  });

  it("shows Explore in progress like an investigation", () => {
    useInvestigationStore.setState({ investigation: exploring, picking: false });
    renderCards();
    expect(screen.getByText("En route")).toBeInTheDocument();
    expect(screen.getByText("ETA")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Cancel" })).toBeInTheDocument();
  });
});
