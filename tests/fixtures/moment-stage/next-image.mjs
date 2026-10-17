// next/image stand-in: a plain <img>, so the rendered DOM shows exactly
// which thumbnails the editor produced.
import { createElement } from "react";
export default function Image({ src, alt, className }) {
  return createElement("img", { src, alt, className });
}
