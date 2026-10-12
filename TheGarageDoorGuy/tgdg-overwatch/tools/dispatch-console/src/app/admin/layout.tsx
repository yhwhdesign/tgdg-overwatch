import type { Metadata } from "next";

// Keep the admin screen out of search engines and link previews.
export const metadata: Metadata = {
  title: "Admin | The Garage Door Guy Corp",
  robots: { index: false, follow: false },
};

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return children;
}
