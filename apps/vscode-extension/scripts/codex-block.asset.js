(function () {
  "use strict";
  try {
    if (typeof window !== "undefined" && window.__runtimeadsCodexBoot) {
      return undefined;
    }
    if (typeof window !== "undefined") {
      window.__runtimeadsCodexBoot = 1;
    }
  } catch (e) {
    return undefined;
  }

  try {
    var BRAND = __RUNTIMEADS_BRAND__;
    var HEADLINE = __RUNTIMEADS_HEADLINE__;
    var ICON_URL = __RUNTIMEADS_ICON_URL__;
    var CLICK_URL = __RUNTIMEADS_CLICK_URL__;
    var ALLOCATION_ID = __RUNTIMEADS_ALLOCATION_ID__;
    var BASE = __RUNTIMEADS_LOOPBACK_BASE__;
    var AD_TEXT = BRAND + " — " + HEADLINE;
    var GRACE_MS = 1500;
    var VIEW_THRESHOLD_MS = 5000;

    function esc(s) {
      return String(s).replace(/[&<>"]/g, function (c) {
        return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c];
      });
    }

    function ell(f) {
      return ["", " .", " ..", " ..."][f % 4];
    }

    function elp(ms) {
      return (ms / 1000).toFixed(1) + "s";
    }

    function ping(kind, body) {
      try {
        fetch(BASE + "/" + kind, {
          method: "POST",
          keepalive: true,
          headers: { "content-type": "application/json" },
          body: JSON.stringify(
            body || {
              allocation_id: ALLOCATION_ID,
              surface: "codex_overlay",
            },
          ),
        }).catch(function () {});
      } catch (e) {}
    }

    var FG = "var(--vscode-foreground,currentColor)";
    var DIM = "var(--vscode-descriptionForeground,currentColor)";
    var ICON_FALLBACK =
      '<span aria-hidden="true" style="color:' + FG + ';font-weight:700;flex:0 0 auto">◆</span>';

    function faviconHtml() {
      if (!ICON_URL) {
        return ICON_FALLBACK;
      }
      return (
        '<img src="' +
        esc(ICON_URL) +
        '" width="13" height="13" data-runtimeads-icon="1" aria-hidden="true" ' +
        'style="vertical-align:middle;border-radius:3px;flex:0 0 auto;' +
        'display:block;object-fit:contain" />'
      );
    }

    function buildAdHtml(opts) {
      var href = /^https?:\/\//i.test(opts.href || "") ? esc(opts.href) : "#";
      var adText = opts.text || AD_TEXT;
      var link =
        '<a href="' +
        href +
        '" target="_blank" rel="noopener noreferrer" data-runtimeads-ad="1" ' +
        'style="display:inline-flex;align-items:center;gap:7px;color:' +
        FG +
        ';text-decoration:underline;overflow:hidden;text-overflow:ellipsis;min-width:0;cursor:pointer">' +
        faviconHtml() +
        esc(adText) +
        '<span data-runtimeads-dots="1" style="display:inline-block;width:3ch;text-align:left;white-space:pre">' +
        esc(opts.dots || "") +
        "</span></a>";
      var left =
        '<span style="display:flex;align-items:center;gap:7px;color:' +
        FG +
        ';min-width:0">' +
        link +
        "</span>";
      var right =
        '<span data-runtimeads-elapsed="1" style="font-size:11px;color:' +
        DIM +
        ";flex:0 0 auto;margin-left:auto;padding-left:24px;" +
        'font-variant-numeric:tabular-nums">' +
        esc(opts.elapsed || "") +
        "</span>";
      return (
        // data-runtimeads-ad on the outer row makes the WHOLE bar clickable (TD-028), not just the
        // link text.
        '<span data-runtimeads-ad="1" style="display:flex;align-items:center;width:100%;' +
        'box-sizing:border-box;padding:0 4px;justify-content:flex-start;white-space:nowrap;' +
        'cursor:pointer">' +
        left +
        right +
        "</span>"
      );
    }

    function findRow() {
      var selectors = ['[class*="loading-shimmer-pure-text"]', '[class*="loading-shimmer"]'];
      for (var s = 0; s < selectors.length; s++) {
        var els = document.querySelectorAll(selectors[s]);
        for (var i = 0; i < els.length; i++) {
          var el = els[i];
          if (el.nodeType !== 1) continue;
          var rect = el.getBoundingClientRect && el.getBoundingClientRect();
          if (!rect || (!rect.width && !rect.height)) continue;
          try {
            var cs = window.getComputedStyle && window.getComputedStyle(el);
            if (cs) {
              if (cs.visibility === "hidden" || cs.display === "none") continue;
              if (parseFloat(cs.opacity || "1") < 0.05) continue;
            }
          } catch (e) {}
          return el;
        }
      }
      return null;
    }

    function isThinkingRow(el) {
      if (!el) return false;
      var classes = " " + (el.className || "") + " ";
      // Codex 26.609 thinking rows use this class; text can be empty/transient.
      if (classes.indexOf("loading-shimmer-pure-text") !== -1) {
        return true;
      }
      var text = (el.textContent || "").trim();
      if (!text) return false;
      var lower = text.toLowerCase();
      return lower.length <= 32 && lower.indexOf("thinking") === 0;
    }

    function surfaceBg(el) {
      try {
        var node = el;
        var hops = 0;
        while (node && node.nodeType === 1 && hops++ < 20) {
          var cs = window.getComputedStyle(node) || {};
          var overflow = cs.overflowY || cs.overflow;
          if (overflow === "auto" || overflow === "scroll") {
            var bg = cs.backgroundColor;
            if (bg && bg !== "transparent" && bg !== "rgba(0, 0, 0, 0)") {
              return bg;
            }
            break;
          }
          node = node.parentElement;
        }
        var bodyBg = (window.getComputedStyle(document.body) || {}).backgroundColor;
        if (bodyBg && bodyBg !== "transparent" && bodyBg !== "rgba(0, 0, 0, 0)") {
          return bodyBg;
        }
      } catch (e) {}
      return "var(--vscode-sideBar-background,var(--vscode-editor-background,#1e1e1e))";
    }

    function openAdLink(allocationId, surface) {
      try {
        fetch(
          BASE +
            "/open?allocation_id=" +
            encodeURIComponent(allocationId || ALLOCATION_ID) +
            "&surface=" +
            encodeURIComponent(surface || "codex_overlay"),
          { method: "GET", keepalive: true },
        ).catch(function () {
          // Loopback unreachable — still navigate using the destination we have (TD-028).
          try {
            if (CLICK_URL && /^https?:\/\//i.test(CLICK_URL)) {
              window.open(CLICK_URL, "_blank", "noopener");
            }
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
            openAdLink(ALLOCATION_ID, "codex_overlay");
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
          var target = ev && ev.target;
          if (
            target &&
            target.tagName === "IMG" &&
            target.getAttribute &&
            target.getAttribute("data-runtimeads-icon") === "1"
          ) {
            target.outerHTML = ICON_FALLBACK;
          }
        } catch (e) {}
      },
      true,
    );

    var overlay = null;
    var lastRow = null;
    var lastSeenMs = 0;
    var _rect = "";
    var t0 = 0;
    var frameN = 0;
    var _noServe = false;
    var _adEmptyPolls = 0;
    var viewSession = null;
    var _chromeSig = "";
    var _dotsEl = null;
    var _elapsedEl = null;

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
        allocation_id: ALLOCATION_ID,
        surface: "codex_overlay",
        visible_ms: elapsed,
      });
    }

    function ensureOverlay(row) {
      if (overlay && overlay.parentNode) {
        return overlay;
      }
      overlay = document.createElement("div");
      overlay.setAttribute("data-runtimeads-overlay", "codex");
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

    function placeOverlay(row) {
      try {
        var rect = row.getBoundingClientRect();
        if (rect && (rect.width || rect.height || rect.top || rect.left)) {
          var key = rect.left + "," + rect.top + "," + rect.width + "," + rect.height;
          if (key !== _rect) {
            _rect = key;
            overlay.style.left = rect.left + "px";
            overlay.style.top = rect.top + "px";
            overlay.style.minWidth = rect.width + "px";
            overlay.style.height = rect.height + "px";
            overlay.style.visibility = "visible";
            overlay.style.background = surfaceBg(row);
          }
        }
      } catch (e) {}
    }

    function dropOverlay() {
      try {
        if (overlay && overlay.parentNode) {
          overlay.parentNode.removeChild(overlay);
        }
      } catch (e) {}
      overlay = null;
      lastRow = null;
      _rect = "";
      t0 = 0;
      frameN = 0;
      _chromeSig = "";
      _dotsEl = null;
      _elapsedEl = null;
      viewEnd();
    }

    function paint(row) {
      var now = Date.now();
      if (!t0) {
        t0 = now;
      }
      lastRow = row;
      lastSeenMs = now;
      frameN++;
      viewEnsure();
      viewMaybeRecordImpression();
      var node = ensureOverlay(row);
      placeOverlay(row);
      var sig = BRAND + "|" + HEADLINE + "|" + CLICK_URL + "|" + ICON_URL + "|" + AD_TEXT;
      var dots = ell(Math.floor(frameN / 3));
      var elapsed = elp(now - t0);
      if (sig !== _chromeSig) {
        node.innerHTML = buildAdHtml({
          href: CLICK_URL,
          text: AD_TEXT,
          dots: dots,
          elapsed: elapsed,
        });
        _chromeSig = sig;
        _dotsEl = node.querySelector("[data-runtimeads-dots]");
        _elapsedEl = node.querySelector("[data-runtimeads-elapsed]");
      } else {
        if (_dotsEl) {
          _dotsEl.textContent = dots;
        }
        if (_elapsedEl) {
          _elapsedEl.textContent = elapsed;
        }
      }
    }

    function frame() {
      try {
        if (overlay && lastRow && lastRow.isConnected) {
          placeOverlay(lastRow);
        }
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

    function pollAd() {
      try {
        fetch(BASE + "/ad")
          .then(function (r) {
            return r.json();
          })
          .then(function (payload) {
            if (!payload || payload.serve === false || !payload.allocation_id) {
              _adEmptyPolls++;
              if (_adEmptyPolls >= 2 && !_noServe) {
                _noServe = true;
                dropOverlay();
              }
              return;
            }
            _adEmptyPolls = 0;
            _noServe = false;
            var nextText = (payload.brand || BRAND) + " — " + (payload.headline || HEADLINE);
            var changed =
              payload.allocation_id !== ALLOCATION_ID ||
              nextText !== AD_TEXT ||
              (payload.click_url || CLICK_URL) !== CLICK_URL ||
              (payload.icon_url || ICON_URL) !== ICON_URL;
            if (!changed) {
              return;
            }
            ALLOCATION_ID = payload.allocation_id;
            BRAND = payload.brand || BRAND;
            HEADLINE = payload.headline || HEADLINE;
            CLICK_URL = payload.click_url || CLICK_URL;
            ICON_URL = payload.icon_url || ICON_URL;
            AD_TEXT = nextText;
            _chromeSig = "";
            viewEnd();
          })
          .catch(function () {});
      } catch (e) {}
    }

    setInterval(pollAd, 10000);
    setTimeout(pollAd, 500);
    setInterval(viewMaybeRecordImpression, 250);

    setInterval(function () {
      try {
        var now = Date.now();
        var row = findRow();
        // Only render when we actually have an ad. The block is injected with empty "bootstrap"
        // content and only gets real text once /ad populates it; without this guard it paints an
        // empty bar (no allocation, or /serve unreachable). No ad → render nothing.
        var hasAd = !!(BRAND || HEADLINE || AD_TEXT);
        if (!_noServe && hasAd && row && isThinkingRow(row)) {
          paint(row);
        } else if (overlay && (now - lastSeenMs > GRACE_MS || !hasAd)) {
          dropOverlay();
        }
      } catch (e) {}
    }, 80);
  } catch (e) {}

  return undefined;
})
