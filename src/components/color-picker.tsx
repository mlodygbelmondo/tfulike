"use client";

import { PLAYER_COLORS } from "@/lib/types";

interface ColorPickerProps {
  selected: string;
  onSelect: (color: string) => void;
  takenColors?: string[];
}

export function ColorPicker({
  selected,
  onSelect,
  takenColors = [],
}: ColorPickerProps) {
  return (
    <div className="flex flex-wrap gap-3 justify-center">
      {PLAYER_COLORS.map((color) => {
        const taken = takenColors.includes(color);
        const active = selected === color;
        return (
          <button
            key={color}
            type="button"
            disabled={taken}
            onClick={() => onSelect(color)}
            className={`w-12 h-12 rounded-full transition-all ${
              taken
                ? "opacity-20 cursor-not-allowed"
                : active
                  ? "ring-3 ring-white ring-offset-2 ring-offset-black scale-110"
                  : "hover:scale-105"
            }`}
            style={{ backgroundColor: color }}
            aria-label={`Color ${color}`}
          />
        );
      })}
    </div>
  );
}
