import type { Metadata } from "next";
// The font ships inside the app (no call to Google at build time), so the build also works on hosting.
import "@fontsource-variable/archivo";
import "./globals.css";

export const metadata: Metadata = {
  title: "Schedule Service | The Garage Door Guy Corp",
  description: "Book garage door service in Central Arkansas.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className="h-full antialiased">
      <body className="min-h-full flex flex-col bg-brand-cream">{children}</body>
    </html>
  );
}
