// popup.js (Milo Mate AI Assistant - Complete Version)

document.addEventListener('DOMContentLoaded', async () => {
  // Initialize language detector first
  await initLanguageDetector();
  loadUserPreferences();
  initializeImageUpload();
  testBackgroundCommunication();
  addSummarizationStyles();
  initializeSummarization();

  // --- 1. Tab switching logic ---
  const tabs = document.querySelectorAll('.tab');
  const tabContents = document.querySelectorAll('.tab-content');

  tabs.forEach(tab => {
    tab.addEventListener('click', () => {
      const targetId = tab.dataset.tab + '-content';
      const targetContent = document.getElementById(targetId);

      tabs.forEach(t => t.classList.remove('active'));
      tabContents.forEach(c => c.classList.remove('active'));

      tab.classList.add('active');
      if (targetContent) {
        targetContent.classList.add('active');
      }
    });
  });

  // --- 2. Chat logic ---
  const chatInputField = document.getElementById('chat-input-field');
  const sendButton = document.getElementById('send-btn');
  const chatMessages = document.getElementById('chat-messages');

  const DEBUG = true;
  const log = (...args) => DEBUG && console.log('[Popup]', ...args);

  // Initialize RAG Manager
  const ragManager = new EnhancedRAGManager();

  // Message creation function
  const createMessageElement = (text, type) => {
    const messageElement = document.createElement('div');
    messageElement.classList.add('message', type);

    const messageBubble = document.createElement('div');
    messageBubble.classList.add('message-bubble');

    const textElement = document.createElement('div');
    textElement.classList.add('message-text');

    // Check if text contains HTML tags
    if (/<[a-z][\s\S]*>/i.test(text)) {
      textElement.innerHTML = DOMPurify.sanitize(marked.parse(text));
    } else {
      textElement.textContent = text;
    }

    const timeElement = document.createElement('div');
    timeElement.classList.add('message-time');
    timeElement.textContent = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

    messageBubble.appendChild(textElement);
    messageBubble.appendChild(timeElement);
    messageElement.appendChild(messageBubble);
    chatMessages.appendChild(messageElement);
    chatMessages.scrollTop = chatMessages.scrollHeight;

    return messageElement;
  };

  // Make it globally available
  window.createMessageElement = createMessageElement;

  // Send to content script helper
  const sendToContentScript = async (tabId, message) => {
    try {
      return await chrome.tabs.sendMessage(tabId, message);
    } catch (err) {
      console.log('Content script not ready, injecting...');
      try {
        await chrome.scripting.executeScript({
          target: { tabId: tabId },
          files: ['content.js']
        });
        await new Promise(resolve => setTimeout(resolve, 100));
        return await chrome.tabs.sendMessage(tabId, message);
      } catch (injectError) {
        throw new Error('Could not load content script on this page');
      }
    }
  };
  function removeMarkdown(text) {
    if (!text || typeof text !== 'string') return text;

    return text
      // Remove headers
      .replace(/^#{1,6}\s+/gm, '')
      // Remove bold and italic
      .replace(/(\*\*|__)(.*?)\1/g, '$2')
      .replace(/(\*|_)(.*?)\1/g, '$2')
      // Remove code blocks
      .replace(/`{3}[\s\S]*?`{3}/g, '')
      .replace(/`([^`]+)`/g, '$1')
      // Remove images
      .replace(/!\[([^\]]*)\]\([^)]+\)/g, '$1')
      // Remove links but keep text
      .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
      // Remove blockquotes
      .replace(/^\s*>+\s*/gm, '')
      // Remove horizontal rules
      .replace(/^\s*[-*_]{3,}\s*$/gm, '')
      // Remove lists
      .replace(/^\s*[-*+]\s+/gm, '')
      .replace(/^\s*\d+\.\s+/gm, '')
      // Remove HTML tags if any
      .replace(/<[^>]*>/g, '')
      // Clean up extra whitespace
      .replace(/\n\s*\n/g, '\n\n')
      .trim();
  }
  // Main send handler
  const handleSend = async () => {
    const query = chatInputField.value.trim();
    if (!query) return;

    createMessageElement(query, 'user');
    chatInputField.value = '';

    const statusMessage = createMessageElement('🔍 Scraping current page...', 'assistant');

    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (!tab?.id) throw new Error('No active tab found.');

      console.log('Scraping tab:', tab.url);

      const scrapedRes = await sendToContentScript(tab.id, { type: 'SCRAPE_PAGE' });

      if (!scrapedRes?.ok) {
        statusMessage.querySelector('.message-text').textContent = '❌ Failed to scrape page content.';
        return;
      }

      const scrapedData = scrapedRes.data;
      console.log('Got page data: ', scrapedData);

      const structuredText = jsonToStructuredText(scrapedData);
      console.log('Structured text length:', structuredText);

      statusMessage.querySelector('.message-text').textContent = '📚 Processing content...';

      const processingResult = await ragManager.processPageContent(
        structuredText,
        tab.url,
        { title: scrapedData.title }
      );

      statusMessage.querySelector('.message-text').textContent = '🎯 Finding relevant information...';

      const relevantChunks = await ragManager.retrieveRelevantChunks(query, tab.url, 4);

      let context;
      if (relevantChunks.length === 0) {
        console.log('No relevant chunks, using fallback');
        const allChunks = await ragManager.vectorStore.getChunks(tab.url);
        context = allChunks.slice(0, 3).map(c => c?.text).filter(Boolean).join('\n\n');
      } else {
        context = relevantChunks
          .map((item, index) => `[Section ${index + 1}]\n${item.text}`)
          .join('\n\n---\n\n');
      }
      context += scrapedData.links
        .map(linkObj => `${linkObj.text || ''} (${linkObj.href || ''})`)
        .join("; ");
      console.log(`Using ${relevantChunks.length} relevant chunks`);

      statusMessage.querySelector('.message-text').textContent = '🧠 Generating answer...';
      console.log("Meta data:", processingResult.totalChunks, "\n\n\n relevant chunks: ", relevantChunks);
      const res = await chrome.runtime.sendMessage({
        type: 'ASK_QUERY_WITH_CONTEXT',
        query: query,
        context: context,
        metadata: {
          totalChunks: processingResult.totalChunks,
          relevantChunks: relevantChunks.length,
          source: tab.url,
          title: scrapedData.title || 'Current Page'
        }
      });

      if (res?.ok) {
        const answer = res.answer;
        const cleananswer = removeMarkdown(answer);

        const messageText = statusMessage.querySelector('.message-text');

        // Check if answer contains markdown
        if (answer.includes('**') || answer.includes('*') || answer.includes('#')) {
          messageText.innerHTML = DOMPurify.sanitize(marked.parse(answer));
        } else {
          messageText.textContent = answer;
        }

        // Store and optionally play via Deepgram
        window.latestAIResponse = answer;
        speakTextWithDeepgram(cleananswer);

        console.log('✅ Answer received');
      } else {
        statusMessage.querySelector('.message-text').textContent =
          `❌ AI Error: ${res?.error || 'Please check if Gemini Nano is available'}`;
      }

    } catch (err) {
      statusMessage.querySelector('.message-text').textContent = `⚠️ Error: ${err.message}`;
      console.log('Error:', err);
    }
  };

  // Event listeners for chat
  sendButton.addEventListener('click', handleSend);
  chatInputField.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      handleSend();
    }
  });

  // --- 3. Translation functionality ---
  const defaultLang = document.getElementById('default-lang');



  // Event listeners for translation
  defaultLang.addEventListener('change', saveUserPreferences);


  // --- 4. Voice functionality ---
  initializeVoiceRecording();
  // --- 4.2. Voice functionality for mom ---
  initializelivestream();

  // --- 5. Voice reply button ---
  document.getElementById("voice-reply-btn").addEventListener("click", async () => {
    if (!window.latestAIResponse) {
      alert("No AI response to speak yet!");
      return;
    }
    await speakTextWithDeepgram(window.latestAIResponse);
  });

  // --- 6. Close button functionality ---
  const closeBtn = document.getElementById("close-btn");
  if (closeBtn) {
    closeBtn.addEventListener("click", () => {
      window.parent.postMessage("close-milo-popup", "*");
    });
  }

  // --- 7. Make the popup draggable ---
  const popup = document.getElementById("milo-mate-popup");
  // if (popup) {
  //   dragElement(popup);
  // }
});

// =====================
// UTILITY FUNCTIONS
// =====================

// User preferences
function loadUserPreferences() {
  chrome.storage.local.get(['userLanguage'], (result) => {
    if (result.userLanguage) {
      document.getElementById('default-lang').value = result.userLanguage;
    }
  });
}

function saveUserPreferences() {
  const preferences = {
    userLanguage: document.getElementById('default-lang').value
  };
  chrome.storage.local.set(preferences);
}

// Translation functions



function removeMarkdown(text) {
  if (!text || typeof text !== 'string') return text;

  return text
    // Remove headers
    .replace(/^#{1,6}\s+/gm, '')
    // Remove bold and italic
    .replace(/(\*\*|__)(.*?)\1/g, '$2')
    .replace(/(\*|_)(.*?)\1/g, '$2')
    // Remove code blocks
    .replace(/`{3}[\s\S]*?`{3}/g, '')
    .replace(/`([^`]+)`/g, '$1')
    // Remove images
    .replace(/!\[([^\]]*)\]\([^)]+\)/g, '$1')
    // Remove links but keep text
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    // Remove blockquotes
    .replace(/^\s*>+\s*/gm, '')
    // Remove horizontal rules
    .replace(/^\s*[-*_]{3,}\s*$/gm, '')
    // Remove lists
    .replace(/^\s*[-*+]\s+/gm, '')
    .replace(/^\s*\d+\.\s+/gm, '')
    // Remove HTML tags if any
    .replace(/<[^>]*>/g, '')
    // Clean up extra whitespace
    .replace(/\n\s*\n/g, '\n\n')
    .trim();
}
// Shared function to handle AI responses from text or voice queries
function handleAIResponse(messageEl, res) {
  if (res?.ok) {
    const answer = res.answer;
    const messageText = messageEl.querySelector(".message-text");

    // Check if answer contains markdown
    if (answer.includes('**') || answer.includes('*') || answer.includes('#')) {
      messageText.innerHTML = DOMPurify.sanitize(marked.parse(answer));
    } else {
      messageText.textContent = answer;
    }

    // Store and optionally play via Deepgram
    window.latestAIResponse = answer;
    const cleananswer = removeMarkdown(answer);
    speakTextWithDeepgram(cleananswer);
  } else {
    messageEl.querySelector(".message-text").textContent =
      `❌ ${res?.error || "Unknown background error"}`;
  }
}

// Voice recording functionality
function initializeVoiceRecording() {
  const DEBUG = true;
  const log = (...args) => DEBUG && console.log('[Popup][Voice]', ...args);

  const micBtn = document.getElementById('mic-btn');
  if (!micBtn) {
    log('❌ mic button not found');
    return;
  }

  let isRecording = false;

  // Listen for messages from background
  chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    console.log("Popup to rag")
    console.log("[POPUP]", request);

    switch (request.type) {
      case "AUDIO_RECORDING_COMPLETE":
        log('📤 Received audio from background');
        handleAudioRecordingComplete(request.audioBase64, request.mimeType);
        isRecording = false;
        updateButtonState(false);
        break;

    }
  });

  async function startRecording() {
    try {
      log('🎙 Starting recording...');

      const response = await chrome.runtime.sendMessage({
        type: 'START_RECORDING'
      });

      if (response.success) {
        isRecording = true;
        updateButtonState(true);
        log('🟢 Recording started successfully');
      } else {
        throw new Error(response.error || 'Failed to start recording');
      }
    } catch (error) {
      log('❌ Failed to start recording:', error);
      showMicrophoneError(error.message);
      updateButtonState(false);
    }
  }

  async function stopRecording() {
    try {
      log('🔴 Stopping recording...');

      await chrome.runtime.sendMessage({
        type: 'STOP_RECORDING'
      });



    } catch (error) {
      log('❌ Error stopping recording:', error);
      updateButtonState(false);
    }
  }

  function updateButtonState(recording) {
    if (recording) {
      micBtn.style.color = 'red';
      micBtn.innerHTML = '🛑 Stop Recording';
    } else {
      micBtn.style.color = '';
      micBtn.innerHTML = '🎙 Start Recording';
    }
  }

  function showMicrophoneError(message) {
    alert(`Microphone Error: ${message}\n\nPlease ensure:\n• You're on a secure website (HTTPS)\n• Microphone permissions are allowed\n• The website allows microphone access`);
  }

  micBtn.addEventListener('click', () => {
    if (!isRecording) {
      startRecording();
    } else {
      stopRecording();
    }
  });

  // Update button state on popup open
  updateRecordingState();
}


