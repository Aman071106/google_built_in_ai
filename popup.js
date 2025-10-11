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

  // --- 2. Chat logic with Optimized RAG ---
  const chatInputField = document.getElementById('chat-input-field');
  const sendButton = document.getElementById('send-btn');
  const chatMessages = document.getElementById('chat-messages');

  const DEBUG = true;
  const log = (...args) => DEBUG && console.log('[Popup]', ...args);

  // Simple Vector Store with optimized storage
  class SimpleVectorStore {
    constructor() {
      this.dbName = 'MiloMateVectors';
      this.storeName = 'chunks';
      this.db = null;
    }

    async init() {
      return new Promise((resolve, reject) => {
        const request = indexedDB.open(this.dbName, 2);

        request.onerror = () => reject(request.error);
        request.onsuccess = () => {
          this.db = request.result;
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

    async storeChunks(url, chunks) {
      if (!this.db) await this.init();

      const transaction = this.db.transaction([this.storeName], 'readwrite');
      const store = transaction.objectStore(this.storeName);

      // Clear existing chunks for this URL
      const clearRequest = store.index('url').openCursor(IDBKeyRange.only(url));
      return new Promise((resolve, reject) => {
        clearRequest.onsuccess = () => {
          const cursor = clearRequest.result;
          if (cursor) {
            store.delete(cursor.primaryKey);
            cursor.continue();
          } else {
            // Store new chunks
            const timestamp = Date.now();
            const operations = chunks.map((chunk, index) => ({
              id: `${url}_${timestamp}_${index}`,
              url,
              text: chunk.text,
              tokens: chunk.tokens || [],
              metadata: chunk.metadata,
              timestamp
            }));

            operations.forEach(op => store.add(op));

            transaction.oncomplete = () => resolve(operations.length);
            transaction.onerror = () => reject(transaction.error);
          }
        };
      });
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

  // Optimized Text Processor
  class OptimizedTextProcessor {
    // Improved chunking with better boundaries
    static chunkText(text, chunkSize = 400, overlap = 50) {
      if (!text) return [];

      // Split into paragraphs first for better semantic boundaries
      const paragraphs = text.split(/\n\s*\n/).filter(p => p.trim().length > 0);
      const chunks = [];

      for (const paragraph of paragraphs) {
        if (paragraph.length <= chunkSize) {
          chunks.push(paragraph.trim());
        } else {
          // Split long paragraphs into sentences
          const sentences = paragraph.split(/(?<=[.!?])\s+/);
          let currentChunk = '';

          for (const sentence of sentences) {
            if ((currentChunk + sentence).length <= chunkSize) {
              currentChunk += (currentChunk ? ' ' : '') + sentence;
            } else {
              if (currentChunk) chunks.push(currentChunk.trim());
              currentChunk = sentence;
            }
          }
          if (currentChunk) chunks.push(currentChunk.trim());
        }
      }

      return chunks.filter(chunk => chunk.length > 10); // Filter very short chunks
    }

    // Simple but effective token-based similarity (faster than embeddings)
    static getQueryTokens(query) {
      return query.toLowerCase()
        .replace(/[^\w\s]/g, ' ')
        .split(/\s+/)
        .filter(word => word.length > 2)
        .filter(word => !this.stopWords.has(word));
    }

    static getTextTokens(text) {
      return text.toLowerCase()
        .replace(/[^\w\s]/g, ' ')
        .split(/\s+/)
        .filter(word => word.length > 2)
        .filter(word => !this.stopWords.has(word));
    }

    // BM25-like scoring (simplified)
    static calculateRelevanceScore(queryTokens, textTokens, text) {
      if (queryTokens.length === 0 || textTokens.length === 0) return 0;

      const queryTokenSet = new Set(queryTokens);
      const textTokenSet = new Set(textTokens);

      // Calculate term frequency and intersection
      let score = 0;
      let matches = 0;

      for (const token of queryTokenSet) {
        if (textTokenSet.has(token)) {
          matches++;
          // Simple term frequency in the text
          const termFrequency = textTokens.filter(t => t === token).length;
          score += termFrequency;
        }
      }

      // Boost score based on match ratio and position
      const matchRatio = matches / queryTokenSet.size;
      const lengthRatio = Math.min(textTokens.length / 100, 1); // Prefer medium-length chunks

      return (score * matchRatio * lengthRatio) / (1 + Math.abs(textTokens.length - 80));
    }

    // Common stop words to filter out
    static stopWords = new Set([
      'the', 'a', 'an', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for', 'of', 'with', 'by',
      'is', 'are', 'was', 'were', 'be', 'been', 'being', 'have', 'has', 'had', 'do', 'does', 'did',
      'this', 'that', 'these', 'those', 'i', 'you', 'he', 'she', 'it', 'we', 'they',
      'my', 'your', 'his', 'her', 'its', 'our', 'their'
    ]);
  }

  // Efficient RAG Manager
  class EfficientRAGManager {
    constructor() {
      this.vectorStore = new SimpleVectorStore();
    }

    async processPageContent(structuredText, url, metadata = {}) {
      console.log('🚀 Processing page content...');

      // Step 1: Chunk the text
      const textChunks = OptimizedTextProcessor.chunkText(structuredText, 400, 50);
      console.log(`📦 Created ${textChunks.length} chunks`);

      // Step 2: Precompute tokens for faster retrieval
      const chunksWithTokens = textChunks.map((text, index) => ({
        text,
        tokens: OptimizedTextProcessor.getTextTokens(text),
        metadata: {
          chunkIndex: index,
          totalChunks: textChunks.length,
          chunkLength: text.length,
          ...metadata
        }
      }));

      // Step 3: Store in database
      const storedCount = await this.vectorStore.storeChunks(url, chunksWithTokens);
      console.log(`💾 Stored ${storedCount} chunks for ${url}`);

      return {
        totalChunks: textChunks.length,
        url
      };
    }

    async retrieveRelevantChunks(query, url, topK = 4) {
      console.log(`🎯 Retrieving chunks for: "${query}"`);

      // Get all chunks for this URL
      const storedChunks = await this.vectorStore.getChunks(url);
      if (storedChunks.length === 0) {
        console.log('❌ No chunks found for URL');
        return [];
      }

      // Precompute query tokens once
      const queryTokens = OptimizedTextProcessor.getQueryTokens(query);

      // Score all chunks
      const scoredChunks = storedChunks.map(chunk => {
        const score = OptimizedTextProcessor.calculateRelevanceScore(
          queryTokens,
          chunk.tokens,
          chunk.text
        );

        return {
          text: chunk.text,
          score,
          metadata: chunk.metadata
        };
      });

      // Sort by score and get top K
      scoredChunks.sort((a, b) => b.score - a.score);

      const relevantChunks = scoredChunks
        .slice(0, topK)
        .filter(item => item.score > 0.1);

      console.log(`✅ Found ${relevantChunks.length} relevant chunks`);

      return relevantChunks;
    }
  }

  // Initialize RAG Manager
  const ragManager = new EfficientRAGManager();

  // Convert JSON to structured text
  function jsonToStructuredText(data) {
    if (!data) return "No data available";

    const sections = [];

    // 1. Title (always include if available)
    if (data.title) {
      sections.push(`# ${data.title}`);
    }

    // 2. Auto-detect and structure main content sections
    const structuredContent = autoStructureContent(data);
    sections.push(...structuredContent);

    // 3. Metadata summary at the end
    sections.push(createMetadataSummary(data));

    return sections.join('\n\n');
  }

  function autoStructureContent(data) {
    const sections = [];

    // Analyze content to find natural sections
    const contentAnalysis = analyzeContentStructure(data);

    // Main content section
    if (contentAnalysis.mainContent.length > 0) {
      sections.push('## Main Content');
      sections.push(...contentAnalysis.mainContent.slice(0, 8)); // Top 8 most important paragraphs
    }

    // Key topics identified from headings
    if (contentAnalysis.keyTopics.length > 0) {
      sections.push('## Key Topics');
      sections.push(contentAnalysis.keyTopics.map(topic => `- ${topic}`).join('\n'));
    }

    // Detailed sections if available
    if (contentAnalysis.detailedSections.length > 0) {
      sections.push('## Detailed Information');
      contentAnalysis.detailedSections.forEach((section, index) => {
        if (index < 5) { // Limit to 5 detailed sections
          sections.push(`### ${section.heading || `Section ${index + 1}`}`);
          sections.push(section.content);
        }
      });
    }

    // Important links
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

    // Analyze headings to identify key topics
    if (data.headings && data.headings.length > 0) {
      // Group headings by level and importance
      const headingGroups = groupHeadingsByImportance(data.headings);
      analysis.keyTopics = headingGroups.mainTopics.slice(0, 10);
    }

    // Analyze paragraphs for main content
    if (data.paras && data.paras.length > 0) {
      // Score paragraphs by importance (length, position, content)
      const scoredParagraphs = data.paras.map((para, index) => ({
        text: para,
        score: calculateParagraphScore(para, index, data.paras.length),
        length: para.length
      }));

      // Sort by score and take most important ones
      scoredParagraphs.sort((a, b) => b.score - a.score);
      analysis.mainContent = scoredParagraphs
        .filter(p => p.score > 0 && p.length > 0)
        .slice(0, 15)
        .map(p => p.text);
    }

    // Create detailed sections from heading-paragraph relationships
    if (data.headings && data.paras) {
      analysis.detailedSections = createHeadingContentPairs(data.headings, data.paras);
    }

    // Analyze links for importance
    if (data.links && data.links.length > 0) {
      analysis.importantLinks = data.links
        .filter(link => link.text && link.text.length > 5)
        .filter(link => !isNavigationLink(link.text))
        .slice(0, 8);
    }

    return analysis;
  }

  function groupHeadingsByImportance(headings) {
    const mainTopics = [];
    const subTopics = [];

    headings.forEach(heading => {
      const text = typeof heading === 'string' ? heading : heading.text || heading;
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

    // Length score (medium-length paragraphs are often most important)
    const lengthScore = Math.min(paragraph.length / 500, 1);
    score += lengthScore * 0.4;

    // Position score (first and early paragraphs often contain key info)
    const positionScore = 1 - (index / totalParagraphs);
    score += positionScore * 0.3;

    // Content quality score
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

    // Simple algorithm: pair headings with following paragraphs
    let currentHeading = null;
    let currentContent = [];

    // Convert all to strings for simplicity
    const headingTexts = headings.map(h => typeof h === 'string' ? h : h.text || '');
    const paragraphTexts = paragraphs.map(p => typeof p === 'string' ? p : p);

    // For each paragraph, check if it's likely related to a heading
    paragraphTexts.forEach((paragraph, index) => {
      // If this paragraph is short and looks like a subheading, treat it as such
      if (paragraph.length < 100 && /^[A-Z][^.!?]*$/.test(paragraph)) {
        if (currentHeading && currentContent.length > 0) {
          sections.push({
            heading: currentHeading,
            content: currentContent.join(' ')
          });
        }
        currentHeading = paragraph;
        currentContent = [];
      }
      // Otherwise, accumulate content under current heading
      else if (currentHeading) {
        currentContent.push(paragraph);
      }
      // If no current heading, use the first main heading we find
      else if (headingTexts.length > 0 && index < 3) {
        currentHeading = headingTexts[0];
        currentContent.push(paragraph);
      }
    });

    // Add the last section
    if (currentHeading && currentContent.length > 0) {
      sections.push({
        heading: currentHeading,
        content: currentContent.join(' ')
      });
    }

    return sections.slice(0, 10); // Limit to 10 sections
  }

  function isNavigationLink(linkText) {
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

  // Helper to send message to content script
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

      // Scrape page content
      const scrapedRes = await sendToContentScript(tab.id, { type: 'SCRAPE_PAGE' });

      if (!scrapedRes?.ok) {
        statusMessage.querySelector('.message-text').textContent = '❌ Failed to scrape page content.';
        return;
      }

      const scrapedData = scrapedRes.data;
      console.log('Got page data: ', scrapedData);

      // Convert to structured text
      const structuredText = jsonToStructuredText(scrapedData);
      console.log('Structured text length:', structuredText);

      // RAG Processing
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
        // Fallback: use first few chunks
        const allChunks = await ragManager.vectorStore.getChunks(tab.url);
        context = allChunks.slice(0, 3).map(c => c.text).join('\n\n');
      } else {
        context = relevantChunks
          .map((item, index) => `[Section ${index + 1}]\n${item.text}`)
          .join('\n\n---\n\n');
      }

      console.log(`Using ${relevantChunks.length} relevant chunks`);

      // Send to AI
      statusMessage.querySelector('.message-text').textContent = '🧠 Generating answer...';

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
        let answer = res.answer;

        // Optional: include metadata info
        // if (res.ragMetadata) {
        //   answer += `\n\n---\n*Generated using ${res.ragMetadata.chunksUsed} relevant sections*`;
        // }

        // ✅ Convert Markdown → HTML
        const htmlAnswer = DOMPurify.sanitize(marked.parse(answer));

        // ✅ Render Markdown safely
        const messageDiv = statusMessage.querySelector('.message-text');
        messageDiv.innerHTML = htmlAnswer;

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

  sendButton.addEventListener('click', handleSend);
  chatInputField.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      handleSend();
    }
  });
});