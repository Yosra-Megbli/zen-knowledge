import type { StorageProvider, StoredFileRef } from "./types.ts";

// Supabase Storage provider — used in production (Vercel).
// Requires SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, SUPABASE_STORAGE_BUCKET.
// Files are isolated by companyId/documentId/versionId path segments,
// exactly mirroring LocalStorageProvider's layout.
// Access is via the service-role key (server-side only, never exposed to
// the client). The bucket must be private — no public URL is ever returned.

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing required environment variable: ${name}`);
  return v;
}

function sanitizeFileName(fileName: string): string {
  const base = fileName.split(/[\\/]/).pop() ?? "file";
  return base.replace(/[^a-zA-Z0-9._-]/g, "_") || "file";
}

export class SupabaseStorageProvider implements StorageProvider {
  private get bucket() {
    return requireEnv("SUPABASE_STORAGE_BUCKET");
  }

  private get baseUrl() {
    return `${requireEnv("SUPABASE_URL")}/storage/v1/object`;
  }

  private get headers() {
    return {
      Authorization: `Bearer ${requireEnv("SUPABASE_SERVICE_ROLE_KEY")}`,
    };
  }

  async save(params: {
    companyId: string;
    documentId: string;
    versionId: string;
    fileName: string;
    data: Buffer;
  }): Promise<StoredFileRef> {
    const safeName = sanitizeFileName(params.fileName);
    const key = `${params.companyId}/${params.documentId}/${params.versionId}/${safeName}`;

    const res = await fetch(`${this.baseUrl}/${this.bucket}/${key}`, {
      method: "POST",
      headers: {
        ...this.headers,
        "Content-Type": "application/octet-stream",
        "x-upsert": "true",
      },
      body: new Uint8Array(params.data),
    });

    if (!res.ok) {
      const text = await res.text().catch(() => res.statusText);
      throw new Error(`Supabase Storage upload failed (${res.status}): ${text}`);
    }

    return { key };
  }

  async read(key: string): Promise<Buffer> {
    assertSafeKey(key);
    const res = await fetch(`${this.baseUrl}/${this.bucket}/${key}`, {
      headers: this.headers,
    });
    if (!res.ok) {
      throw new Error(`Supabase Storage read failed (${res.status}): ${res.statusText}`);
    }
    const ab = await res.arrayBuffer();
    return Buffer.from(ab);
  }

  async remove(key: string): Promise<void> {
    assertSafeKey(key);
    // DELETE /object/bucket/key — best-effort, never throws for missing key
    await fetch(`${this.baseUrl}/${this.bucket}/${key}`, {
      method: "DELETE",
      headers: this.headers,
    }).catch(() => {});
  }
}

function assertSafeKey(key: string): void {
  if (key.includes("..") || key.startsWith("/")) {
    throw new Error("storage: rejected unsafe key");
  }
}
