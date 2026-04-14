"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { clearSession } from "@/lib/game";
import { checkExtensionPresent, requestVideoDataUri, requestVideoRefresh } from "@/lib/extension";
import type { Dictionary } from "@/lib/dictionaries";
import type { SoloVideoSource, UserBookmark, UserLike } from "@/lib/types";

type VideoFitMode = "cover" | "contain";
type SoloVideo = (UserLike | UserBookmark) & { source: SoloVideoSource };

const VIDEO_COVER_ASPECT_TOLERANCE = 0.14;

function extractVideoIdFromUrl(url: string | null | undefined): string | null {
  if (!url || typeof url !== "string") return null;
  const match = url.match(/\/video\/(\d+)/);
  return match?.[1] ?? null;
}

function getLikeCandidates(video: SoloVideo | null): string[] {
  if (!video) return [];

  const rawCandidates = [
    ...(Array.isArray(video.video_urls) ? video.video_urls : []),
    video.video_url,
  ];

  return rawCandidates
    .filter(
      (url, index, arr) =>
        typeof url === "string" && /^https?:\/\//i.test(url) && arr.indexOf(url) === index
    )
    .filter((url): url is string => typeof url === "string");
}

function pickRandomUnseenIndex(videos: SoloVideo[], history: number[]): number {
  if (videos.length === 0) return -1;

  const unseen = videos
    .map((_, index) => index)
    .filter((index) => !history.includes(index));

  const pool = unseen.length > 0 ? unseen : videos.map((_, index) => index);
  return pool[Math.floor(Math.random() * pool.length)] ?? -1;
}

function shouldTreatMetadataAsBroken(videoWidth: number, videoHeight: number) {
  return videoWidth <= 0 || videoHeight <= 0;
}

