import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MissionCard } from "./MissionCard";
import { useMissionStore } from "../../stores/missionStore";

vi.mock("../../hooks/useApiConnection", () => ({ useApiConnection: () => ({ status: "connected" }) }));

describe("MissionCard without a current mission", () => {
  beforeEach(() => {
    useMissionStore.setState({ definition: null, execution: null });
  });

  it("offers both picking a saved mission and creating one", async () => {
    const onEdit = vi.fn();
    const onCreate = vi.fn();
    render(<MissionCard onEdit={onEdit} onCreate={onCreate} />);

    await userEvent.click(screen.getByRole("button", { name: "Choose mission" }));
    expect(onEdit).toHaveBeenCalled();
    await userEvent.click(screen.getByRole("button", { name: "Create mission" }));
    expect(onCreate).toHaveBeenCalled();
  });
});
