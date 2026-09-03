"use client";

import { useState } from "react";
import { TextField } from "@/components/admin/Fields";

/** Toggles the temporary-password field's visibility/required-ness based
 * on which setup method is selected. Kept as its own tiny client island
 * rather than making the whole Create User page a client component — the
 * page itself stays a plain server-rendered form + Server Action. */
export default function SetupMethodFields() {
  const [method, setMethod] = useState<"email" | "password">("email");

  return (
    <div className="flex flex-col gap-3">
      <span className="block text-sm font-medium text-ink">Account setup method</span>

      <label className="flex items-start gap-3 rounded-xl border border-black/10 bg-white px-3.5 py-3 has-[:checked]:border-findmi has-[:checked]:bg-findmi-50">
        <input
          type="radio"
          name="setup_method"
          value="email"
          checked={method === "email"}
          onChange={() => setMethod("email")}
          className="mt-0.5 h-4 w-4 shrink-0 accent-findmi"
        />
        <span>
          <span className="block text-sm font-medium text-ink">Send setup email (recommended)</span>
          <span className="block text-xs text-ink/45">
            The user gets a secure email with a link to set their own password. No password to hand off.
          </span>
        </span>
      </label>

      <label className="flex items-start gap-3 rounded-xl border border-black/10 bg-white px-3.5 py-3 has-[:checked]:border-findmi has-[:checked]:bg-findmi-50">
        <input
          type="radio"
          name="setup_method"
          value="password"
          checked={method === "password"}
          onChange={() => setMethod("password")}
          className="mt-0.5 h-4 w-4 shrink-0 accent-findmi"
        />
        <span>
          <span className="block text-sm font-medium text-ink">Set a temporary password</span>
          <span className="block text-xs text-ink/45">
            You choose an initial password and share it with the user directly. They should change it after
            logging in.
          </span>
        </span>
      </label>

      {method === "password" && (
        <div className="rounded-xl border border-black/10 bg-mist/40 p-3.5">
          <TextField
            label="Temporary password"
            name="password"
            type="password"
            required
            hint="At least 8 characters. Shown here once — FindMi never stores or displays it again. Tell the user to change it after they log in."
          />
        </div>
      )}
    </div>
  );
}
