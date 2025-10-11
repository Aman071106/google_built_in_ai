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

CORE PRINCIPLES:
1. Answer questions based ONLY on the provided context from the webpage
2. If the context doesn't contain enough information, be honest about what you cannot answer
3. Provide concise, relevant answers that directly address the user's question
4. Reference specific parts of the context when helpful
5. Stay focused on the webpage content and avoid adding external knowledge

RESPONSE GUIDELINES:
- Start with a direct answer to the question
- Reference relevant sections from the context
- If information is missing, clearly state what's not available in the page
- Keep responses clear and conversational
- Use bullet points for lists when helpful
        `
      }
    ],
    temperature: 0.7, // Lower temperature for more focused, context-based responses
    topK: 3,
  });

  console.log("[BG] Session created!");
  return session;
}

// Handle regular queries (full page content)
async function handleRegularQuery(request, sender, sendResponse) {
  try {
    const sess = await ensureSession();
    console.log("[BG] Session ready, sending prompt for regular query...");
    console.log("[BG] Page content length:", request.page?.length);

    const result = await sess.prompt([
      {
        role: "user",
        content: `Page Content:\n${request.page}\n\nQuestion:\n${request.query}\n\nPlease answer based on the page content above.`,
      },
    ]);

    console.log("[BG] Regular prompt complete:", result);
    sendResponse({ ok: true, answer: result });
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
    
    console.log(`[BG] RAG Query: "${query}"`);
    console.log(`[BG] Context length: ${context.length} chars`);
    console.log(`[BG] Using ${metadata.relevantChunks} of ${metadata.totalChunks} chunks`);
    console.log(`[BG] Source: ${metadata.source}`);

    // Create enhanced prompt with RAG context
    const prompt = `Based on the following context from the webpage "${metadata.title}", answer the user's question.

CONTEXT FROM PAGE:
${context}

USER'S QUESTION: ${query}

IMPORTANT INSTRUCTIONS:
1. Answer using ONLY the information provided in the context above
2. If the context doesn't contain the answer, say: "Based on the page content, I cannot find specific information about [the topic]."
3. Be specific and reference relevant parts of the context
4. Keep your answer concise and directly helpful
5. If the question is about the page structure or content, use the headings and sections from the context
6. Do not make up or assume any information not present in the context

ANSWER:`;
    
    console.log("[BG] Full prompt :", prompt );
    
    const result = await sess.prompt([
      {
        role: "user",
        content: prompt,
      },
    ]);

    console.log("[BG] RAG prompt complete, response length:", result.length);
    
    // Add RAG metadata to the response
    sendResponse({ 
      ok: true, 
      answer: result,
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

// Main message handler
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  console.log("[BG] Received message type:", msg.type);

  switch (msg.type) {
    case "ASK_QUERY_WITH_CONTEXT":
      handleRAGQuery(msg, sender, sendResponse);
      break;
      
    case "ASK_QUERY":
      handleRegularQuery(msg, sender, sendResponse);
      break;
      
    default:
      console.warn("[BG] Unknown message type:", msg.type);
      sendResponse({ ok: false, error: "Unknown message type" });
  }

  return true; // keep channel open
});

// Session management and cleanup
chrome.runtime.onSuspend.addListener(() => {
  console.log("[BG] Extension suspending, cleaning up...");
  session = null;
});

// Optional: Add periodic session refresh to prevent memory issues
setInterval(() => {
  if (session) {
    console.log("[BG] Refreshing session...");
    session = null;
  }
}, 30 * 60 * 1000); // Refresh every 30 minutes