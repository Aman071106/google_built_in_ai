// popup.js (Milo Mate AI Assistant)
document.addEventListener('DOMContentLoaded', () => {
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
  // Add this function to convert JSON to structured text
  function jsonToStructuredText(data) {
    if (!data) return "No data available";

    const lines = [];

    // Basic metadata
    if (data.title) {
      lines.push(`PAGE TITLE: ${data.title}`);
      lines.push('');
    }

    // Headings
    if (data.headings && data.headings.length > 0) {
      lines.push('HEADINGS:');
      data.headings.forEach((heading, index) => {
        lines.push(`  ${index + 1}. ${heading}`);
      });
      lines.push('');
    }

    // Paragraphs
    if (data.paras && data.paras.length > 0) {
      lines.push('CONTENT PARAGRAPHS:');
      data.paras.forEach((para, index) => {
        // Limit paragraph length for readability
        const truncatedPara = para.length > 200 ? para.substring(0, 200) + '...' : para;
        lines.push(`  ${index + 1}. ${truncatedPara}`);
      });
      lines.push('');
    }

    // Links
    if (data.links && data.links.length > 0) {
      lines.push('LINKS:');
      data.links.forEach((link, index) => {
        lines.push(`  ${index + 1}. ${link.text} -> ${link.href}`);
      });
      lines.push('');
    }

    // Enhanced data if available
    if (data.enhanced) {
      if (data.enhanced.meta && Object.keys(data.enhanced.meta).length > 0) {
        lines.push('META TAGS:');
        Object.entries(data.enhanced.meta).forEach(([key, value], index) => {
          lines.push(`  ${key}: ${value}`);
        });
        lines.push('');
      }

      if (data.enhanced.contentStats) {
        lines.push('CONTENT STATISTICS:');
        lines.push(`  - Paragraphs: ${data.enhanced.contentStats.totalParagraphs}`);
        lines.push(`  - Headings: ${data.enhanced.contentStats.totalHeadings}`);
        lines.push(`  - Meaningful Content: ${data.enhanced.contentStats.meaningfulContent ? 'Yes' : 'No'}`);
        lines.push('');
      }
    }

    return lines.join('\n');
  }
  const createMessageElement = (text, type) => {
    const messageElement = document.createElement('div');
    messageElement.classList.add('message', type);

    const messageBubble = document.createElement('div');
    messageBubble.classList.add('message-bubble');

    const textElement = document.createElement('div');
    textElement.classList.add('message-text');
    textElement.textContent = text;

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

  // Helper to send message to content script with fallback injection
  const sendToContentScript = async (tabId, message) => {
    try {
      // First try to send message directly
      return await chrome.tabs.sendMessage(tabId, message);
    } catch (err) {
      console.log('[Popup] Content script not ready, injecting manually...');

      // If content script isn't loaded, inject it manually
      try {
        await chrome.scripting.executeScript({
          target: { tabId: tabId },
          files: ['content.js']
        });
        console.log('[Popup] Content script injected successfully');

        // Wait a bit for the script to initialize
        await new Promise(resolve => setTimeout(resolve, 100));

        // Try sending message again
        return await chrome.tabs.sendMessage(tabId, message);
      } catch (injectError) {
        console.error('[Popup] Failed to inject content script:', injectError);
        throw new Error('Could not load content script on this page');
      }
    }
  };

  const handleSend = async () => {
    const query = chatInputField.value.trim();
    if (!query) return;

    createMessageElement(query, 'user');
    chatInputField.value = '';

    const statusMessage = createMessageElement('🔍 Scraping current page...', 'assistant');

    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (!tab?.id) throw new Error('No active tab found.');

      console.log('[Popup] Scraping tab:', tab.url);

      // Use the helper function to send message with injection fallback
      const scrapedRes = await sendToContentScript(tab.id, { type: 'SCRAPE_PAGE' });

      if (!scrapedRes?.ok) {
        statusMessage.querySelector('.message-text').textContent =
          '❌ Failed to scrape page content.';
        console.log('Scrape failed:', scrapedRes);
        return;
      }

      const scrapedData = scrapedRes.data;
      console.log('✅ Got page data:', scrapedData);

      // Convert JSON to structured text
      const structuredText = jsonToStructuredText(scrapedData);
      console.log('[BG] 📝 Structured text:', structuredText);

      // Ask query to background with structured text
      statusMessage.querySelector('.message-text').textContent = '🧠 Thinking...';

      const res = await chrome.runtime.sendMessage({
        type: 'ASK_QUERY',
        page: structuredText,  // Send structured text instead of raw JSON
        query: query
      });

      if (res?.ok) {
        statusMessage.querySelector('.message-text').textContent = res.answer;
        log('✅ Answer received:', res.answer);
      } else {
        statusMessage.querySelector('.message-text').textContent =
          `❌ AI Error: ${res?.error || 'Please check if Gemini Nano is available'}`;
        log('❌ Error from background:', res);
      }
    } catch (err) {
      statusMessage.querySelector('.message-text').textContent =
        `⚠️ Error: ${err.message}`;
      log('❌ Uncaught Error:', err);
    }
  };

  sendButton.addEventListener('click', handleSend);
  chatInputField.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      handleSend();
    }
  });
});