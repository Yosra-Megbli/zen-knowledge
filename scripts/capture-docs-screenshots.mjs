import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const CHROME_PATH = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const USER_DATA_DIR = path.join(process.env.TEMP || "C:\\temp", "chrome_doc_screenshots_" + Date.now());
const PORT = 9222;
const BASE_URL = "https://zen-knowledge.vercel.app";

async function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Strings that show up on browser-level error pages (network hiccups, DNS, etc.)
// rather than on the actual app — used to detect a bad screenshot before saving it.
const BROWSER_ERROR_MARKERS = [
  "ERR_NETWORK_CHANGED",
  "ERR_INTERNET_DISCONNECTED",
  "ERR_CONNECTION_",
  "ERR_NAME_NOT_RESOLVED",
  "ERR_TIMED_OUT",
  "Votre connexion a été interrompue",
  "This site can't be reached",
  "Ce site est inaccessible",
];

// Strings that indicate the RAG answered with its "no authorized sources" fallback
// instead of a real, cited answer. Matched case-insensitively (see findMarker),
// and includes both the current backend REFUSAL_MESSAGE (lib/rag/answerQuestion.ts)
// and the frontend's own hardcoded fallback (app/(app)/chat/page.tsx) — plus the
// older English wording, in case an older prod deployment is still live.
const RAG_NO_SOURCE_MARKERS = [
  "je n'ai pas de sources autorisées suffisantes",
  "i don't have enough authorized sources",
];

class CdpSession {
  constructor(ws) {
    this.ws = ws;
    this.id = 1;
    this.pending = new Map();
    this.listeners = new Map();
    ws.onmessage = (event) => {
      const msg = JSON.parse(event.data);
      if (msg.id && this.pending.has(msg.id)) {
        const { resolve, reject } = this.pending.get(msg.id);
        this.pending.delete(msg.id);
        if (msg.error) reject(new Error(msg.error.message));
        else resolve(msg.result);
      } else if (msg.method && this.listeners.has(msg.method)) {
        for (const cb of this.listeners.get(msg.method)) cb(msg.params);
      }
    };
  }

  send(method, params = {}) {
    return new Promise((resolve, reject) => {
      const id = this.id++;
      this.pending.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }

  on(method, cb) {
    if (!this.listeners.has(method)) this.listeners.set(method, []);
    this.listeners.get(method).push(cb);
  }

  once(method, timeoutMs = 15000) {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`Timed out waiting for ${method}`)), timeoutMs);
      this.on(method, (params) => {
        clearTimeout(timer);
        resolve(params);
      });
    });
  }
}

// Reads the current page's visible text so we can detect browser error pages
// or RAG fallback answers before trusting a screenshot.
async function getPageText(cdp) {
  const res = await cdp.send("Runtime.evaluate", {
    expression: "document.body ? document.body.innerText : ''",
    returnByValue: true,
  });
  return res.result?.value || "";
}

function findMarker(text, markers) {
  const lower = text.toLowerCase();
  return markers.find((m) => lower.includes(m.toLowerCase()));
}

// Navigates and waits for the real Page.loadEventFired signal (instead of a
// fixed sleep), then checks the loaded page for browser-level error markers.
// Retries the navigation a few times with backoff if the browser choked
// (e.g. ERR_NETWORK_CHANGED from a Wi-Fi/VPN hiccup on the runner machine).
async function navigateAndWait(cdp, url, { retries = 3, settleMs = 1500, extraWaitMs = 0 } = {}) {
  let lastError = null;
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const loadPromise = cdp.once("Page.loadEventFired", 20000);
      await cdp.send("Page.navigate", { url });
      await loadPromise;
      await sleep(settleMs + extraWaitMs);

      const text = await getPageText(cdp);
      const marker = findMarker(text, BROWSER_ERROR_MARKERS);
      if (marker) {
        lastError = new Error(`Browser error page detected (${marker}) while loading ${url}`);
        console.warn(`Attempt ${attempt}/${retries} failed: ${lastError.message}. Retrying...`);
        await sleep(2000 * attempt);
        continue;
      }
      return; // success
    } catch (err) {
      lastError = err;
      console.warn(`Attempt ${attempt}/${retries} failed to load ${url}: ${err.message}. Retrying...`);
      await sleep(2000 * attempt);
    }
  }
  throw new Error(`Failed to load ${url} after ${retries} attempts: ${lastError?.message}`);
}