// live transcription mic btn
// Voice recording functionality
// Fixed Live Recording functionality for popup.js
// Replace your initializelivestream() function with this:

function initializelivestream() {
  const DEBUG = true;
  const log = (...args) => DEBUG && console.log('[Popup][LiveVoice]', ...args);

  const livemicBtn = document.getElementById('start-meeting-btn');

  if (!livemicBtn) {
    log('❌ Live mic button not found');
    return;
  }

  log('✅ Live mic button found');

  let isRecording = false;

  // Listen for messages from background/content
  chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    log('📨 Received message:', request.type);
    if (request.type === "LIVE_TRANSCRIPT_CHUNK") {
      console.log("[Popup][LiveVoice] 📝 Received transcript chunk:", request.transcript);
      displayLiveTranscript(request.transcript);
    }
    switch (request.type) {

      case "AUDIO_RECORDING_COMPLETE_LIVE":
        if (request.success) {
          log('📤 Received LIVE audio from background');
          handleAudioRecordingCompleteLive(request.audioBase64, request.mimeType);
          isRecording = false;
          updateLiveButtonState(false);
        }
        break;
    }
  });

  async function startLiveRecording() {
    try {
      log('🎙 Starting live recording...');

      // Update UI immediately
      updateLiveButtonState(true);

      const response = await chrome.runtime.sendMessage({
        type: 'START_LIVE_RECORDING'
      });

      console.log('📨 Response from background:', response);

      if (!response) {
        throw new Error('No response from background script');
      }

      if (response.success) {
        isRecording = true;
        log('🟢 Live recording started successfully');
      } else {
        throw new Error(response.error || 'Failed to start live recording');
      }

    } catch (error) {
      console.log('❌ Failed to start live recording:', error);
      showMicrophoneError(error.message);
      updateLiveButtonState(false);
      isRecording = false;
    }
  }

  async function stopLiveRecording() {
    try {
      log('🔴 Stopping live recording...');

      const response = await chrome.runtime.sendMessage({
        type: 'STOP_RECORDING'
      });

      log('📨 Stop response:', response);

      if (response && response.success) {
        log('✅ Recording stopped successfully');

        // 🔥 NEW: Finalize the active session
        const outputArea = document.getElementById('transcription-output');
        const activeSession = outputArea?.querySelector('.active-session');
        if (activeSession) {
          activeSession.classList.remove('active-session');
          activeSession.classList.add('completed-session');

          const sessionHeader = activeSession.querySelector('div');
          if (sessionHeader) {
            const endTime = new Date().toLocaleTimeString();
            sessionHeader.innerHTML = sessionHeader.innerHTML.replace('🔴 Live Session', '✅ Completed Session') + ` - Ended at ${endTime}`;
          }
        }
      }

      // Update UI
      updateLiveButtonState(false);
      isRecording = false;

    } catch (error) {
      log('❌ Error stopping recording:', error);
      updateLiveButtonState(false);
      isRecording = false;
    }
  }

  function updateLiveButtonState(recording) {
    log('🎨 Updating button state:', recording);

    if (recording) {
      livemicBtn.style.backgroundColor = '#ff4444';
      livemicBtn.style.color = 'white';
      livemicBtn.innerHTML = '🛑 Stop Live Recording';
      livemicBtn.classList.add('recording');
    } else {
      livemicBtn.style.backgroundColor = '';
      livemicBtn.style.color = '';
      livemicBtn.innerHTML = '🎙 Start Live Recording';
      livemicBtn.classList.remove('recording');
    }
  }

  function showMicrophoneError(message) {
    alert(`Microphone Error: ${message}\n\nPlease ensure:\n• You're on a secure website (HTTPS)\n• Microphone permissions are allowed\n• The website allows microphone access`);
  }

  // Button click handler
  livemicBtn.addEventListener('click', () => {
    log('🖱️ Button clicked, current state:', isRecording);

    if (!isRecording) {
      startLiveRecording();
    } else {
      stopLiveRecording();
    }
  });

  // Initialize button state
  updateLiveButtonState(false);

  log('✅ Live recording initialized');
}

