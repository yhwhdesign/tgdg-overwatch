import { NextResponse } from "next/server";
import { validTopic } from "@/lib/notify";

export const dynamic = "force-dynamic";

// The home-screen app's description. Its start address is this person's own setup page, so opening the icon comes back here.
export async function GET(_request: Request, context: { params: Promise<{ code: string }> }) {
  const { code } = await context.params;
  if (!validTopic(code)) return new NextResponse("Not found", { status: 404 });
  const manifest = {
    name: "TGDG Alerts",
    short_name: "TGDG Alerts",
    description: "Alerts from TGDG Overwatch.",
    start_url: `/join/${code}`,
    scope: "/",
    display: "standalone",
    background_color: "#f4f2ea",
    theme_color: "#e97530",
    icons: [
      { src: "/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
    ],
  };
  return new NextResponse(JSON.stringify(manifest), { headers: { "content-type": "application/manifest+json", "cache-control": "no-store" } });
}
