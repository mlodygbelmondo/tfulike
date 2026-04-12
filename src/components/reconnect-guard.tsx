"use client";

import { useReconnect } from "@/lib/use-reconnect";

export function ReconnectGuard({
  lang,
  children,
}: {
  lang: string;
  children: React.ReactNode;
}) {
  const { reconnecting } = useReconnect(lang);

  if (reconnecting) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="flex flex-col items-center gap-3">
          <div className="w-8 h-8 border-2 border-accent border-t-transparent rounded-full animate-spin" />
          <p className="text-muted text-sm">Reconnecting...</p>
        </div>
      </div>
    );
  }

  return <>{children}</>;
}
