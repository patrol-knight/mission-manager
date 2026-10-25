import { describe, it, expect, vi } from "vitest";
import { useState } from "react";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Modal } from "./Modal";

describe("Modal", () => {
  it("closes on a backdrop click only when closeOnBackdrop is set", () => {
    const onClose = vi.fn();
    const { rerender } = render(
      <Modal label="Test" onClose={onClose}>
        <button>Inside</button>
      </Modal>,
    );
    fireEvent.click(screen.getByRole("dialog").parentElement!);
    expect(onClose).not.toHaveBeenCalled();

    rerender(
      <Modal label="Test" onClose={onClose} closeOnBackdrop>
        <button>Inside</button>
      </Modal>,
    );
    fireEvent.click(screen.getByText("Inside"));
    expect(onClose).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("dialog").parentElement!);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("takes focus on open and gives it back on close", async () => {
    function Harness() {
      const [open, setOpen] = useState(false);
      return (
        <>
          <button onClick={() => setOpen(true)}>Open</button>
          {open && (
            <Modal label="Test" onClose={() => setOpen(false)}>
              <button>Inside</button>
            </Modal>
          )}
        </>
      );
    }
    render(<Harness />);
    const opener = screen.getByText("Open");
    await userEvent.click(opener);
    await waitFor(() => expect(screen.getByRole("dialog")).toHaveFocus());
    fireEvent.keyDown(window, { key: "Escape" });
    await waitFor(() => expect(opener).toHaveFocus());
  });

  it("keeps Tab focus inside the dialog", async () => {
    render(
      <Modal label="Test" onClose={() => {}}>
        <button>First</button>
        <button>Last</button>
      </Modal>,
    );
    screen.getByText("Last").focus();
    await userEvent.tab();
    expect(screen.getByText("First")).toHaveFocus();
    await userEvent.tab({ shift: true });
    expect(screen.getByText("Last")).toHaveFocus();
  });

  it("uses the latest onClose without re-running its focus handling", async () => {
    const calls: string[] = [];
    function Harness() {
      const [open, setOpen] = useState(true);
      const [n, setN] = useState(0);
      return open ? (
        <Modal label="Test" onClose={() => { calls.push(`close-${n}`); setOpen(false); }}>
          <button onClick={() => setN(n + 1)}>Bump</button>
        </Modal>
      ) : null;
    }
    render(<Harness />);
    await userEvent.click(screen.getByText("Bump"));
    expect(screen.getByText("Bump")).toHaveFocus();
    fireEvent.keyDown(window, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(calls).toEqual(["close-1"]);
  });
});
