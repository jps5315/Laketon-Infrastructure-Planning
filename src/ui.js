/**
 * ui.js — Panel and report utilities
 *
 * PHASE 3: Expanded from a single updateReport() to a set of state-aware
 * helpers so every async operation in the app has a consistent visual state.
 *
 * WHY centralise UI state here?
 * main.js and analysis.js both write to the panel. Without a shared contract
 * for what "loading", "error", and "success" look like, each caller invents
 * its own HTML and the panel becomes inconsistent. These helpers enforce one
 * visual language across the whole app.
 */

define([], function () {

  /**
   * updateReport — writes arbitrary HTML into the report panel.
   * Use this for rich content (analysis results, feature lists).
   * @param {string} html
   */
  function updateReport(html) {
    var el = document.getElementById("report");
    if (el) el.innerHTML = html;
  }

  /**
   * setLoading — shows a spinner message while an async operation runs.
   * Replaces the panel content with a neutral "working" state.
   * @param {string} message
   */
  function setLoading(message) {
    var el = document.getElementById("report");
    if (el) {
      el.innerHTML =
        "<span style='color:#7ec8e3'>⏳ " + (message || "Loading…") + "</span>";
    }
  }

  /**
   * showError — shows a visible, recoverable error in the panel.
   * Always includes the raw error message so it's debuggable.
   * @param {string} context   — where the error happened ("Layer load", "Analysis")
   * @param {Error|string} err — the caught error object or message string
   * @param {string} [hint]    — optional plain-english recovery hint
   */
  function showError(context, err, hint) {
    var el = document.getElementById("report");
    if (!el) return;

    var msg = (err && err.message) ? err.message : String(err);
    var hintHtml = hint
      ? "<br><em style='color:#8899aa'>" + hint + "</em>"
      : "";

    el.innerHTML =
      "<strong style='color:#ff6b6b'>⚠ " + context + " failed</strong><br>" +
      "<span style='color:#aabbcc'>" + msg + "</span>" +
      hintHtml;
  }

  /**
   * showSuccess — brief confirmation after a write operation (e.g. applyEdits).
   * @param {string} message
   */
  function showSuccess(message) {
    var el = document.getElementById("report");
    if (el) {
      el.innerHTML =
        "<strong style='color:#50c878'>✓ " + message + "</strong>";
    }
  }

  return {
    updateReport: updateReport,
    setLoading:   setLoading,
    showError:    showError,
    showSuccess:  showSuccess,
  };
});
