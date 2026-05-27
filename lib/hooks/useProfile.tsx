"use client";

import React, { createContext, useContext, useState, useEffect, useCallback, lazy, Suspense } from "react";

const CreateProfileModal = lazy(() =>
  import("@/components/CreateProfileModal").then((m) => ({ default: m.CreateProfileModal }))
);

import { upsertProfile, deleteProfileFromDb, getAllProfilesFromDb } from "@/app/actions/dbActions";

export interface Profile {
  id: string;
  name: string;
  avatar: string;
  bio: string;
}

const PROFILES_KEY = "devops-lms:profiles";
const ACTIVE_KEY = "devops-lms:activeProfileId";

function loadProfiles(): Profile[] {
  if (typeof window === "undefined") return [];
  try {
    const stored = localStorage.getItem(PROFILES_KEY);
    if (stored) {
      const parsed = JSON.parse(stored) as Profile[];
      if (parsed.length > 0) return parsed;
    }
  } catch {}
  return [];
}

function saveProfiles(profiles: Profile[]) {
  localStorage.setItem(PROFILES_KEY, JSON.stringify(profiles));
}

function makeAvatar(name: string): string {
  return name
    .trim()
    .split(/\s+/)
    .map((n) => n[0])
    .join("")
    .toUpperCase()
    .slice(0, 2);
}

interface ProfileContextValue {
  profiles: Profile[];
  activeProfile: Profile | null;
  setActiveProfile: (profile: Profile) => void;
  createProfile: (name: string, bio: string) => Profile;
  deleteProfile: (id: string) => void;
}

const ProfileContext = createContext<ProfileContextValue | null>(null);

export function ProfileProvider({ children }: { children: React.ReactNode }) {
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [activeProfile, setActiveProfileState] = useState<Profile | null>(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    async function initProfiles() {
      const found = loadProfiles();
      
      if (found.length > 0) {
        setProfiles(found);
        const storedActiveId = localStorage.getItem(ACTIVE_KEY);
        const active = found.find((p: Profile) => p.id === storedActiveId) ?? found[0] ?? null;
        setActiveProfileState(active);
        if (active) localStorage.setItem(ACTIVE_KEY, active.id);
        setLoaded(true);

        // Sync existing local profiles to database asynchronously
        for (const p of found) {
          upsertProfile(p).catch((err: any) => console.error("Error background syncing profile to DB:", err));
        }
      } else {
        // LocalStorage is empty. Try restoring profiles from SQLite DB!
        try {
          const res = await getAllProfilesFromDb();
          if (res.success && res.profiles && res.profiles.length > 0) {
            setProfiles(res.profiles);
            saveProfiles(res.profiles);

            const storedActiveId = localStorage.getItem(ACTIVE_KEY);
            const active = res.profiles.find((p: Profile) => p.id === storedActiveId) ?? res.profiles[0] ?? null;
            setActiveProfileState(active);
            if (active) localStorage.setItem(ACTIVE_KEY, active.id);
          } else {
            setProfiles([]);
          }
        } catch (err: any) {
          console.error("Failed to restore profiles from SQLite DB:", err);
          setProfiles([]);
        } finally {
          setLoaded(true);
        }
      }
    }

    initProfiles();
  }, []);

  const setActiveProfile = useCallback((profile: Profile) => {
    setActiveProfileState(profile);
    localStorage.setItem(ACTIVE_KEY, profile.id);
    // Background sync to ensure it exists in the database
    upsertProfile(profile).catch((err: any) => console.error("Error syncing active profile to DB:", err));
  }, []);

  const createProfile = useCallback((name: string, bio: string): Profile => {
    const trimmed = name.trim();
    const newProfile: Profile = {
      id: `${trimmed.toLowerCase().replace(/\s+/g, "-")}-${Date.now()}`,
      name: trimmed,
      avatar: makeAvatar(trimmed),
      bio: bio.trim(),
    };
    setProfiles((prev) => {
      const updated = [...prev, newProfile];
      saveProfiles(updated);
      return updated;
    });

    // Background sync to database
    upsertProfile(newProfile).catch((err: any) => {
      console.error("Failed to sync new profile to DB:", err);
    });

    return newProfile;
  }, []);

  const deleteProfile = useCallback(
    (id: string) => {
      setProfiles((prev) => {
        const updated = prev.filter((p: Profile) => p.id !== id);
        saveProfiles(updated);

        // If we deleted the active profile, switch to the first remaining one
        if (activeProfile?.id === id) {
          const next = updated[0] ?? null;
          setActiveProfileState(next);
          if (next) localStorage.setItem(ACTIVE_KEY, next.id);
          else localStorage.removeItem(ACTIVE_KEY);
        }

        return updated;
      });

      // Sync deletion to DB
      deleteProfileFromDb(id).catch((err: any) => {
        console.error("Failed to delete profile from DB:", err);
      });
    },
    [activeProfile]
  );

  return (
    <ProfileContext.Provider value={{ profiles, activeProfile, setActiveProfile, createProfile, deleteProfile }}>
      {children}
      {loaded && activeProfile === null && (
        <Suspense fallback={null}>
          <CreateProfileModal />
        </Suspense>
      )}
    </ProfileContext.Provider>
  );
}

export function useProfile() {
  const ctx = useContext(ProfileContext);
  if (!ctx) throw new Error("useProfile must be used within ProfileProvider");
  return ctx;
}
