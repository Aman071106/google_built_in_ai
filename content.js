function quickScrape() {
  try {
    // Clean text helper
    const cleanText = (text) => {
      return text
        .replace(/\s+/g, ' ')
        .replace(/[\r\n\t]/g, ' ')
        .trim();
    };

    // Remove duplicates
    const removeDuplicates = (array, key = null) => {
      const seen = new Set();
      return array.filter(item => {
        const value = key ? item[key] : item;
        if (seen.has(value)) return false;
        seen.add(value);
        return true;
      });
    };

    // Filter meaningful content
    const filterMeaningfulContent = (texts, minLength = 20) => {
      const boilerplateWords = [
        'cookie', 'privacy', 'terms', 'conditions', 'copyright',
        'all rights reserved', 'login', 'sign up', 'subscribe'
      ];
      
      return texts.filter(text => {
        if (text.length < minLength) return false;
        
        const lowerText = text.toLowerCase();
        return !boilerplateWords.some(word => lowerText.includes(word));
      });
    };

    // Extract meta data
    const extractMetaData = () => {
      const metas = Array.from(document.querySelectorAll('meta'));
      const metaData = {};
      
      metas.forEach(meta => {
        const name = meta.getAttribute('name') || meta.getAttribute('property');
        const content = meta.getAttribute('content');
        if (name && content) {
          metaData[name] = cleanText(content);
        }
      });
      
      return metaData;
    };

    // Extract images
    const extractImages = () => {
      return Array.from(document.querySelectorAll('img'))
        .filter(img => img.offsetParent !== null && img.src)
        .slice(0, 20)
        .map(img => ({
          src: img.src,
          alt: cleanText(img.alt || ''),
          title: cleanText(img.title || '')
        }));
    };

    const title = cleanText(document.title);
    
    // Enhanced headings with hierarchy
    const headings = Array.from(document.querySelectorAll("h1, h2, h3, h4, h5, h6"))
      .map(h => ({
        level: h.tagName.toLowerCase(),
        text: cleanText(h.innerText)
      }))
      .filter(h => h.text.length > 0);

    // Better paragraphs with filtering
    let paras = Array.from(document.querySelectorAll("p"))
      .map(p => cleanText(p.innerText))
      .filter(Boolean);
    
    paras = filterMeaningfulContent(paras);
    paras = removeDuplicates(paras).slice(0, 30);

    // Enhanced links with more context
    const links = Array.from(document.querySelectorAll("a"))
      .filter(a => a.offsetParent !== null && a.href && a.innerText.trim().length > 1)
      .slice(0, 150)
      .map(a => ({
        text: cleanText(a.innerText),
        href: a.href,
        isExternal: !a.href.startsWith(window.location.origin),
        isNavigation: a.closest('nav, header, footer') !== null
      }));
    
    const uniqueLinks = removeDuplicates(links, 'href').slice(0, 100);

    // Enhanced data structure
    const data = {
      // Basic info (maintaining your original structure)
      title,
      headings: headings.map(h => h.text), // Keep original format for compatibility
      paras,
      links: uniqueLinks.map(link => ({ text: link.text, href: link.href })), // Keep original format
      
      // New enhanced fields
      enhanced: {
        meta: extractMetaData(),
        images: extractImages(),
        headingHierarchy: headings,
        linkAnalysis: {
          total: uniqueLinks.length,
          internal: uniqueLinks.filter(link => !link.isExternal).length,
          external: uniqueLinks.filter(link => link.isExternal).length,
          navigation: uniqueLinks.filter(link => link.isNavigation).length
        },
        contentStats: {
          totalParagraphs: paras.length,
          totalHeadings: headings.length,
          meaningfulContent: paras.length > 5 && headings.length > 2
        }
      }
    };

    console.log("[Enhanced Scraper ✅] Collected structured page data:", {
      title: data.title,
      paragraphs: data.paras,
      headings: data.headings,
      links: data.links,
      images: data.enhanced.images,
      metaTags: Object.keys(data.enhanced.meta)
    });

    return data;

  } catch (err) {
    console.error("[Enhanced Scraper ❌ Error]:", err);
    
    // Fallback to basic scraping
    try {
      const title = document.title;
      const headings = Array.from(document.querySelectorAll("h1, h2, h3"))
        .map(h => h.innerText.trim())
        .filter(Boolean);

      const paras = Array.from(document.querySelectorAll("p"))
        .slice(0, 30)
        .map(p => p.innerText.trim())
        .filter(Boolean);

      const links = Array.from(document.querySelectorAll("a"))
        .filter(a => a.offsetParent !== null && a.href && a.innerText.trim().length > 2)
        .slice(0, 100)
        .map(a => ({
          text: a.innerText.trim(),
          href: a.href
        }));

      return { title, headings, paras, links };
    } catch (fallbackErr) {
      return {};
    }
  }
}
// Content script for microphone access
class ContentVoiceRecorder {
  constructor() {
    this.recorder = null;
    this.stream = null;
    this.chunks = [];
    this.isRecording = false;
  }

