// pdfjs-dist (used internally by pdf-parse) references the browser's
// DOMMatrix global for PDF page-transform math. It tries to polyfill
// it itself from a dynamically `require()`d @napi-rs/canvas — that
// auto-detection doesn't reliably run before first use inside
// Vercel's serverless Node environment: production crashed with
// "ReferenceError: DOMMatrix is not defined" the moment pdf-parse's
// module graph loaded, even for a non-PDF (.txt) upload, since
// lib/ingestion/extract/index.ts imports pdf.ts unconditionally.
//
// Setting the global explicitly, imported here for its side effect
// ONLY before any pdf-parse import (see pdf.ts), sidesteps pdfjs-dist's
// own fragile detection entirely — @napi-rs/canvas's DOMMatrix is a
// real, API-compatible implementation (confirmed locally: it exports
// a working DOMMatrix constructor), not a stub.
import { DOMMatrix } from "@napi-rs/canvas";

if (typeof globalThis.DOMMatrix === "undefined") {
  // @napi-rs/canvas's DOMMatrix is runtime-compatible with the
  // browser's; only the TypeScript lib.dom.d.ts shape differs.
  (globalThis as unknown as { DOMMatrix: unknown }).DOMMatrix = DOMMatrix;
}
