"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { PlayerAvatar } from "@/components/player-avatar";
import { getStoredSession } from "@/lib/game";
import {
  requestVideoRefresh,
  checkExtensionPresent,
  requestVideoDataUri,
} from "@/lib/extension";
import type { Player, Round, Video, RoomSettings } from "@/lib/types";
import type { Dictionary } from "@/lib/dictionaries";

const VIDEO_DEBUG_STORAGE_KEY = "tfulike_debug_video";

function isVideoDebugEnabled(): boolean {
  if (typeof window === "undefined") return false;

  try {
    return window.localStorage.getItem(VIDEO_DEBUG_STORAGE_KEY) === "1";
  } catch {
    return false;
  }
}

function summarizeVideoUrlForDebug(rawUrl: string | null | undefined) {
  if (!rawUrl || typeof rawUrl !== "string") {
    return null;
  }

  try {
    const url = new URL(rawUrl);
    const expire = url.searchParams.get("expire");
    const expireAt = expire ? Number(expire) : null;
    const nowSeconds = Math.floor(Date.now() / 1000);
    const queryKeys = Array.from(new Set(url.searchParams.keys()))
      .filter((key) => !["signature", "tk", "l", "X-Bogus"].includes(key))
      .sort();

    return {
      host: url.host,
      pathTail: url.pathname.split("/").slice(-4).join("/"),
      expireAt,
      expiresInSec:
        typeof expireAt === "number" && Number.isFinite(expireAt)
          ? expireAt - nowSeconds
          : null,
      hasSignature: url.searchParams.has("signature"),
      hasTk: url.searchParams.has("tk"),
      queryKeyCount: queryKeys.length,
      queryKeysPreview: queryKeys.slice(0, 8),
    };
  } catch {
    return { invalid: true };
  }
}

function logVideoDebug(step: string, details: Record<string, unknown>) {
  if (!isVideoDebugEnabled()) return;
  console.debug("[DEBUG][tfulike-video]", step, details);
}

/**
 * Extract TikTok video ID from a TikTok URL like
 * https://www.tiktok.com/@user/video/1234567890
 */
function extractVideoIdFromUrl(url: string | null | undefined): string | null {
  if (!url || typeof url !== "string") return null;
  const match = url.match(/\/video\/(\d+)/);
  return match?.[1] ?? null;
}

type GamePhase = "loading" | "voting" | "reveal" | "finished";

type VideoFitMode = "cover" | "contain";

const VIDEO_COVER_ASPECT_TOLERANCE = 0.14;

interface RevealData {
  correct_player_id: string;
  votes: Array<{
    player_id: string;
    guessed_player_id: string;
    is_correct: boolean;
  }>;
  score_deltas: Record<string, number>;
  players: Player[];
}

