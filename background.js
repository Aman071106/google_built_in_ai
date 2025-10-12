// background.js

let session = null;
let translators = new Map();

// ---------------------- SESSION ----------------------
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
You are *Milo Mate*, a friendly, intelligent AI assistant that helps users **explore and understand the content of the current webpage**.

---

## 🪶 CORE PRINCIPLES

1. **Grounded Responses Only:**  
   Always answer **based solely on the provided webpage content** — no external knowledge.  

2. **Transparency:**  
   If the answer isn't clearly supported by the content, say so honestly.  

3. **Clarity and Precision:**  
   Keep explanations **concise, relevant, and directly answering the user's question**.  

4. **Reference Context:**  
   When helpful, mention the specific section or phrase from the page.  

5. **Focus:**  
   Stay entirely focused on the webpage content; **avoid speculation or unrelated info**.  

---

## 🧭 RESPONSE FORMAT

- All responses must be in Markdown (md) format.
- Begin with a direct answer to the question.  
- Follow up with supporting details or references to specific parts of the webpage.  
- If information is missing, clearly state:  
  > "The webpage does not provide information about this."  
- Use bullet points for structured lists.  
- Keep the tone friendly, intelligent, and helpful.  

---

## 🧩 FEW-SHOT EXAMPLES

**Example 1 – Direct Answer:**

> **Q:** What is the main topic of this page?  
>
>  The page mainly discusses *renewable energy sources*, focusing on solar and wind power.  
  - It highlights advantages like sustainability and reduced carbon emissions.  
  - This is mentioned in the section *"Benefits of Renewable Energy"*.  

---

**Example 2 – Missing Information:**

