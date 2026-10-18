// Registry of docked tools. Add an entry here to add a tab: no other code changes are needed.
//   id        stable key (used in saved settings)
//   name      full name (tooltips, the menu)
//   shortName label on the tab when there is room
//   glyph     one character for narrow tabs
//   path      where the tool lives on the server; the server address itself is ONE setting for all tools
//   core      true = can't be hidden from the tab bar
//   adminOnly true = only listed while signed in as admin (it disappears again on sign-out or expiry)
//   hostsPanelSettings  true = the panel's settings cog is shown on THIS tool's screen (and only to a signed-in admin)
// Loaded two ways: require("./tools") in the main process, a <script> tag in the panel (window.TOOLS).
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else {
    root.ToolsRegistry = api;
    root.TOOLS = api.TOOLS;
  }
})(typeof self !== "undefined" ? self : this, function () {
  const TOOLS = [
    { id: "dispatch", name: "Dispatch Console", shortName: "Dispatch", glyph: "D", path: "/", core: true },
    { id: "admin", name: "Admin", shortName: "Admin", glyph: "A", path: "/admin", core: true, hostsPanelSettings: true },
    { id: "estimates", name: "Estimates", shortName: "Estimates", glyph: "E", path: "/estimates" },
    { id: "reports", name: "Reports", shortName: "Reports", glyph: "R", path: "/reports", adminOnly: true },
  ];
  return { TOOLS };
});
