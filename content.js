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
// Listener is now UNCOMMENTED to receive messages from popup.js
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === "SCRAPE_PAGE") {
    try {
      const data = quickScrape();
      sendResponse({ ok: true, data });
    } catch (err) {
      console.error("[Scraper ❌ Failed to scrape]:", err);
      sendResponse({ ok: false, error: err.message });
    }
  }
  return true;
});