async function handleAudioRecordingCompleteLive(audioBase64, mimeType) {
  console.log("[Popup][LiveVoice] 🎙️ Processing recorded audio");

  chrome.runtime.sendMessage({
    type: "TRANSCRIBE_AUDIO_CHUNK_LIVE",
    audioBase64: audioBase64,
    mimeType: mimeType,
    language: document.getElementById('default-lang')?.value || "en"
  }, async (response) => {
    console.log("[Popup][Voice] Transcription response:", response);

    if (response.ok && response.transcript) {
      console.log("[POPUP] Response transcript", response.transcript);
      displayLiveTranscript(response.transcript); // Display transcript in UI
    } else {
      window.createMessageElement(`❌ Transcription failed: ${response.error}`, "assistant");
    }
  });
}

// Displays live transcription within the designated transcription area
function displayLiveTranscript(transcript) {
  const outputArea = document.getElementById('transcription-output');

  if (!outputArea) {
    console.error('[Popup] Transcription output area not found');
    return;
  }

  // Check if there's an active session container
  let activeSession = outputArea.querySelector('.active-session');

  if (!activeSession) {
    // Create new session container
    const timestamp = new Date().toLocaleTimeString();
    activeSession = document.createElement('div');
    activeSession.className = 'active-session';
    activeSession.style.cssText = `
      margin-bottom: 12px;
      padding: 12px;
      background: linear-gradient(135deg, #d4d5dbff 0%, #eeecf1ff 100%);
      border-radius: 8px;
      box-shadow: 0 2px 8px rgba(0,0,0,0.15);
      color: white;
    `;

    const sessionHeader = document.createElement('div');
    sessionHeader.style.cssText = `
      font-size: 11px;
      color:black;
      opacity: 0.9;
      margin-bottom: 8px;
      font-weight: 600;
    `;
    sessionHeader.textContent = `🔴 Live Session - Started at ${timestamp}`;

    const transcriptText = document.createElement('div');
    transcriptText.className = 'transcript-text';
    transcriptText.style.cssText = `
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
      font-size: 14px;
      line-height: 1.6;
      white-space: pre-wrap;
    `;

    activeSession.appendChild(sessionHeader);
    activeSession.appendChild(transcriptText);
    outputArea.appendChild(activeSession);
  }

  // Append new transcript to existing session
  const transcriptText = activeSession.querySelector('.transcript-text');
  if (transcriptText) {
    const currentText = transcriptText.textContent;
    transcriptText.textContent = currentText + (currentText ? ' ' : '') + transcript;
  }

  // Auto-scroll to bottom
  outputArea.scrollTop = outputArea.scrollHeight;
}


async function updateRecordingState() {
  try {
    const response = await chrome.runtime.sendMessage({
      type: 'GET_RECORDING_STATE'
    });

    if (response.isRecording) {
      updateButtonState(true);
    }
  } catch (error) {
    console.log('[Popup][Voice] Could not get recording state:', error);
  }
}

// Your existing handleAudioRecordingComplete function remains the same
async function handleAudioRecordingComplete(audioBase64, mimeType) {
  console.log("[Popup][Voice] 🎙️ Processing recorded audio");

  chrome.runtime.sendMessage({
    type: "TRANSCRIBE_AUDIO",
    audioBase64: audioBase64,
    mimeType: mimeType,
    language: document.getElementById('default-lang')?.value || "en"
  }, async (response) => {
    console.log("[Popup][Voice] Transcription response:", response);

    if (response.ok && response.transcript) {
      window.createMessageElement(response.transcript, "user");
      await processVoiceQuery(response.transcript);
    } else {
      window.createMessageElement(`❌ Transcription failed: ${response.error}`, "assistant");
    }
  });
}
// async function handleAudioRecordingCompleteLive(audioBase64, mimeType) {
//   console.log("[Popup][LiveVoice] 🎙️ Processing recorded audio");

//   chrome.runtime.sendMessage({
//     type: "TRANSCRIBE_AUDIO",
//     audioBase64: audioBase64,
//     mimeType: mimeType,
//     language: document.getElementById('default-lang')?.value || "en"
//   }, async (response) => {
//     console.log("[Popup][Voice] Transcription response:", response);

//     if (response.ok && response.transcript) {
//       console.log("[POPUP] Response transcript", response.transcript);
//     } else {
//       window.createMessageElement(`❌ Transcription failed: ${response.error}`, "assistant");
//     }
//   });
// }

async function processVoiceQuery(transcript) {
  // Status message while processing
  const thinkingMsg = window.createMessageElement("🔍 Scraping current page...", "assistant");
  const ragManager = new EnhancedRAGManager();
  try {
    // Get current tab
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id) throw new Error("No active tab found.");

    // Ask content.js to scrape
    const scrapedRes = await chrome.tabs.sendMessage(tab.id, { type: "SCRAPE_PAGE" });
    console.log("[Popup][Voice] 📄 Scrape response:", scrapedRes);

    if (!scrapedRes?.ok) {
      thinkingMsg.querySelector(".message-text").textContent = "❌ Failed to scrape page.";
      return;
    }

    // Send transcript as query to LLM
    const scrapedData = scrapedRes.data;
    const structuredText = jsonToStructuredText(scrapedData);
    thinkingMsg.querySelector('.message-text').textContent = '📚 Thinking...';
    const processingResult = await ragManager.processPageContent(
      structuredText,
      tab.url,
      { title: scrapedData.title }
    );
    const relevantChunks = await ragManager.retrieveRelevantChunks(transcript, tab.url, 4);
    let context;
    if (relevantChunks.length === 0) {
      console.log('No relevant chunks, using fallback');
      const allChunks = await ragManager.vectorStore.getChunks(tab.url);
      context = allChunks.slice(0, 3).map(c => c?.text).filter(Boolean).join('\n\n');
    } else {
      context = relevantChunks
        .map((item, index) => `[Section ${index + 1}]\n${item.text}`)
        .join('\n\n---\n\n');
    }
    const res = await chrome.runtime.sendMessage({
      type: 'ASK_QUERY_WITH_CONTEXT',
      query: transcript,
      context: context,
      metadata: {
        totalChunks: processingResult.totalChunks,
        relevantChunks: relevantChunks.length,
        source: tab.url,
        title: scrapedData.title || 'Current Page'
      }
    });

    console.log("[Popup][Voice] 🤖 LLM response:", res);
    handleAIResponse(thinkingMsg, res);

  } catch (err) {
    console.error("[Popup][Voice] ❌ Error while sending query:", err);
    window.createMessageElement(`⚠️ Error: ${err.message}`, "assistant");
  }
}

