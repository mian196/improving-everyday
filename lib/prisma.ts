import { PrismaClient } from "@/app/generated/prisma/client";
import * as path from "path";

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

// Retrieve connection string from env or use standard local fallback
let dbUrl = process.env.DATABASE_URL || "file:./prisma/dev.db";

// Programmatically resolve relative SQLite paths to absolute paths
if (dbUrl.startsWith("file:")) {
  const rawPath = dbUrl.substring(5);
  // Check if it's a relative path (does not start with a slash, a drive letter like C:/, or backslash)
  if (!rawPath.startsWith("/") && !rawPath.includes(":/") && !rawPath.includes(":\\")) {
    const absolutePath = path.resolve(process.cwd(), rawPath).replace(/\\/g, "/");
    dbUrl = `file:${absolutePath}`;
  }
}

console.log("=== PRISMA DB DEBUG ===");
console.log("process.env.DATABASE_URL:", process.env.DATABASE_URL);
console.log("Programmatically resolved dbUrl:", dbUrl);
console.log("process.cwd():", process.cwd());
console.log("=======================");

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    datasources: {
      db: {
        url: dbUrl,
      },
    },
    log: process.env.NODE_ENV === "development" ? ["query", "error", "warn"] : ["error"],
  });

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;
