// Prevent duplicates and handle multiple injections
if (document.getElementById("milo-mate-popup")) {
  document.getElementById("milo-mate-popup").remove();
}

// Use var instead of const to avoid redeclaration errors
var iframe = document.createElement("iframe");
iframe.src = chrome.runtime.getURL("popup.html");
iframe.id = "milo-mate-popup";
iframe.style.position = "fixed";
iframe.style.bottom = "20px";
iframe.style.right = "20px";
iframe.style.width = "420px";
iframe.style.height = "580px";
iframe.style.border = "none";
iframe.style.borderRadius = "12px";
iframe.style.boxShadow = "0 4px 20px rgba(0,0,0,0.3)";
iframe.style.zIndex = "999999";
iframe.style.background = "white";

document.body.appendChild(iframe);

// Allow closing from inside popup - use named function to prevent duplicate listeners
function handlePopupMessage(event) {
  if (event.data === "close-milo-popup") {
    console.log('Closing Milo Mate - Stopping all actions...');
    
    // 1. Stop all timers and intervals
    const maxId = setTimeout(() => {}, 0);
    for (let i = maxId; i >= 0; i--) {
      clearTimeout(i);
      clearInterval(i);
    }
    
    // 2. Remove all event listeners
    const clone = iframe.cloneNode(true);
    iframe.parentNode.replaceChild(clone, iframe);
    
    // 3. Remove the iframe
    clone.remove();
    
    // 4. Remove message listener
    window.removeEventListener("message", handlePopupMessage);
    
    // 5. Clear variables
    iframe = null;
    
    console.log('Milo Mate completely closed');
  }
}

// Remove any existing listener first, then add new one
window.removeEventListener("message", handlePopupMessage);
window.addEventListener("message", handlePopupMessage);