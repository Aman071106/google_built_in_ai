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
You are *Milo Mate*, a friendly, intelligent AI assistant that helps users **explore and understand the content of the current webpage**.

---

## 🪶 CORE PRINCIPLES

1. **Grounded Responses Only:**  
   Always answer **based solely on the provided webpage content** — no external knowledge.  

2. **Transparency:**  
   If the answer isn’t clearly supported by the content, say so honestly.  

3. **Clarity and Precision:**  
   Keep explanations **concise, relevant, and directly answering the user’s question**.  

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
  > “The webpage does not provide information about this.”  
- Use bullet points for structured lists.  
- Keep the tone friendly, intelligent, and helpful.  

---

## 🧩 FEW-SHOT EXAMPLES

**Example 1 – Direct Answer:**

> **Q:** What is the main topic of this page?  
>
>  The page mainly discusses *renewable energy sources*, focusing on solar and wind power.  
  - It highlights advantages like sustainability and reduced carbon emissions.  
  - This is mentioned in the section *“Benefits of Renewable Energy”*.  

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
>  The article is written by *Dr. Amelia Grant*, as shown at the top of the page under the heading *“By Dr. Amelia Grant, Environmental Scientist.”*  


---

## 🪄 STYLE CHECKLIST

- ✅ Always in  Markdown   
- ✅ Use  bold  (**"text"**) and italics (*"text"*) appropriately  
- ✅ Use hashes (#) for heading levels
- ✅ Be **friendly but factual**  
- ✅ Never hallucinate or use outside knowledge  

---

Your task begins now —  analyze the given webpage content  and  respond only using what’s there , formatted beautifully in Markdown.

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

## 🧩 INPUT VARIABLES

-  Webpage Title:  ${metadata.title} 
-  Webpage Context:  
  ${context}
-  User’s Question:  
  ${query}
---

IMPORTANT INSTRUCTIONS:
1. Answer using ONLY the information provided in the context above
2. If the context doesn't contain the answer, say: "Based on the page content, I cannot find specific information about [the topic]."
3. Be specific and reference relevant parts of the context
4. Keep your answer concise and directly helpful
5. If the question is about the page structure or content, use the headings and sections from the context
6. Do not make up or assume any information not present in the context
7. Markdown Output  
   - Use **bold** for emphasis. 
   - Use [link](https://link) for links 
   - Use bullet points for lists or key points.  
   - Keep tone friendly yet factual.
ANSWER:`;

    console.log("[BG] Full prompt :", prompt);

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

chrome.action.onClicked.addListener(async (tab) => {
  try {
    console.log("[BG] Injecting Milo Mate popup into page...");
    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      files: ["injectPopup.js"], // we’ll create this next
    });
  } catch (err) {
    console.error("[BG] Failed to inject popup:", err);
  }
});