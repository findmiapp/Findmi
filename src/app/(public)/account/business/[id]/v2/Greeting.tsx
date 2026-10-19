"use client";

import { useEffect, useState } from "react";

/** Time-of-day greeting in the viewer's own local time (server render
 * can't know it), falling back to a neutral "Welcome back" until mounted
 * so server and client markup always match. */
export default function Greeting() {
  const [text, setText] = useState("Welcome Back");
  useEffect(() => {
    const h = new Date().getHours();
    // Title Case display copy, like every other heading.
    setText(h < 5 ? "Good Evening" : h < 12 ? "Good Morning" : h < 17 ? "Good Afternoon" : "Good Evening");
  }, []);
  return <h1 className="font-display text-page-title-lg font-bold text-primary">{text}</h1>;
}