export function SoloView({ dict }: { dict: Dictionary }) {
  const router = useRouter();
  const supabase = useMemo(() => createClient(), []);
  const [videos, setVideos] = useState<SoloVideo[]>([]);
  const [selectedSource, setSelectedSource] = useState<SoloVideoSource>("bookmark");
  const [history, setHistory] = useState<number[]>([]);
  const [historyIndex, setHistoryIndex] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [videoSrc, setVideoSrc] = useState<string | null>(null);
  const [videoFitMode, setVideoFitMode] = useState<VideoFitMode>("contain");
  const [soundEnabled, setSoundEnabled] = useState(true);
  const [videoResolving, setVideoResolving] = useState(false);
  const [videoRefreshing, setVideoRefreshing] = useState(false);
  const [videoLoadFailed, setVideoLoadFailed] = useState(false);
  const [deletingSession, setDeletingSession] = useState(false);
  const [controlsHidden, setControlsHidden] = useState(false);
  const [autoAdvanceEnabled, setAutoAdvanceEnabled] = useState(true);
  const [videoCandidateIndex, setVideoCandidateIndex] = useState(0);
  const filteredVideos = useMemo(
    () => videos.filter((video) => video.source === selectedSource),
    [selectedSource, videos]
  );
  const filteredVideoIdsKey = useMemo(
    () => filteredVideos.map((video) => video.id).join(","),
    [filteredVideos]
  );
  const currentLike =
    history.length > 0 ? filteredVideos[history[historyIndex] ?? -1] ?? null : null;
  const videoCandidates = useMemo(() => getLikeCandidates(currentLike), [currentLike]);
  const videoCandidatesKey = useMemo(() => videoCandidates.join(","), [videoCandidates]);
  const videoContainerRef = useRef<HTMLDivElement | null>(null);
  const videoElementRef = useRef<HTMLVideoElement | null>(null);
  const resolvedVideoSrcRef = useRef<string | null>(null);
  const resolvedCandidateRef = useRef<string | null>(null);
  const videoResolveTokenRef = useRef(0);
  const extensionPresentRef = useRef<boolean | null>(null);
  const brokenCandidatesRef = useRef<Set<string>>(new Set());
  const retryingCandidateRef = useRef(false);
  const routerRef = useRef(router);

  useEffect(() => {
    routerRef.current = router;
  }, [router]);

  const canGoBack = historyIndex > 0;

  const loadInitialLikes = useCallback(async () => {
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      routerRef.current.push("/");
      return;
    }

    const [{ data: likesData, error: likesError }, { data: bookmarksData, error: bookmarksError }] =
      await Promise.all([
        supabase.from("user_likes").select("*").eq("user_id", user.id),
        supabase.from("user_bookmarks").select("*").eq("user_id", user.id),
      ]);

    if (likesError || bookmarksError) {
      setError("Failed to load your videos.");
      setLoading(false);
      return;
    }

    const nextVideos = [
      ...(((bookmarksData as UserBookmark[] | null) ?? []).map((bookmark) => ({
        ...bookmark,
        source: "bookmark" as const,
      })) as SoloVideo[]),
      ...(((likesData as UserLike[] | null) ?? []).map((like) => ({
        ...like,
        source: "like" as const,
      })) as SoloVideo[]),
    ].filter((video) => getLikeCandidates(video).length > 0);

    setVideos(nextVideos);
    setLoading(false);
  }, [supabase]);

  useEffect(() => {
    void loadInitialLikes();
    void checkExtensionPresent().then((version) => {
      extensionPresentRef.current = version !== null;
    });
  }, [loadInitialLikes]);

  useEffect(() => {
    brokenCandidatesRef.current = new Set();
    retryingCandidateRef.current = false;
    setVideoCandidateIndex(0);
    setVideoLoadFailed(false);
    setVideoRefreshing(false);
    setVideoResolving(videoCandidates.length > 0);
    setVideoSrc(null);
    setSoundEnabled(true);
    setVideoFitMode("contain");
  }, [videoCandidatesKey]);

  useEffect(() => {
    if (loading) return;

    setHistory(
      filteredVideos.length === 0 ? [] : [pickRandomUnseenIndex(filteredVideos, [])]
    );
    setHistoryIndex(0);
  }, [filteredVideoIdsKey, loading]);

  useEffect(() => {
    return () => {
      if (resolvedVideoSrcRef.current) {
        URL.revokeObjectURL(resolvedVideoSrcRef.current);
      }
    };
  }, []);

  const attemptRefresh = useCallback(async () => {
    if (!currentLike || !extensionPresentRef.current) {
      setVideoLoadFailed(true);
      return;
    }

    const tiktokVideoId =
      currentLike.tiktok_video_id ?? extractVideoIdFromUrl(currentLike.tiktok_url);

    if (!tiktokVideoId) {
      setVideoLoadFailed(true);
      return;
    }

    setVideoRefreshing(true);
    try {
      const result = await requestVideoRefresh({
        tiktok_video_id: tiktokVideoId,
        tiktok_url: currentLike.tiktok_url,
        author_username: currentLike.author_username,
      });

      if (!result.ok) {
        setVideoLoadFailed(true);
        return;
      }

      const refreshed = [
        ...(Array.isArray(result.video_urls) ? result.video_urls : []),
        result.video_url,
      ].filter(
        (url, index, arr): url is string =>
          typeof url === "string" && /^https?:\/\//i.test(url) && arr.indexOf(url) === index
      );

      if (refreshed.length === 0) {
        setVideoLoadFailed(true);
        return;
      }

      const replacement = {
        ...currentLike,
        video_url: refreshed[0] ?? null,
        video_urls: refreshed,
      };

      setVideos((currentVideos) =>
        currentVideos.map((video) =>
          video.id === currentLike.id ? { ...replacement, source: currentLike.source } : video
        )
      );
    } finally {
      setVideoRefreshing(false);
    }
  }, [currentLike]);

  useEffect(() => {
    const candidate = videoCandidates[videoCandidateIndex] ?? null;
    const resolveToken = videoResolveTokenRef.current + 1;
    videoResolveTokenRef.current = resolveToken;

    if (resolvedVideoSrcRef.current) {
      URL.revokeObjectURL(resolvedVideoSrcRef.current);
      resolvedVideoSrcRef.current = null;
    }

    if (!candidate) {
      resolvedCandidateRef.current = null;
      setVideoResolving(false);
      setVideoSrc(null);
      return;
    }

    setVideoResolving(true);
    setVideoLoadFailed(false);
    setVideoSrc(null);

    requestVideoDataUri(candidate)
      .then((blobUrl) => {
        if (videoResolveTokenRef.current !== resolveToken) {
          URL.revokeObjectURL(blobUrl);
          return;
        }

        resolvedVideoSrcRef.current = blobUrl;
        resolvedCandidateRef.current = candidate;
        setVideoSrc(blobUrl);
        setVideoResolving(false);
      })
      .catch(async () => {
        if (videoResolveTokenRef.current !== resolveToken) return;

        const nextIndex = videoCandidateIndex + 1;
        if (nextIndex < videoCandidates.length) {
          setVideoCandidateIndex(nextIndex);
          return;
        }

        await attemptRefresh();
        setVideoResolving(false);
      });

    return () => {
      if (videoResolveTokenRef.current === resolveToken) {
        videoResolveTokenRef.current += 1;
      }
    };
  }, [attemptRefresh, videoCandidateIndex, videoCandidates]);

  const advanceToNextCandidate = useCallback(() => {
    const nextIndex = videoCandidateIndex + 1;
    if (nextIndex < videoCandidates.length) {
      setVideoCandidateIndex(nextIndex);
      return true;
    }

    void attemptRefresh();
    return false;
  }, [attemptRefresh, videoCandidateIndex, videoCandidates.length]);

  const handleNext = useCallback(() => {
    if (historyIndex < history.length - 1) {
      setHistoryIndex((current) => current + 1);
      return;
    }

    const nextLikeIndex = pickRandomUnseenIndex(filteredVideos, history);
    if (nextLikeIndex === -1) return;

    setHistory((current) => [...current, nextLikeIndex]);
    setHistoryIndex((current) => current + 1);
  }, [filteredVideos, history, historyIndex]);

  const handlePrevious = useCallback(() => {
    if (!canGoBack) return;
    setHistoryIndex((current) => current - 1);
  }, [canGoBack]);

  const handleOpenTikTok = useCallback(() => {
    if (!currentLike?.tiktok_url) return;
    window.open(currentLike.tiktok_url, "_blank", "noopener,noreferrer");
  }, [currentLike?.tiktok_url]);

  const handleDeleteSession = useCallback(async () => {
    if (deletingSession) return;

    setDeletingSession(true);
    setError("");

    try {
      const response = await fetch("/api/profile/delete-session", {
        method: "POST",
      });

      if (!response.ok) {
        const data = await response.json();
        setError(data.error ?? "Failed to delete session.");
        return;
      }

      clearSession();
      await supabase.auth.signOut();
      router.push("/");
    } catch {
      setError("Failed to delete session.");
    } finally {
      setDeletingSession(false);
    }
  }, [deletingSession, router, supabase.auth]);

  const handleSoundToggle = useCallback(async () => {
    const element = videoElementRef.current;
    if (!element) return;

    const nextSoundEnabled = !soundEnabled;
    element.muted = !nextSoundEnabled;
    setSoundEnabled(nextSoundEnabled);

    try {
      await element.play();
    } catch {
      element.muted = !soundEnabled;
      setSoundEnabled(soundEnabled);
    }
  }, [soundEnabled]);

  if (loading) {
    return (
      <main className="relative left-1/2 flex h-dvh max-h-dvh w-screen -translate-x-1/2 items-center justify-center overflow-hidden p-6 text-sm text-muted">
        {dict.game.soloLoading}
      </main>
    );
  }

  if (!currentLike) {
    return (
      <main className="relative left-1/2 flex h-dvh max-h-dvh w-screen -translate-x-1/2 flex-col items-center justify-center overflow-hidden gap-4 p-6 text-center">
        <div className="flex flex-wrap items-center justify-center gap-2">
          <SourceButton
            active={selectedSource === "bookmark"}
            label={dict.game.soloSourceBookmarks}
            onClick={() => setSelectedSource("bookmark")}
          />
          <SourceButton
            active={selectedSource === "like"}
            label={dict.game.soloSourceLikes}
            onClick={() => setSelectedSource("like")}
          />
        </div>
        <p className="max-w-md text-sm text-muted">
          {selectedSource === "bookmark"
            ? dict.game.soloEmptyBookmarks
            : dict.game.soloEmptyLikes}
        </p>
        <button
          type="button"
          onClick={handleDeleteSession}
          disabled={deletingSession}
          className="min-h-11 rounded-full border border-red-500/50 px-5 text-sm font-semibold text-red-300 transition hover:border-red-400 hover:text-red-200 disabled:opacity-50"
        >
          {deletingSession ? dict.game.soloDeletingSession : dict.game.soloDeleteSession}
        </button>
        {error ? <p className="text-sm text-red-400">{error}</p> : null}
      </main>
    );
  }

  return (
    <main className="relative left-1/2 flex h-dvh max-h-dvh w-screen -translate-x-1/2 flex-col overflow-hidden bg-black text-white">
      <div
        ref={videoContainerRef}
        className="relative flex h-full min-h-0 flex-1 items-center justify-center overflow-hidden bg-black"
      >
        {videoSrc ? (
          <>
            <video
              key={`bg-${videoSrc}`}
              aria-hidden="true"
              tabIndex={-1}
              src={videoSrc}
              className="pointer-events-none absolute inset-0 block h-full w-full scale-110 object-cover blur-3xl"
              autoPlay
              muted
              playsInline
            />
            <div className="pointer-events-none absolute inset-0 bg-black/35" />
            <video
              key={`fg-${videoSrc}`}
              ref={videoElementRef}
              src={videoSrc}
              className={
                videoFitMode === "cover"
                  ? "relative z-10 h-full w-full object-cover object-center"
                  : "relative z-10 h-full w-auto max-w-none object-contain object-center"
              }
              autoPlay
              playsInline
              muted={!soundEnabled}
              preload="metadata"
              onCanPlay={(event) => {
                const element = event.currentTarget;

                element.muted = !soundEnabled;
                void element.play().catch(() => {
                  element.muted = true;
                  setSoundEnabled(false);
                  void element.play().catch(() => undefined);
                });
              }}
              onPlaying={() => {
                setVideoResolving(false);
              }}
              onEnded={() => {
                if (!autoAdvanceEnabled) return;
                handleNext();
              }}
              onLoadedMetadata={(event) => {
                const element = event.currentTarget;
                const container = videoContainerRef.current;
                const currentCandidate = resolvedCandidateRef.current;

                if (shouldTreatMetadataAsBroken(element.videoWidth, element.videoHeight)) {
                  if (currentCandidate) {
                    if (brokenCandidatesRef.current.has(currentCandidate)) {
                      retryingCandidateRef.current = false;
                      setVideoResolving(false);
                      setVideoLoadFailed(true);
                      return;
                    }

                    brokenCandidatesRef.current.add(currentCandidate);
                  }

                  retryingCandidateRef.current = true;
                  setVideoLoadFailed(false);
                  advanceToNextCandidate();
                  return;
                }

                const videoAspect =
                  element.videoWidth > 0 && element.videoHeight > 0
                    ? element.videoWidth / element.videoHeight
                    : null;
                const containerAspect =
                  container && container.clientWidth > 0 && container.clientHeight > 0
                    ? container.clientWidth / container.clientHeight
                    : null;

                let nextFitMode: VideoFitMode = "contain";
                if (
                  videoAspect &&
                  containerAspect &&
                  Number.isFinite(videoAspect) &&
                  Number.isFinite(containerAspect)
                ) {
                  const delta = Math.abs(videoAspect - containerAspect) / containerAspect;
                  nextFitMode = delta <= VIDEO_COVER_ASPECT_TOLERANCE ? "cover" : "contain";
                }

                setVideoFitMode(nextFitMode);
              }}
              onError={() => {
                if (retryingCandidateRef.current) {
                  retryingCandidateRef.current = false;
                  return;
                }

                setVideoSrc(null);
                setVideoLoadFailed(true);
                advanceToNextCandidate();
              }}
            />
          </>
        ) : (
          <div className="flex h-full w-full items-center justify-center p-6 text-center text-sm text-muted">
            {videoRefreshing ? (
              <p>Refreshing video link...</p>
            ) : videoResolving ? (
              <p>Loading video...</p>
            ) : videoLoadFailed ? (
              <p>This TikTok video expired or could not be loaded in Chrome.</p>
            ) : (
              <p>Video unavailable.</p>
            )}
          </div>
        )}

        {controlsHidden ? (
          <div className="absolute bottom-4 right-4 z-20">
            <button
              type="button"
              onClick={() => setControlsHidden(false)}
              className="min-h-11 rounded-full bg-black/65 px-4 text-sm font-semibold text-white backdrop-blur-md transition hover:bg-black/75"
            >
              {dict.game.soloShowControls}
            </button>
          </div>
        ) : (
          <div className="absolute inset-x-0 bottom-0 z-20 p-4 sm:p-6">
            <div className="mx-auto flex w-full max-w-5xl flex-wrap items-center justify-center gap-3 rounded-3xl bg-black/60 p-3 backdrop-blur-md">
              <SourceButton
                active={selectedSource === "bookmark"}
                label={dict.game.soloSourceBookmarks}
                onClick={() => setSelectedSource("bookmark")}
              />
              <SourceButton
                active={selectedSource === "like"}
                label={dict.game.soloSourceLikes}
                onClick={() => setSelectedSource("like")}
              />
              <button
                type="button"
                onClick={() => setAutoAdvanceEnabled((current) => !current)}
                aria-pressed={autoAdvanceEnabled}
                className="min-h-11 rounded-full border border-white/20 px-4 text-sm font-semibold text-white transition hover:border-white/40"
              >
                {autoAdvanceEnabled
                  ? dict.game.soloModeHandsFree
                  : dict.game.soloModeManual}
              </button>
              <button
                type="button"
                onClick={handlePrevious}
                disabled={!canGoBack}
                className="min-h-11 rounded-full border border-white/20 px-4 text-sm font-semibold text-white transition hover:border-white/40 disabled:opacity-40"
              >
                {dict.game.soloPrevious}
              </button>
              <button
                type="button"
                onClick={handleNext}
                className="min-h-11 rounded-full bg-white px-4 text-sm font-semibold text-black transition hover:bg-white/90"
              >
                {dict.game.soloNext}
              </button>
              <button
                type="button"
                onClick={handleOpenTikTok}
                disabled={!currentLike.tiktok_url}
                className="min-h-11 rounded-full border border-white/20 px-4 text-sm font-semibold text-white transition hover:border-white/40 disabled:opacity-40"
              >
                {dict.game.soloOpenTikTok}
              </button>
              <button
                type="button"
                onClick={handleSoundToggle}
                className="min-h-11 rounded-full border border-white/20 px-4 text-sm font-semibold text-white transition hover:border-white/40"
              >
                {soundEnabled ? "Mute" : "Sound"}
              </button>
              <button
                type="button"
                onClick={() => setControlsHidden(true)}
                className="min-h-11 rounded-full border border-white/20 px-4 text-sm font-semibold text-white transition hover:border-white/40"
              >
                {dict.game.soloHideControls}
              </button>
              <button
                type="button"
                onClick={handleDeleteSession}
                disabled={deletingSession}
                className="min-h-11 rounded-full border border-red-500/50 px-4 text-sm font-semibold text-red-300 transition hover:border-red-400 hover:text-red-200 disabled:opacity-50"
              >
                {deletingSession ? dict.game.soloDeletingSession : dict.game.soloDeleteSession}
              </button>
            </div>
            {error ? <p className="mt-3 text-center text-sm text-red-400">{error}</p> : null}
          </div>
        )}
      </div>
    </main>
  );
}

function SourceButton({
  active,
  label,
  onClick,
}: {
  active: boolean;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`min-h-11 rounded-full px-4 text-sm font-semibold transition ${
        active
          ? "bg-white text-black"
          : "border border-white/20 text-white hover:border-white/40"
      }`}
    >
      {label}
    </button>
  );
}
