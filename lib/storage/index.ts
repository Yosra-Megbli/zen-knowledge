import { LocalStorageProvider } from "./local.ts";
import { SupabaseStorageProvider } from "./supabase.ts";
import type { StorageProvider } from "./types.ts";

export type { StorageProvider, StoredFileRef } from "./types.ts";

// In production (Vercel), SUPABASE_URL is set → use Supabase Storage.
// Locally (Docker), fall back to the local filesystem provider.
export const storageProvider: StorageProvider = process.env.SUPABASE_URL
  ? new SupabaseStorageProvider()
  : new LocalStorageProvider();
