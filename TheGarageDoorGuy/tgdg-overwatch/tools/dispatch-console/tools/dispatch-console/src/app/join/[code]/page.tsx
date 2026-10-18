import type { Metadata, Viewport } from "next";
import { validTopic } from "@/lib/notify";
import { prisma } from "@/lib/prisma";
import JoinClient from "./JoinClient";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ code: string }> };

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { code } = await params;
  return {
    title: "TGDG Alerts",
    description: "Alerts from TGDG Overwatch.",
    manifest: validTopic(code) ? `/join/${code}/manifest.webmanifest` : undefined,
    appleWebApp: { capable: true, title: "TGDG Alerts", statusBarStyle: "default" },
    icons: { icon: "/icon-192.png", apple: "/apple-touch-icon.png" },
    robots: { index: false, follow: false },
    referrer: "no-referrer",
  };
}

export const viewport: Viewport = { themeColor: "#e97530", width: "device-width", initialScale: 1 };

// A person's own setup page for phone alerts. Public (no console sign-in): the private code in the address is the key.
export default async function JoinPage({ params }: Params) {
  const { code } = await params;
  let name: string | null = null;
  if (validTopic(code)) {
    try {
      const row = await prisma.notifyRecipient.findUnique({ where: { topic: code }, select: { name: true } });
      name = row?.name ?? null;
    } catch {
      name = null;
    }
  }
  return (
    <main className="mx-auto flex min-h-screen w-full max-w-md flex-col justify-center gap-6 px-5 py-10">
      {name ? (
        <JoinClient code={code} name={name} />
      ) : (
        <div className="rounded-2xl bg-white p-6 shadow-sm">
          <h1 className="text-2xl font-black uppercase tracking-tight text-brand-black">Link not valid</h1>
          <p className="mt-3 text-base text-brand-gray">This setup link is not valid or was removed. Ask the office for a new one.</p>
        </div>
      )}
    </main>
  );
}
