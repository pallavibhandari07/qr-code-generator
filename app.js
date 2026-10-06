/*
 * app.js - page logic for the QR Link Generator.
 *
 * Flow:  enter link -> validate -> generate QR -> display -> (optional) download.
 * The QR encodes the user's validated link EXACTLY as typed (only surrounding
 * whitespace from copy/paste is trimmed). Nothing is sent to a server or stored.
 */
(function () {
  "use strict";

  // ---------- Elements ----------
  const form = document.getElementById("qr-form");
  const input = document.getElementById("url-input");
  const errorBox = document.getElementById("error-message");
  const errorText = document.getElementById("error-text");
  const suggestionBtn = document.getElementById("suggestion-btn");
  const placeholder = document.getElementById("placeholder");
  const result = document.getElementById("result");
  const canvas = document.getElementById("qr-canvas");
  const encodedUrl = document.getElementById("encoded-url");
  const downloadBtn = document.getElementById("download-btn");
  const resetBtn = document.getElementById("reset-btn");

  const MAX_URL_LENGTH = 2000;        // keeps the QR dense-but-scannable
  const DOWNLOAD_MIN_SIZE = 1024;     // PNG is at least this many pixels wide
  const PREVIEW_MIN_SIZE = 512;       // on-page canvas resolution (CSS scales it down)
  const QUIET_ZONE = 4;               // blank border (in modules) required by the QR spec

  let currentUrl = null;              // the URL the visible QR encodes

  // ---------- URL validation ----------

  const IPV4 = /^(25[0-5]|2[0-4]\d|1?\d?\d)(\.(25[0-5]|2[0-4]\d|1?\d?\d)){3}$/;
  const DOMAIN = /^([a-z0-9]([a-z0-9-]*[a-z0-9])?\.)+[a-z0-9-]{2,}$/i;

  /**
   * Checks whether `raw` is a usable http(s) link.
   * Returns { ok: true, url } or { ok: false, message, suggestion? }.
   *  - Rejects empty input, plain words ("hello", "google"), numbers ("12345"),
   *    other schemes (ftp:, javascript:), spaces, and malformed URLs.
   *  - The URL is never rewritten. If it only lacks "https://", we offer a
   *    one-click suggestion instead of silently changing it.
   */
  function validateUrl(raw, allowSuggestion) {
    const value = raw.trim();
    const invalid = (extra) => ({ ok: false, message: "Please enter a valid URL.", detail: extra });

    if (!value) return invalid("Paste a link that starts with http:// or https://");

    if (value.length > MAX_URL_LENGTH) {
      return {
        ok: false,
        message: "That link is too long.",
        detail: "Links can be up to " + MAX_URL_LENGTH.toLocaleString() + " characters.",
      };
    }

    // Spaces or control characters can never be part of a valid URL.
    if (/[\s\u0000-\u001f\u007f]/.test(value)) return invalid("Links can't contain spaces.");

    // Must literally start with http:// or https:// (checked on the raw text,
    // because new URL() is lenient and would accept things like "https:/x.com").
    if (!/^https?:\/\//i.test(value)) {
      const out = invalid("Links must start with http:// or https://");
      // "google.com/path" is probably a real link missing its protocol: suggest the fix.
      if (allowSuggestion && /^[^\s/?#:]+\.[^\s/?#:]{2,}([/?#]\S*)?$/.test(value)) {
        const candidate = "https://" + value;
        if (validateUrl(candidate, false).ok) out.suggestion = candidate;
      }
      return out;
    }

    // Let the browser's own parser confirm the structure.
    let parsed;
    try {
      parsed = new URL(value);
    } catch (e) {
      return invalid("That doesn't look like a complete web address.");
    }

    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return invalid();

    // The host must be a real-looking domain, localhost, or an IP address.
    // This is what rejects "https://google" and "https://".
    const host = parsed.hostname;
    const hostOk =
      host === "localhost" ||
      IPV4.test(host) ||
      (host.startsWith("[") && host.endsWith("]")) || // IPv6
      DOMAIN.test(host);
    if (!hostOk) return invalid("The web address needs a domain such as example.com.");

    return { ok: true, url: value };
  }

  // ---------- QR generation & drawing ----------

  /**
   * Draws a QR matrix onto a canvas using whole-pixel squares (crisp, scannable).
   * `minSize` is the minimum canvas width/height in pixels.
   */
  function drawQr(targetCanvas, matrix, minSize) {
    const modules = matrix.length;
    const total = modules + QUIET_ZONE * 2;
    const scale = Math.max(1, Math.ceil(minSize / total));
    const size = total * scale;

    targetCanvas.width = size;
    targetCanvas.height = size;
    const ctx = targetCanvas.getContext("2d");

    ctx.fillStyle = "#ffffff";                 // light background + quiet zone
    ctx.fillRect(0, 0, size, size);
    ctx.fillStyle = "#000000";                 // dark modules
    for (let y = 0; y < modules; y++) {
      for (let x = 0; x < modules; x++) {
        if (matrix[y][x]) {
          ctx.fillRect((x + QUIET_ZONE) * scale, (y + QUIET_ZONE) * scale, scale, scale);
        }
      }
    }
  }

  /** Generates the QR for `url` (exactly as given) and shows it. */
  function showQr(url) {
    // QREncoder.encode stores the string as-is: no shortening, no rewriting.
    const matrix = window.QREncoder.encode(url);
    drawQr(canvas, matrix, PREVIEW_MIN_SIZE);

    currentUrl = url;
    encodedUrl.textContent = url;     // textContent: the URL is never interpreted as HTML
    canvas.setAttribute("aria-label", "QR code for " + url);
    placeholder.hidden = true;
    result.hidden = false;
  }

  // ---------- Error display ----------

  function showError(message, detail, suggestion) {
    errorText.textContent = message + (detail ? " " + detail : "");
    if (suggestion) {
      suggestionBtn.textContent = "Use " + suggestion + "?";
      suggestionBtn.dataset.value = suggestion;
      suggestionBtn.hidden = false;
    } else {
      suggestionBtn.hidden = true;
      delete suggestionBtn.dataset.value;
    }
    errorBox.hidden = false;
    input.classList.add("is-invalid");
    input.setAttribute("aria-invalid", "true");
  }

  function clearError() {
    errorBox.hidden = true;
    suggestionBtn.hidden = true;
    input.classList.remove("is-invalid");
    input.removeAttribute("aria-invalid");
  }

  // ---------- Submit handling ----------

  function handleGenerate() {
    clearError();
    const check = validateUrl(input.value, true);

    if (!check.ok) {
      // Invalid input: show the error and do NOT produce a QR code.
      // Any QR from an earlier valid link is hidden so it can't be mistaken for this input.
      showReset();
      showError(check.message, check.detail, check.suggestion);
      return;
    }

    try {
      showQr(check.url);
    } catch (err) {
      showReset();
      if (err && err.code === "TOO_LONG") {
        showError("That link is too long to fit in a QR code.", "Try a shorter link.");
      } else {
        showError("Something went wrong while generating the QR code.", "Please try again.");
        console.error(err);
      }
    }
  }

  function showReset() {
    currentUrl = null;
    result.hidden = true;
    placeholder.hidden = false;
  }

  form.addEventListener("submit", function (event) {
    event.preventDefault();       // stay on the page; everything happens client-side
    handleGenerate();
  });

  input.addEventListener("input", clearError);

  suggestionBtn.addEventListener("click", function () {
    input.value = suggestionBtn.dataset.value || input.value;
    handleGenerate();
  });

  resetBtn.addEventListener("click", function () {
    input.value = "";
    clearError();
    showReset();
    input.focus();
  });

  // ---------- Download ----------

  /** Saves the displayed QR as qr-code.png (re-rendered large for sharp printing). */
  downloadBtn.addEventListener("click", async function () {
    if (!currentUrl) return;

    try {
      const big = document.createElement("canvas");
      drawQr(big, window.QREncoder.encode(currentUrl), DOWNLOAD_MIN_SIZE);

      // Turn the canvas into a PNG file (Blob).
      const blob = await new Promise(function (resolve) { big.toBlob(resolve, "image/png"); });
      if (!blob) throw new Error("PNG export failed");

      // Inside the claude.ai preview, plain download links are blocked, so ask the
      // viewer's save capability instead. On a normal page this is simply skipped.
      let saver = null;
      if (window.claude && typeof window.claude.use === "function") {
        try { saver = await window.claude.use("downloads"); } catch (e) { saver = null; }
      }
      if (saver) {
        try {
          await saver.save({ filename: "qr-code.png", data: blob });
        } catch (e) {
          if (!e || e.code !== "declined") showError("Couldn't download the QR code.", "Please try again.");
        }
        return;
      }

      // Normal browsers: a temporary link with the download attribute saves the PNG.
      const href = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = href;
      a.download = "qr-code.png";
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(function () { URL.revokeObjectURL(href); }, 1000);
    } catch (err) {
      showError("Couldn't download the QR code.", "Please try again.");
      console.error(err);
    }
  });
})();
