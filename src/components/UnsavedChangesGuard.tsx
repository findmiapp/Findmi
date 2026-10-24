"use client";

import { useEffect, useRef, useState } from "react";

export const UNSAVED_CHANGES_MESSAGE = "You have unsaved changes. Leave without saving?";

/** Warn before leaving with unsaved edits: the browser's own prompt on reload /
 * close / external navigation, and a confirm on in-app link taps (Next's client
 * navigation never fires beforeunload). Nothing else — no autosave, no drafts. */
export function useUnsavedChangesGuard(dirty: boolean) {
  const dirtyRef = useRef(dirty);
  useEffect(() => {
    dirtyRef.current = dirty;
  }, [dirty]);
  useEffect(() => {
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      if (!dirtyRef.current) return;
      e.preventDefault();
      e.returnValue = "";
    };
    const onClick = (e: MouseEvent) => {
      if (!dirtyRef.current || e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      const a = (e.target as Element | null)?.closest?.("a[href]") as HTMLAnchorElement | null;
      if (!a || a.target === "_blank" || a.hasAttribute("download")) return;
      const url = new URL(a.href, window.location.href);
      // Same-page anchors (#public-actions) don't leave the edits.
      if (url.origin === window.location.origin && url.pathname === window.location.pathname && url.search === window.location.search) return;
      if (window.confirm(UNSAVED_CHANGES_MESSAGE)) dirtyRef.current = false;
      else {
        e.preventDefault();
        e.stopPropagation();
      }
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    document.addEventListener("click", onClick, true);
    return () => {
      window.removeEventListener("beforeunload", onBeforeUnload);
      document.removeEventListener("click", onClick, true);
    };
  }, []);
}

/** Drop inside any server-rendered <form>: it becomes dirty on the first edit
 * and clean again when submitted (the save itself navigates/refreshes). */
export default function UnsavedChangesGuard() {
  const ref = useRef<HTMLSpanElement>(null);
  const [dirty, setDirty] = useState(false);
  useEffect(() => {
    const form = ref.current?.closest("form");
    if (!form) return;
    const onEdit = () => setDirty(true);
    const onSubmit = () => setDirty(false);
    form.addEventListener("input", onEdit);
    form.addEventListener("change", onEdit);
    form.addEventListener("submit", onSubmit);
    return () => {
      form.removeEventListener("input", onEdit);
      form.removeEventListener("change", onEdit);
      form.removeEventListener("submit", onSubmit);
    };
  }, []);
  useUnsavedChangesGuard(dirty);
  return <span ref={ref} hidden aria-hidden="true" />;
}
