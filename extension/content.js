// extension/content.js
// Content script injected on tfulike pages.
// Listens for sync requests from the web app and relays them to the background service worker.

(() => {
  function postResponse(type, payload, requestId) {
    window.postMessage({ type, payload, requestId }, "*");
  }

  function getExtensionVersion() {
    try {
      return chrome.runtime.getManifest().version;
    } catch {
      return null;
    }
  }

  // Listen for messages from the web page
  window.addEventListener("message", (event) => {
    // Only accept messages from the same window
    if (event.source !== window) return;

    const { type, payload, requestId } = event.data || {};

    if (type === "TAPUJEMY_SYNC_REQUEST") {
      try {
        chrome.runtime.sendMessage(
          {
            type: "SYNC_LIKES",
            payload: payload,
          },
          (response) => {
            const runtimeError = chrome.runtime.lastError;
            if (runtimeError) {
                postResponse("TAPUJEMY_SYNC_RESPONSE", {
                  ok: false,
                  error: "Extension reloaded. Refresh the page and try sync again.",
                }, requestId);
                return;
              }

              postResponse(
                "TAPUJEMY_SYNC_RESPONSE",
                response || { ok: false, error: "Empty response from extension" },
                requestId
              );
            }
          );
        } catch {
        postResponse("TAPUJEMY_SYNC_RESPONSE", {
          ok: false,
          error: "Extension reloaded. Refresh the page and try sync again.",
        }, requestId);
        }
      }

    if (type === "TAPUJEMY_VIDEO_REFRESH_REQUEST") {
      try {
        chrome.runtime.sendMessage(
          {
            type: "VIDEO_REFRESH",
            payload: payload,
          },
          (response) => {
            const runtimeError = chrome.runtime.lastError;
            if (runtimeError) {
                postResponse("TAPUJEMY_VIDEO_REFRESH_RESPONSE", {
                  ok: false,
                  error: "Extension reloaded. Refresh the page and try again.",
                }, requestId);
                return;
              }

              postResponse(
                "TAPUJEMY_VIDEO_REFRESH_RESPONSE",
                response || { ok: false, error: "Empty response from extension" },
                requestId
              );
            }
          );
        } catch {
        postResponse("TAPUJEMY_VIDEO_REFRESH_RESPONSE", {
          ok: false,
          error: "Extension reloaded. Refresh the page and try again.",
        }, requestId);
        }
      }

    if (type === "TAPUJEMY_FETCH_VIDEO_DATA") {
      try {
        chrome.runtime.sendMessage(
          {
            type: "FETCH_VIDEO_DATA",
            payload: payload,
          },
          (response) => {
            const runtimeError = chrome.runtime.lastError;
            if (runtimeError) {
                postResponse("TAPUJEMY_VIDEO_DATA_RESPONSE", {
                  ok: false,
                  error: "Extension reloaded. Refresh the page and try again.",
                }, requestId);
                return;
              }

              postResponse(
                "TAPUJEMY_VIDEO_DATA_RESPONSE",
                response || { ok: false, error: "Empty response from extension" },
                requestId
              );
            }
          );
        } catch {
        postResponse("TAPUJEMY_VIDEO_DATA_RESPONSE", {
          ok: false,
          error: "Extension reloaded. Refresh the page and try again.",
        }, requestId);
        }
      }

    if (type === "TAPUJEMY_EXTENSION_CHECK") {
      const version = getExtensionVersion();
      if (version) {
        postResponse("TAPUJEMY_EXTENSION_PRESENT", { version });
      }
    }
  });

  // Announce that the extension content script is loaded
  const version = getExtensionVersion();
  if (version) {
    postResponse("TAPUJEMY_EXTENSION_PRESENT", { version });
  }
})();
