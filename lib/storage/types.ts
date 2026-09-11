export interface StoredFileRef {
  /** Opaque key identifying the file within the storage provider. */
  key: string;
}

export interface StorageProvider {
  /**
   * Persists a file, isolated by the given path segments (typically
   * companyId/documentId/versionId), and returns the key to store on
   * DocumentVersion.file_key.
   */
  save(params: { companyId: string; documentId: string; versionId: string; fileName: string; data: Buffer }): Promise<StoredFileRef>;

  /** Reads a previously saved file back into memory. */
  read(key: string): Promise<Buffer>;

  /** Removes a previously saved file. Best-effort; never throws for a missing key. */
  remove(key: string): Promise<void>;
}
