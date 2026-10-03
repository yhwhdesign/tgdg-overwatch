import { redirect } from "next/navigation";
import { getCurrentUserId } from "@/lib/session";

export default async function RootPage() {
  const userId = await getCurrentUserId();

  if (userId) {
    redirect("/dashboard");
  } else {
    redirect("/login");
  }
}