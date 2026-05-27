"use client";

import React, { createContext, useContext, useState, useEffect, useCallback } from "react";
import { useProfile } from "./useProfile";

import { saveProgressEntry, getProgressForProfile } from "@/app/actions/dbActions";

interface ProgressEntry {
  trackId: string;
  moduleId: string;
  lessonId: string;
  completed: boolean;
  completedAt?: string;
}

function getKey(profileId: string) {
  return `progress:${profileId}`;
}

interface ProgressContextValue {
  progress: Record<string, ProgressEntry>;
  markComplete: (trackId: string, moduleId: string, lessonId: string) => void;
  markIncomplete: (trackId: string, moduleId: string, lessonId: string) => void;
  isCompleted: (trackId: string, moduleId: string, lessonId: string) => boolean;
  getTrackProgress: (trackId: string, totalLessons: number) => { completed: number; total: number; percent: number };
  getRecentlyCompleted: (limit?: number) => ProgressEntry[];
}

const ProgressContext = createContext<ProgressContextValue | null>(null);

export function ProgressProvider({ children }: { children: React.ReactNode }) {
  const { activeProfile } = useProfile();
  const profileId = activeProfile?.id ?? null;

  const [progress, setProgress] = useState<Record<string, ProgressEntry>>(() => {
    // Synchronous initialisation — runs only on the client, avoids a blank flash
    if (typeof window === "undefined") return {};
    return {};
  });

  // Re-load whenever the active profile changes (including on first mount)
  useEffect(() => {
    if (!profileId) {
      setProgress({});
      return;
    }
    const pid = profileId;

    // 1. Initial Load from LocalStorage (Instant)
    try {
      const stored = localStorage.getItem(getKey(pid));
      if (stored) {
        setProgress(JSON.parse(stored));
      } else {
        setProgress({});
      }
    } catch {
      setProgress({});
    }

    // 2. Fetch and Merge from SQLite DB in background
    async function syncFromDb() {
      try {
        const res = await getProgressForProfile(pid);
        if (res.success && res.progress) {
          setProgress((prev) => {
            const merged = { ...prev, ...res.progress };
            localStorage.setItem(getKey(pid), JSON.stringify(merged));
            return merged;
          });
        }
      } catch (err: any) {
        console.error("Failed to sync progress from SQLite DB:", err);
      }
    }

    syncFromDb();
  }, [profileId]);

  const markComplete = useCallback(
    (trackId: string, moduleId: string, lessonId: string) => {
      if (!profileId) return;
      const completedAt = new Date().toISOString();
      
      setProgress((prev) => {
        const key = `${trackId}:${moduleId}:${lessonId}`;
        const updated = {
          ...prev,
          [key]: { trackId, moduleId, lessonId, completed: true, completedAt },
        };
        localStorage.setItem(getKey(profileId), JSON.stringify(updated));
        return updated;
      });

      // Background DB Sync
      saveProgressEntry(
        profileId,
        { trackId, moduleId, lessonId, completed: true, completedAt },
        activeProfile ? { name: activeProfile.name, avatar: activeProfile.avatar, bio: activeProfile.bio } : undefined
      ).catch((err: any) => console.error("Error background saving progress entry:", err));
    },
    [profileId, activeProfile]
  );

  const markIncomplete = useCallback(
    (trackId: string, moduleId: string, lessonId: string) => {
      if (!profileId) return;
      setProgress((prev) => {
        const key = `${trackId}:${moduleId}:${lessonId}`;
        const updated = { ...prev };
        delete updated[key];
        localStorage.setItem(getKey(profileId), JSON.stringify(updated));
        return updated;
      });

      // Background DB Sync
      saveProgressEntry(
        profileId,
        { trackId, moduleId, lessonId, completed: false },
        activeProfile ? { name: activeProfile.name, avatar: activeProfile.avatar, bio: activeProfile.bio } : undefined
      ).catch((err: any) => console.error("Error background saving progress entry:", err));
    },
    [profileId, activeProfile]
  );

  const isCompleted = useCallback(
    (trackId: string, moduleId: string, lessonId: string) => {
      const key = `${trackId}:${moduleId}:${lessonId}`;
      return progress[key]?.completed === true;
    },
    [progress]
  );

  const getTrackProgress = useCallback(
    (trackId: string, totalLessons: number) => {
      const completed = Object.values(progress).filter(
        (p) => p.trackId === trackId && p.completed
      ).length;
      return {
        completed,
        total: totalLessons,
        percent: totalLessons > 0 ? Math.round((completed / totalLessons) * 100) : 0,
      };
    },
    [progress]
  );

  const getRecentlyCompleted = useCallback(
    (limit = 5) => {
      return Object.values(progress)
        .filter((p) => p.completed && p.completedAt)
        .sort((a, b) => new Date(b.completedAt!).getTime() - new Date(a.completedAt!).getTime())
        .slice(0, limit);
    },
    [progress]
  );

  return React.createElement(
    ProgressContext.Provider,
    { value: { progress, markComplete, markIncomplete, isCompleted, getTrackProgress, getRecentlyCompleted } },
    children
  );
}

/**
 * Returns the shared progress state from ProgressContext.
 * The `_profileId` parameter is accepted but ignored — the context
 * tracks the active profile automatically. It is kept for backwards
 * compatibility with existing call-sites.
 */
export function useProgress(_profileId?: string | null) {
  const ctx = useContext(ProgressContext);
  if (!ctx) throw new Error("useProgress must be used within ProgressProvider");
  return ctx;
}
