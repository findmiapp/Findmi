"use client";

import { useEffect, useState } from "react";

/** Time-of-day greeting in the viewer's own local time (server render
 * can't know it), falling back to a neutral "Welcome back" until mounted
 * so server and client markup always match. */
export default function Greeting() {
  const [text, setText] = useState("Welcome back");
  useEffect(() => {
    const h = new Date().getHours();
    setText(h < 5 ? "Good evening" : h < 12 ? "Good morning" : h < 17 ? "Good afternoon" : "Good evening");
  }, []);
  return <h1 className="font-display text-page-title-lg font-bold text-primary">{text}</h1>;
}
