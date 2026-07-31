import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { CameraGrid } from "./CameraGrid";
import type { CameraInfo } from "../../types/domain";

function cams(n: number): CameraInfo[] {
  return Array.from({ length: n }, (_, i) => ({ id: `cam-${i}`, name: `Camera ${i + 1}`, status: "live" as const }));
}

describe("CameraGrid", () => {
  it("shows an empty state for 0 cameras", () => {
    render(<CameraGrid cameras={[]} streams={{}} onFocusCamera={vi.fn()} />);
    expect(screen.getByText(/no cameras available/i)).toBeInTheDocument();
  });

  it.each([
    [1, 1],
    [2, 2],
    [3, 2],
    [4, 2],
    [5, 3],
    [8, 3],
  ])("renders %i camera(s) in a %i-column grid", (count, expectedColumns) => {
    const { container } = render(<CameraGrid cameras={cams(count)} streams={{}} onFocusCamera={vi.fn()} />);
    const grid = container.firstElementChild as HTMLElement;
    expect(grid.style.gridTemplateColumns).toBe(`repeat(${expectedColumns}, 1fr)`);
    expect(screen.getAllByRole("button")).toHaveLength(count);
  });

  it("invokes onFocusCamera with the clicked camera's id", async () => {
    const onFocusCamera = vi.fn();
    render(<CameraGrid cameras={cams(2)} streams={{}} onFocusCamera={onFocusCamera} />);
    screen.getByText("Camera 1").closest("button")!.click();
    expect(onFocusCamera).toHaveBeenCalledWith("cam-0");
  });
});
