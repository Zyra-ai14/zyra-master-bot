(function () {
  const scriptTag = document.currentScript;
  const businessSlug = scriptTag.getAttribute("data-slug");

  if (!businessSlug) {
    console.error("Zyra widget error: Missing data-slug attribute.");
    return;
  }

  // Create widget container
  const container = document.createElement("div");
  container.style.position = "fixed";
  container.style.bottom = "20px";
  container.style.right = "20px";
  container.style.width = "350px";
  container.style.height = "500px";
  container.style.background = "#ffffff";
  container.style.borderRadius = "16px";
  container.style.boxShadow = "0 10px 40px rgba(0,0,0,0.15)";
  container.style.display = "flex";
  container.style.flexDirection = "column";
  container.style.fontFamily = "Arial, sans-serif";
  container.style.overflow = "hidden";
  container.style.zIndex = "9999";

  // Header
  const header = document.createElement("div");
  header.style.padding = "16px";
  header.style.background = "#111";
  header.style.color = "#fff";
  header.style.fontWeight = "bold";
  header.innerText = "Chat with us";
  container.appendChild(header);

  // Messages area
  const messages = document.createElement("div");
  messages.style.flex = "1";
  messages.style.padding = "12px";
  messages.style.overflowY = "auto";
  messages.style.fontSize = "14px";
  container.appendChild(messages);

  // Input area
  const inputContainer = document.createElement("div");
  inputContainer.style.display = "flex";
  inputContainer.style.borderTop = "1px solid #eee";

  const input = document.createElement("input");
  input.type = "text";
  input.placeholder = "Type your message...";
  input.style.flex = "1";
  input.style.padding = "10px";
  input.style.border = "none";
  input.style.outline = "none";

  const button = document.createElement("button");
  button.innerText = "Send";
  button.style.padding = "10px 16px";
  button.style.border = "none";
  button.style.cursor = "pointer";
  button.style.background = "#111";
  button.style.color = "#fff";

  inputContainer.appendChild(input);
  inputContainer.appendChild(button);
  container.appendChild(inputContainer);

  document.body.appendChild(container);

  function addMessage(text, isUser = false) {
    const msg = document.createElement("div");
    msg.style.marginBottom = "8px";
    msg.style.padding = "8px 12px";
    msg.style.borderRadius = "12px";
    msg.style.maxWidth = "80%";
    msg.style.fontSize = "14px";

    if (isUser) {
      msg.style.background = "#111";
      msg.style.color = "#fff";
      msg.style.alignSelf = "flex-end";
    } else {
      msg.style.background = "#f1f1f1";
      msg.style.color = "#000";
      msg.style.alignSelf = "flex-start";
    }

    msg.innerText = text;
    messages.appendChild(msg);
    messages.scrollTop = messages.scrollHeight;
  }

  async function sendMessage() {
    const text = input.value.trim();
    if (!text) return;

    addMessage(text, true);
    input.value = "";

    try {
      const response = await fetch(
        "https://zyra-master-bot-production.up.railway.app/chat",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            businessSlug,
            message: text,
          }),
        }
      );

      const data = await response.json();
      addMessage(data.reply, false);
    } catch (error) {
      addMessage("Something went wrong. Please try again.", false);
    }
  }

  button.addEventListener("click", sendMessage);
  input.addEventListener("keypress", function (e) {
    if (e.key === "Enter") sendMessage();
  });
})();
