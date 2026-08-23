"use server";

import { redirect } from "next/navigation";
import { checkPassword, createSession, destroySession } from "@/lib/admin/auth";

export async function login(formData: FormData) {
  const password = String(formData.get("password") ?? "");
  const next = String(formData.get("next") ?? "/admin");

  if (!checkPassword(password)) {
    redirect(`/admin/login?error=1&next=${encodeURIComponent(next)}`);
  }

  await createSession();
  redirect(next.startsWith("/admin") ? next : "/admin");
}

export async function logout() {
  await destroySession();
  redirect("/admin/login");
}
