// next/dynamic stand-in: the "dynamically imported" map canvas becomes a
// plain element that records the props MapExplorer passes it.
import { createElement } from "react";
export default function dynamic() {
  return function FakeCanvas(props) {
    globalThis.__canvas = props;
    return createElement("div", { "data-fake-canvas": "1" });
  };
}