// Captures a screenshot but refuses to save it if the page is showing a
// known browser error page — throws instead so the caller can retry.
async function captureScreenshotSafely(cdp, outPath, label) {
  const text = await getPageText(cdp);
  const marker = findMarker(text, BROWSER_ERROR_MARKERS);
  if (marker) {
    throw new Error(`Refusing to save ${label}: page shows browser error (${marker})`);
  }
  const shot = await cdp.send("Page.captureScreenshot", { format: "png" });
  fs.writeFileSync(outPath, Buffer.from(shot.data, "base64"));
  console.log(`Saved ${outPath}`);
}

async function main() {
  const chrome = spawn(CHROME_PATH, [
    "--headless=new",
    `--remote-debugging-port=${PORT}`,
    `--user-data-dir=${USER_DATA_DIR}`,
    "--window-size=1280,800",
    "--disable-gpu",
    "--no-first-run",
    "--no-default-browser-check",
  ]);

  try {
    await sleep(2000);
    const versionRes = await fetch(`http://127.0.0.1:${PORT}/json/version`);
    const versionData = await versionRes.json();
    console.log("Connected to browser:", versionData.Browser);

    // Connect to existing target / page
    const listRes = await fetch(`http://127.0.0.1:${PORT}/json/list`);
    const listData = await listRes.json();
    const pageTarget = listData.find((t) => t.type === "page") || listData[0];
    const wsUrl = pageTarget.webSocketDebuggerUrl;

    const ws = new WebSocket(wsUrl);
    await new Promise((resolve, reject) => {
      ws.onopen = resolve;
      ws.onerror = reject;
    });

    const cdp = new CdpSession(ws);
    await cdp.send("Page.enable");
    await cdp.send("DOM.enable");
    await cdp.send("Emulation.setDeviceMetricsOverride", {
      width: 1280,
      height: 800,
      deviceScaleFactor: 1,
      mobile: false,
    });

    console.log("Navigating to /login...");
    await navigateAndWait(cdp, BASE_URL + "/login", { extraWaitMs: 2000 });

    // 1. Screenshot login page
    await captureScreenshotSafely(cdp, "docs/screenshots/login.png", "login.png");

    // 2. Click the quick-login button for Admin ZEN Retail
    console.log("Clicking quick login for Admin ZEN Retail...");
    await cdp.send("Runtime.evaluate", {
      expression: `(() => {
        const btns = Array.from(document.querySelectorAll('button'));
        const adminBtn = btns.find(b => b.textContent.includes('ZEN Retail Tunisia') && b.textContent.includes('Admin'));
        if (adminBtn) { adminBtn.click(); return 'clicked'; }
        return 'not found';
      })()`,
      returnByValue: true,
    });

    await sleep(4000);

    // Check current URL
    const urlEval = await cdp.send("Runtime.evaluate", {
      expression: "window.location.href",
      returnByValue: true,
    });
    console.log("Current URL after login:", urlEval.result.value);

    // If still on login or redirected to /chat, navigate to /chat
    if (!urlEval.result.value.includes("/chat")) {
      await navigateAndWait(cdp, BASE_URL + "/chat", { extraWaitMs: 1500 });
    }

    const QUESTION = "Quelles sont les consignes de sécurité incendie à l'entrepôt ?";

    // Snapshot of what's actually on screen — logged so a failed run tells us
    // WHY it failed (submission never fired vs. stuck loading vs. wrong text)
    // instead of just "timeout".
    async function getDiagnostics() {
      const res = await cdp.send("Runtime.evaluate", {
        expression: `(() => {
          const textarea = document.querySelector('textarea');
          const form = textarea?.closest('form');
          const submitBtn = form?.querySelector('button[type="submit"]');
          const userMsgs = document.querySelectorAll('.justify-end').length;
          const assistantBubbles = Array.from(document.querySelectorAll('.justify-start'));
          const lastAssistant = assistantBubbles[assistantBubbles.length - 1];
          return {
            hasTextarea: !!textarea,
            textareaValue: textarea ? textarea.value : null,
            submitDisabled: submitBtn ? submitBtn.disabled : null,
            userMsgCount: userMsgs,
            isTyping: !!document.body.innerText.match(/Recherche dans vos documents|Génération de la réponse/),
            lastAssistantSnippet: lastAssistant ? lastAssistant.innerText.slice(0, 150) : null,
          };
        })()`,
        returnByValue: true,
      });
      return res.result?.value || {};
    }

    async function submitQuestion(attempt) {
      console.log("Submitting question on /chat...");
      // Always start a fresh conversation so we don't accidentally land on a
      // stale/cached one from a previous run (which was masking real failures).
      await cdp.send("Runtime.evaluate", {
        expression: `(() => {
          const newConvBtn = Array.from(document.querySelectorAll('button')).find(b => b.textContent && b.textContent.includes('Nouvelle'));
          if (newConvBtn) newConvBtn.click();
          return true;
        })()`,
        returnByValue: true,
      });
      await sleep(900);

      // Poll briefly for the textarea to exist (it can be momentarily absent
      // right after the "new conversation" navigation swaps the page out).
      let hasTextarea = false;
      for (let i = 0; i < 6; i++) {
        const check = await cdp.send("Runtime.evaluate", {
          expression: "!!document.querySelector('textarea')",
          returnByValue: true,
        });
        hasTextarea = !!check.result?.value;
        if (hasTextarea) break;
        await sleep(400);
      }
      if (!hasTextarea) {
        console.warn(`[attempt ${attempt}] No <textarea> found on page — chat input never appeared.`);
        return;
      }

      const setResult = await cdp.send("Runtime.evaluate", {
        expression: `(() => {
          const textarea = document.querySelector('textarea');
          const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set;
          setter.call(textarea, ${JSON.stringify(QUESTION)});
          textarea.dispatchEvent(new Event('input', { bubbles: true }));
          textarea.dispatchEvent(new Event('change', { bubbles: true }));
          return textarea.value;
        })()`,
        returnByValue: true,
      });
      console.log(`[attempt ${attempt}] Textarea value after setting: ${JSON.stringify(setResult.result?.value)}`);

      // Give React a beat to re-render the submit button as enabled before we
      // try to click it.
      await sleep(300);

      const clickResult = await cdp.send("Runtime.evaluate", {
        expression: `(() => {
          const textarea = document.querySelector('textarea');
          const form = textarea?.closest('form');
          const submitBtn = form?.querySelector('button[type="submit"]');
          if (submitBtn && !submitBtn.disabled) {
            submitBtn.click();
            return 'submit clicked';
          }
          return 'submit button disabled or missing (disabled=' + submitBtn?.disabled + ')';
        })()`,
        returnByValue: true,
      });
      console.log(`[attempt ${attempt}] Click result: ${clickResult.result?.value}`);

      // Fallback: if the button was disabled (React state didn't pick up the
      // native-setter trick this time), submit the same way a real user would
      // — pressing Enter in the textarea, which the app's own onKeyDown handles.
      if (String(clickResult.result?.value).includes("disabled")) {
        console.log(`[attempt ${attempt}] Falling back to Enter keypress in textarea...`);
        await cdp.send("Runtime.evaluate", {
          expression: `(() => {
            const textarea = document.querySelector('textarea');
            if (!textarea) return 'no textarea';
            textarea.focus();
            const evt = new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', bubbles: true, cancelable: true });
            textarea.dispatchEvent(evt);
            return 'enter dispatched';
          })()`,
          returnByValue: true,
        });
      }

      await sleep(500);
      const diag = await getDiagnostics();
      console.log(`[attempt ${attempt}] Post-submit diagnostics:`, JSON.stringify(diag));
    }

    // Waits for either a citation button (success) or the RAG "no sources"
    // fallback (failure) to appear, so we know which case we're in instead of
    // blindly screenshotting whatever happens to be on screen after a timeout.
    // Also logs periodic diagnostics so a "timeout" outcome is explainable.
    async function waitForRagOutcome(attempt, timeoutMs = 40000) {
      const start = Date.now();
      let loop = 0;
      while (Date.now() - start < timeoutMs) {
        await sleep(1500);
        loop++;
        const text = await getPageText(cdp);
        if (findMarker(text, RAG_NO_SOURCE_MARKERS)) return "no_source";
        const evalRes = await cdp.send("Runtime.evaluate", {
          expression: `(() => {
            const hasSourcesCited = Array.from(document.querySelectorAll('span, div, p')).some(el => el.textContent && el.textContent.includes('Sources citées'));
            const hasSourceAccordion = !!document.querySelector('[class*="group/source"]');
            const hasCiteLinks = !!document.querySelector('[class*="group/cite"], a[href*="preview"]');
            const citeBtn = Array.from(document.querySelectorAll('button, a, div[role="button"]')).find(b => b.textContent && (b.textContent.includes('[1]') || b.textContent.includes('v1') || b.textContent.includes('Procédure')));
            return !!(hasSourcesCited || hasSourceAccordion || hasCiteLinks || citeBtn);
          })()`,
          returnByValue: true,
        });
        if (evalRes.result?.value) return "cited";

        // Every ~6s, log what's actually happening so a timeout isn't a black box.
        if (loop % 4 === 0) {
          const diag = await getDiagnostics();
          console.log(`[attempt ${attempt}] Still waiting (${Math.round((Date.now() - start) / 1000)}s)…`, JSON.stringify(diag));
        }
      }
      return "timeout";
    }

    let outcome = "timeout";
    const MAX_QUESTION_ATTEMPTS = 3;
    for (let attempt = 1; attempt <= MAX_QUESTION_ATTEMPTS; attempt++) {
      await submitQuestion(attempt);
      console.log(`Waiting for RAG answer (attempt ${attempt}/${MAX_QUESTION_ATTEMPTS})...`);
      outcome = await waitForRagOutcome(attempt);
      if (outcome === "cited") {
        console.log("Found citation button!");
        break;
      }
      console.warn(
        `RAG did not return a cited answer (outcome: ${outcome}). ` +
          (attempt < MAX_QUESTION_ATTEMPTS
            ? "Retrying — this is usually a transient indexing/retrieval hiccup, not a real regression."
            : "Giving up after max attempts; the underlying retrieval issue needs investigating separately.")
      );
      await sleep(1500);
    }

    if (outcome === "cited") {
      // Unfold citation
      console.log("Unfolding citation preview...");
      await cdp.send("Runtime.evaluate", {
        expression: `(() => {
          // 1. Expand the citation accordion under the message
          const sourceHeader = document.querySelector('[class*="group/source"] > div');
          if (sourceHeader) {
            sourceHeader.click();
            sourceHeader.scrollIntoView({ behavior: 'instant', block: 'center' });
          }
          // 2. Also open the right side panel if not already open
          const inspectBtn = Array.from(document.querySelectorAll('button')).find(b => b.textContent && (b.textContent.includes('Inspecter dans le volet') || b.textContent.includes('Sources')));
          if (inspectBtn) {
            inspectBtn.click();
          }
          return 'citation unfolded';
        })()`,
        returnByValue: true,
      });
      await sleep(2500);

      // 2. Screenshot chat with citation
      await captureScreenshotSafely(cdp, "docs/screenshots/chat-citation.png", "chat-citation.png");
    } else {
      console.error(
        `Skipping docs/screenshots/chat-citation.png: RAG never returned a cited answer (outcome: ${outcome}). ` +
          "The existing file is left untouched — check retrieval/ingestion status for the demo dataset before re-running."
      );
    }

    // 3. Navigate to /admin
    console.log("Navigating to /admin...");
    await navigateAndWait(cdp, BASE_URL + "/admin", { extraWaitMs: 1500 });
    await captureScreenshotSafely(cdp, "docs/screenshots/admin.png", "admin.png");

    ws.close();
    console.log("All screenshots captured successfully!");
  } catch (err) {
    console.error("Screenshot script failed:", err);
  } finally {
    chrome.kill();
    try {
      fs.rmSync(USER_DATA_DIR, { recursive: true, force: true });
    } catch {}
  }
}

main();
