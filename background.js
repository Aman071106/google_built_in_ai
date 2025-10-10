// background.js

let session = null;

async function ensureSession() {
  console.log("[BG] ensureSession() called");

  if (session) {
    console.log("[BG] using cached session");
    return session;
  }

  if (typeof LanguageModel === "undefined") {
    throw new Error("LanguageModel API not available — requires Chrome Canary with Gemini Nano enabled.");
  }

  console.log("[BG] Checking availability...");
  const availability = await LanguageModel.availability();
  console.log("[BG] availability:", availability);

  if (availability === "unavailable") {
    throw new Error("Gemini Nano not available");
  }

  console.log("[BG] Fetching params...");
  const params = await LanguageModel.params();

  console.log("[BG] Creating session...");
  session = await LanguageModel.create({
    monitor(m) {
      m.addEventListener("downloadprogress", (e) => {
        console.log(`[BG] Downloaded ${(e.loaded * 100).toFixed(1)}%`);
      });
    },
    initialPrompts: [
        {
          role: "system",
          content: `
              You are **Milo Mate**, a friendly and intelligent AI assistant that helps users explore and understand the content of the current webpage.
              
          `
        }
      ],
    temperature: 1.2,
    topK: 3,
  });

  console.log("[BG] Session created!");
  return session;
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === "ASK_QUERY") {
    console.log("[BG] Received ASK_QUERY:", msg);

    (async () => {
      try {
        const sess = await ensureSession();
        console.log("[BG] Session ready, sending prompt...");
        console.log("[BG]",msg.page);

        const result = await sess.prompt([
          {
            role: "user",
            content: `Page:\n${msg.page}\n\nQuestion:\n${msg.query}`,
          },
        ]);

        console.log("[BG] Prompt complete:", result);
        sendResponse({ ok: true, answer: result });
      } catch (e) {
        console.error("[BG] Prompt failed:", e);
        sendResponse({ ok: false, error: e.message });
      }
    })();

    return true; // keep channel open
  }
});