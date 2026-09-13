/* Strip only a complete leading metadata block; keep the source file intact. */
(function () {
  function body(text) {
    return String(text).replace(/^\uFEFF?---[ \t]*\r?\n[\s\S]*?\r?\n(?:---|\.\.\.)[ \t]*(?:\r?\n|$)/, "");
  }
  window.WBMarkdown = { body };
})();
