"use client";

import type { Profile } from "@/lib/types";
import type { Dictionary } from "@/lib/dictionaries";

interface UserMenuProps {
  profile: Profile;
  dict: Dictionary;
}

export function UserMenu({ profile, dict }: UserMenuProps) {
  const initial = profile.nickname.charAt(0).toUpperCase();

  return (
    <div className="absolute right-6 top-6 flex items-center gap-3">
      {/* Avatar */}
      <div className="flex items-center gap-2">
        {profile.avatar_url ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={profile.avatar_url}
            alt={profile.nickname}
            className="h-8 w-8 rounded-full object-cover"
            referrerPolicy="no-referrer"
          />
        ) : (
          <div
            className="flex h-8 w-8 items-center justify-center rounded-full text-sm font-bold text-white"
            style={{ backgroundColor: profile.color }}
          >
            {initial}
          </div>
        )}
        <span className="text-sm font-medium text-foreground">
          {profile.nickname}
        </span>
      </div>

      {/* Sign out */}
      <form action="/auth/signout" method="POST">
        <button
          type="submit"
          className="inline-flex h-8 items-center justify-center whitespace-nowrap rounded-full border border-surface-2 px-3 text-xs leading-none text-muted transition-colors hover:text-foreground"
        >
          {dict.auth?.signOut ?? "Sign out"}
        </button>
      </form>
    </div>
  );
}