// Text-to-Speech with Deepgram
async function speakTextWithDeepgram(text) {
  try {
    if (!text || text.trim() === "") return;

    const langCode = await detectLanguageAI(text);
    console.log(`[TTS] 🧠 Language detected: ${langCode}`);

    // Allowed languages: English and Spanish only
    const allowedLangs = ["en-US", "es-ES"];
    if (!allowedLangs.includes(langCode)) {
      alert(`🔔 Text-to-Speech is currently supported only for English and Spanish. We are working to support your language soon!`);
      return;
    }

    // Prepare TTS payload
    const payload = { text };
    let model_name = "aura-asteria-en";

    if (langCode === "es-ES") {
      model_name = "aura-2-sirio-es";
    }

    console.log(`[TTS] 🎯 Using model: ${model_name}`);
    console.log(`[TTS] 🗣 Text for TTS: ${text}`);

    const response = await fetch(`https://api.deepgram.com/v1/speak?model=${model_name}`, {
      method: "POST",
      headers: {
        "Authorization": `Token ef2c8061467bd30d586456e55bfb751027e553fb`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error("[TTS] ❌ Deepgram error:", errorText);
      return;
    }

    const audioBlob = await response.blob();
    const audioUrl = URL.createObjectURL(audioBlob);
    const audioEl = document.getElementById("voice-audio");

    if (audioEl) {
      audioEl.src = audioUrl;
      audioEl.style.display = "block";
      await audioEl.play();
      console.log("[TTS] ✅ Played voice successfully!");
    } else {
      console.error("[TTS] ❌ Audio element not found");
    }
  } catch (err) {
    console.error("[TTS] ⚠️ Error:", err);
  }
}

// Language Detection
let languageDetector = null;

async function initLanguageDetector() {
  // More robust API detection
  if (!self.LanguageDetector || typeof LanguageDetector.create !== 'function') {
    console.warn("[LangDetect] ❌ Language Detector API not supported in this browser.");
    return createFallbackDetector();
  }

  try {
    // Check if the API is actually usable (not blocked by policies)
    const availability = await LanguageDetector.availability();
    console.log("[LangDetect] Model availability:", availability);

    if (availability === 'downloadable') {
      console.log("[LangDetect] ⏬ Downloading model...");
    }

    const languageDetector = await LanguageDetector.create({
      monitor(m) {
        m.addEventListener('downloadprogress', (e) => {
          console.log(`[LangDetect] Downloaded ${(e.loaded * 100).toFixed(1)}%`);
        });
      },
    });

    console.log("[LangDetect] ✅ Detector ready");
    return languageDetector;
  } catch (error) {
    console.error("[LangDetect] Failed to initialize detector:", error);
    return createFallbackDetector();
  }
}

function createFallbackDetector() {
  console.log("[LangDetect] Using fallback language detector");

  return {
    async detect(text) {
      // Simple language detection based on character patterns
      if (!text || text.trim().length === 0) {
        return [{ language: 'en', confidence: 1.0 }];
      }

      const cleanText = text.trim().toLowerCase();

      // Common language patterns
      const patterns = {
        'en': /^[a-z\s.,!?;:'"-]+$/, // Basic Latin
        'es': /[áéíóúñ]/,
        'fr': /[àâæçéèêëîïôœùûüÿ]/,
        'de': /[äöüß]/,
        'it': /[àèéìíîòóùú]/,
        'pt': /[áâãàçéêíóôõú]/,
        'ru': /[а-яё]/,
        'zh': /[\u4e00-\u9fff]/, // Chinese characters
        'ja': /[\u3040-\u309f\u30a0-\u30ff]/, // Hiragana/Katakana
        'ko': /[\uac00-\ud7af]/, // Hangul
        'ar': /[\u0600-\u06ff]/, // Arabic
      };

      const scores = [];

      for (const [lang, pattern] of Object.entries(patterns)) {
        const matches = (cleanText.match(pattern) || []).length;
        const confidence = matches / Math.max(cleanText.length, 1);

        if (confidence > 0.1) { // Only consider if we have some confidence
          scores.push({
            language: lang,
            confidence: Math.min(confidence, 0.95)
          });
        }
      }

      // Sort by confidence and return top results
      scores.sort((a, b) => b.confidence - a.confidence);

      // If no clear match, default to English
      if (scores.length === 0 || scores[0].confidence < 0.3) {
        return [{ language: 'en', confidence: 0.5 }];
      }

      return scores.slice(0, 3); // Return top 3 guesses
    },

    // Add other methods that might be expected
    async getLanguages() {
      return ['en', 'es', 'fr', 'de', 'it', 'pt', 'ru', 'zh', 'ja', 'ko', 'ar'];
    },

    dispose() {
      // Cleanup if needed
    }
  };
}

async function detectLanguageAI(text) {
  if (!languageDetector) {
    console.warn("[LangDetect] ⚠️ Detector not ready — initializing...");
    await initLanguageDetector();
  }

  if (!text || text.trim().length < 3) {
    console.warn("[LangDetect] ⚠️ Text too short for detection.");
    return "en-US";
  }

  try {
    const results = await languageDetector.detect(text);
    const top = results[0];
    console.log("[LangDetect] 🔠 Detected:", top.detectedLanguage, "confidence:", top.confidence);

    const langMap = {
      en: "en-US",
      hi: "hi-IN",
      ta: "ta-IN",
      te: "te-IN",
      fr: "fr-FR",
      de: "de-DE",
      es: "es-ES",
      zh: "zh-CN",
      ja: "ja-JP",
    };

    const locale = langMap[top.detectedLanguage] || "en-US";
    console.log("[LangDetect] 🌍 Mapped locale:", locale);
    return locale;
  } catch (err) {
    console.error("[LangDetect] ❌ Detection failed:", err);
    return "en-US";
  }
}

// Draggable popup functionality
function dragElement(elmnt) {
  let pos1 = 0, pos2 = 0, pos3 = 0, pos4 = 0;

  const header = document.getElementById("milo-mate-header");
  if (header) {
    header.onmousedown = dragMouseDown;
  } else {
    elmnt.onmousedown = dragMouseDown;
  }

  function dragMouseDown(e) {
    e = e || window.event;
    e.preventDefault();
    pos3 = e.clientX;
    pos4 = e.clientY;
    document.onmouseup = closeDragElement;
    document.onmousemove = elementDrag;
  }

  function elementDrag(e) {
    e = e || window.event;
    e.preventDefault();
    pos1 = pos3 - e.clientX;
    pos2 = pos4 - e.clientY;
    pos3 = e.clientX;
    pos4 = e.clientY;
    elmnt.style.top = (elmnt.offsetTop - pos2) + "px";
    elmnt.style.left = (elmnt.offsetLeft - pos1) + "px";
  }

  function closeDragElement() {
    document.onmouseup = null;
    document.onmousemove = null;
  }
}

// =====================
// RAG SYSTEM CLASSES
// =====================

// FAISS-like in-memory vector store with embeddings
class FAISSVectorStore {
  constructor(dimension = 384) {
    this.dbName = 'MiloMateVectorDB';
    this.storeName = 'vectorChunks';
    this.dimension = dimension;
    this.db = null;
    this.vectorIndex = null;
    this.embeddingsCache = new Map();
  }

  async init() {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(this.dbName, 3);

      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        this.db = request.result;
        this.initializeVectorIndex();
        resolve(this.db);
      };

      request.onupgradeneeded = (event) => {
        const db = event.target.result;
        if (!db.objectStoreNames.contains(this.storeName)) {
          const store = db.createObjectStore(this.storeName, { keyPath: 'id' });
          store.createIndex('url', 'url', { unique: false });
          store.createIndex('timestamp', 'timestamp', { unique: false });
        }
      };
    });
  }

  initializeVectorIndex() {
    this.vectorIndex = {
      vectors: [],
      ids: [],
      url: []
    };
  }

  static l2Distance(a, b) {
    let sum = 0;
    for (let i = 0; i < a.length; i++) {
      sum += (a[i] - b[i]) ** 2;
    }
    return Math.sqrt(sum);
  }

  static cosineSimilarity(a, b) {
    let dotProduct = 0;
    let normA = 0;
    let normB = 0;

    for (let i = 0; i < a.length; i++) {
      dotProduct += a[i] * b[i];
      normA += a[i] ** 2;
      normB += b[i] ** 2;
    }

    if (normA === 0 || normB === 0) return 0;
    return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
  }

  async storeChunksWithEmbeddings(url, chunksWithEmbeddings) {
    if (!this.db) await this.init();

    const transaction = this.db.transaction([this.storeName], 'readwrite');
    const store = transaction.objectStore(this.storeName);

    return new Promise((resolve, reject) => {
      const clearRequest = store.index('url').openCursor(IDBKeyRange.only(url));

      clearRequest.onsuccess = () => {
        const cursor = clearRequest.result;
        if (cursor) {
          const index = this.vectorIndex.ids.indexOf(cursor.primaryKey);
          if (index > -1) {
            this.vectorIndex.vectors.splice(index, 1);
            this.vectorIndex.ids.splice(index, 1);
            this.vectorIndex.url.splice(index, 1);
          }
          store.delete(cursor.primaryKey);
          cursor.continue();
        } else {
          const timestamp = Date.now();
          const operations = chunksWithEmbeddings.map((chunk, index) => {
            const id = `${url}_${timestamp}_${index}`;

            this.vectorIndex.vectors.push(chunk.embedding);
            this.vectorIndex.ids.push(id);
            this.vectorIndex.url.push(url);

            return {
              id,
              url,
              text: chunk.text,
              embedding: chunk.embedding,
              tokens: chunk.tokens || [],
              metadata: chunk.metadata,
              timestamp
            };
          });

          operations.forEach(op => {
            try {
              store.add(op);
            } catch (error) {
              console.error('Error storing chunk:', error);
            }
          });

          transaction.oncomplete = () => {
            console.log(`📊 Vector index now has ${this.vectorIndex.vectors.length} vectors`);
            resolve(operations.length);
          };
          transaction.onerror = () => reject(transaction.error);
        }
      };
      clearRequest.onerror = () => reject(clearRequest.error);
    });
  }

  async searchSimilarVectors(queryEmbedding, url = null, topK = 5) {
    if (!this.db) await this.init();
    if (this.vectorIndex.vectors.length === 0) return [];

    const results = [];

    for (let i = 0; i < this.vectorIndex.vectors.length; i++) {
      if (url && this.vectorIndex.url[i] !== url) continue;

      const similarity = FAISSVectorStore.cosineSimilarity(
        queryEmbedding,
        this.vectorIndex.vectors[i]
      );

      results.push({
        id: this.vectorIndex.ids[i],
        similarity,
        index: i
      });
    }

    results.sort((a, b) => b.similarity - a.similarity);

    const topResults = results.slice(0, topK);
    const fullChunks = await this.getChunksByIds(topResults.map(r => r.id));

    return topResults.map((result, i) => ({
      ...fullChunks[i],
      similarity: result.similarity
    })).filter(chunk => chunk !== undefined);
  }

  async getChunksByIds(ids) {
    if (!this.db) await this.init();

    const transaction = this.db.transaction([this.storeName], 'readonly');
    const store = transaction.objectStore(this.storeName);

    const chunks = await Promise.all(
      ids.map(id =>
        new Promise((resolve) => {
          const request = store.get(id);
          request.onsuccess = () => resolve(request.result);
          request.onerror = () => resolve(undefined);
        })
      )
    );

    return chunks.filter(chunk => chunk !== undefined);
  }

  async getChunks(url) {
    if (!this.db) await this.init();

    const transaction = this.db.transaction([this.storeName], 'readonly');
    const store = transaction.objectStore(this.storeName);
    const request = store.index('url').getAll(IDBKeyRange.only(url));

    return new Promise((resolve, reject) => {
      request.onsuccess = () => resolve(request.result || []);
      request.onerror = () => reject(request.error);
    });
  }
}

