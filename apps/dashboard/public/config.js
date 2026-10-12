/**
 * Boundia Runtime Node — runtime config for the static UI.
 *
 * The four pages + shell.js are served either by the local Express server
 * (same origin as the API) or by a static host such as Netlify, where the
 * real API lives on the Cloudflare Worker. Resolve the API base here once:
 *
 *   - localhost / 127.0.0.1 → same origin (Express server)
 *   - anything else         → the deployed Worker (freebuff.page site)
 *
 * Override without editing code by setting `window.BOUNDIA_API_BASE` BEFORE
 * this script runs (e.g. a Netlify edge/HTML injection).
 */
(function () {
  if (typeof window === "undefined") return;
  if (window.BOUNDIA_API_BASE !== undefined) return; // already set
  var host = window.location.hostname;
  var isLocal =
    host === "localhost" || host === "127.0.0.1" || host === "[::1]";
  window.BOUNDIA_API_BASE = isLocal
    ? ""
    : "https://site-0fee6695c459425e975f11c68ef7c2a5.freebuff.page";
})();
