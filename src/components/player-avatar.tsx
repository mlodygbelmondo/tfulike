"use client";

interface PlayerAvatarProps {
  nickname: string;
  color: string;
  size?: "sm" | "md" | "lg";
  showName?: boolean;
}

const sizeClasses = {
  sm: "w-8 h-8 text-xs",
  md: "w-12 h-12 text-sm",
  lg: "w-16 h-16 text-lg",
};

export function PlayerAvatar({
  nickname,
  color,
  size = "md",
  showName = true,
}: PlayerAvatarProps) {
  const initials = nickname
    .split(" ")
    .map((w) => w[0])
    .join("")
    .toUpperCase()
    .slice(0, 2);

  return (
    <div className="flex flex-col items-center gap-1">
      <div
        className={`${sizeClasses[size]} rounded-full flex items-center justify-center font-bold text-white`}
        style={{ backgroundColor: color }}
      >
        {initials}
      </div>
      {showName && (
        <span className="text-xs text-foreground truncate max-w-[80px]">
          {nickname}
        </span>
      )}
    </div>
  );
}