// Enhanced Text Processor with Embedding Support
class EmbeddingTextProcessor {
  static chunkText(text, chunkSize = 100, overlap = 20) {
    if (!text) return [];

    const paragraphs = text.split(/\n\s*\n/).filter(p => p.trim().length > 0);
    const chunks = [];

    for (const paragraph of paragraphs) {
      const words = paragraph.split(/\s+/);

      if (words.length <= chunkSize) {
        chunks.push(paragraph.trim());
      } else {
        const sentences = paragraph.split(/(?<=[.!?])\s+/);
        let currentChunk = '';
        let currentWordCount = 0;

        for (const sentence of sentences) {
          const sentenceWordCount = sentence.split(/\s+/).length;

          if (currentWordCount + sentenceWordCount <= chunkSize) {
            currentChunk += (currentChunk ? ' ' : '') + sentence;
            currentWordCount += sentenceWordCount;
          } else {
            if (currentChunk) {
              chunks.push(currentChunk.trim());
              const chunkSentences = currentChunk.split(/(?<=[.!?])\s+/);
              const overlapSentences = chunkSentences.slice(-2);
              currentChunk = overlapSentences.join(' ') + ' ' + sentence;
              currentWordCount = overlapSentences.reduce((sum, sent) =>
                sum + sent.split(/\s+/).length, 0) + sentenceWordCount;
            } else {
              currentChunk = sentence;
              currentWordCount = sentenceWordCount;
            }
          }
        }
        if (currentChunk.trim()) {
          chunks.push(currentChunk.trim());
        }
      }
    }

    return chunks.filter(chunk => {
      const wordCount = chunk.split(/\s+/).length;
      return wordCount >= 10 && wordCount <= chunkSize * 1.5;
    });
  }

  static getTextTokens(text) {
    if (!text) return [];
    return text.toLowerCase()
      .replace(/[^\w\s]/g, ' ')
      .split(/\s+/)
      .filter(word => word.length > 2 && !EmbeddingTextProcessor.stopWords.has(word));
  }

