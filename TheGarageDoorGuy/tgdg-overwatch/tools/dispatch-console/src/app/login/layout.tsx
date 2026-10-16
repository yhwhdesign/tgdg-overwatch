import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Sign in | The Garage Door Guy Corp",
  robots: { index: false, follow: false },
};

export default function LoginLayout({ children }: { children: React.ReactNode }) {
  return children;
}
