// Prevent duplicates and handle multiple injections
if (document.getElementById("milo-mate-popup")) {
  document.getElementById("milo-mate-popup").remove();
}
if (document.getElementById("milo-mate-drag-handle")) {
  document.getElementById("milo-mate-drag-handle").remove();
}

// Create container
var container = document.createElement("div");
container.id = "milo-mate-container";
container.style.position = "fixed";
container.style.bottom = "20px";
container.style.right = "20px";
container.style.width = "420px";
container.style.height = "580px";
container.style.zIndex = "999999";

// Create iframe
var iframe = document.createElement("iframe");
iframe.src = chrome.runtime.getURL("popup.html");
iframe.id = "milo-mate-popup";
iframe.style.width = "100%";
iframe.style.height = "100%";
iframe.style.border = "none";
iframe.style.borderRadius = "12px";
iframe.style.boxShadow = "0 4px 20px rgba(0,0,0,0.3)";
iframe.style.background = "white";
iframe.style.pointerEvents = "auto";

// Create drag handle (invisible overlay on header area)
var dragHandle = document.createElement("div");
dragHandle.id = "milo-mate-drag-handle";
dragHandle.style.position = "absolute";
dragHandle.style.top = "0";
dragHandle.style.left = "0";
dragHandle.style.right = "0";
dragHandle.style.height = "60px"; // Height of your header
dragHandle.style.cursor = "move";
dragHandle.style.zIndex = "1";
dragHandle.style.background = "transparent";

container.appendChild(iframe);
container.appendChild(dragHandle);
document.body.appendChild(container);

// Make the container draggable via the drag handle
makeDraggable(container, dragHandle);

function makeDraggable(element, handle) {
  let pos1 = 0, pos2 = 0, pos3 = 0, pos4 = 0;
  let isDragging = false;

  handle.onmousedown = dragMouseDown;

  function dragMouseDown(e) {
    e = e || window.event;
    e.preventDefault();
    
    pos3 = e.clientX;
    pos4 = e.clientY;
    
    document.onmouseup = closeDragElement;
    document.onmousemove = elementDrag;
    
    isDragging = true;
    handle.style.cursor = "grabbing";
    
    // Disable pointer events on iframe while dragging
    iframe.style.pointerEvents = "none";
  }

  function elementDrag(e) {
    if (!isDragging) return;
    
    e = e || window.event;
    e.preventDefault();
    
    pos1 = pos3 - e.clientX;
    pos2 = pos4 - e.clientY;
    pos3 = e.clientX;
    pos4 = e.clientY;
    
    const newTop = element.offsetTop - pos2;
    const newLeft = element.offsetLeft - pos1;
    
    const maxTop = window.innerHeight - element.offsetHeight;
    const maxLeft = window.innerWidth - element.offsetWidth;
    
    element.style.top = Math.max(0, Math.min(newTop, maxTop)) + "px";
    element.style.left = Math.max(0, Math.min(newLeft, maxLeft)) + "px";
    element.style.bottom = "auto";
    element.style.right = "auto";
  }

  function closeDragElement() {
    document.onmouseup = null;
    document.onmousemove = null;
    isDragging = false;
    handle.style.cursor = "move";
    
    // Re-enable pointer events on iframe
    iframe.style.pointerEvents = "auto";
  }
}

// Close handler
function handlePopupMessage(event) {
  if (event.data === "close-milo-popup") {
    console.log('Closing Milo Mate...');
    
    const maxId = setTimeout(() => {}, 0);
    for (let i = maxId; i >= 0; i--) {
      clearTimeout(i);
      clearInterval(i);
    }
    
    if (container && container.parentNode) {
      container.remove();
    }
    
    window.removeEventListener("message", handlePopupMessage);
    
    container = null;
    iframe = null;
    
    console.log('Milo Mate closed');
  }
}

window.removeEventListener("message", handlePopupMessage);
window.addEventListener("message", handlePopupMessage);