  async startRecording() {
    try {
      console.log('[Content][Voice] 🎙 Requesting microphone access...');
      
      // Check if we're in a secure context
      if (!window.isSecureContext) {
        throw new Error('Microphone requires secure context (HTTPS)');
      }

      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        throw new Error('Microphone API not available in this context');
      }

      this.stream = await navigator.mediaDevices.getUserMedia({ 
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          sampleRate: 16000
        }
      });
      
      this.recorder = new MediaRecorder(this.stream, {
        mimeType: 'audio/webm;codecs=opus'
      });

      this.chunks = [];

      this.recorder.ondataavailable = (e) => {
        if (e.data && e.data.size > 0) {
          this.chunks.push(e.data);
        }
      };

      this.recorder.onstop = async () => {
        console.log('[Content][Voice] 🔴 Recording stopped');
        
        const blob = new Blob(this.chunks, { type: 'audio/webm;codecs=opus' });
        
        // Convert to base64
        const arrayBuffer = await blob.arrayBuffer();
        const base64Audio = this.arrayBufferToBase64(arrayBuffer);
        
        // Send to background script
        chrome.runtime.sendMessage({
          type: "AUDIO_RECORDING_COMPLETE",
          audioBase64: base64Audio,
          mimeType: blob.type
        });

        this.cleanup();
      };

      this.recorder.start();
      this.isRecording = true;
      console.log('[Content][Voice] 🟢 Recording started');
      
      return { success: true };
      
    } catch (error) {
      console.error('[Content][Voice] ❌ Microphone error:', error);
      this.cleanup();
      return { success: false, error: error.message };
    }
  }

  stopRecording() {
    if (this.recorder && this.isRecording) {
      this.recorder.stop();
      this.isRecording = false;
    }
  }

  cleanup() {
    if (this.stream) {
      this.stream.getTracks().forEach(track => track.stop());
      this.stream = null;
    }
    this.recorder = null;
    this.chunks = [];
    this.isRecording = false;
  }

  arrayBufferToBase64(buffer) {
    const bytes = new Uint8Array(buffer);
    let binary = '';
    const chunkSize = 0x8000;
    
    for (let i = 0; i < bytes.length; i += chunkSize) {
      const chunk = bytes.subarray(i, i + chunkSize);
      binary += String.fromCharCode(...chunk);
    }
    
    return btoa(binary);
  }
}

// Initialize content voice recorder
const contentVoiceRecorder = new ContentVoiceRecorder();

// Listener to receive messages from popup.js and background.js
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  console.log('[Content] Received message:', msg.type);

  switch (msg.type) {
    case "SCRAPE_PAGE":
      try {
        const data = quickScrape();
        sendResponse({ ok: true, data });
      } catch (err) {
        console.error("[Scraper ❌ Failed to scrape]:", err);
        sendResponse({ ok: false, error: err.message });
      }
      return true; // Keep message channel open for async response

    case "START_RECORDING":
      contentVoiceRecorder.startRecording().then(sendResponse);
      return true; // Keep message channel open for async response

    case "STOP_RECORDING":
      contentVoiceRecorder.stopRecording();
      sendResponse({ success: true });
      return false; // No async response needed

    default:
      console.warn('[Content] Unknown message type:', msg.type);
      return false;
  }
});