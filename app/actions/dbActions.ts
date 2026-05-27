"use server";

import { prisma } from "@/lib/prisma";
import type { Profile, Progress } from "@/app/generated/prisma/client";

export interface DBProfile {
  id: string;
  name: string;
  avatar: string;
  bio: string;
}

export interface DBProgress {
  trackId: string;
  moduleId: string;
  lessonId: string;
  completed: boolean;
  completedAt?: string;
}

/**
 * Upserts a profile in the database.
 * If the profile does not exist, it is created. Otherwise, it is updated.
 */
export async function upsertProfile(profile: DBProfile) {
  try {
    const dbProfile = await prisma.profile.upsert({
      where: { id: profile.id },
      update: {
        name: profile.name,
        avatar: profile.avatar,
        bio: profile.bio,
      },
      create: {
        id: profile.id,
        name: profile.name,
        avatar: profile.avatar,
        bio: profile.bio,
      },
    });
    return { success: true, profile: dbProfile };
  } catch (error) {
    console.error("Error upserting profile:", error);
    return { success: false, error: (error as Error).message };
  }
}

/**
 * Deletes a profile from the database (cascade deletes all progress and bookmarks).
 */
export async function deleteProfileFromDb(id: string) {
  try {
    await prisma.profile.delete({
      where: { id },
    });
    return { success: true };
  } catch (error) {
    console.error("Error deleting profile:", error);
    return { success: false, error: (error as Error).message };
  }
}

/**
 * Gets all profiles from the database to restore client-side localStorage if it is cleared.
 */
export async function getAllProfilesFromDb() {
  try {
    const profiles = await prisma.profile.findMany({
      orderBy: { createdAt: "asc" },
    });
    return {
      success: true,
      profiles: profiles.map((p: Profile) => ({
        id: p.id,
        name: p.name,
        avatar: p.avatar ?? "",
        bio: p.bio ?? "",
      })),
    };
  } catch (error) {
    console.error("Error getting all profiles:", error);
    return { success: false, error: (error as Error).message, profiles: [] };
  }
}

/**
 * Saves a progress entry for a profile.
 * Automatically upserts a skeleton profile if it does not exist in the DB
 * to prevent foreign key constraint violations.
 */
export async function saveProgressEntry(
  profileId: string,
  entry: DBProgress,
  profileFallback?: Omit<DBProfile, "id">
) {
  try {
    // 1. Ensure Profile exists in the DB first to satisfy foreign key relations
    const profileExists = await prisma.profile.findUnique({
      where: { id: profileId },
    });

    if (!profileExists) {
      await prisma.profile.create({
        data: {
          id: profileId,
          name: profileFallback?.name ?? "Learner",
          avatar: profileFallback?.avatar ?? "L",
          bio: profileFallback?.bio ?? "",
        },
      });
    }

    // 2. Upsert progress
    const { trackId, moduleId, lessonId, completed, completedAt } = entry;
    const progressKey = { profileId_trackId_moduleId_lessonId: { profileId, trackId, moduleId, lessonId } };

    if (completed) {
      await prisma.progress.upsert({
        where: progressKey,
        update: {
          completed: true,
          completedAt: completedAt ? new Date(completedAt) : new Date(),
        },
        create: {
          profileId,
          trackId,
          moduleId,
          lessonId,
          completed: true,
          completedAt: completedAt ? new Date(completedAt) : new Date(),
        },
      });
    } else {
      // If marked incomplete, delete or set to false. We delete to keep DB clean and match key deletion in useProgress.ts
      await prisma.progress.deleteMany({
        where: { profileId, trackId, moduleId, lessonId },
      });
    }

    return { success: true };
  } catch (error) {
    console.error("Error saving progress entry:", error);
    return { success: false, error: (error as Error).message };
  }
}

/**
 * Fetches all progress entries for a given profile from the database.
 */
export async function getProgressForProfile(profileId: string) {
  try {
    const records = await prisma.progress.findMany({
      where: { profileId },
    });
    
    const progressMap: Record<string, DBProgress> = {};
    records.forEach((r: Progress) => {
      const key = `${r.trackId}:${r.moduleId}:${r.lessonId}`;
      progressMap[key] = {
        trackId: r.trackId,
        moduleId: r.moduleId,
        lessonId: r.lessonId,
        completed: r.completed,
        completedAt: r.completedAt?.toISOString(),
      };
    });

    return { success: true, progress: progressMap };
  } catch (error) {
    console.error("Error getting progress for profile:", error);
    return { success: false, error: (error as Error).message, progress: {} };
  }
}
