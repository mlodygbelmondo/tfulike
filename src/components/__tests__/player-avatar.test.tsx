import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { PlayerAvatar } from "@/components/player-avatar";

describe("PlayerAvatar", () => {
  it("renders initials from single-word nickname", () => {
    render(<PlayerAvatar nickname="Alice" color="#ff2d55" />);
    expect(screen.getByText("A")).toBeInTheDocument();
  });

  it("renders two-letter initials from two-word nickname", () => {
    render(<PlayerAvatar nickname="John Doe" color="#ff2d55" />);
    expect(screen.getByText("JD")).toBeInTheDocument();
  });

  it("caps initials at 2 characters for long names", () => {
    render(<PlayerAvatar nickname="Alice Bob Charlie" color="#ff2d55" />);
    expect(screen.getByText("AB")).toBeInTheDocument();
  });

  it("uppercases initials", () => {
    render(<PlayerAvatar nickname="alice" color="#ff2d55" />);
    expect(screen.getByText("A")).toBeInTheDocument();
  });

  it("shows the nickname when showName is true (default)", () => {
    render(<PlayerAvatar nickname="Alice" color="#ff2d55" />);
    expect(screen.getByText("Alice")).toBeInTheDocument();
  });

  it("hides the nickname when showName is false", () => {
    render(<PlayerAvatar nickname="Alice" color="#ff2d55" showName={false} />);
    expect(screen.queryByText("Alice")).not.toBeInTheDocument();
  });

  it("applies background color from prop", () => {
    render(<PlayerAvatar nickname="Alice" color="#007aff" showName={false} />);
    const circle = screen.getByText("A");
    expect(circle).toHaveStyle({ backgroundColor: "#007aff" });
  });

  it("renders with sm size class", () => {
    const { container } = render(
      <PlayerAvatar nickname="A" color="#ff2d55" size="sm" />
    );
    const circle = container.querySelector(".w-8");
    expect(circle).toBeInTheDocument();
  });

  it("renders with lg size class", () => {
    const { container } = render(
      <PlayerAvatar nickname="A" color="#ff2d55" size="lg" />
    );
    const circle = container.querySelector(".w-16");
    expect(circle).toBeInTheDocument();
  });
});
