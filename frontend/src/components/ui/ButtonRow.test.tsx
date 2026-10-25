import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import { ButtonRow } from "./ButtonRow";

const columnsOf = (container: HTMLElement) => (container.firstChild as HTMLElement).style.gridTemplateColumns;

describe("ButtonRow", () => {
  it("gives every button its own column", () => {
    const { container } = render(
      <ButtonRow>
        <button>A</button>
        <button>B</button>
      </ButtonRow>,
    );
    expect(columnsOf(container)).toBe("repeat(2, minmax(0, 1fr))");
  });

  it("counts the buttons inside a fragment, not the fragment", () => {
    const { container } = render(
      <ButtonRow>
        <>
          <button>Verify</button>
          <button>Submit</button>
        </>
      </ButtonRow>,
    );
    expect(columnsOf(container)).toBe("repeat(2, minmax(0, 1fr))");
  });
});
