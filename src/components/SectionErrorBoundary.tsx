"use client";

import { Component, type ErrorInfo, type ReactNode } from "react";

/** Contains a client-side failure to ONE page section. Without it, any
 * exception thrown while rendering a client component (a malformed media
 * record, a map/gallery edge case) propagates to the root and Next.js
 * replaces the WHOLE page with "Application error: a client-side exception
 * has occurred" (2026-11-02 incident: Magnolia Bakery's Business page).
 * With it, the failing section renders `fallback` (nothing by default) and
 * the rest of the page keeps working. The error is still logged to the
 * console with the section name so it stays diagnosable. */
export default class SectionErrorBoundary extends Component<
  { name: string; fallback?: ReactNode; children: ReactNode },
  { failed: boolean }
> {
  state = { failed: false };

  static getDerivedStateFromError(): { failed: boolean } {
    return { failed: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error(`[Findmi] "${this.props.name}" section failed to render and was hidden.`, error, info.componentStack);
  }

  render() {
    return this.state.failed ? (this.props.fallback ?? null) : this.props.children;
  }
}
