/* Workbench 1.4: navigation never filters the Markdown document. */
(function () {
  "use strict";
  function headings(container) {
    return Array.from(container.querySelectorAll("h2,h3")).map(
      (node, index) => ({
        node,
        id: "by-heading-" + (index + 1),
        title: node.textContent.trim(),
        level: Number(node.tagName.slice(1)),
      }),
    );
  }
  function outline(md) {
    const template = document.createElement("template");
    template.innerHTML = window.marked.parse(window.WBMarkdown.body(md));
    return headings(template.content).map(({ id, title, level }) => ({
      id,
      title,
      level,
    }));
  }
  function mount(article, query) {
    document.getElementById("readerToc")?.remove();
    const entries = headings(article);
    entries.forEach((entry) => {
      entry.node.id = entry.id;
      entry.node.tabIndex = -1;
    });
    const top = document.querySelector(".top"),
      header = document.getElementById("readerStickyHeader");
    function measure() {
      const topHeight = top?.getBoundingClientRect().height || 0;
      const headerHeight = header?.getBoundingClientRect().height || 0;
      document.documentElement.style.setProperty(
        "--reader-top",
        topHeight + 8 + "px",
      );
      document.documentElement.style.setProperty(
        "--reader-offset",
        topHeight + headerHeight + 28 + "px",
      );
    }
    measure();
    if (window.ResizeObserver) {
      const observer = new ResizeObserver(measure);
      if (top) observer.observe(top);
      if (header) observer.observe(header);
    }
    function go(entry) {
      if (!entry || !article.contains(entry.node)) return;
      measure();
      entry.node.scrollIntoView({ block: "start", behavior: "instant" });
      entry.node.focus({ preventScroll: true });
    }
    if (entries.length) {
      const toc = document.createElement("details");
      toc.id = "readerToc";
      toc.className = "reader-toc";
      toc.open = true;
      const summary = document.createElement("summary");
      summary.textContent = "全文目錄 · " + entries.length + " 個標題";
      toc.append(summary);
      const nav = document.createElement("nav");
      nav.setAttribute("aria-label", "全文目錄");
      entries.forEach((entry) => {
        const link = document.createElement("a");
        link.href = "#" + entry.id;
        link.textContent = entry.title;
        link.className = entry.level === 3 ? "toc-subheading" : "toc-heading";
        link.addEventListener("click", (event) => {
          if (event.ctrlKey || event.metaKey || event.shiftKey || event.altKey)
            return;
          event.preventDefault();
          const url = new URL(location.href);
          url.searchParams.delete("section");
          url.searchParams.delete("anchor");
          url.hash = entry.id;
          history.pushState(null, "", url);
          go(entry);
        });
        nav.append(link);
      });
      toc.append(nav);
      article.parentElement.insertBefore(toc, article);
    }
    function fromHash() {
      let id;
      try {
        id = decodeURIComponent(location.hash.slice(1));
      } catch (e) {
        return null;
      }
      return entries.find((entry) => entry.id === id);
    }
    window.addEventListener("hashchange", () => go(fromHash()));
    const target =
      fromHash() ||
      entries.find((entry) => entry.id === query.get("anchor")) ||
      entries.find((entry) => entry.title === query.get("section")) ||
      legacyTarget();
    function legacyTarget() {
      const section = query.get("section");
      if (!section) return null;
      const template = document.createElement("template");
      template.innerHTML = window.marked.parse("## " + section);
      return entries.find(
        (entry) => entry.title === template.content.textContent.trim(),
      );
    }
    if (target) requestAnimationFrame(() => go(target));
    // An explicit invalid destination starts at the top rather than a stale saved position.
    return Boolean(
      target || query.has("section") || query.has("anchor") || location.hash,
    );
  }
  window.WBReader = { outline, mount };
})();