  static async generateEmbedding(text) {
    if (!text) return new Array(384).fill(0);

    const cacheKey = text.toLowerCase().trim();
    if (!EmbeddingTextProcessor.embeddingCache) {
      EmbeddingTextProcessor.embeddingCache = new Map();
    }
    if (EmbeddingTextProcessor.embeddingCache.has(cacheKey)) {
      return EmbeddingTextProcessor.embeddingCache.get(cacheKey);
    }

    const words = text.toLowerCase()
      .replace(/[^\w\s]/g, ' ')
      .split(/\s+/)
      .filter(word => word.length > 2 && !EmbeddingTextProcessor.stopWords.has(word));

    const embedding = new Array(384).fill(0);
    let wordCount = 0;

    for (const word of words) {
      const hash = EmbeddingTextProcessor.simpleHash(word) % 384;
      embedding[hash] += 1;
      wordCount++;
    }

    if (wordCount > 0) {
      const norm = Math.sqrt(embedding.reduce((sum, val) => sum + val * val, 0));
      if (norm > 0) {
        for (let i = 0; i < embedding.length; i++) {
          embedding[i] = embedding[i] / norm;
        }
      }
    }

    EmbeddingTextProcessor.embeddingCache.set(cacheKey, embedding);
    return embedding;
  }

  static simpleHash(str) {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash;
    }
    return Math.abs(hash);
  }

  static stopWords = new Set([
    'the', 'a', 'an', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for', 'of', 'with', 'by',
    'is', 'are', 'was', 'were', 'be', 'been', 'being', 'have', 'has', 'had', 'do', 'does', 'did',
    'this', 'that', 'these', 'those', 'i', 'you', 'he', 'she', 'it', 'we', 'they',
    'my', 'your', 'his', 'her', 'its', 'our', 'their', 'what', 'which', 'who', 'whom',
    'such', 'as', 'from', 'when', 'where', 'how', 'why', 'all', 'any', 'both', 'each',
    'few', 'more', 'most', 'other', 'some', 'than', 'too', 'very', 'can', 'will', 'just'
  ]);
}

// Enhanced RAG Manager with Embedding Support
class EnhancedRAGManager {
  constructor() {
    this.vectorStore = new FAISSVectorStore();
  }

  async processPageContent(structuredText, url, metadata = {}) {
    console.log('🚀 Processing page content with embeddings...');

    const textChunks = EmbeddingTextProcessor.chunkText(structuredText, 400, 50);
    console.log(`📦 Created ${textChunks.length} semantic chunks`);

    console.log('🔮 Generating embeddings...');
    const chunksWithEmbeddings = [];

    for (let i = 0; i < textChunks.length; i++) {
      try {
        const embedding = await EmbeddingTextProcessor.generateEmbedding(textChunks[i]);

        chunksWithEmbeddings.push({
          text: textChunks[i],
          embedding,
          tokens: EmbeddingTextProcessor.getTextTokens(textChunks[i]),
          metadata: {
            chunkIndex: i,
            totalChunks: textChunks.length,
            chunkLength: textChunks[i].length,
            url,
            ...metadata
          }
        });

        if (i % 10 === 0) {
          console.log(`📊 Generated embeddings for ${i}/${textChunks.length} chunks`);
        }
      } catch (error) {
        console.error(`Error generating embedding for chunk ${i}:`, error);
      }
    }

    const storedCount = await this.vectorStore.storeChunksWithEmbeddings(url, chunksWithEmbeddings);
    console.log(`💾 Stored ${storedCount} vector chunks for ${url}`);

    return {
      totalChunks: textChunks.length,
      url,
      averageChunkLength: textChunks.reduce((sum, chunk) => sum + chunk.length, 0) / textChunks.length
    };
  }

  async retrieveRelevantChunks(query, url = null, topK = 5, similarityThreshold = 0.01) {
    console.log(`🎯 Performing vector similarity search for: "${query}"`);

    const queryEmbedding = await EmbeddingTextProcessor.generateEmbedding(query);
    console.log('🔍 Query embedding generated');

    const similarChunks = await this.vectorStore.searchSimilarVectors(queryEmbedding, url, topK * 2);

    const relevantChunks = similarChunks
      .filter(chunk => chunk && chunk.similarity >= similarityThreshold)
      .slice(0, topK);

    console.log(`✅ Found ${relevantChunks.length} semantically relevant chunks`);

    if (relevantChunks.length > 0) {
      console.log(`📊 Top similarity score: ${relevantChunks[0].similarity.toFixed(3)}`);
    }

    return relevantChunks;
  }

  async searchAcrossAllPages(query, topK = 5) {
    return this.retrieveRelevantChunks(query, null, topK, 0.6);
  }

  async getVectorStoreStats() {
    const allChunks = await this.vectorStore.getChunks();
    return {
      totalChunks: allChunks.length,
      totalURLs: new Set(allChunks.map(chunk => chunk?.url).filter(Boolean)).size,
      averageEmbeddingDimension: allChunks[0]?.embedding?.length || 0
    };
  }
}

// Content processing functions
function jsonToStructuredText(data) {
  if (!data) return "No data available";

  const sections = [];

  if (data.title) {
    sections.push(`# ${data.title}`);
  }

  const structuredContent = autoStructureContent(data);
  sections.push(...structuredContent);

  sections.push(createMetadataSummary(data));

  return sections.join('\n\n');
}

function autoStructureContent(data) {
  const sections = [];

  const contentAnalysis = analyzeContentStructure(data);

  if (contentAnalysis.mainContent.length > 0) {
    sections.push('## Main Content');
    sections.push(...contentAnalysis.mainContent);
  }

  if (contentAnalysis.keyTopics.length > 0) {
    sections.push('## Key Topics');
    sections.push(contentAnalysis.keyTopics.map(topic => `- ${topic}`).join('\n'));
  }

  if (contentAnalysis.detailedSections.length > 0) {
    sections.push('## Detailed Information');
    contentAnalysis.detailedSections.forEach((section, index) => {
      if (index < 5) {
        sections.push(`### ${section.heading || `Section ${index + 1}`}`);
        sections.push(section.content);
      }
    });
  }

  if (contentAnalysis.importantLinks.length > 0) {
    sections.push('## Related Resources');
    sections.push(contentAnalysis.importantLinks.map(link =>
      `- [${link.text}](${link.href})`
    ).join('\n'));
  }

  return sections;
}

function analyzeContentStructure(data) {
  const analysis = {
    mainContent: [],
    keyTopics: [],
    detailedSections: [],
    importantLinks: []
  };

  if (data.headings && data.headings.length > 0) {
    const headingGroups = groupHeadingsByImportance(data.headings);
    analysis.keyTopics = headingGroups.mainTopics;
  }

  if (data.paras && data.paras.length > 0) {
    const scoredParagraphs = data.paras.map((para, index) => ({
      text: para,
      length: para.length
    }));

    analysis.mainContent = scoredParagraphs
      .map(p => p.text);
  }

  if (data.headings && data.paras) {
    analysis.detailedSections = createHeadingContentPairs(data.headings, data.paras);
  }

  if (data.links && data.links.length > 0) {
    analysis.importantLinks = data.links
      .filter(link => !isNavigationLink(link.text));
  }

  return analysis;
}

function groupHeadingsByImportance(headings) {
  const mainTopics = [];
  const subTopics = [];

  headings.forEach(heading => {
    const text = typeof heading === 'string' ? heading : (heading.text || heading);
    if (!text) return;

    const words = text.split(/\s+/).length;
    const hasImportantKeywords = /^(what|how|why|when|where|guide|tutorial|introduction|about)/i.test(text);

    if (words <= 8 && hasImportantKeywords) {
      mainTopics.push(text);
    } else if (words <= 12) {
      subTopics.push(text);
    }
  });

  return { mainTopics, subTopics };
}

