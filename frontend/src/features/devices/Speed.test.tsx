import { describe, expect, it } from "vitest";
import { render } from "@testing-library/react";
import { formatSpeed } from "./formatSpeed";
import { Speed } from "./Speed";

describe("formatSpeed", () => {
  it("never signs a speed that rounds to zero", () => {
    expect(formatSpeed(-0, 1)).toEqual({ negative: false, text: "0.0" });
    expect(formatSpeed(-0.04, 1)).toEqual({ negative: false, text: "0.0" });
    expect(formatSpeed(-0.004, 2)).toEqual({ negative: false, text: "0.00" });
  });

  it("signs backing up and rounds the magnitude", () => {
    expect(formatSpeed(-0.36, 1)).toEqual({ negative: true, text: "0.4" });
    expect(formatSpeed(1.234, 2)).toEqual({ negative: false, text: "1.23" });
  });
});

describe("Speed", () => {
  it("keeps the sign slot so the digits stay put", () => {
    const forward = render(<Speed value={0.5} digits={1} />).container;
    const backward = render(<Speed value={-0.5} digits={1} />).container;
    expect(forward.textContent).toBe("0.5 m/s");
    expect(backward.textContent).toBe("−0.5 m/s");
    expect(forward.querySelectorAll("span[aria-hidden]")).toHaveLength(1);
    expect(backward.querySelectorAll("span[aria-hidden]")).toHaveLength(1);
  });

  it("shows a dash when the speed is unknown", () => {
    expect(render(<Speed value={null} digits={1} />).container.textContent).toBe("—");
  });
});
