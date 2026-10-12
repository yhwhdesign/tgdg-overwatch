// A tiny stand-in for the dispatch console: pages, a sign-in cookie, the yes/no session check, and test controls.
const http = require("http");
function start(port = 3000) {
  const state = { sessionValid: true, sessionChecks: 0 };
  const log = [];
  const server = http.createServer((req, res) => {
    const cookie = req.headers.cookie || "";
    log.push(`${req.method} ${req.url} cookie=${cookie || "-"}`);
    const page = (title, body, headers = {}) => { res.writeHead(200, { "content-type": "text/html", ...headers }); res.end(`<!doctype html><meta charset="utf-8"><title>${title}</title><body style="font-family:Arial;background:#f4f2ea;color:#16140f;margin:0"><div style="background:#16140f;color:#fff;padding:18px"><div style="color:#e97530;font-size:11px;font-weight:700;letter-spacing:.1em">THE GARAGE DOOR GUY CORP</div><h1 style="margin:6px 0 0;font-size:22px;text-transform:uppercase">${title}</h1></div><div style="padding:18px">${body}</div>`); };
    const json = (obj) => { res.writeHead(200, { "content-type": "application/json", "cache-control": "no-store" }); res.end(JSON.stringify(obj)); };
    if (req.url === "/") return page("Dispatch console", `<p id="marker">DISPATCH PAGE</p><p><a id="ext" target="_blank" href="https://example.com/outside">An external link (new window)</a></p><p><a id="nav" href="https://example.org/navigate">An external link (same window)</a></p><p><button id="popup" onclick="window.open('https://example.com/popup')">window.open</button></p>`);
    // loading the admin page "signs you in" (it sets the cookie), like a successful login would
    if (req.url === "/admin") return page("Admin", `<p id="marker">ADMIN PAGE</p>`, { "set-cookie": "overwatch_admin=abc123; Path=/; HttpOnly; SameSite=Strict; Max-Age=3600" });
    if (req.url === "/reports") return page("Reports", `<p id="marker">REPORTS PAGE</p>`);
    if (req.url.startsWith("/tool-")) return page("Tool " + req.url.slice(6), `<p id="marker">TOOL ${req.url.slice(6).toUpperCase()}</p>`);
    if (req.url === "/logout") { res.writeHead(200, { "content-type": "text/plain", "set-cookie": "overwatch_admin=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0" }); return res.end("signed out"); }
    if (req.url === "/api/admin/session") { state.sessionChecks++; return json({ enabled: true, signedIn: state.sessionValid && cookie.includes("overwatch_admin=abc123") }); }
    if (req.url === "/__invalidate") { state.sessionValid = false; return json({ ok: true }); }   // the server stops accepting the cookie (a password change) while the cookie stays
    if (req.url === "/__validate") { state.sessionValid = true; return json({ ok: true }); }
    if (req.url === "/whoami") return json({ cookie: cookie || null });
    res.writeHead(404); res.end("not found");
  });
  return new Promise((resolve) => server.listen(port, "127.0.0.1", () => resolve({ server, log, state })));
}
module.exports = { start };