function calculateParagraphScore(paragraph, index, totalParagraphs) {
  let score = 0;

  const lengthScore = Math.min(paragraph.length / 500, 1);
  score += lengthScore * 0.4;

  const positionScore = 1 - (index / totalParagraphs);
  score += positionScore * 0.3;

  const hasQuestions = /\?/.test(paragraph);
  const hasKeywords = /(important|key|main|primary|essential|crucial)/i.test(paragraph);
  const sentenceCount = (paragraph.match(/[.!?]+/g) || []).length;
  const sentenceComplexity = Math.min(sentenceCount / 5, 1);

  score += (hasQuestions ? 0.1 : 0);
  score += (hasKeywords ? 0.1 : 0);
  score += sentenceComplexity * 0.1;

  return Math.min(score, 1);
}

function createHeadingContentPairs(headings, paragraphs) {
  const sections = [];

  let currentHeading = null;
  let currentContent = [];

  const headingTexts = headings.map(h => typeof h === 'string' ? h : (h.text || ''));
  const paragraphTexts = paragraphs.map(p => typeof p === 'string' ? p : p);

  paragraphTexts.forEach((paragraph, index) => {
    if (paragraph.length < 100 && /^[A-Z][^.!?]*$/.test(paragraph)) {
      if (currentHeading && currentContent.length > 0) {
        sections.push({
          heading: currentHeading,
          content: currentContent.join(' ')
        });
      }
      currentHeading = paragraph;
      currentContent = [];
    } else if (currentHeading) {
      currentContent.push(paragraph);
    } else if (headingTexts.length > 0 && index < 3) {
      currentHeading = headingTexts[0];
      currentContent.push(paragraph);
    }
  });

  if (currentHeading && currentContent.length > 0) {
    sections.push({
      heading: currentHeading,
      content: currentContent.join(' ')
    });
  }

  return sections;
}

function isNavigationLink(linkText) {
  if (!linkText) return true;
  const navKeywords = [
    'home', 'about', 'contact', 'login', 'sign up', 'register', 'menu',
    'search', 'help', 'support', 'privacy', 'terms', 'cookie'
  ];
  const lowerText = linkText.toLowerCase();
  return navKeywords.some(keyword => lowerText.includes(keyword));
}

function createMetadataSummary(data) {
  const summary = [];

  summary.push('## Page Summary');

  if (data.enhanced?.meta?.description) {
    summary.push(`**Description:** ${data.enhanced.meta.description}`);
  }

  if (data.enhanced?.contentStats) {
    const stats = data.enhanced.contentStats;
    summary.push(`**Content Stats:** ${stats.totalParagraphs} paragraphs, ${stats.totalHeadings} headings`);
  }

  if (data.enhanced?.linkAnalysis) {
    const links = data.enhanced.linkAnalysis;
    summary.push(`**Links:** ${links.internal} internal, ${links.external} external`);
  }

  return summary.join('\n');
}

// Initialize embedding cache
EmbeddingTextProcessor.embeddingCache = new Map();



// //  Mom feature functions
// function stream_from_web(){
//   // Take live stream buffer from popup.html meetings tab and convert to format for transcription

// }
// function deepgram_transcription(){
//   // Do live transcription and  display on screen
// }
// //summarize button
// function summarize_mom(){

// }





function initializeImageUpload() {
  const imageUploadBtn = document.getElementById('image-upload-btn');
  const imageFileInput = document.getElementById('image-file-input');

  if (!imageUploadBtn || !imageFileInput) {
    console.error('Image upload elements not found');
    return;
  }

  imageUploadBtn.addEventListener('click', () => {
    imageFileInput.click();
  });

  imageFileInput.addEventListener('change', handleImageUpload);
}

async function handleImageUpload(event) {
  const file = event.target.files[0];
  if (!file) return;

  // Validate file type
  if (!file.type.startsWith('image/')) {
    alert('Please select an image file');
    return;
  }

  // Validate file size (max 5MB)
  if (file.size > 5 * 1024 * 1024) {
    alert('Image size should be less than 5MB');
    return;
  }

  console.log('[Popup] 📸 Image selected:', file.name, file.type, file.size);

  try {
    // Create preview message
    const previewMessage = createImagePreviewMessage(file);

    // Process the image with AI
    await processImageQuery(file);

  } catch (error) {
    console.error('[Popup] ❌ Image upload failed:', error);
    window.createMessageElement('❌ Failed to process image. Please try again.', 'assistant');
  } finally {
    // Reset file input
    event.target.value = '';
  }
}

function createImagePreviewMessage(file) {
  const messageElement = document.createElement('div');
  messageElement.classList.add('message', 'user');

  const messageBubble = document.createElement('div');
  messageBubble.classList.add('message-bubble');

  const imageElement = document.createElement('img');
  imageElement.classList.add('message-image');
  imageElement.src = URL.createObjectURL(file);
  imageElement.alt = 'Uploaded image';

  const textElement = document.createElement('div');
  textElement.classList.add('message-text');
  textElement.textContent = 'Analyzing this image...';

  const timeElement = document.createElement('div');
  timeElement.classList.add('message-time');
  timeElement.textContent = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

  messageBubble.appendChild(imageElement);
  messageBubble.appendChild(textElement);
  messageBubble.appendChild(timeElement);
  messageElement.appendChild(messageBubble);

  const chatMessages = document.getElementById('chat-messages');
  chatMessages.appendChild(messageElement);
  chatMessages.scrollTop = chatMessages.scrollHeight;

  return { messageElement, textElement };
}

async function processImageQuery(imageFile) {
  const thinkingMsg = window.createMessageElement('🔍 Analyzing image with page context...', 'assistant');

  try {
    // Check if Prompt API supports images
    if (typeof LanguageModel === 'undefined') {
      throw new Error('AI features not available in this browser');
    }

    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id) throw new Error('No active tab found.');

    let pageContext = 'No page context available';
    let pageTitle = tab.title || 'Current Page';

    try {
      const scrapedRes = await chrome.tabs.sendMessage(tab.id, { type: 'SCRAPE_PAGE' });
      console.log("[POPUP] Scraped data in image function", scrapedRes);
      if (scrapedRes?.ok && scrapedRes.data) {
        const scrapedData = scrapedRes.data; // DEFINE scrapedData here
        pageTitle = scrapedData.title || pageTitle;
        const structuredText = jsonToStructuredText(scrapedData);
        const ragManager = new EnhancedRAGManager();
        await ragManager.processPageContent(structuredText, tab.url, { title: pageTitle });
        const relevantChunks = await ragManager.retrieveRelevantChunks('image content description', tab.url, 2);
        if (relevantChunks.length > 0) {
          pageContext = relevantChunks.map(chunk => chunk.text).join('\n\n');
        }
      }
    } catch (scrapeError) {
      console.warn('[Popup] Could not get page context:', scrapeError);
    }

    const imageBase64 = await fileToBase64(imageFile);

    console.log('[POPUP] Sending image query to background...');
    console.log('ASK_IMAGE_QUERY');
    const res = await chrome.runtime.sendMessage({
      type: 'ASK_IMAGE_QUERY',  // Make sure this matches exactly
      imageBase64: imageBase64,
      imageType: imageFile.type,
      pageContext: pageContext,
      pageTitle: pageTitle,
      pageUrl: tab.url
    });

    console.log('[POPUP] Response from background:', res);

    if (res?.ok) {
      const messageText = thinkingMsg.querySelector('.message-text');
      const answer = res.answer;

      // Check if answer contains markdown
      if (answer.includes('**') || answer.includes('*') || answer.includes('#')) {
        messageText.innerHTML = DOMPurify.sanitize(marked.parse(answer));
      } else {
        messageText.textContent = answer;
      }

      window.latestAIResponse = answer;
      const cleanAnswer = removeMarkdown(answer);
      speakTextWithDeepgram(cleanAnswer);

    } else {
      throw new Error(res?.error || 'Image analysis failed');
    }

  } catch (err) {
    console.error('[Popup] ❌ Image processing error:', err);
    thinkingMsg.querySelector('.message-text').textContent =
      `⚠️ ${err.message}. Please ensure you're using Chrome with Gemini Nano support for images.`;
  }
}