> **Q:** Does this webpage include any statistics about global warming?  
>
>  The webpage does **not** provide specific statistics about global warming.  
  -  It discusses environmental impacts generally but without numerical data. 
  -  You can visit [link](https://globalwarming.com)

---

**Example 3 – Context Reference:**

> **Q:** Who is the author of this article?  
>
>  The article is written by *Dr. Amelia Grant*, as shown at the top of the page under the heading *"By Dr. Amelia Grant, Environmental Scientist."*  

---

## 🪄 STYLE CHECKLIST

- ✅ Always in Markdown   
- ✅ Use bold (**"text"**) and italics (*"text"*) appropriately  
- ✅ Use hashes (#) for heading levels
- ✅ Be **friendly but factual**  
- ✅ Never hallucinate or use outside knowledge  

---

Your task begins now — analyze the given webpage content and respond only using what's there, formatted beautifully in Markdown.
        `
      }
    ],
    temperature: 0.7,
    topK: 3,
  });

  console.log("[BG] Session created!");
  return session;
}

// ---------------------- TRANSLATOR ----------------------
async function ensureTranslator(sourceLang, targetLang, forceNew = false) {
  const key = `${sourceLang}-${targetLang}`;

  if (!forceNew && translators.has(key)) {
    console.log(`[BG] Reusing cached translator for ${key}`);
    return translators.get(key);
  }

  console.log(`[BG] Creating new translator for ${sourceLang} -> ${targetLang}`);
  if (typeof Translator === "undefined") {
    throw new Error("[BG] Translator API not available");
  }

  const availability = await Translator.availability({
    sourceLanguage: sourceLang,
    targetLanguage: targetLang,
  });
  console.log(`[BG] Translator availability for ${key}:`, availability);

  if (availability === "unavailable") {
    throw new Error(`[BG] Translation from ${sourceLang} to ${targetLang} not available`);
  }

  const translator = await Translator.create({
    sourceLanguage: sourceLang,
    targetLanguage: targetLang,
    monitor(m) {
      m.addEventListener("downloadprogress", (e) => {
        console.log(`[BG] Translator downloaded ${(e.loaded * 100).toFixed(1)}%`);
      });
    },
  });

  console.log("[BG] Translator created:", translator);
  translators.set(key, translator);
  return translator;
}

async function translateText(text, sourceLang, targetLang, forceNew = false) {
  if (sourceLang === targetLang) return text;

  console.log(`[BG] translateText() called`);
  console.log(`[BG] Input text: "${text}"`);
  console.log(`[BG] Source: ${sourceLang}, Target: ${targetLang}, Force new: ${forceNew}`);

  try {
    const translator = await ensureTranslator(sourceLang, targetLang, forceNew);
    console.log("[BG] Translator instance ready:", translator);

    const translated = await translator.translate(text);
    console.log(`[BG] Translated text: "${translated}"`);

    if (!translated || translated === text) {
      console.warn("[BG] Warning: Translation returned the same text as input. Possible misconfiguration.");
    }

    return translated;
  } catch (err) {
    console.error("[BG] Translation failed:", err);
    throw err;
  }
}

// ---------------------- UTILS ----------------------
async function getUserLanguage() {
  return new Promise((resolve) => {
    chrome.storage.local.get(['userLanguage'], (result) => {
      resolve(result.userLanguage || 'en');
    });
  });
}

// ---------------------- HANDLERS ----------------------

// Handle regular queries (full page content)
async function handleRegularQuery(request, sender, sendResponse) {
  try {
    const sess = await ensureSession();
    console.log("[BG] Session ready, sending prompt for regular query...");
    console.log("[BG] Page content length:", request.page?.length);

    const userLanguage = await getUserLanguage();
    let queryToSend = request.query;

    // Translate query to English if needed
    if (userLanguage !== 'en') {
      console.log("[BG] Translating user query to English...");
      queryToSend = await translateText(request.query, userLanguage, 'en', true);
      console.log("[BG] Translated query:", queryToSend);
    }

    const result = await sess.prompt([
      {
        role: "user",
        content: `Page Content:\n${request.page}\n\nQuestion:\n${queryToSend}\n\nPlease answer based on the page content above.`,
      },
    ]);

    console.log("[BG] Regular prompt complete (English):", result);

    let finalAnswer = result;

    // Translate answer back to user language if needed
    if (userLanguage !== 'en') {
      console.log("[BG] Translating answer back to user language...");
      finalAnswer = await translateText(result, 'en', userLanguage, true);
      console.log("[BG] Translated answer:", finalAnswer);
    }

    sendResponse({ ok: true, answer: finalAnswer });
  } catch (e) {
    console.error("[BG] Regular prompt failed:", e);
    sendResponse({ ok: false, error: e.message });
  }
}

// Handle RAG-enhanced queries
async function handleRAGQuery(request, sender, sendResponse) {
  try {
    const sess = await ensureSession();
    console.log("[BG] Session ready, sending RAG-enhanced prompt...");

    const { query, context, metadata } = request;
    const userLanguage = await getUserLanguage();
    let queryToSend = query;

    console.log(`[BG] RAG Query: "${query}"`);
    console.log(`[BG] Context length: ${context.length} chars`);
    console.log(`[BG] Using ${metadata.relevantChunks} of ${metadata.totalChunks} chunks`);
    console.log(`[BG] Source: ${metadata.source}`);

    // Translate query to English if needed
    if (userLanguage !== 'en') {
      console.log("[BG] Translating RAG query to English...");
      queryToSend = await translateText(query, userLanguage, 'en', true);
      console.log("[BG] Translated RAG query:", queryToSend);
    }

    // Create enhanced prompt with RAG context
    const prompt = `Based on the following context from the webpage "${metadata.title}", answer the user's question.

CONTEXT FROM PAGE:
${context}

## 🧩 INPUT VARIABLES

-  Webpage Title:  ${metadata.title} 
-  Webpage Context:  
  ${context}
-  User's Question:  
  ${queryToSend}
---

IMPORTANT INSTRUCTIONS:
1. Answer using ONLY the information provided in the context above
2. If the context doesn't contain the answer, say: "Based on the page content, I cannot find specific information about [the topic]."
3. Be specific and reference relevant parts of the context
4. Keep your answer concise and directly helpful
5. If the question is about the page structure or content, use the headings and sections from the context
6. Do not make up or assume any information not present in the context
7. You are always provided with the links from the current page user can navigate to so if the user asks a query whose answer is not available on current page , then tell him that he can navigate to {these} relevant pages with links. Give only relevant ones.
8. Markdown Output  
   - Use **bold** for emphasis. 
   - Use [link](https://link) for links 
   - Use bullet points for lists or key points.  
   - Keep tone friendly yet factual.
ANSWER:`;

    console.log("[BG] Full RAG prompt:", prompt);

    const result = await sess.prompt([
      {
        role: "user",
        content: prompt,
      },
    ]);

    console.log("[BG] RAG prompt complete, response length:", result.length);

    let finalAnswer = result;

    // Translate answer back to user language if needed
    if (userLanguage !== 'en') {
      console.log("[BG] Translating RAG answer back to user language...");
      finalAnswer = await translateText(result, 'en', userLanguage, true);
      console.log("[BG] Translated RAG answer:", finalAnswer);
    }

    // Add RAG metadata to the response
    sendResponse({
      ok: true,
      answer: finalAnswer,
      ragMetadata: {
        chunksUsed: metadata.relevantChunks,
        totalChunks: metadata.totalChunks,
        contextLength: context.length,
        source: metadata.source
      }
    });

  } catch (e) {
    console.error("[BG] RAG prompt failed:", e);
    sendResponse({ ok: false, error: e.message });
  }
}

// Background voice recording manager
class VoiceRecordingManager {
  constructor() {
    this.isRecording = false;
    this.activeTabId = null;
  }

  async startRecording(tabId) {
    try {
      console.log('[Background][Voice] 🎙 Starting recording via content script...');

      this.activeTabId = tabId;

      // Inject content script if not already injected
      await chrome.scripting.executeScript({
        target: { tabId: tabId },
        files: ['content.js']
      });
      console.log("[Background][Voice] Inside start Recording");
      // Send message to content script to start recording
      const response = await chrome.tabs.sendMessage(tabId, {
        type: 'START_RECORDING'
      });

      if (response && response.success) {
        this.isRecording = true;
        console.log('[Background][Voice] 🟢 Recording started via content script');
        return { success: true };
      } else {
        throw new Error(response?.error || 'Failed to start recording');
      }

    } catch (error) {
      console.error('[Background][Voice] ❌ Recording error:', error);
      return { success: false, error: error.message };
    }
  }
  async startLiveRecording(tabId) {
    try {
      console.log('[Background][Voice] 🎙 Starting recording via content script...');

      this.activeTabId = tabId;

      // Inject content script if not already injected
      await chrome.scripting.executeScript({
        target: { tabId: tabId },
        files: ['content.js']
      });
      onsole.log("[Background][LiveVoice] Inside Live start Recording");
      // Send message to content script to start recording
      const response = await chrome.tabs.sendMessage(tabId, {
        type: 'START_LIVE_RECORDING'
      });

      if (response && response.success) {
        this.isRecording = true;
        console.log('[Background][LiveVoice] 🟢 Recording started via content script');
        return { success: true };
      } else {
        throw new Error(response?.error || 'Failed to start recording');
      }

    } catch (error) {
      console.error('[Background][LiveVoice] ❌ Recording error:', error);
      return { success: false, error: error.message };
    }
  }

  async stopRecording() {
    if (!this.activeTabId || !this.isRecording) {
      return { success: false, error: 'No active recording' };
    }

    try {
      const response = await chrome.tabs.sendMessage(this.activeTabId, {
        type: 'STOP_RECORDING'
      });

      this.isRecording = false;
      this.activeTabId = null;

      console.log('[Background][Voice] 🔴 Recording stopped');
      return { success: true, audioData: response?.audioData };

    } catch (error) {
      console.error('[Background][Voice] ❌ Stop recording error:', error);
      return { success: false, error: error.message };
    }
  }
}

// Initialize voice manager
const voiceManager = new VoiceRecordingManager();
// ---------------------- MESSAGE HANDLER ----------------------
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  console.log("[BG] Received message type:", msg.type);

  switch (msg.type) {
    case "ASK_QUERY_WITH_CONTEXT":
      handleRAGQuery(msg, sender, sendResponse);
      break;

    case "ASK_QUERY":
      handleRegularQuery(msg, sender, sendResponse);
      break;

    case "TRANSLATE_TEXT":
      (async () => {
        try {
          const translated = await translateText(msg.text, msg.sourceLang, msg.targetLang, true);
          sendResponse({ ok: true, translatedText: translated });
        } catch (e) {
          sendResponse({ ok: false, error: e.message });
        }
      })();
      break;

    case "TRANSCRIBE_AUDIO":
      (async () => {
        try {
          const lang = msg.language || "en";
          const mimeType = msg.mimeType || "audio/webm;codecs=opus";

          // Reconstruct Blob from Base64
          const byteChars = atob(msg.audioBase64);
          const byteNumbers = new Array(byteChars.length);
          for (let i = 0; i < byteChars.length; i++) {
            byteNumbers[i] = byteChars.charCodeAt(i);
          }
          const byteArray = new Uint8Array(byteNumbers);
          const audioBlob = new Blob([byteArray], { type: mimeType });

          const response = await fetch(`https://api.deepgram.com/v1/listen?language=${lang}`, {
            method: "POST",
            headers: {
              "Authorization": "Token ef2c8061467bd30d586456e55bfb751027e553fb",
              "Content-Type": mimeType,
            },
            body: audioBlob
          });

          const result = await response.json();
          console.log("[BG][Voice] ✅ Deepgram raw response:", result);

          const transcript = result.results?.channels?.[0]?.alternatives?.[0]?.transcript || "";
          console.log("[BG][Voice] 📝 Transcript:", transcript);

          sendResponse({ ok: true, transcript });
        } catch (err) {
          console.error("[BG][Voice] ❌ Transcription failed:", err);
          sendResponse({ ok: false, error: err.message });
        }
      })();
      break;
    case 'START_RECORDING':
      // Get active tab and start recording
      chrome.tabs.query({ active: true, currentWindow: true }).then((tabs) => {
        if (tabs[0]?.id) {
          voiceManager.startRecording(tabs[0].id).then(sendResponse);
        } else {
          sendResponse({ success: false, error: 'No active tab found' });
        }
      });
      return true;
    case 'START_LIVE_RECORDING':
      // Get active tab and start recording
      console.log("[BG] start live speech")
      chrome.tabs.query({ active: true, currentWindow: true }).then((tabs) => {
        if (tabs[0]?.id) {
          voiceManager.startLiveRecording(tabs[0].id).then(sendResponse);
        } else {  
          sendResponse({ success: false, error: 'No active tab found' });
        }
      });
      return true;
    case 'STOP_RECORDING':
      voiceManager.stopRecording().then(sendResponse);
      return true;

    case 'GET_RECORDING_STATE':
      sendResponse({ 
        isRecording: voiceManager.isRecording 
      });
      return false;
    default:
      console.warn("[BG] Unknown message type:", msg.type);
      sendResponse({ ok: false, error: "Unknown message type" });
  }

  return true; // keep channel open
});

// ---------------------- SESSION MANAGEMENT ----------------------
chrome.runtime.onSuspend.addListener(() => {
  console.log("[BG] Extension suspending, cleaning up...");
  session = null;
  translators.clear();
});

// Periodic session refresh to prevent memory issues
setInterval(() => {
  if (session) {
    console.log("[BG] Refreshing session...");
    session = null;
  }
  if (translators.size > 0) {
    console.log("[BG] Clearing translator cache...");
    translators.clear();
  }
}, 30 * 60 * 1000); // Refresh every 30 minutes

// ---------------------- POPUP INJECTION ----------------------
chrome.action.onClicked.addListener(async (tab) => {
  try {
    console.log("[BG] Injecting Milo Mate popup into page...");
    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      files: ["injectPopup.js"],
    });
  } catch (err) {
    console.error("[BG] Failed to inject popup:", err);
  }
});