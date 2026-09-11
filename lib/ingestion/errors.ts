// Machine-readable error codes — persisted on ingestion_jobs.error_code
// (see db/migrations/0011_ingestion_job_details.sql) and returned by
// the API. Never include stack traces or document content in messages
// shown to a client.
export type IngestionErrorCode =
  | "EMPTY_FILE"
  | "UNSUPPORTED_FILE_TYPE"
  | "FILE_TOO_LARGE"
  | "CORRUPTED_FILE"
  | "NO_EXTRACTABLE_TEXT"
  | "EMPTY_TEXT_AFTER_CLEANING"
  | "EMBEDDING_FAILURE"
  | "STORAGE_FAILURE"
  | "DATABASE_FAILURE"
  | "DOCUMENT_DELETED"
  | "INVALID_METADATA";

export class IngestionError extends Error {
  readonly code: IngestionErrorCode;

  constructor(code: IngestionErrorCode, message: string) {
    super(message);
    this.name = "IngestionError";
    this.code = code;
  }
}

/** Target document does not exist, belongs to another company (RLS
 * makes these indistinguishable — deliberately, to avoid leaking
 * cross-company existence), or is otherwise inaccessible. */
export class IngestionNotFoundError extends Error {
  constructor(message = "Document not found.") {
    super(message);
    this.name = "IngestionNotFoundError";
  }
}

/** The authenticated user's role does not permit the requested action
 * (e.g. an employee attempting to create restricted-visibility content). */
export class IngestionForbiddenError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "IngestionForbiddenError";
  }
}
