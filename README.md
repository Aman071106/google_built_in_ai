# Chrome AI Customer-Service Assistant — Plan + Initial Scaffold

**Goal (MVP):** A Chrome Extension (website-agnostic) that helps agents and customers by providing: live voice STT, sentiment-aware suggested replies, multilingual translation, summarization of FAQs, and automated reply insertion into web chat widgets — all primarily client-side using Chrome Built-in AI (Gemini Nano + APIs) and Deepgram for high-quality STT/TTS where needed.

---

## Quick overview (one-line)

A browser extension that injects a floating assistant on any site, transcribes voice calls, detects sentiment, suggests & inserts replies (multilingual), and summarizes/supports email/chat workflows — privacy-first and client-side-first.

---

## Milestones (one-by-one)

1. **Scaffold & basic UI** — manifest, service worker, content script, popup/options UI, basic injection of floating assistant.
2. **Chat detection + reply suggestions** — detect chat widgets and show suggested replies (client-side call to Chrome Prompt API stub).
3. **STT/TTS (Deepgram)** — capture microphone, stream or chunk audio to Deepgram, display live captions and suggested responses.
4. **Translation + Multilingual** — integrate Chrome Translator API (or hybrid with Gemini Developer API if needed) for real-time translation and reply generation.
5. **Sentiment & auto-priority** — run sentiment on messages and surface urgency flags and canned reply templates.
6. **Email composer integration & FAQ summarizer** — detect Gmail/Outlook compose and produce suggested email drafts; summarize long FAQ pages and produce short answers.
7. **Polish, demo, and packaging** — prepare 2–4 minute demo video / slides and Devpost description.

---

## What I deliver in this turn (immediately)

* A concise step-by-step plan (this doc).
* A working scaffold (files you can load as an unpacked extension): `manifest.json`, `background.js` (service worker), `content_script.js`, `popup.html`, `popup.js`, `options.html`, `options.js` and small CSS. These include clear TODOs/placeholders for Deepgram and Chrome Built-in AI calls.

> **Important:** I placed all scaffold contents below. Load them as an unpacked extension to test the UI injection. After you give me Deepgram + Chrome AI access/token/docs, I will implement Step 2 (chat suggestions) and Step 3 (Deepgram integration) one-by-one.

---

## File tree (scaffold)

```
chrome-ai-assistant/
├─ manifest.json
├─ background.js          // service worker
├─ content_script.js
├─ popup.html
├─ popup.js
├─ options.html
├─ options.js
├─ styles.css
└─ icons/
   └─ icon128.png
```

---

## Files (copy these into the folder)

### `manifest.json`

```json
{
  "manifest_version": 3,
  "name": "Chrome AI Customer Assist",
  "version": "0.1.0",
  "description": "Floating AI assistant: STT, translation, sentiment-aware replies and summarization (MVP)",
  "permissions": ["storage","activeTab","scripting","tabs","microphone"],
  "host_permissions": ["<all_urls>"],
  "action": { "default_popup": "popup.html" },
  "background": { "service_worker": "background.js" },
  "content_scripts": [
    {
      "matches": ["http://*/*","https://*/*"],
      "js": ["content_script.js"],
      "run_at": "document_idle"
    }
  ],
  "icons": { "128": "icons/icon128.png" }
}
```

### `background.js` (service worker)

```js
// background.js - message router + placeholders for API calls
chrome.runtime.onInstalled.addListener(() => {
  console.log('Chrome AI Assistant installed');
});

// Simple message routing
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === 'CALL_CHROME_AI') {
    // TODO: replace with real Chrome Built-in AI call per Google docs.
    // Example stub that echoes prompt back
    const response = { text: '[stub] suggested reply for: ' + msg.prompt };
    sendResponse({ ok: true, data: response });
    return true; // keeps the message channel open
  }

  if (msg.type === 'SEND_AUDIO_DEEPGRAM') {
    // TODO: get Deepgram API key from storage and forward audio blob to Deepgram
    // PLACEHOLDER: respond with fake transcript
    sendResponse({ ok: true, transcript: '[stub] transcribed audio' });
    return true;
  }
});
```

