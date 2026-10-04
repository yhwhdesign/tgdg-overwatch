// TOOLS, getToolUrl, setToolUrl come from tools.js, loaded just before this
// script — both are plain <script> tags sharing one global scope, no module
// system needed for a file this small.

const rail = document.getElementById("rail");
const frame = document.getElementById("app");
const nameLabel = document.getElementById("active-tool-name");
const toggleBtn = document.getElementById("toggle-settings");
const settingsPanel = document.getElementById("settings");
const urlInput = document.getElementById("url-input");
const saveBtn = document.getElementById("save-url");

let activeTool = TOOLS[0];

function renderRail() {
  rail.innerHTML = "";
  for (const tool of TOOLS) {
    const btn = document.createElement("button");
    btn.className = "rail-btn" + (tool.id === activeTool.id ? " active" : "");
    btn.textContent = tool.glyph;
    btn.title = tool.name;
    btn.addEventListener("click", () => switchTool(tool));
    rail.appendChild(btn);
  }
}

async function switchTool(tool) {
  activeTool = tool;
  nameLabel.textContent = tool.name;
  settingsPanel.classList.remove("open");
  renderRail();
  const url = await getToolUrl(tool);
  frame.src = url;
  urlInput.value = url;
}

toggleBtn.addEventListener("click", () => {
  settingsPanel.classList.toggle("open");
});

saveBtn.addEventListener("click", async () => {
  const url = urlInput.value.trim();
  if (!url) return;
  await setToolUrl(activeTool, url);
  frame.src = url;
  settingsPanel.classList.remove("open");
});

switchTool(TOOLS[0]);
