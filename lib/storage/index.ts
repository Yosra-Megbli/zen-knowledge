import { LocalStorageProvider } from "./local.ts";
import type { StorageProvider } from "./types.ts";

export type { StorageProvider, StoredFileRef } from "./types.ts";

// Single local provider for now. A future SupabaseStorageProvider only
// needs to implement StorageProvider and be swapped in here — nothing
// else in the codebase depends on LocalStorageProvider directly.
export const storageProvider: StorageProvider = new LocalStorageProvider();