### `content_script.js`

```js
// content_script.js - injects assistant UI and detects chat inputs
(function () {
  if (window.__chromeAiAssistantInjected) return;
  window.__chromeAiAssistantInjected = true;

  // --- UI injection ---
  const panel = document.createElement('div');
  panel.id = 'chrome-ai-assistant-panel';
  panel.style.cssText = `position:fixed;right:20px;bottom:20px;z-index:999999;`;
  panel.innerHTML = `
    <button id="ai-toggle">AI</button>
    <div id="ai-menu" style="display:none; width:320px; background:white; border-radius:8px; box-shadow:0 4px 12px rgba(0,0,0,.15); padding:8px;">
      <div id="ai-status">Ready</div>
      <button id="ai-start-voice">Start Voice</button>
      <button id="ai-suggest">Suggest Reply</button>
      <div id="ai-suggestions"></div>
    </div>
  `;
  document.body.appendChild(panel);

  const toggle = document.getElementById('ai-toggle');
  const menu = document.getElementById('ai-menu');
  toggle.addEventListener('click', () => menu.style.display = menu.style.display === 'none' ? 'block' : 'none');

  // --- Detect chat input boxes (simple heuristic) ---
  function findChatInputs() {
    const candidates = Array.from(document.querySelectorAll('input[type=text], textarea, [contenteditable="true"]'));
    // Filter out very small, hidden or disabled
    return candidates.filter(el => el.offsetParent !== null && !el.disabled && el.offsetWidth > 100).slice(0, 10);
  }

  // Show suggestion in first detected chat input
  async function suggestReply() {
    const inputs = findChatInputs();
    if (!inputs.length) {
      alert('No chat inputs detected on this page.');
      return;
    }
    const target = inputs[0];
    const contextText = target.value || target.innerText || '';

    // Ask background to call Chrome AI (stub for now)
    chrome.runtime.sendMessage({ type: 'CALL_CHROME_AI', prompt: contextText }, (resp) => {
      const s = document.getElementById('ai-suggestions');
      s.innerText = resp?.data?.text || '[no suggestions]';

      // Add a quick-insert button
      const insertBtn = document.createElement('button');
      insertBtn.innerText = 'Insert suggestion';
      insertBtn.onclick = () => {
        if (target.tagName === 'TEXTAREA' || target.tagName === 'INPUT') target.value = resp.data.text;
        else target.innerText = resp.data.text;
      };
      s.appendChild(document.createElement('br'));
      s.appendChild(insertBtn);
    });
  }

  document.getElementById('ai-suggest').addEventListener('click', suggestReply);

  // --- Voice start placeholder ---
  document.getElementById('ai-start-voice').addEventListener('click', async () => {
    // Request mic access and capture 5 seconds, then send to background for Deepgram
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mediaRecorder = new MediaRecorder(stream);
      const chunks = [];
      mediaRecorder.ondataavailable = e => chunks.push(e.data);
      mediaRecorder.onstop = () => {
        const blob = new Blob(chunks, { type: 'audio/webm' });
        chrome.runtime.sendMessage({ type: 'SEND_AUDIO_DEEPGRAM', blob }, (resp) => {
          const s = document.getElementById('ai-suggestions');
          s.innerText = 'Transcript: ' + (resp.transcript || '[stub]');
        });
      };
      mediaRecorder.start();
      setTimeout(() => mediaRecorder.stop(), 5000);
    } catch (err) {
      alert('Microphone access denied or not available');
    }
  });
})();
```

### `popup.html`

```html
<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <title>AI Assist</title>
    <link rel="stylesheet" href="styles.css" />
  </head>
  <body>
    <h3>AI Assist — Controls</h3>
    <label>Language: <select id="lang"><option value="en">English</option><option value="hi">Hindi</option></select></label>
    <div>
      <label><input type="checkbox" id="autoSuggest"> Auto-suggest replies</label>
    </div>
    <button id="openOptions">API Keys & Settings</button>
    <script src="popup.js"></script>
  </body>
</html>
```

### `popup.js`