function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.readAsDataURL(file);
    reader.onload = () => {
      // Remove the data:image/...;base64, prefix
      const base64 = reader.result.split(',')[1];
      resolve(base64);
    };
    reader.onerror = error => reject(error);
  });
}

// Test function to verify background communication
async function testBackgroundCommunication() {
  console.log('[Popup] 🧪 Testing background communication...');

  try {
    const testResponse = await chrome.runtime.sendMessage({
      type: 'TEST_COMMUNICATION',
      test: 'hello'
    });
    console.log('[Popup] Background test response:', testResponse);
  } catch (error) {
    console.error('[Popup] Background test failed:', error);
  }
}

// Call this in your DOMContentLoaded to test
// testBackgroundCommunication();


// Initialize summarization tab
function initializeSummarization() {
  const summarizeBtn = document.getElementById('summarize-btn');
  const clearBtn = document.getElementById('clear-summary-btn');
  const summaryInput = document.getElementById('summary-input');
  const summaryResult = document.getElementById('summary-result');
  const summarizeStatus = document.getElementById('summarize-status');

  if (!summarizeBtn) {
    console.log('[Popup] Summarize elements not found');
    return;
  }

  console.log('[Popup] Initializing summarization tab...');

  summarizeBtn.addEventListener('click', handleSummarize);
  clearBtn.addEventListener('click', handleClearSummary);

  // Test summarizer availability on tab focus
  document.querySelector('.tab[data-tab="summarize"]')?.addEventListener('click', testSummarizerAvailability);
}

async function testSummarizerAvailability() {
  console.log('[Popup] Testing summarizer availability...');

  try {
    const response = await chrome.runtime.sendMessage({
      type: 'TEST_COMMUNICATION',
      test: 'summarizer-check'
    });

    if (response?.ok) {
      console.log('[Popup] Background communication OK');
      updateSummarizeStatus('Background service ready', 'success');
    }
  } catch (error) {
    console.error('[Popup] Background test failed:', error);
    updateSummarizeStatus('Background service unavailable', 'error');
  }
}

async function handleSummarize() {
  console.log('[Popup] Handle summarize clicked');

  const textInput = document.getElementById('summary-input');
  const summaryType = document.getElementById('summary-type');
  const summaryLength = document.getElementById('summary-length');
  const summaryFormat = document.getElementById('summary-format');
  const summaryContext = document.getElementById('summary-context');
  const summaryResult = document.getElementById('summary-result');

  const text = textInput.value.trim();

  if (!text) {
    alert('Please enter some text to summarize');
    return;
  }

  if (text.length < 50) {
    alert('Please enter at least 50 characters for meaningful summarization');
    return;
  }

  console.log(`[Popup] Summarizing text: ${text.length} chars`);
  updateSummarizeStatus('Starting summarization...', 'processing');

  const options = {
    type: summaryType.value,
    length: summaryLength.value,
    format: summaryFormat.value,
    sharedContext: summaryContext.value || undefined
  };

  console.log('[Popup] Summary options:', options);

  try {
    updateSummarizeStatus('Processing with Gemini Nano...', 'processing');
    summaryResult.innerHTML = '<em>Generating summary... This may take a moment.</em>';

    const response = await chrome.runtime.sendMessage({
      type: 'SUMMARIZE_TEXT',
      text: text,
      options: options,
      context: summaryContext.value || ''
    });

    console.log('[Popup] Summarization response:', response);

    if (response.ok) {
      const summary = response.summary;
      const metadata = response.metadata;

      console.log(`[Popup] Summary generated: ${summary.length} chars`);
      console.log(`[Popup] Compression: ${metadata.compressionRatio}% reduction`);

      // Display the summary
      if (options.format === 'markdown' && (summary.includes('**') || summary.includes('*') || summary.includes('#'))) {
        summaryResult.innerHTML = DOMPurify.sanitize(marked.parse(summary));
      } else {
        summaryResult.textContent = summary;
      }

      updateSummarizeStatus(
        `✅ Summary generated! Reduced by ${metadata.compressionRatio}% (${metadata.originalLength} → ${metadata.summaryLength} chars)`,
        'success'
      );

      // Store for voice playback
      window.latestSummary = summary;

    } else {
      throw new Error(response.error || 'Unknown error during summarization');
    }

  } catch (error) {
    console.error('[Popup] Summarization failed:', error);
    summaryResult.innerHTML = `<span style="color: red;">Error: ${error.message}</span>`;
    updateSummarizeStatus(`❌ Failed: ${error.message}`, 'error');
  }
}

function handleClearSummary() {
  console.log('[Popup] Clearing summary inputs');

  document.getElementById('summary-input').value = '';
  document.getElementById('summary-context').value = '';
  document.getElementById('summary-result').innerHTML = 'Your summary will appear here...';
  updateSummarizeStatus('Ready to summarize', 'ready');
}

function updateSummarizeStatus(message, type = 'ready') {
  const statusElement = document.getElementById('summarize-status');
  if (!statusElement) return;

  statusElement.textContent = message;

  // Update color based on type
  statusElement.style.color =
    type === 'success' ? 'green' :
      type === 'error' ? 'red' :
        type === 'processing' ? 'blue' : '#666';
}

// Add summarization-specific CSS (optional)
function addSummarizationStyles() {
  const styles = `
    .summarize-container {
      padding: 15px;
    }
    .summarize-controls {
      display: flex;
      gap: 15px;
      margin: 15px 0;
      flex-wrap: wrap;
    }
    .summarize-option {
      flex: 1;
      min-width: 120px;
    }
    .summarize-option label {
      display: block;
      margin-bottom: 5px;
      font-weight: bold;
      font-size: 12px;
    }
    .summarize-option select {
      width: 100%;
      padding: 8px;
      border: 1px solid #ddd;
      border-radius: 4px;
    }
    .summarize-input-section {
      margin: 15px 0;
    }
    .summarize-input-section label {
      display: block;
      margin-bottom: 5px;
      font-weight: bold;
    }
    .summarize-actions {
      margin: 20px 0;
      display: flex;
      gap: 10px;
    }
    .summarize-btn {
      padding: 10px 20px;
      border: none;
      border-radius: 6px;
      cursor: pointer;
      font-size: 14px;
    }
    .summarize-btn.primary {
      background: #4285f4;
      color: white;
    }
    .summarize-btn.secondary {
      background: #f1f3f4;
      color: #333;
    }
    .summarize-btn:disabled {
      opacity: 0.6;
      cursor: not-allowed;
    }
  `;

  const styleSheet = document.createElement('style');
  styleSheet.textContent = styles;
  document.head.appendChild(styleSheet);
}



// Enhanced logging for summarization
function logSummarizationStep(step, data = null) {
  const timestamp = new Date().toISOString();
  const logEntry = {
    timestamp,
    step,
    data,
    userAgent: navigator.userAgent,
    textLength: data?.text?.length || document.getElementById('summary-input')?.value.length || 0
  };

  console.log(`[Summarize][${step}]`, data || '');

  // Store in window for debugging
  if (!window.summarizeLogs) {
    window.summarizeLogs = [];
  }
  window.summarizeLogs.push(logEntry);

  // Keep only last 50 logs
  if (window.summarizeLogs.length > 50) {
    window.summarizeLogs.shift();
  }
}