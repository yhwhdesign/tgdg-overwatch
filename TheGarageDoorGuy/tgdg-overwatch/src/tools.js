// Registry of docked tools. Add an entry here to add a new tool to the icon
// rail — no other code changes needed. `defaultUrl` is used until someone
// overrides it via the settings gear (stored via the Electron main process,
// see preload.js / main.js).
const TOOLS = [
  {
    id: "dispatch",
    name: "Dispatch Console",
    defaultUrl: "http://localhost:3000",
    // Single-character glyph is enough for a narrow icon rail; swap for an
    // <img> per tool later if the rail ever needs real icon art.
    glyph: "D",
  },
];

async function getToolUrl(tool) {
  const stored = await window.overwatch.getToolUrl(tool.id);
  return stored || tool.defaultUrl;
}

async function setToolUrl(tool, url) {
  await window.overwatch.setToolUrl(tool.id, url);
}
