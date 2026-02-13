(() => {
  const scriptTag = document.currentScript;
  const businessSlug =
    scriptTag?.getAttribute("data-business-slug") || "demo";

  // Where this widget is hosted (your Railway domain)
  const baseUrl = new URL(scriptTag.src).origin;

  // --- Button (chat bubble) ---
  const btn = document.createElement("button");
  btn.type = "button";
  btn.setAttribute("aria-label", "Open chat");
  btn.style.cssText = `
    position: fixed;
    right: 18px;
    bottom: 18px;
    width: 56px;
    height: 56px;
    border-radius: 999px;
    border: 0;
    cursor: pointer;
    z-index: 2147483647;
    background: #111827;
    color: #fff;
    box-shadow: 0 12px 30px rgba(0,0,0,0.22);
    display: flex;
    align-items: center;
    justify-content: center;
  `;

  // Simple chat icon (inline SVG)
  btn.innerHTML = `
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none"
      xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      <path d="M7 8h10M7 12h6" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
      <path d="M21 12c0 4.418-4.03 8-9 8a10.8 10.8 0 0 1-3.7-.64L3 21l1.55-4.02A7.3 7.3 0 0 1 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8Z"
        stroke="currentColor" stroke-width="2" stroke-linejoin="round"/>
    </svg>
  `;

  // --- Panel container ---
  const panel = document.createElement("div");
  panel.style.cssText = `
    position: fixed;
    right: 18px;
    bottom: 86px;
    width: 360px;
    height: 520px;
    border-radius: 16px;
    overflow: hidden;
    background: #ffffff;
    box-shadow: 0 18px 50px rgba(0,0,0,0.25);
    z-index: 2147483647;
    display: none;
  `;

  // --- Iframe (isolated UI so it won't break) ---
  const iframe = document.createElement("iframe");
  iframe.src = `${baseUrl}/demo-chat.html?businessSlug=${encodeURIComponent(
    businessSlug
  )}`;
  iframe.style.cssText = `
    width: 100%;
    height: 100%;
    border: 0;
    display: block;
  `;
  iframe.setAttribute("title", "Zyra Chat");

  panel.appendChild(iframe);

  // Toggle open/close
  const toggle = () => {
    panel.style.display = panel.style.display === "none" ? "block" : "none";
  };
  btn.addEventListener("click", toggle);

  // Close on Escape (nice touch)
  window.addEventListener("keydown", (e) => {
    if (e.key === "Escape") panel.style.display = "none";
  });

  document.body.appendChild(btn);
  document.body.appendChild(panel);
})();
