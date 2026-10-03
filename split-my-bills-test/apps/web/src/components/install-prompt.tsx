"use client";

import { useState, useEffect } from "react";
import { X, Share, PlusSquare } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Logo } from "@/components/logo";

export function InstallPrompt() {
  const [visible, setVisible] = useState(false);
  const [platform, setPlatform] = useState<"ios" | "android" | "other">("other");
  const [deferredPrompt, setDeferredPrompt] = useState<any>(null);

  useEffect(() => {
    const isStandalone = window.matchMedia("(display-mode: standalone)").matches;
    const dismissed = localStorage.getItem("installPromptDismissed");

    if (isStandalone || dismissed) return;

    const ua = navigator.userAgent;
    if (/iPhone|iPad|iPod/.test(ua)) {
      setPlatform("ios");
      setVisible(true);
    } else if (/Android/.test(ua)) {
      setPlatform("android");
    }

    const handler = (e: any) => {
      e.preventDefault();
      setDeferredPrompt(e);
      setVisible(true);
    };
    window.addEventListener("beforeinstallprompt", handler);
    return () => window.removeEventListener("beforeinstallprompt", handler);
  }, []);

  function dismiss() {
    setVisible(false);
    localStorage.setItem("installPromptDismissed", "true");
  }

  async function handleAndroidInstall() {
    if (!deferredPrompt) return;
    deferredPrompt.prompt();
    await deferredPrompt.userChoice;
    setDeferredPrompt(null);
    dismiss();
  }

  if (!visible) return null;

  return (
    <div className="rounded-xl border border-primary/30 bg-primary/5 p-4 flex items-start gap-3 relative">
      <button
        onClick={dismiss}
        className="absolute top-3 right-3 text-muted-foreground/50 hover:text-foreground"
      >
        <X size={16} />
      </button>

      <div className="shrink-0 mt-0.5">
        <Logo />
      </div>

      <div className="flex-1 pr-6">
        {platform === "ios" ? (
          <p className="text-sm text-foreground">
            Install this app on your phone: tap{" "}
            <Share size={14} className="inline text-primary mx-0.5 -mt-0.5" /> Share, then{" "}
            <PlusSquare size={14} className="inline text-primary mx-0.5 -mt-0.5" /> Add to Home
            Screen.
          </p>
        ) : (
          <div>
            <p className="text-sm text-foreground mb-2">
              Install Split My Bills for quick access, right from your home screen.
            </p>
            <Button size="sm" onClick={handleAndroidInstall} className="font-semibold">
              Install App
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}