export function GamePlayView({
  lang,
  pin,
  dict,
}: {
  lang: string;
  pin: string;
  dict: Dictionary;
}) {
  const router = useRouter();
  const [phase, setPhase] = useState<GamePhase>("loading");
  const [round, setRound] = useState<Round | null>(null);
  const [video, setVideo] = useState<Video | null>(null);
  const [players, setPlayers] = useState<Player[]>([]);
  const [currentPlayer, setCurrentPlayer] = useState<Player | null>(null);
  const [votedFor, setVotedFor] = useState<string | null>(null);
  const [revealData, setRevealData] = useState<RevealData | null>(null);
  const [totalRounds, setTotalRounds] = useState(0);
  const [roomId, setRoomId] = useState<string | null>(null);
  const [allVoted, setAllVoted] = useState(false);
  const [error, setError] = useState("");
  const [slotRevealing, setSlotRevealing] = useState(false);
  const [slotDone, setSlotDone] = useState(false);
  const [videoSrc, setVideoSrc] = useState<string | null>(null);
  const [videoFitMode, setVideoFitMode] = useState<VideoFitMode>("contain");
  const [soundEnabled, setSoundEnabled] = useState(true);
  const [videoCandidates, setVideoCandidates] = useState<string[]>([]);
  const [videoCandidateIndex, setVideoCandidateIndex] = useState(0);
  const [videoLoadFailed, setVideoLoadFailed] = useState(false);
  const [videoRefreshing, setVideoRefreshing] = useState(false);
  const [videoRefreshAttempted, setVideoRefreshAttempted] = useState(false);
  const [videoResolving, setVideoResolving] = useState(false);
  const [revealSubmitting, setRevealSubmitting] = useState(false);
  const [nextRoundSubmitting, setNextRoundSubmitting] = useState(false);
  const revealTriggeredRef = useRef(false);
  const videoElementRef = useRef<HTMLVideoElement | null>(null);
  const videoContainerRef = useRef<HTMLDivElement | null>(null);
  const videoLoadTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const extensionPresentRef = useRef<boolean | null>(null);
  const videoRefreshAttemptedRef = useRef(false);
  const resolvedVideoSrcRef = useRef<string | null>(null);
  const videoResolveTokenRef = useRef(0);
  const currentVideoIdRef = useRef<string | null>(null);
  const fetchRoundTokenRef = useRef(0);

  const videoSourceKey = [
    video?.id ?? "",
    video?.video_url ?? "",
    Array.isArray(video?.video_urls) ? video.video_urls.join("|") : "",
  ].join("::");

  useEffect(() => {
    currentVideoIdRef.current = video?.id ?? null;
  }, [video?.id]);

  const fetchRound = useCallback(async () => {
    const fetchToken = fetchRoundTokenRef.current + 1;
    fetchRoundTokenRef.current = fetchToken;
    const supabase = createClient();
    const session = getStoredSession();

    if (!session || session.roomPin !== pin) {
      router.push(`/${lang}/join`);
      return;
    }

    // Get room
    const { data: room } = await supabase
      .from("rooms")
      .select("*")
      .eq("pin", pin)
      .single();

    if (!room || fetchRoundTokenRef.current !== fetchToken) return;
    setRoomId(room.id);

    if (room.status === "finished") {
      router.push(`/${lang}/room/${pin}/results`);
      return;
    }

    if (room.status === "lobby") {
      router.push(`/${lang}/room/${pin}`);
      return;
    }

    const settings = room.settings as RoomSettings & { total_rounds?: number };
    setTotalRounds(settings.total_rounds || 30);

    // Get players
    const { data: playersData } = await supabase
      .from("players")
      .select("*")
      .eq("room_id", room.id)
      .order("score", { ascending: false });

    if (fetchRoundTokenRef.current !== fetchToken) return;

    setPlayers((playersData as Player[]) || []);

    const me = playersData?.find(
      (p: Player) => p.id === session.playerId
    );
    if (me) setCurrentPlayer(me as Player);

    // Get current round
    const { data: roundData } = await supabase
      .from("rounds")
      .select("*")
      .eq("room_id", room.id)
      .eq("round_number", room.current_round)
      .single();

    if (!roundData || fetchRoundTokenRef.current !== fetchToken) return;
    setRound(roundData as Round);

    // Get video for this round
    if (roundData.video_id) {
      const { data: videoData } = await supabase
        .from("videos")
        .select("*")
        .eq("id", roundData.video_id)
        .single();

      if (videoData && fetchRoundTokenRef.current === fetchToken) {
        setVideo(videoData as Video);
        logVideoDebug("round-video-loaded", {
          pin,
          roundId: roundData.id,
          videoId: videoData.id,
          playerId: videoData.player_id,
          directVideoUrl: summarizeVideoUrlForDebug(videoData.video_url),
          candidateCount: Array.isArray(videoData.video_urls)
            ? videoData.video_urls.length
            : videoData.video_url
              ? 1
              : 0,
          candidatePreview: Array.isArray(videoData.video_urls)
            ? videoData.video_urls
                .slice(0, 4)
                .map((url: string) => summarizeVideoUrlForDebug(url))
            : [],
        });
      }
    }

    // Check if we already voted
    const { data: existingVote } = await supabase
      .from("votes")
      .select("guessed_player_id")
      .eq("round_id", roundData.id)
      .eq("player_id", session.playerId)
      .maybeSingle();

    if (fetchRoundTokenRef.current !== fetchToken) return;

    if (existingVote) {
      setVotedFor(existingVote.guessed_player_id);
    } else {
      setVotedFor(null);
    }

    // Check vote count to determine if everyone voted
    const { count: voteCount } = await supabase
      .from("votes")
      .select("*", { count: "exact", head: true })
      .eq("round_id", roundData.id);

    if (fetchRoundTokenRef.current !== fetchToken) return;

    const playerCount = playersData?.length || 0;
    setAllVoted(!!voteCount && voteCount >= playerCount);

    if (roundData.status === "voting") {
      setPhase("voting");
      revealTriggeredRef.current = false;
    } else if (roundData.status === "reveal") {
      setPhase("reveal");
    }
  }, [pin, lang, router]);

  useEffect(() => {
    const rawCandidates = [
      ...(Array.isArray(video?.video_urls) ? video.video_urls : []),
      video?.video_url,
    ];

    const candidates = rawCandidates
      .filter(
        (url, index, arr) =>
          typeof url === "string" &&
          /^https?:\/\//i.test(url) &&
          arr.indexOf(url) === index
      )
      .filter((url): url is string => typeof url === "string");

    setVideoCandidates(candidates);
    setVideoCandidateIndex(0);
    setVideoLoadFailed(false);
    setVideoRefreshing(false);
    setVideoRefreshAttempted(false);
    setVideoResolving(candidates.length > 0);
    videoRefreshAttemptedRef.current = false;
    setVideoFitMode("contain");
    setSoundEnabled(true);
    setVideoSrc(null);

    logVideoDebug("video-candidates-prepared", {
      videoId: video?.id ?? null,
      selectedCandidateIndex: 0,
      candidateCount: candidates.length,
      candidates: candidates.map((url, index) => ({
        index,
        summary: summarizeVideoUrlForDebug(url),
      })),
    });
  }, [videoSourceKey]);

  useEffect(() => {
    const candidate = videoCandidates[videoCandidateIndex] || null;
    const resolveToken = videoResolveTokenRef.current + 1;
    videoResolveTokenRef.current = resolveToken;

    if (resolvedVideoSrcRef.current) {
      URL.revokeObjectURL(resolvedVideoSrcRef.current);
      resolvedVideoSrcRef.current = null;
    }

    if (!candidate) {
      setVideoResolving(false);
      setVideoSrc(null);
      return;
    }

    setVideoSrc(null);
    setVideoLoadFailed(false);
    setVideoResolving(true);

    requestVideoDataUri(candidate)
      .then((blobUrl) => {
        if (videoResolveTokenRef.current !== resolveToken) {
          URL.revokeObjectURL(blobUrl);
          return;
        }

        resolvedVideoSrcRef.current = blobUrl;
        setVideoResolving(false);
        setVideoSrc(blobUrl);
      })
      .catch((err) => {
        if (videoResolveTokenRef.current !== resolveToken) {
          return;
        }

        logVideoDebug("video-data-fetch-error", {
          videoId: video?.id ?? null,
          candidateIndex: videoCandidateIndex,
          candidate: summarizeVideoUrlForDebug(candidate),
          error: String(err instanceof Error ? err.message : err),
        });

        const nextIndex = videoCandidateIndex + 1;
        if (nextIndex < videoCandidates.length) {
          setVideoCandidateIndex(nextIndex);
          return;
        }

        if (!videoRefreshAttemptedRef.current) {
          attemptExtensionRefresh();
          return;
        }

        setVideoResolving(false);
        setVideoLoadFailed(true);
      });

    return () => {
      if (videoResolveTokenRef.current === resolveToken) {
        videoResolveTokenRef.current += 1;
      }
    };
  }, [videoCandidates, videoCandidateIndex, videoSourceKey]);

  useEffect(() => {
    return () => {
      if (resolvedVideoSrcRef.current) {
        URL.revokeObjectURL(resolvedVideoSrcRef.current);
        resolvedVideoSrcRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    if (!videoSrc) {
      logVideoDebug("video-source-cleared", {
        videoId: video?.id ?? null,
        candidateIndex: videoCandidateIndex,
        candidateCount: videoCandidates.length,
        videoLoadFailed,
      });
      return;
    }

    logVideoDebug("video-source-selected", {
      videoId: video?.id ?? null,
      candidateIndex: videoCandidateIndex,
      candidateCount: videoCandidates.length,
      selected: summarizeVideoUrlForDebug(videoSrc),
    });
  }, [video?.id, videoSrc, videoCandidateIndex, videoCandidates.length, videoLoadFailed]);

  // Check extension presence once on mount
  useEffect(() => {
    checkExtensionPresent().then((version) => {
      extensionPresentRef.current = version !== null;
      logVideoDebug("extension-check", { present: version !== null, version });
    });
  }, []);

  // 3-second timeout: if video hasn't started playing, try extension refresh
  useEffect(() => {
    if (!videoSrc || videoRefreshAttempted || videoRefreshing) return;

    if (videoLoadTimeoutRef.current) {
      clearTimeout(videoLoadTimeoutRef.current);
    }

    videoLoadTimeoutRef.current = setTimeout(() => {
      const el = videoElementRef.current;
      // readyState < 2 = HAVE_CURRENT_DATA not reached = video not playable yet
      if (el && el.readyState < 2 && !videoRefreshAttempted) {
        logVideoDebug("video-load-timeout", {
          videoId: video?.id ?? null,
          readyState: el.readyState,
          networkState: el.networkState,
          candidateIndex: videoCandidateIndex,
          extensionPresent: extensionPresentRef.current,
        });
        attemptExtensionRefresh();
      }
    }, 3000);

    return () => {
      if (videoLoadTimeoutRef.current) {
        clearTimeout(videoLoadTimeoutRef.current);
        videoLoadTimeoutRef.current = null;
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [videoSrc, videoRefreshAttempted, videoRefreshing]);

  // Cancel timeout when video successfully plays
  const handlePlaying = useCallback(
    (event: React.SyntheticEvent<HTMLVideoElement>) => {
      if (videoLoadTimeoutRef.current) {
        clearTimeout(videoLoadTimeoutRef.current);
        videoLoadTimeoutRef.current = null;
      }

      setVideoResolving(false);

      const element = event.currentTarget;
      logVideoDebug("video-playing", {
        videoId: video?.id ?? null,
        candidateIndex: videoCandidateIndex,
        currentSrc: summarizeVideoUrlForDebug(element.currentSrc || videoSrc),
        muted: element.muted,
        networkState: element.networkState,
        readyState: element.readyState,
      });
    },
    [video?.id, videoCandidateIndex, videoSrc]
  );

  const handleCanPlay = useCallback(
    (event: React.SyntheticEvent<HTMLVideoElement>) => {
      const element = event.currentTarget;

      element.muted = !soundEnabled;

      void element
        .play()
        .then(() => {
          setVideoResolving(false);
        })
        .catch(async (error) => {
          logVideoDebug("video-play-start-failed", {
            videoId: video?.id ?? null,
            muted: element.muted,
            error: String(error instanceof Error ? error.message : error),
          });

          if (!soundEnabled) {
            return;
          }

          element.muted = true;
          setSoundEnabled(false);

          try {
            await element.play();
            setVideoResolving(false);
            logVideoDebug("video-play-start-muted-fallback", {
              videoId: video?.id ?? null,
              candidateIndex: videoCandidateIndex,
            });
          } catch (fallbackError) {
            logVideoDebug("video-play-muted-fallback-failed", {
              videoId: video?.id ?? null,
              error: String(
                fallbackError instanceof Error ? fallbackError.message : fallbackError
              ),
            });
          }
        });

      logVideoDebug("video-can-play", {
        videoId: video?.id ?? null,
        candidateIndex: videoCandidateIndex,
        currentSrc: summarizeVideoUrlForDebug(element.currentSrc || videoSrc),
        networkState: element.networkState,
        readyState: element.readyState,
      });
    },
    [soundEnabled, video?.id, videoCandidateIndex, videoSrc]
  );

  const handleSoundToggle = useCallback(async () => {
    const element = videoElementRef.current;
    if (!element) return;

    const nextSoundEnabled = !soundEnabled;

    element.muted = !nextSoundEnabled;
    setSoundEnabled(nextSoundEnabled);

    try {
      await element.play();
    } catch (error) {
      element.muted = !soundEnabled;
      setSoundEnabled(soundEnabled);
      logVideoDebug("video-sound-toggle-failed", {
        videoId: video?.id ?? null,
        error: String(error instanceof Error ? error.message : error),
      });
    }
  }, [soundEnabled, video?.id]);

  /**
   * Try to get fresh video URLs from the extension by re-scraping TikTok.
   * Falls back gracefully if extension is not present.
   */
  async function attemptExtensionRefresh() {
    if (!video || videoRefreshAttempted) return;
    const refreshForVideoId = video.id;

    setVideoRefreshAttempted(true);
    videoRefreshAttemptedRef.current = true;

    if (!extensionPresentRef.current) {
      logVideoDebug("extension-refresh-skip", { reason: "extension not present" });
      setVideoLoadFailed(true);
      return;
    }

    // Extract tiktok_video_id from tiktok_url if we don't have it directly
    const tiktokVideoId = extractVideoIdFromUrl(video.tiktok_url);
    if (!tiktokVideoId) {
      logVideoDebug("extension-refresh-skip", { reason: "no video id" });
      setVideoLoadFailed(true);
      return;
    }

    setVideoRefreshing(true);
    logVideoDebug("extension-refresh-start", { tiktokVideoId });

    try {
      const result = await requestVideoRefresh({
        tiktok_video_id: tiktokVideoId,
        tiktok_url: video.tiktok_url,
      });

      if (currentVideoIdRef.current !== refreshForVideoId) {
        return;
      }

      logVideoDebug("extension-refresh-result", {
        ok: result.ok,
        urlCount: result.video_urls?.length ?? 0,
        error: result.error ?? null,
      });

      if (result.ok && result.video_urls && result.video_urls.length > 0) {
        const refreshedUrls = result.video_urls.filter(
          (url, index, arr) =>
            typeof url === "string" &&
            /^https?:\/\//i.test(url) &&
            arr.indexOf(url) === index
        );

        if (!result.ok || refreshedUrls.length === 0) {
          setVideoLoadFailed(true);
          return;
        }

        // Replace candidates with fresh URLs
        setVideoCandidates(refreshedUrls);
        setVideoCandidateIndex(0);
        setVideoLoadFailed(false);
        setVideoResolving(true);
        setSoundEnabled(true);
        setVideoSrc(null);
      }
    } catch (err) {
      if (currentVideoIdRef.current === refreshForVideoId) {
        logVideoDebug("extension-refresh-error", {
          error: String(err instanceof Error ? err.message : err),
        });
        setVideoLoadFailed(true);
      }
    } finally {
      if (currentVideoIdRef.current === refreshForVideoId) {
        setVideoRefreshing(false);
      }
    }
  }

  // Initial load
  useEffect(() => {
    fetchRound();
  }, [fetchRound]);

  // Auto-reveal when all players have voted
  useEffect(() => {
    if (phase !== "voting" || !allVoted || revealTriggeredRef.current) return;

    revealTriggeredRef.current = true;
    const session = getStoredSession();
    fetch(`/api/rooms/${pin}/rounds/reveal`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ player_id: session?.playerId }),
    }).then(() => fetchRound());
  }, [phase, allVoted, pin, fetchRound]);

  // Realtime subscription
  useEffect(() => {
    if (!roomId) return;

    const supabase = createClient();

    let channel = supabase
      .channel(`game:${pin}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "rooms", filter: `pin=eq.${pin}` },
        () => fetchRound()
      )
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "rounds",
          filter: `room_id=eq.${roomId}`,
        },
        () => fetchRound()
      )
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "players",
          filter: `room_id=eq.${roomId}`,
        },
        () => fetchRound()
      );

    if (round?.id) {
      channel = channel.on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "votes",
          filter: `round_id=eq.${round.id}`,
        },
        () => fetchRound()
      );
    }

    channel.subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [pin, roomId, round?.id, fetchRound]);

  async function handleVote(guessedPlayerId: string) {
    if (votedFor || !round || !currentPlayer) return;

    setVotedFor(guessedPlayerId);

    try {
      const res = await fetch("/api/votes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          round_id: round.id,
          player_id: currentPlayer.id,
          guessed_player_id: guessedPlayerId,
        }),
      });

      if (!res.ok) {
        const data = await res.json();
        setError(data.error);
        setVotedFor(null);
      }
    } catch {
      setError("Failed to vote");
      setVotedFor(null);
    }
  }

  async function handleReveal() {
    if (revealSubmitting) return;

    setRevealSubmitting(true);
    try {
      const res = await fetch(`/api/rooms/${pin}/rounds/reveal`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ player_id: currentPlayer?.id }),
      });
      const data = await res.json();
      if (res.ok) {
        setRevealData(data);
        setSlotRevealing(true);
        setSlotDone(false);
        // Slot animation runs for ~2.4s, then settle
        setTimeout(() => {
          setSlotRevealing(false);
          setSlotDone(true);
        }, 2400);
        setPhase("reveal");
      }
    } catch {
      setError("Failed to reveal");
    } finally {
      setRevealSubmitting(false);
    }
  }

  async function handleNextRound() {
    if (nextRoundSubmitting) return;

    setNextRoundSubmitting(true);
    try {
      const res = await fetch(`/api/rooms/${pin}/rounds/next`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ player_id: currentPlayer?.id }),
      });
      const data = await res.json();

      if (data.finished) {
        router.push(`/${lang}/room/${pin}/results`);
      } else {
        setPhase("voting");
        setVotedFor(null);
        setRevealData(null);
        setSlotRevealing(false);
        setSlotDone(false);
        setAllVoted(false);
        fetchRound();
      }
    } catch {
      setError("Failed to advance round");
    } finally {
      setNextRoundSubmitting(false);
    }
  }

  // When phase transitions to reveal without explicit handleReveal (e.g. from realtime),
  // trigger slot animation
  useEffect(() => {
    if (phase === "reveal" && !slotRevealing && !slotDone && !revealData) {
      // Fetch reveal data from current round
      const fetchRevealData = async () => {
        setSlotRevealing(true);
        setTimeout(() => {
          setSlotRevealing(false);
          setSlotDone(true);
        }, 2400);
      };
      fetchRevealData();
    }
  }, [phase, slotRevealing, slotDone, revealData]);

  if (phase === "loading") {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen gap-4 p-6">
        {/* Skeleton: round counter */}
        <div className="flex items-center justify-between w-full max-w-sm">
          <div className="h-4 w-20 bg-surface rounded animate-pulse" />
        </div>
        {/* Skeleton: video area */}
        <div className="w-full max-w-sm aspect-[9/16] max-h-[50vh] bg-surface rounded-2xl animate-pulse" />
        {/* Skeleton: question */}
        <div className="h-6 w-48 bg-surface rounded animate-pulse" />
        {/* Skeleton: player buttons */}
        <div className="grid grid-cols-2 gap-2 w-full max-w-sm">
          {[1, 2, 3, 4].map((i) => (
            <div
              key={i}
              className="h-14 bg-surface rounded-xl animate-pulse"
            />
          ))}
        </div>
      </div>
    );
  }

  const isHost = currentPlayer?.is_host;

  return (
    <main className="flex min-h-screen flex-col gap-4 p-4 animate-fade-in">
      {/* Round counter */}
      <div className="flex items-center justify-between">
        <span className="text-sm text-muted">
          {dict.game.round} {round?.round_number} {dict.game.of}{" "}
          {totalRounds}
        </span>
        {phase === "voting" && allVoted && (
          <span className="text-sm text-green-400 font-medium animate-fade-in">
            {dict.game.everyoneVoted}
          </span>
        )}
      </div>

      {/* Video - MP4 playback */}
      <div
        ref={videoContainerRef}
        className="relative flex-1 overflow-hidden rounded-2xl bg-surface"
      >
        {videoSrc ? (
          <>
            <video
              aria-hidden="true"
              tabIndex={-1}
              src={videoSrc}
              className="pointer-events-none absolute inset-0 block h-full w-full scale-110 object-cover blur-2xl"
              autoPlay
              loop
              muted
              playsInline
              preload="metadata"
            />
            <div className="pointer-events-none absolute inset-0 bg-black/35" />
            <div className="absolute inset-0 z-10 grid place-items-center">
              <video
                key={videoSrc}
                ref={videoElementRef}
                src={videoSrc}
                className={
                  videoFitMode === "cover"
                    ? "block h-full w-full object-cover object-center"
                    : "block max-h-full max-w-full object-contain object-center"
                }
                autoPlay
                loop
                playsInline
                muted={!soundEnabled}
                preload="metadata"
                onLoadStart={(event) => {
                  const element = event.currentTarget;
                  logVideoDebug("video-load-start", {
                    videoId: video?.id ?? null,
                    candidateIndex: videoCandidateIndex,
                    selected: summarizeVideoUrlForDebug(videoSrc),
                    currentSrc: summarizeVideoUrlForDebug(element.currentSrc || videoSrc),
                    networkState: element.networkState,
                    readyState: element.readyState,
                  });
                }}
                onLoadedMetadata={(event) => {
                  const element = event.currentTarget;
                  const container = videoContainerRef.current;
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
                    nextFitMode =
                      delta <= VIDEO_COVER_ASPECT_TOLERANCE ? "cover" : "contain";
                  }

                  setVideoFitMode(nextFitMode);

                  logVideoDebug("video-loaded-metadata", {
                    videoId: video?.id ?? null,
                    candidateIndex: videoCandidateIndex,
                    currentSrc: summarizeVideoUrlForDebug(element.currentSrc || videoSrc),
                    duration: Number.isFinite(element.duration) ? element.duration : null,
                    videoWidth: element.videoWidth,
                    videoHeight: element.videoHeight,
                    videoAspect,
                    containerWidth: container?.clientWidth ?? null,
                    containerHeight: container?.clientHeight ?? null,
                    containerAspect,
                    fitMode: nextFitMode,
                    networkState: element.networkState,
                    readyState: element.readyState,
                  });
                }}
                onCanPlay={handleCanPlay}
                onPlaying={handlePlaying}
                onError={(event) => {
                  const element = event.currentTarget;
                  logVideoDebug("video-error", {
                    videoId: video?.id ?? null,
                    candidateIndex: videoCandidateIndex,
                    candidateCount: videoCandidates.length,
                    currentSrc: summarizeVideoUrlForDebug(element.currentSrc || videoSrc),
                    networkState: element.networkState,
                    readyState: element.readyState,
                    mediaErrorCode: element.error?.code ?? null,
                    mediaErrorMessage: element.error?.message ?? null,
                    willRetry: false,
                    willAttemptRefresh: !videoRefreshAttempted,
                  });

                  if (!videoRefreshAttempted) {
                    setVideoSrc(null);
                    attemptExtensionRefresh();
                    return;
                  }

                  setVideoLoadFailed(true);
                  setVideoSrc(null);
                }}
              />
            </div>
            <button
              type="button"
              onClick={handleSoundToggle}
              className="absolute right-3 top-3 z-20 rounded-full bg-black/70 px-3 py-1 text-xs font-medium text-white"
            >
              {soundEnabled ? "Tap to mute" : "Tap for sound"}
            </button>
          </>
        ) : (
          <div className="w-full h-full bg-surface rounded-2xl flex items-center justify-center p-4">
            <div className="text-center text-sm text-muted">
              {videoRefreshing ? (
                <p className="animate-pulse">Refreshing video link...</p>
              ) : videoResolving ? (
                <p className="animate-pulse">Loading video...</p>
              ) : (
                <>
                  <p>
                    {videoLoadFailed
                      ? "This TikTok video expired or could not be loaded in Chrome."
                      : "Video unavailable in this round."}
                  </p>
                  {video?.tiktok_url && (
                    <a
                      href={video.tiktok_url}
                      target="_blank"
                      rel="noreferrer"
                      className="text-accent underline mt-2 inline-block"
                    >
                      Open on TikTok
                    </a>
                  )}
                </>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Voting */}
      {phase === "voting" && (
        <div className="mt-auto flex flex-col gap-3 animate-slide-up">
          <h2 className="text-lg font-bold text-center">
            {dict.game.whoseTiktok}
          </h2>

          {votedFor ? (
            <div className="text-center py-4 animate-scale-in">
              <p className="text-accent font-bold text-xl">{dict.game.voted}</p>
              {!allVoted && (
                <p className="text-muted text-sm mt-1">{dict.game.waiting}</p>
              )}
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-2">
              {players
                .map((p) => (
                  <button
                    key={p.id}
                    onClick={() => handleVote(p.id)}
                    className="flex items-center gap-2 h-14 px-4 rounded-xl bg-surface border border-surface-2 transition-all active:scale-95 hover:border-accent hover:bg-surface-2"
                  >
                    <PlayerAvatar
                      nickname={p.nickname}
                      color={p.color}
                      size="sm"
                      showName={false}
                    />
                    <span className="font-medium text-sm truncate">
                      {p.nickname}
                    </span>
                  </button>
                ))}
            </div>
          )}

          {/* Host can force reveal */}
          {isHost && (
              <button
                onClick={handleReveal}
                disabled={revealSubmitting}
                className="h-12 rounded-xl bg-surface-2 text-muted font-medium text-sm transition-all active:scale-95"
              >
                {revealSubmitting ? "Loading..." : dict.game.skipToReveal}
              </button>
            )}
        </div>
      )}

      {/* Reveal with slot-machine animation */}
      {phase === "reveal" && (
        <div className="flex flex-col gap-4 items-center animate-fade-in">
          <h2 className="text-lg font-bold">{dict.game.reveal}</h2>

          {/* Slot-machine style reveal */}
          {round?.correct_player_id && (
            <div className="relative">
              {slotRevealing ? (
                <SlotMachineReveal
                  players={players}
                  correctPlayerId={round.correct_player_id}
                />
              ) : (
                <div className={slotDone ? "animate-scale-in" : "animate-bounce-in"}>
                  <div className="animate-glow-pulse rounded-full">
                    <PlayerAvatar
                      nickname={
                        players.find((p) => p.id === round.correct_player_id)
                          ?.nickname || "?"
                      }
                      color={
                        players.find((p) => p.id === round.correct_player_id)
                          ?.color || "#888"
                      }
                      size="lg"
                    />
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Vote results */}
          {revealData && !slotRevealing && (
            <div className="w-full max-w-sm">
              <div className="flex flex-col gap-2">
                {revealData.votes.map((v, i) => {
                  const voter = players.find((p) => p.id === v.player_id);
                  const guessed = players.find(
                    (p) => p.id === v.guessed_player_id
                  );
                  return (
                    <div
                      key={i}
                      className={`flex items-center justify-between px-3 py-2 rounded-xl transition-all animate-slide-up ${
                        v.is_correct
                          ? "bg-green-900/30"
                          : "bg-red-900/20"
                      }`}
                      style={{ animationDelay: `${i * 100}ms` }}
                    >
                      <span className="text-sm">
                        {voter?.nickname} → {guessed?.nickname}
                      </span>
                      <span
                        className={`text-xs font-bold ${
                          v.is_correct ? "text-green-400" : "text-red-400"
                        }`}
                      >
                        {v.is_correct ? dict.game.correct : dict.game.wrong}
                      </span>
                    </div>
                  );
                })}
              </div>

              {/* Score changes */}
              {Object.keys(revealData.score_deltas).length > 0 && (
                <div className="mt-3 text-center animate-fade-in" style={{ animationDelay: "400ms" }}>
                  {Object.entries(revealData.score_deltas).map(
                    ([pid, delta]) => {
                      const p = players.find((pl) => pl.id === pid);
                      return (
                        <span
                          key={pid}
                          className="text-sm text-accent inline-block mx-2"
                        >
                          {p?.nickname} +{delta} {dict.game.points}
                        </span>
                      );
                    }
                  )}
                </div>
              )}

              {/* Nobody guessed */}
              {revealData.votes.length > 0 &&
                !revealData.votes.some((v) => v.is_correct) && (
                  <p className="text-center text-accent mt-2 font-bold animate-scale-in">
                    {dict.game.nobodyGuessed} {dict.game.stumpBonus}
                  </p>
                )}
            </div>
          )}

          {/* Next round */}
          {isHost && !slotRevealing && (
            <button
              onClick={handleNextRound}
              disabled={nextRoundSubmitting}
              className="h-14 w-full max-w-sm rounded-2xl bg-accent text-white font-bold text-lg transition-transform active:scale-95"
            >
              {nextRoundSubmitting ? "Loading..." : dict.game.nextRound}
            </button>
          )}
        </div>
      )}

      {error && (
        <p className="text-red-400 text-sm text-center animate-fade-in">{error}</p>
      )}
    </main>
  );
}

/**
 * Slot-machine style reveal animation.
 * Rapidly cycles through player avatars before landing on the correct one.
 */
function SlotMachineReveal({
  players,
  correctPlayerId,
}: {
  players: Player[];
  correctPlayerId: string;
}) {
  const [visibleIndex, setVisibleIndex] = useState(0);
  const [stopped, setStopped] = useState(false);

  // Build a sequence: shuffle players several times, end with the correct one
  const sequence = useRef<Player[]>([]);
  if (sequence.current.length === 0) {
    const others = players.filter((p) => p.id !== correctPlayerId);
    const correct = players.find((p) => p.id === correctPlayerId);
    const shuffled: Player[] = [];
    // 4 full shuffled cycles of all players
    for (let cycle = 0; cycle < 4; cycle++) {
      const copy = [...others];
      for (let i = copy.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [copy[i], copy[j]] = [copy[j], copy[i]];
      }
      shuffled.push(...copy);
    }
    // End with the correct player
    if (correct) shuffled.push(correct);
    sequence.current = shuffled;
  }

  useEffect(() => {
    const totalSteps = sequence.current.length;
    let step = 0;

    // Start fast, slow down toward the end
    function tick() {
      step++;
      setVisibleIndex(step);

      if (step >= totalSteps - 1) {
        setStopped(true);
        return;
      }

      // Ease out: slow down as we approach the end
      const progress = step / totalSteps;
      const delay = 60 + Math.pow(progress, 3) * 400;
      setTimeout(tick, delay);
    }

    const timer = setTimeout(tick, 60);
    return () => clearTimeout(timer);
  }, []);

  const current = sequence.current[Math.min(visibleIndex, sequence.current.length - 1)];
  if (!current) return null;

  return (
    <div
      className={`transition-transform duration-100 ${
        stopped ? "animate-scale-in" : ""
      }`}
    >
      <div className={stopped ? "animate-glow-pulse rounded-full" : ""}>
        <PlayerAvatar
          nickname={current.nickname}
          color={current.color}
          size="lg"
        />
      </div>
    </div>
  );
}
