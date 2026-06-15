/* RUNTIMEADS-START */
(function () {
  "use strict";
  var BRAND = __RUNTIMEADS_BRAND__;
  var HEADLINE = __RUNTIMEADS_HEADLINE__;
  var ICON_URL = __RUNTIMEADS_ICON_URL__;
  var CLICK_URL = __RUNTIMEADS_CLICK_URL__;
  var ALLOCATION_ID = __RUNTIMEADS_ALLOCATION_ID__;
  var BASE = __RUNTIMEADS_LOOPBACK_BASE__;

  var SPINNER_BLUE = "#60A5FA";
  var SPINNER_BLUE_DIM = "#93C5FD";
  var GRACE_MS = 1500;
  var VIEW_THRESHOLD_MS = 5000;

  function esc(s) {
    return String(s).replace(/[&<>"]/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c];
    });
  }

  function ellipsis(frame) {
    return ["", " .", " ..", " ...", " ....", " ....."][frame % 6];
  }

  function fmtElapsed(ms) {
    return (ms / 1000).toFixed(1) + "s";
  }

  function faviconImg(url) {
    return (
      '<img src="' +
      esc(url) +
      '" width="14" height="14" data-runtimeads-icon="1" ' +
      'aria-hidden="true" style="vertical-align:middle;border-radius:3px;flex:0 0 auto;' +
      "display:block;object-fit:contain;image-rendering:-webkit-optimize-contrast;" +
      'image-rendering:crisp-edges" />'
    );
  }

  var ICON_FALLBACK =
    '<span aria-hidden="true" style="color:' + SPINNER_BLUE + ';font-weight:700">◆</span>';

  function buildAdHtml(opts) {
    var icon = opts.iconUrl ? faviconImg(opts.iconUrl) : ICON_FALLBACK;
    var brand = '<span style="color:' + SPINNER_BLUE + '">' + esc(opts.brand) + "</span>";
    var headline =
      '<span style="color:' + SPINNER_BLUE_DIM + '"> — ' + esc(opts.headline) + "</span>";
    var href = opts.href ? esc(opts.href) : "#";
    var dots = esc(opts.dots || "");
    var elapsed = esc(opts.elapsed || "");
    return (
      // data-runtimeads-ad on the outer row makes the WHOLE bar clickable (icon, timer, padding),
      // not just the link text (TD-028).
      '<span data-runtimeads-ad="1" style="display:flex;align-items:center;width:100%;' +
      "box-sizing:border-box;padding:0 32px;justify-content:flex-start;white-space:nowrap;" +
      'gap:7px;cursor:pointer">' +
      icon +
      '<a href="' +
      href +
      '" target="_blank" rel="noopener noreferrer" data-runtimeads-ad="1" ' +
      'style="color:' +
      SPINNER_BLUE +
      ";text-decoration:underline;overflow:hidden;" +
      'text-overflow:ellipsis;min-width:0">' +
      brand +
      headline +
      '<span data-runtimeads-dots="1" style="display:inline-block;width:3ch;text-align:left;' +
      'white-space:pre">' +
      dots +
      "</span></a>" +
      '<span data-runtimeads-elapsed="1" style="font-size:11px;color:var(--vscode-descriptionForeground,' +
      'currentColor);flex:0 0 auto;margin-left:auto;padding-left:24px;font-variant-numeric:tabular-nums">' +
      elapsed +
      "</span></span>"
    );
  }

  if (typeof module !== "undefined" && module.exports) {
    module.exports = { buildAdHtml: buildAdHtml, esc: esc };
    return;
  }

  try {
    var st = { simStart: 0, frame: 0 };
    var viewSession = null;
    var overlay = null;
    var lastNode = null;
    var lastSeenMs = 0;
    var lastSig = null;
    var lastSigMs = 0;
    var _chromeSig = "";
    var _dotsEl = null;
    var _elapsedEl = null;
    var _noServe = false;
    var ad = {
      brand: BRAND,
      headline: HEADLINE,
      iconUrl: ICON_URL,
      clickUrl: CLICK_URL,
      allocationId: ALLOCATION_ID,
    };

    function pollServe() {
      try {
        fetch(BASE + "/serve")
          .then(function (r) {
            return r.json();
          })
          .then(function (j) {
            if (!j || j.serve === false) {
              if (!_noServe) {
                _noServe = true;
                dropOverlay();
                st.sentImpression = false;
              }
              return;
            }
            _noServe = false;
          })
          .catch(function () {});
      } catch (e) {}
    }

    function pollAd() {
      try {
        fetch(BASE + "/ad")
          .then(function (r) {
            return r.json();
          })
          .then(function (j) {
            if (!j || !j.serve || !j.allocation_id) {
              return;
            }
            var changed = j.allocation_id !== ad.allocationId;
            ad.brand = j.brand || ad.brand;
            ad.headline = j.headline || ad.headline;
            ad.iconUrl = j.icon_url || ad.iconUrl;
            ad.clickUrl = j.click_url || ad.clickUrl;
            ad.allocationId = j.allocation_id;
            if (changed) {
              viewSession = null;
              _chromeSig = "";
            }
          })
          .catch(function () {});
      } catch (e) {}
    }

    function ping(kind, body) {
      try {
        fetch(BASE + "/" + kind, {
          method: "POST",
          keepalive: true,
          headers: { "content-type": "application/json" },
          body: JSON.stringify(
            body || {
              allocation_id: ad.allocationId,
              surface: "claude_overlay",
            },
          ),
        }).catch(function () {});
      } catch (e) {}
    }

    function viewEnsure() {
      if (viewSession) {
        return;
      }
      viewSession = {
        startedAt: Date.now(),
        pausedAt: 0,
        paused: false,
        thresholdMet: false,
      };
    }

    function viewEnd() {
      viewSession = null;
    }

    function viewElapsedMs() {
      if (!viewSession) {
        return 0;
      }
      var hidden = false;
      try {
        hidden = typeof document.hidden === "boolean" && document.hidden;
      } catch (e) {}
      if (hidden) {
        if (!viewSession.paused) {
          viewSession.paused = true;
          viewSession.pausedAt = Date.now();
        }
        return 0;
      }
      if (viewSession.paused) {
        viewSession.startedAt += Math.max(0, Date.now() - viewSession.pausedAt);
        viewSession.paused = false;
        viewSession.pausedAt = 0;
      }
      return Math.max(0, Date.now() - viewSession.startedAt);
    }

    function viewMaybeRecordImpression() {
      if (!viewSession || viewSession.thresholdMet) {
        return;
      }
      var elapsed = viewElapsedMs();
      if (elapsed < VIEW_THRESHOLD_MS) {
        return;
      }
      viewSession.thresholdMet = true;
      ping("impression", {
        allocation_id: ad.allocationId,
        surface: "claude_overlay",
        visible_ms: elapsed,
      });
    }

    function findSpinner() {
      var els = document.querySelectorAll('[class*="spinnerRow_"]');
      var last = null;
      for (var i = 0; i < els.length; i++) {
        if (els[i].nodeType !== 1) continue;
        if ((els[i].textContent || "").trim() !== "") last = els[i];
      }
      return last;
    }

    function rowActive(row) {
      if (!row) return false;
      var t = (row.textContent || "").replace(/^[\s ]+/, "");
      var c = t.charCodeAt(0);
      return c === 0x2722 || c === 0x2736 || c === 0x273b || c === 0x273d;
    }

    function surfaceBg(el) {
      try {
        var n = el,
          hops = 0;
        while (n && n.nodeType === 1 && hops++ < 10) {
          var bg = (window.getComputedStyle(n) || {}).backgroundColor;
          if (bg && bg !== "transparent" && bg !== "rgba(0, 0, 0, 0)") return bg;
          n = n.parentElement;
        }
      } catch (e) {}
      return "var(--vscode-editor-background,#1e1e1e)";
    }

    function ensureOverlay(row) {
      if (overlay && overlay.parentNode) return overlay;
      overlay = document.createElement("div");
      overlay.setAttribute("data-runtimeads-overlay", "1");
      // z-index:1 keeps the overlay above in-flow transcript content but below the
      // message composer (and other positive-z app chrome) so it never covers the input.
      overlay.style.cssText =
        "position:fixed;z-index:1;pointer-events:auto;display:flex;" +
        "align-items:center;box-sizing:border-box;overflow:hidden;white-space:nowrap;" +
        "visibility:hidden;background:" +
        surfaceBg(row);
      try {
        (document.body || document.documentElement).appendChild(overlay);
      } catch (e) {}
      return overlay;
    }

    var _rect = "";
    function placeOverlay(row) {
      try {
        var r = row.getBoundingClientRect();
        if (r && (r.width || r.height || r.top || r.left)) {
          var key = r.left + "," + r.top + "," + r.width + "," + r.height;
          if (key !== _rect) {
            _rect = key;
            overlay.style.left = r.left + "px";
            overlay.style.top = r.top + "px";
            overlay.style.minWidth = r.width + "px";
            overlay.style.height = r.height + "px";
            overlay.style.visibility = "visible";
          }
        }
      } catch (e) {}
    }

    function dropOverlay() {
      try {
        if (overlay && overlay.parentNode) overlay.parentNode.removeChild(overlay);
      } catch (e) {}
      overlay = null;
      _rect = "";
      lastNode = null;
      st.simStart = 0;
      _chromeSig = "";
      _dotsEl = null;
      _elapsedEl = null;
      viewEnd();
    }

    function paint(row, anim) {
      var now = Date.now();
      lastNode = row;
      lastSeenMs = now;
      if (anim) st.frame++;
      if (!st.simStart) st.simStart = now;
      viewEnsure();
      viewMaybeRecordImpression();
      var o = ensureOverlay(row);
      placeOverlay(row);
      var sig = ad.brand + "|" + ad.headline + "|" + ad.clickUrl + "|" + ad.iconUrl;
      var dots = ellipsis(st.frame);
      var elapsed = fmtElapsed(now - st.simStart);
      if (sig !== _chromeSig) {
        o.innerHTML = buildAdHtml({
          brand: ad.brand,
          headline: ad.headline,
          iconUrl: ad.iconUrl,
          href: ad.clickUrl,
          dots: dots,
          elapsed: elapsed,
        });
        _chromeSig = sig;
        _dotsEl = o.querySelector("[data-runtimeads-dots]");
        _elapsedEl = o.querySelector("[data-runtimeads-elapsed]");
      } else {
        if (_dotsEl) _dotsEl.textContent = dots;
        if (_elapsedEl) _elapsedEl.textContent = elapsed;
      }
    }

    function openAdLink(allocationId, surface) {
      try {
        fetch(
          BASE +
            "/open?allocation_id=" +
            encodeURIComponent(allocationId || ad.allocationId) +
            "&surface=" +
            encodeURIComponent(surface || "claude_overlay"),
          { method: "GET", keepalive: true },
        ).catch(function () {
          // Loopback unreachable (e.g. stale endpoint) — still navigate using the destination
          // we already have, so the click never silently no-ops (TD-028).
          try {
            if (ad.clickUrl) window.open(ad.clickUrl, "_blank", "noopener");
          } catch (e) {}
        });
      } catch (e) {}
    }

    document.addEventListener(
      "click",
      function (ev) {
        var el = ev.target;
        while (el && el !== document) {
          if (el.getAttribute && el.getAttribute("data-runtimeads-ad")) {
            try {
              ev.preventDefault();
              ev.stopPropagation();
            } catch (e) {}
            openAdLink(ad.allocationId, "claude_overlay");
            return;
          }
          el = el.parentNode;
        }
      },
      true,
    );

    document.addEventListener(
      "error",
      function (ev) {
        try {
          var t = ev && ev.target;
          if (
            t &&
            t.tagName === "IMG" &&
            t.getAttribute &&
            t.getAttribute("data-runtimeads-icon") === "1"
          ) {
            t.outerHTML = ICON_FALLBACK;
          }
        } catch (e) {}
      },
      true,
    );

    function frame() {
      try {
        if (overlay && lastNode && lastNode.isConnected) placeOverlay(lastNode);
      } catch (e) {}
      try {
        window.requestAnimationFrame(frame);
      } catch (e) {
        setTimeout(frame, 16);
      }
    }
    try {
      window.requestAnimationFrame(frame);
    } catch (e) {
      setTimeout(frame, 16);
    }

    function evaluate() {
      try {
        var now = Date.now();
        var row = findSpinner();
        if (row) {
          var t = (row.textContent || "").replace(/^[\s ]+/, "");
          var cc = t.charCodeAt(0) | 0;
          if (cc !== lastSig) {
            lastSig = cc;
            lastSigMs = now;
          }
        } else {
          lastSig = null;
        }
        var glyphLed = !!(row && rowActive(row));
        var fresh = glyphLed && lastSigMs > 0 && now - lastSigMs <= GRACE_MS;
        // Only render when we actually have an ad to show. The block is injected with empty
        // "bootstrap" content and only gets real text once /ad populates it; without this guard
        // it would paint an empty bar (no allocation, or /serve unreachable). No ad → nothing.
        var hasAd = !!(ad.brand || ad.headline);
        if (!_noServe && hasAd && glyphLed && fresh) {
          paint(row, true);
        } else if (
          overlay &&
          (now - lastSeenMs > GRACE_MS || (glyphLed && !fresh) || _noServe || !hasAd)
        ) {
          dropOverlay();
        }
      } catch (e) {}
    }

    setInterval(pollServe, 2000);
    setTimeout(pollServe, 400);
    setInterval(pollAd, 10000);
    setTimeout(pollAd, 500);
    setInterval(viewMaybeRecordImpression, 250);
    setInterval(evaluate, 80);
    try {
      document.addEventListener(
        "visibilitychange",
        function () {
          if (!document.hidden) evaluate();
        },
        false,
      );
    } catch (e) {}
  } catch (e) {}
})();
/* RUNTIMEADS-END */
