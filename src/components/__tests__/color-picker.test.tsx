import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ColorPicker } from "@/components/color-picker";
import { PLAYER_COLORS } from "@/lib/types";

describe("ColorPicker", () => {
  it("renders all 8 color buttons", () => {
    render(<ColorPicker selected={PLAYER_COLORS[0]} onSelect={() => {}} />);
    const buttons = screen.getAllByRole("button");
    expect(buttons).toHaveLength(8);
  });

  it("marks the selected color with ring classes", () => {
    const { container } = render(
      <ColorPicker selected={PLAYER_COLORS[0]} onSelect={() => {}} />
    );
    const selected = container.querySelector(".ring-3");
    expect(selected).toBeInTheDocument();
    expect(selected).toHaveStyle({ backgroundColor: PLAYER_COLORS[0] });
  });

  it("calls onSelect when a color is clicked", async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    render(
      <ColorPicker selected={PLAYER_COLORS[0]} onSelect={onSelect} />
    );

    const buttons = screen.getAllByRole("button");
    await user.click(buttons[2]); // 3rd color
    expect(onSelect).toHaveBeenCalledWith(PLAYER_COLORS[2]);
  });

  it("disables taken colors", () => {
    render(
      <ColorPicker
        selected={PLAYER_COLORS[0]}
        onSelect={() => {}}
        takenColors={[PLAYER_COLORS[1], PLAYER_COLORS[3]]}
      />
    );

    const buttons = screen.getAllByRole("button");
    expect(buttons[1]).toBeDisabled();
    expect(buttons[3]).toBeDisabled();
    expect(buttons[0]).not.toBeDisabled();
    expect(buttons[2]).not.toBeDisabled();
  });

  it("does not call onSelect for a taken color", async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    render(
      <ColorPicker
        selected={PLAYER_COLORS[0]}
        onSelect={onSelect}
        takenColors={[PLAYER_COLORS[1]]}
      />
    );

    const buttons = screen.getAllByRole("button");
    await user.click(buttons[1]);
    expect(onSelect).not.toHaveBeenCalled();
  });

  it("each button has an aria-label", () => {
    render(<ColorPicker selected={PLAYER_COLORS[0]} onSelect={() => {}} />);
    const buttons = screen.getAllByRole("button");
    buttons.forEach((btn) => {
      expect(btn).toHaveAttribute("aria-label");
    });
  });
});
