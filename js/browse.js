/* Read-only examples use bundled data; local mode keeps the original file API. */
(function () {
  const params = new URLSearchParams(location.search);
  window.SHOWCASE_BROWSE = params.get("mode") !== "local";
  const localURL = (path = "index.html") => {
    const url = new URL(path, location.href);
    url.searchParams.set("mode", "local");
    return url.href;
  };
  BY.connect = async () => {
    try {
      const root = await chooseRoot();
      if (root) location.href = localURL();
    } catch (e) { reportIssue("連接本地企劃", e); }
  };
  BY.reconnect = async () => {
    try {
      const root = await getRoot();
      if (!root) return BY.connect();
      if (await requestPermission(root, true)) location.href = localURL();
      else setStatus("尚未授予權限；你仍可瀏覽示例。");
    } catch (e) { reportIssue("恢復本地企劃", e); }
  };
  const nav = qs(".nav");
  if (!window.SHOWCASE_BROWSE) {
    const link = document.createElement("a");
    link.href = "index.html";
    link.dataset.browse = "true";
    link.textContent = "瀏覽示例";
    nav.append(link);
    // Preserve mode for normal clicks, new tabs, and dynamically added links.
    function markLinks() {
      qsa("a[href]").forEach((a) => {
        if (a.dataset.browse || /^(#|javascript:)/.test(a.getAttribute("href"))) return;
        const u = new URL(a.href, location.href);
        if (u.protocol === location.protocol && u.host === location.host &&
            /\/(index|chapter|reader|images)\.html$/.test(u.pathname)) {
          u.searchParams.set("mode", "local");
          if (a.href !== u.href) a.href = u.href;
        }
      });
    }
    new MutationObserver(markLinks).observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ["href"] });
    markLinks();
    return;
  }
  const data = window.SHOWCASE_DEMO, m = data.manifest;
  document.body.classList.add("browse-mode");
  nav.innerHTML = '<a href="index.html">書架</a><a href="images.html">圖片庫</a><button class="btn" onclick="BY.connect()">連接本地企劃</button><button class="btn" onclick="BY.reconnect()">恢復上次企劃</button>';
  qsa(".dialog").forEach((el) => el.remove());
  applyColors(m);
  setStatus("目前為唯讀示例；若要整理自己的作品，請連接本地企劃。");
  renderSidebar({ manifest: m });
  qsa(".sideops,.sideadd").forEach((el) => el.remove());
  qs("#bySidebar .sidebrand small").textContent = "ver1.3 · 純瀏覽";
  const chapterURL = (c) => "chapter.html?id=" + encodeURIComponent(c.id);
  const readerURL = (path) => "reader.html?file=" + encodeURIComponent(path);
  const imagePath = (c, role) =>
    Object.entries(m.imageMeta).find(
      ([p, meta]) =>
        p.startsWith(c.imageFolder + "/") && meta.role === role,
    )?.[0] ||
    (role === "header"
      ? Object.entries(m.imageMeta).find(
          ([p, meta]) =>
            p.startsWith(c.imageFolder + "/") && meta.role === "showcase",
        )?.[0]
      : "");
  const chapter = m.chapters.find((c) => c.id === (params.get("id") || params.get("chapter")) ||
    (params.get("file") || "").startsWith(c.folder + "/"));
  function banner(c, host) {
    const path = imagePath(c, "header");
    if (path) host.insertAdjacentHTML("afterbegin", `<img class="browse-header" src="${esc(path)}" alt="${esc(c.title)} 抬頭圖">`);
  }
  function audioPanel() {
    const tracks = m.chapters.filter((c) => c.audioTrack);
    document.body.insertAdjacentHTML("beforeend", `<div class="globaltools"><button class="floatbtn" id="browseMusic">♪ BGM</button></div><aside class="toolpanel" id="browseAudio"><div class="toolhead"><strong>BGM</strong><button class="xbtn" id="browseClose">×</button></div><label class="toolfield">曲目<select id="browseTrack">${tracks.map((c) => `<option value="${esc(c.audioTrack)}">${esc(c.audioTitle || basename(c.audioTrack))}</option>`).join("")}</select></label><audio id="browsePlayer" controls loop preload="none"></audio><p class="toolhint">點擊播放即可聆聽；不會自動播放或保存設定。</p><p class="toolhint">隨包示例音樂含 AI 生成內容，僅供展示與測試，外部使用請先確認權利。</p></aside>`);
    const sel = qs("#browseTrack"), audio = qs("#browsePlayer");
    sel.value = chapter?.audioTrack || m.audio.track;
    audio.src = sel.value;
    audio.volume = m.audio.volume;
    sel.onchange = () => { audio.pause(); audio.src = sel.value; };
    qs("#browseMusic").onclick = () => qs("#browseAudio").classList.toggle("open");
    qs("#browseClose").onclick = () => qs("#browseAudio").classList.remove("open");
  }
  audioPanel();
  BY.initHome = async () => {
    qs("#projectTitle").textContent = m.project.title;
    qs("#projectSub").textContent = m.project.subtitle;
    qs(".eyebrow").textContent = "Novel Project Showcase";
    qs(".manager-note").innerHTML = '<strong>先看，再開始</strong><span>選一個示例，看看文字、圖片與配樂如何組成企劃。想整理自己的作品時，再點「連接本地企劃」。</span>';
    qs("#chapterGrid").innerHTML = m.chapters.map((c) => {
      const t = themeInfo(m, c.theme);
      return `<article class="card" style="--accent:${esc(t.color)}"><a href="${chapterURL(c)}" class="coverthumb"><img src="${esc(imagePath(c, "cover"))}" alt="${esc(c.title)} 封面"></a><span class="badge">${esc(t.label)}</span><h3>${esc(c.title)}</h3><div class="meta">${esc(c.subtitle)}</div><p>${esc(c.description)}</p><div class="actions"><a class="action" href="${chapterURL(c)}">進入篇章</a><a class="action" href="images.html?chapter=${c.id}">圖片</a></div></article>`;
    }).join("");
    const host = qs("#homeShowcase");
    const items = m.chapters
      .map((c) => ({ c, path: imagePath(c, "showcase") }))
      .filter((item) => item.path);
    let active = 0;
    host.innerHTML = `<div class="focus-stage">${items
      .map(
        (item, index) =>
          `<a class="focus-card" data-focus-index="${index}" href="${chapterURL(item.c)}" title="進入《${esc(item.c.title)}》"><img src="${esc(item.path)}" alt="${esc(item.c.title)} 展臺圖"><span><b>${esc(item.c.title)}</b><small>${esc(m.imageMeta[item.path]?.caption || "展臺圖")}</small></span></a>`,
      )
      .join("")}</div><div class="showcase-nav"><button class="btn" data-show-prev aria-label="上一張">←</button><span><b data-show-count>1 / ${items.length}</b> · 滾輪切換 · 點圖進入篇章</span><button class="btn" data-show-next aria-label="下一張">→</button></div>`;
    const cards = [...host.querySelectorAll(".focus-card")];
    const count = host.querySelector("[data-show-count]");
    const paint = () => {
      const total = cards.length;
      cards.forEach((card, index) => {
        card.classList.remove("is-prev", "is-active", "is-next", "is-hidden");
        const delta = index - active;
        if (delta === 0) card.classList.add("is-active");
        else if (delta === -1 || (active === 0 && index === total - 1))
          card.classList.add("is-prev");
        else if (delta === 1 || (active === total - 1 && index === 0))
          card.classList.add("is-next");
        else card.classList.add("is-hidden");
      });
      if (count) count.textContent = `${active + 1} / ${cards.length}`;
    };
    const step = (direction) => {
      if (cards.length < 2) return;
      active = (active + direction + cards.length) % cards.length;
      paint();
    };
    host.querySelector("[data-show-prev]")?.addEventListener("click", () => step(-1));
    host.querySelector("[data-show-next]")?.addEventListener("click", () => step(1));
    let wheelLock = false;
    host.querySelector(".focus-stage")?.addEventListener(
      "wheel",
      (event) => {
        event.preventDefault();
        if (wheelLock || cards.length < 2) return;
        wheelLock = true;
        step((event.deltaY || event.deltaX) > 0 ? 1 : -1);
        setTimeout(() => (wheelLock = false), 260);
      },
      { passive: false },
    );
    paint();
  };
  BY.initChapter = async () => {
    if (!chapter) { qs("#chapterTitle").textContent = "找不到示例篇章"; qs("#docList").textContent = "請從書架選擇示例。"; return; }
    qs("#chapterTitle").textContent = chapter.title;
    qs("#chapterSub").textContent = chapter.subtitle;
    qs("#chapterTheme").textContent = themeInfo(m, chapter.theme).label;
    qs(".crumb").textContent = "書架 / 篇章 / 教學文檔";
    qs(".sectionhead h2").textContent = "教學文檔";
    qs(".sectionhead .meta").textContent = "點開一份文檔，即可閱讀完整內容。";
    banner(chapter, qs(".hero"));
    qs("#docList").innerHTML = Object.entries(data.documents).filter(([p]) => p.startsWith(chapter.folder + "/")).map(([p, md]) => {
      const body = WBMarkdown.body(md), title = body.match(/^#\s+(.+)$/m)?.[1] || basename(p);
      return `<div class="treefile"><div class="treerow"><span class="treeicon">MD</span><a href="${readerURL(p)}">${esc(title)}</a></div><div class="treesections">${WBReader.outline(md).map((s) => `<a href="${readerURL(p)}&anchor=${encodeURIComponent(s.id)}">${esc(s.title)}</a>`).join("")}</div></div>`;
    }).join("");
  };
  BY.initReader = async () => {
    const path = params.get("file"), md = data.documents[path];
    qs("#readerManage").replaceChildren();
    qs("#readerPath").textContent = path || "";
    if (md === undefined) { qs("#readerTitle").textContent = "找不到示例文檔"; qs("#md").textContent = "請返回書架，或連接包含此文檔的本地企劃。"; return; }
    const body = WBMarkdown.body(md);
    qs("#readerTitle").textContent = body.match(/^#\s+(.+)$/m)?.[1] || basename(path);
    qs("#md").innerHTML = marked.parse(body);
    if (chapter) banner(chapter, qs(".hero"));
    WBReader.mount(qs("#md"), params);
  };
  BY.initImages = async () => {
    qs("#imagesTitle").textContent = chapter ? chapter.title + " · 圖片庫" : "示例圖片庫";
    qs(".hero .lead").textContent = "點擊圖片放大，查看各篇章的封面與配圖。";
    qs("#imageGrid").innerHTML = Object.entries(m.imageMeta).filter(([p]) => !chapter || p.startsWith(chapter.imageFolder + "/")).map(([p, meta]) => `<figure class="imagecard"><button class="imageopen" data-path="${esc(p)}" data-caption="${esc(meta.caption)}"><img src="${esc(p)}" alt="${esc(meta.caption)}"><span class="zoomhint">點擊放大</span></button><figcaption class="imagecap">${esc(meta.caption)} · ${esc(roleLabel(meta.role))}</figcaption></figure>`).join("");
    qsa(".imageopen").forEach((b) => b.onclick = () => openLightbox(b.dataset.path, b.dataset.caption));
  };
})();
