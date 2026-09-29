(function () {
  "use strict";

  // Findmi Embed Loader — Phase 1. Plain, dependency-free JS meant to run
  // on any external business website. Business-agnostic and slug-driven:
  // this file has no knowledge of any specific business — it only reads
  // whatever slug an embedding page supplies. Two jobs only:
  //   1. Auto-discovery — turn every element carrying data-findmi-business
  //      into a live Findmi widget iframe. The entire integration surface
  //      is meant to be this one attribute plus this one script tag, e.g.
  //      <div data-findmi-business="illy"></div>
  //      <script src="https://findmi.app/embed.js" async></script>
  //   2. Auto-resize — listen for a Findmi embed iframe reporting its own
  //      real rendered height (see BusinessEmbedWidget's findmi:resize
  //      postMessage) and apply it, so the host page never shows clipped
  //      content or leftover blank space. This also resizes a hand-
  //      authored raw <iframe src="https://findmi.app/embed/business/...">
  //      that didn't come from data-findmi-business — matching is done by
  //      the message's own event.source, not by how the iframe was built.
  //
  // Origin is derived from this script's own <script src> (never
  // hardcoded), so the exact same file works unmodified against
  // production, preview, or local environments.
  var ORIGIN = (function () {
    var script = document.currentScript;
    if (script && script.src) {
      try {
        return new URL(script.src).origin;
      } catch (e) {
        // fall through to the default below
      }
    }
    return "https://findmi.app";
  })();

  function buildIframe(slug) {
    var iframe = document.createElement("iframe");
    iframe.src = ORIGIN + "/embed/business/" + encodeURIComponent(slug);
    iframe.title = "Findmi";
    iframe.setAttribute("scrolling", "no");
    iframe.style.width = "100%";
    iframe.style.border = "0";
    iframe.style.display = "block";
    // A sensible starting height before the widget's own real height
    // arrives via postMessage, so the host page never briefly shows a
    // zero-height gap while the iframe loads.
    iframe.style.height = "420px";
    return iframe;
  }

  function init() {
    var hosts = document.querySelectorAll("[data-findmi-business]");
    for (var i = 0; i < hosts.length; i++) {
      var host = hosts[i];
      if (host.getAttribute("data-findmi-initialized") === "true") continue;
      var slug = host.getAttribute("data-findmi-business");
      if (!slug) continue;
      host.setAttribute("data-findmi-initialized", "true");
      host.appendChild(buildIframe(slug));
    }
  }

  window.addEventListener("message", function (event) {
    // Only ever trust a resize instruction from Findmi's own embed origin
    // — never blindly resize an iframe because of an unrelated postMessage
    // elsewhere on the host page.
    if (event.origin !== ORIGIN) return;
    var data = event.data;
    if (!data || data.type !== "findmi:resize" || typeof data.height !== "number") return;

    var iframes = document.getElementsByTagName("iframe");
    for (var i = 0; i < iframes.length; i++) {
      if (iframes[i].contentWindow === event.source) {
        var height = Math.max(1, Math.round(data.height));
        iframes[i].style.height = height + "px";
        break;
      }
    }
  });

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