```js
// popup.js — small controls
document.getElementById('openOptions').addEventListener('click', () => {
  chrome.runtime.openOptionsPage();
});

// load settings
chrome.storage.local.get(['lang','autoSuggest'], (s) => {
  if (s.lang) document.getElementById('lang').value = s.lang;
  document.getElementById('autoSuggest').checked = !!s.autoSuggest;
});

// save changes
document.getElementById('lang').addEventListener('change', (e) => chrome.storage.local.set({ lang: e.target.value }));
document.getElementById('autoSuggest').addEventListener('change', (e) => chrome.storage.local.set({ autoSuggest: e.target.checked }));
```

### `options.html` + `options.js` (API keys storage)

```html
<!-- options.html -->
<!doctype html>
<html>
<body>
  <h3>API Keys & Settings</h3>
  <label>Deepgram API Key (or short-lived token): <input id="deepgramKey" /></label><br/>
  <label>Chrome Built-in AI Token / Notes: <textarea id="chromeAiNotes"></textarea></label><br/>
  <button id="save">Save</button>
  <div id="status"></div>
  <script src="options.js"></script>
</body>
</html>
```

```js
// options.js
document.getElementById('save').addEventListener('click', () => {
  const deepgramKey = document.getElementById('deepgramKey').value.trim();
  const chromeAiNotes = document.getElementById('chromeAiNotes').value.trim();
  chrome.storage.local.set({ deepgramKey, chromeAiNotes }, () => {
    document.getElementById('status').innerText = 'Saved';
  });
});

// Load existing
chrome.storage.local.get(['deepgramKey','chromeAiNotes'], (s) => {
  if (s.deepgramKey) document.getElementById('deepgramKey').value = s.deepgramKey;
  if (s.chromeAiNotes) document.getElementById('chromeAiNotes').value = s.chromeAiNotes;
});
```

### `styles.css`

```css
#chrome-ai-assistant-panel button { padding:8px 10px; border-radius:6px; }
#chrome-ai-assistant-panel #ai-menu { font-family: Arial, sans-serif; }
```

---

## How to load & test (local)

1. Save the files above into a folder `chrome-ai-assistant/`.
2. Open Chrome -> `chrome://extensions` -> enable *Developer mode* -> *Load unpacked* and choose the folder.
3. Open any website, click the floating `AI` button (bottom-right) and test `Suggest Reply` and `Start Voice` (voice is a 5s capture stub).

---

## Next immediate actions (what I need from you)

1. **Deepgram access**: paste a valid Deepgram API key or short-lived token (or upload docs) so I can implement `SEND_AUDIO_DEEPGRAM` in the background worker. If you prefer not to share a key, tell me the Deepgram SDK choice (websocket vs REST) and I will provide code that you can enable locally.
2. **Chrome Built-in AI access**: if you have Early Preview access / docs or sample code, paste it (or grant me the precise API method names). If you don't have access yet, I will provide *generic stubs* you can later replace; however to implement real client-side calls I need the docs/token.
3. Optional: list of 2–3 target websites or chat widgets you most want to support (Gmail, Intercom, Zendesk, custom site, etc.).

---

## What I will do next after you provide items

* **With Deepgram key:** implement streaming/chunked STT in `background.js`, show live captions in the assistant panel, and connect captions -> Chrome AI prompt for suggested replies.
* **With Chrome AI docs/token:** replace `CALL_CHROME_AI` stub with real built-in API calls (Summarizer/Prompt/Translator/Writer) and implement multilingual reply generation.
* Then we'll iterate: sentiment detection, auto-insert rules, Gmail integration, and demo material.

---

## Security & Privacy notes (important for hackathon)

* Keep API keys out of public repos. Use `chrome.storage.local` for keys during development.
* Prefer short-lived tokens. Consider a hybrid server only if you need heavy model use or long-term logging.
* Emphasize client-side-first (Gemini Nano + Prompt API) for privacy and offline resilience.

---

If this scaffold looks good, say **"Proceed Step 2"** and paste the Deepgram API key and Chrome Built-in AI docs/token (or tell me you prefer stubs). I'll implement Step 2 (Deepgram STT + real Chrome AI Prompt integration) and push the exact code changes.
