/* Novel Workbench 1.0 enhancements
   Safety-first layer on top of Folder Mode V10.
*/
(function () {
  const WB_VERSION = "1.4.1";
  const SCHEMA_VERSION = 11;
  const native = { initHome: BY.initHome };
  const safeDeleteHandlers = {};
  window.SafeDelete = safeDeleteHandlers;
  let saving = false,
    dirty = false,
    editorPath = "",
    editorOriginal = "",
    editorSection = "";

  function stamp() {
    const d = new Date(),
      p = (n) => String(n).padStart(2, "0");
    return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
  }
  function humanBytes(n) {
    if (n < 1024) return n + " B";
    if (n < 1048576) return (n / 1024).toFixed(1) + " KB";
    if (n < 1073741824) return (n / 1048576).toFixed(1) + " MB";
    return (n / 1073741824).toFixed(2) + " GB";
  }
  function countWords(text) {
    const cjk = (text.match(/[\u3400-\u9fff]/g) || []).length;
    const latin = (
      text.replace(/[\u3400-\u9fff]/g, " ").match(/\b[\p{L}\p{N}_'-]+\b/gu) ||
      []
    ).length;
    return cjk + latin;
  }
  function relativePath(fromDir, to) {
    const a = fromDir.split("/").filter(Boolean),
      b = to.split("/").filter(Boolean);
    while (a.length && b.length && a[0] === b[0]) {
      a.shift();
      b.shift();
    }
    return "../".repeat(a.length) + b.join("/");
  }
  function htmlEscape(s = "") {
    return esc(s);
  }

  async function ensureSchema() {
    const p = await getProject(true);
    if (!p?.manifest) return;
    p.manifest.schemaVersion ||= SCHEMA_VERSION;
    p.manifest.workbenchVersion = WB_VERSION;
    p.manifest.project ||= {};
    p.manifest.project.subtitle ||= "ver1.3 · 教學模板";
    p.manifest.version = "Workbench 1.4.1";
    if (p.manifest.tags && Object.keys(p.manifest.tags).length === 0)
      delete p.manifest.tags;
    await writeManifest(p.root, p.manifest);
  }

  async function snapshotFile(root, path) {
    if (!/\.md$/i.test(path) || !(await existsPath(root, path))) return "";
    const body = await readText(root, path);
    const rel = path.replace(/\.md$/i, "");
    const dest = pathJoin("_history", rel, stamp() + ".md");
    await writeText(root, dest, body);
    return dest;
  }

  async function readTrashIndex(root) {
    try {
      return JSON.parse(await readText(root, "data/trash.json"));
    } catch (e) {
      if (e.name === "NotFoundError") return { items: [] };
      reportIssue("讀取垃圾桶索引", e);
      throw e;
    }
  }
  async function writeTrashIndex(root, idx) {
    await writeText(root, "data/trash.json", JSON.stringify(idx, null, 2));
  }
  async function softDelete(path, kind = "file", meta = {}) {
    const p = await getProject(true);
    if (!p) return false;
    const token = stamp() + "_" + Math.random().toString(36).slice(2, 8),
      dest = pathJoin("_trash", token, path);
    try {
      const idx = await readTrashIndex(p.root);
      if (kind === "directory")
        await copyDirRecursive(
          await getDir(p.root, path),
          await getDir(p.root, dest, true),
        );
      else await copyFile(p.root, path, dest);
      idx.items ||= [];
      idx.items.push({
        id: token + "_" + Math.random().toString(36).slice(2, 8),
        deletedAt: new Date().toISOString(),
        original: path,
        trashPath: dest,
        kind,
        meta,
      });
      await writeTrashIndex(p.root, idx);
      await removePath(p.root, path, kind === "directory");
      return dest;
    } catch (e) {
      alert("移動到垃圾桶失敗：" + (e.message || e));
      return false;
    }
  }

  async function replaceFileWithHistory(path, accept) {
    const p = await getProject(true);
    if (!p) return false;
    const f = await pickLocalFile(accept);
    if (!f) return false;
    if (!confirm(`用「${f.name}」替換：\n${path}\n\n舊版會先存入 _history。`))
      return false;
    await snapshotFile(p.root, path);
    await writeBlob(p.root, path, f);
    return true;
  }

  safeDeleteHandlers.deleteSeriesDoc = async (encoded) => {
    const path = decodeURIComponent(encoded),
      p = await getProject(true);
    if (!p?.manifest) return;
    if (!confirm(`將文件移入項目垃圾桶：\n${path}\n\n不會永久刪除。`)) return;
    const doc =
      (p.manifest.seriesDocs || []).find((d) => d.path === path) || null;
    const dest = await softDelete(path, "file", { seriesDoc: doc });
    if (!dest) return;
    p.manifest.seriesDocs = (p.manifest.seriesDocs || []).filter(
      (d) => d.path !== path,
    );
    await writeManifest(p.root, p.manifest);
    location.reload();
  };
  safeDeleteHandlers.deleteChapterFile = async (chId, encoded) => {
    const ch = CURRENT_PROJECT?.manifest?.chapters?.find((c) => c.id === chId),
      rel = decodeURIComponent(encoded);
    if (!ch) return;
    const full = pathJoin(ch.folder, rel);
    if (!confirm(`移入垃圾桶？\n${full}`)) return;
    if (await softDelete(full)) location.reload();
  };
  safeDeleteHandlers.deleteChapterFolder = async (chId, encoded) => {
    const ch = CURRENT_PROJECT?.manifest?.chapters?.find((c) => c.id === chId),
      rel = decodeURIComponent(encoded);
    if (!ch) return;
    const full = pathJoin(ch.folder, rel);
    if (!confirm(`將整個資料夾移入垃圾桶？\n${full}\n\n其中內容不會永久刪除。`))
      return;
    if (await softDelete(full, "directory")) location.reload();
  };
  safeDeleteHandlers.deleteReaderFile = async (encoded) => {
    const path = decodeURIComponent(encoded),
      p = await getProject(true);
    if (!p) return;
    if (!confirm(`移入垃圾桶？\n${path}`)) return;
    const dest = await softDelete(path);
    if (!dest) return;
    if (p.manifest?.seriesDocs?.some((d) => d.path === path)) {
      p.manifest.seriesDocs = p.manifest.seriesDocs.filter(
        (d) => d.path !== path,
      );
      await writeManifest(p.root, p.manifest);
    }
    alert("已移入 _trash。");
    location.href = "index.html";
  };
  safeDeleteHandlers.deleteImage = async (encoded) => {
    const path = decodeURIComponent(encoded),
      p = await getProject(true);
    if (!p?.manifest) return;
    if (!confirm(`將圖片移入垃圾桶？\n${path}`)) return;
    const oldMeta = p.manifest.imageMeta?.[path] || null;
    const dest = await softDelete(path, "file", { imageMeta: oldMeta });
    if (!dest) return;
    delete p.manifest.imageMeta?.[path];
    await writeManifest(p.root, p.manifest);
    location.reload();
  };

  BY.replaceSeriesDoc = async (encoded) => {
    const path = decodeURIComponent(encoded);
    if (await replaceFileWithHistory(path, ".md,text/markdown,text/plain"))
      location.reload();
  };
  BY.replaceReaderFile = async (encoded) => {
    const path = decodeURIComponent(encoded);
    if (await replaceFileWithHistory(path, ".md,text/markdown,text/plain"))
      location.reload();
  };
  BY.replaceChapterFile = async (chId, encoded) => {
    const ch = CURRENT_PROJECT?.manifest?.chapters?.find((c) => c.id === chId);
    if (!ch) return;
    const full = pathJoin(ch.folder, decodeURIComponent(encoded));
    if (await replaceFileWithHistory(full, ".md,text/markdown,text/plain"))
      location.reload();
  };
  BY.replaceImage = async (encoded) => {
    const path = decodeURIComponent(encoded),
      p = await getProject(true);
    if (!p) return;
    const f = await pickLocalFile("image/png,image/jpeg,image/webp,image/gif");
    if (!f) return;
    if (!confirm(`替換圖片：\n${path}\n\n舊圖會先備份到 _history。`)) return;
    const old = await getFileHandleByPath(p.root, path);
    const oldFile = await old.getFile();
    await writeBlob(
      p.root,
      pathJoin("_history", "assets", path, stamp() + "_" + basename(path)),
      oldFile,
    );
    await writeBlob(p.root, path, f);
    location.reload();
  };

  function renderMarkdown(md) {
    md = window.WBMarkdown.body(md);
    try {
      if (window.marked) {
        if (typeof marked.setOptions === "function")
          marked.setOptions({ gfm: true, breaks: false });
        return marked.parse(md);
      }
    } catch (e) {
      reportIssue("Markdown 排版", e);
    }
    return mdToHtml(md);
  }

  function parseTags(md) {
    const fm = md.match(/^---\s*\n([\s\S]*?)\n---\s*\n?/);
    let tags = [];
    if (fm) {
      const block = fm[1],
        inline = block.match(/^tags:\s*\[(.*?)\]\s*$/im);
      if (inline)
        tags = inline[1]
          .split(",")
          .map((x) => x.trim().replace(/^['"]|['"]$/g, ""))
          .filter(Boolean);
      else {
        const lines = block.split("\n");
        let on = false;
        for (const l of lines) {
          if (/^tags:\s*$/i.test(l)) {
            on = true;
            continue;
          }
          if (on) {
            const m = l.match(/^\s*-\s*(.+)$/);
            if (m) tags.push(m[1].trim().replace(/^['"]|['"]$/g, ""));
            else if (/^\S/.test(l)) break;
          }
        }
      }
    }
    return [...new Set(tags)];
  }
  function setTags(md, tags) {
    tags = [...new Set(tags.map((x) => x.trim()).filter(Boolean))];
    const fm = md.match(/^---\s*\n([\s\S]*?)\n---\s*\n?/);
    const line =
      "tags: [" + tags.map((t) => JSON.stringify(t)).join(", ") + "]";
    if (fm) {
      let block = fm[1];
      if (/^tags:.*$/im.test(block)) {
        block = block.replace(/^tags:.*(?:\n(?:\s+-.*)*)?/im, line);
      } else block += (block.endsWith("\n") ? "" : "\n") + line;
      return `---\n${block}\n---\n` + md.slice(fm[0].length);
    }
    return `---\n${line}\n---\n\n` + md;
  }

  const readerImageUrls = [];
  async function resolveReaderImages(article, p, mdPath) {
    readerImageUrls.splice(0).forEach((url) => URL.revokeObjectURL(url));
    for (const img of article.querySelectorAll("img")) {
      const src = img.getAttribute("src");
      if (!src || /^(?:[a-z][a-z0-9+.-]*:|\/\/|#)/i.test(src)) continue;
      img.removeAttribute("srcset");
      img.removeAttribute("src");
      try {
        const url = new URL(
          src,
          "https://project.invalid/" +
            mdPath.split("/").map(encodeURIComponent).join("/"),
        );
        const rel = decodeURIComponent(url.pathname.slice(1));
        const file = await (await getFileHandleByPath(p.root, rel)).getFile();
        const blobUrl = URL.createObjectURL(file);
        readerImageUrls.push(blobUrl);
        img.src = blobUrl;
      } catch (e) {
        reportIssue("讀取正文圖片 " + src, e);
        img.title = "無法讀取項目圖片：" + src;
      }
    }
  }

  BY.deleteAudio = async (path) => {
    if (!confirm("將目前音訊移入項目垃圾桶？\n" + path)) return false;
    const p = await getProject(true);
    if (!p?.manifest) return false;
    const cfg = { ...p.manifest.audio };
    const chapterIds = p.manifest.chapters
      .filter((c) => c.audioTrack === path)
      .map((c) => c.id);
    if (!(await softDelete(path, "file", { audio: cfg, chapterIds })))
      return false;
    if (p.manifest.audio?.track === path) p.manifest.audio.track = "";
    for (const c of p.manifest.chapters)
      if (c.audioTrack === path) c.audioTrack = "";
    await writeManifest(p.root, p.manifest);
    return true;
  };
  BY.replaceAudio = async (path, file) => {
    if (!confirm("替換音訊？舊音訊會先備份到 _history。\n" + path))
      return false;
    const p = await getProject(true);
    if (!p) return false;
    const old = await (await getFileHandleByPath(p.root, path)).getFile();
    await writeBlob(
      p.root,
      pathJoin(
        "_history",
        "audio",
        stamp() + "_" + Math.random().toString(36).slice(2, 8),
        path,
      ),
      old,
    );
    await writeBlob(p.root, path, file);
    return true;
  };
  async function initReader() {
    const p = await getProject();
    if (!p) return;
    const q = new URLSearchParams(location.search),
      path = q.get("file"),
      section = q.get("section");
    if (!path) {
      qs("#readerTitle").textContent = "未指定文件";
      return;
    }
    let full;
    try {
      full = await readText(p.root, path);
    } catch (e) {
      qs("#readerTitle").textContent = "讀取失敗";
      qs("#md").innerHTML = "<p>" + esc(String(e)) + "</p>";
      return;
    }
    editorPath = path;
    editorOriginal = full;
    editorSection = "";
    qs("#readerPath").textContent = path;
    const preview = full,
      title = basename(path).replace(/\.md$/i, "");
    qs("#readerTitle").textContent = title;
    qs("#md").innerHTML = renderMarkdown(preview);
    await resolveReaderImages(qs("#md"), p, path);
    const tags = parseTags(full);
    const bar = qs("#readerManage");
    bar.innerHTML = `<div class="reader-primary"><button class="btn editbtn" id="editMdBtn">✎ 編輯 Markdown</button><button class="btn historybtn" id="historyBtn">歷史版本</button><button class="btn" onclick="BY.replaceReaderFile('${encodeURIComponent(path)}')">替換此 MD</button><button class="btn dangerbtn" onclick="BY.deleteReaderFile('${encodeURIComponent(path)}')">移入垃圾桶</button></div><div class="tagline"><span>標籤</span><span id="tagChips">${tags.map((t) => `<button class="tagchip" data-search-tag="${htmlEscape(t)}">#${htmlEscape(t)}</button>`).join("") || "<em>無</em>"}</span></div>`;
    if (section) qs("#editMdBtn").textContent = "✎ 編輯完整 MD";
    qs("#editMdBtn").onclick = () => enterEditMode();
    qs("#historyBtn").onclick = () => openHistory(path);
    qsa("[data-search-tag]").forEach(
      (b) => (b.onclick = () => openSearch("#" + b.dataset.searchTag)),
    );
    await renderReaderHeader();
    const hasTarget = WBReader.mount(qs("#md"), q);
    if (!hasTarget) restoreScroll(path);
  }

  function enterEditMode() {
    if (!editorPath) return;
    const host = qs("#md");
    if (!host) return;
    qs("#readerToc")?.remove();
    host.innerHTML = `<div class="editor-shell"><div class="editor-top"><label>標籤（逗號分隔）<input id="editorTags" value="${htmlEscape(parseTags(editorOriginal).join(", "))}" placeholder="例如：人物, 伏筆, 待確認"></label><div class="editor-hint">Ctrl+S 保存 · 保存前自動寫入 _history</div></div><textarea id="mdEditor" spellcheck="false"></textarea><div class="savebar"><button class="save-big" id="saveMdBtn">💾 保存 Markdown</button><button class="btn" id="insertImageBtn">＋ 插入圖片</button><button class="btn" id="cancelEditBtn">取消編輯</button><span class="save-state" id="saveState">已同步</span></div></div>`;
    const ta = qs("#mdEditor");
    ta.value = editorOriginal;
    ta.focus();
    dirty = false;
    updateDirty(false);
    ta.addEventListener("input", () => updateDirty(true));
    qs("#editorTags").addEventListener("input", () => updateDirty(true));
    qs("#saveMdBtn").onclick = saveEditor;
    qs("#cancelEditBtn").onclick = () => {
      if (dirty && !confirm("尚未保存，確定取消編輯？")) return;
      location.reload();
    };
    qs("#insertImageBtn").onclick = () => openImagePicker(ta);
  }
  function updateDirty(v) {
    dirty = v;
    const s = qs("#saveState");
    if (s) {
      s.textContent = v ? "● 尚未保存" : "✓ 已保存";
      s.classList.toggle("dirty", v);
    }
    document.title = (v ? "● " : "") + document.title.replace(/^● /, "");
  }
  async function saveEditor() {
    if (saving) return;
    const ta = qs("#mdEditor"),
      tagInput = qs("#editorTags"),
      btn = qs("#saveMdBtn");
    if (!ta) return;
    saving = true;
    btn.disabled = true;
    btn.textContent = "保存中…";
    const originalValue = ta.value,
      originalTags = tagInput.value;
    const text = setTags(
      originalValue,
      originalTags
        .split(",")
        .map((x) => x.trim())
        .filter(Boolean),
    );
    try {
      const p = await getProject(true);
      if (!p) throw new Error("請恢復項目讀寫權限");
      await snapshotFile(p.root, editorPath);
      await writeText(p.root, editorPath, text);
      editorOriginal = text;
      const changed =
        ta.value !== originalValue || tagInput.value !== originalTags;
      if (!changed) ta.value = text;
      updateDirty(changed);
      btn.textContent = changed ? "保存新修改" : "✓ 已保存";
    } catch (e) {
      updateDirty(true);
      alert("保存失敗：" + (e.message || e));
      btn.textContent = "重試保存";
    } finally {
      saving = false;
      btn.disabled = false;
    }
  }

  async function openHistory(path) {
    const p = await getProject();
    if (!p) return;
    const dirPath = pathJoin("_history", path.replace(/\.md$/i, ""));
    let files = [];
    try {
      files = await listFilesRecursive(await getDir(p.root, dirPath), [".md"]);
    } catch (e) {
      if (e.name !== "NotFoundError") reportIssue("讀取歷史版本 " + dirPath, e);
    }
    showModal(
      "歷史版本",
      files.length
        ? `<div class="historylist">${files
            .slice()
            .reverse()
            .map(
              (f) =>
                `<div class="historyrow"><span>${htmlEscape(f.name)}</span><button class="btn" data-restore-history="${encodeURIComponent(pathJoin(dirPath, f.path))}">恢復此版</button></div>`,
            )
            .join("")}</div>`
        : '<div class="empty">還沒有歷史版本。第一次保存後會自動建立。</div>',
    );
    qsa("[data-restore-history]").forEach(
      (b) =>
        (b.onclick = async () => {
          if (!confirm("恢復此歷史版本？目前版本會先再備份一次。")) return;
          const src = decodeURIComponent(b.dataset.restoreHistory),
            pp = await getProject(true);
          await snapshotFile(pp.root, path);
          await writeText(pp.root, path, await readText(pp.root, src));
          location.reload();
        }),
    );
  }

  async function openImagePicker(textarea) {
    const p = await getProject();
    if (!p) return;
    let imgs = [];
    try {
      imgs = await listImagesRecursive(await getDir(p.root, "assets/images"));
    } catch (e) {
      reportIssue("讀取資料或素材", e);
    }
    const items = [];
    for (const im of imgs) {
      const full = pathJoin("assets/images", im.path);
      const url = URL.createObjectURL(await im.handle.getFile());
      items.push(
        `<button class="pickimage" data-img-path="${htmlEscape(full)}"><img src="${url}"><span>${htmlEscape(im.path)}</span></button>`,
      );
    }
    showModal(
      "插入項目圖片",
      items.length
        ? `<div class="pickgrid">${items.join("")}</div>`
        : '<div class="empty">圖片庫為空。</div>',
    );
    qsa("[data-img-path]").forEach(
      (b) =>
        (b.onclick = () => {
          const full = b.dataset.imgPath,
            rel = relativePath(dirname(editorPath), full),
            syntax = `![${basename(full).replace(/\.[^.]+$/, "")}](${rel})`;
          const start = textarea.selectionStart,
            end = textarea.selectionEnd;
          textarea.setRangeText(syntax, start, end, "end");
          updateDirty(true);
          closeModal();
        }),
    );
  }

  window.addEventListener("beforeunload", (e) => {
    if (dirty) {
      e.preventDefault();
      e.returnValue = "";
    }
  });
  document.addEventListener("keydown", (e) => {
    if (
      (e.ctrlKey || e.metaKey) &&
      e.key.toLowerCase() === "s" &&
      qs("#mdEditor")
    ) {
      e.preventDefault();
      saveEditor();
    }
  });

  function showModal(title, body) {
    let m = qs("#wbModal");
    if (!m) {
      document.body.insertAdjacentHTML(
        "beforeend",
        '<div class="wbmodal" id="wbModal"><div class="wbmodalbox"><div class="wbmodalhead"><strong id="wbModalTitle"></strong><button class="xbtn" onclick="WB.closeModal()">×</button></div><div id="wbModalBody"></div></div></div>',
      );
      m = qs("#wbModal");
    }
    qs("#wbModalTitle").textContent = title;
    qs("#wbModalBody").innerHTML = body;
    m.classList.add("open");
  }
  function closeModal() {
    qs("#wbModal")?.classList.remove("open");
  }

  async function collectMarkdown(p) {
    const roots = ["content"];
    let out = [];
    for (const r of roots) {
      try {
        const dir = await getDir(p.root, r),
          files = await listFilesRecursive(dir, [".md"]);
        for (const f of files) {
          const path = pathJoin(r, f.path);
          try {
            const text = await (await f.handle.getFile()).text();
            out.push({
              path,
              name: f.name,
              text,
              words: countWords(text),
              tags: parseTags(text),
            });
          } catch (e) {
            reportIssue("讀取文檔 " + path, e);
          }
        }
      } catch (e) {
        reportIssue("讀取文檔目錄 " + r, e);
      }
    }
    return out;
  }

  async function openSearch(seed = "") {
    const p = await getProject();
    if (!p) return;
    showModal(
      "全局搜尋",
      '<div class="searchbox"><input id="globalSearchInput" placeholder="搜尋所有 Markdown…"><div id="searchMeta">正在建立索引…</div><div id="searchResults"></div></div>',
    );
    const docs = await collectMarkdown(p),
      input = qs("#globalSearchInput"),
      meta = qs("#searchMeta"),
      results = qs("#searchResults");
    meta.textContent = `已建立索引 ${docs.length} 份 Markdown · ${docs.reduce((a, b) => a + b.words, 0).toLocaleString()} 字`;
    function run() {
      const raw = input.value.trim(),
        tagMode = raw.startsWith("#"),
        q = tagMode ? raw.slice(1).toLowerCase() : raw.toLowerCase();
      if (!q) {
        results.innerHTML =
          '<div class="empty">輸入關鍵詞，或用 #標籤 搜尋。</div>';
        return;
      }
      const matches = docs.filter((d) =>
        tagMode
          ? d.tags.some((t) => t.toLowerCase().includes(q))
          : d.path.toLowerCase().includes(q) ||
            d.text.toLowerCase().includes(q),
      );
      results.innerHTML =
        matches
          .slice(0, 100)
          .map((d) => {
            const idx = d.text.toLowerCase().indexOf(q),
              snip = tagMode
                ? "標籤：" + d.tags.join(" · ")
                : idx >= 0
                  ? d.text
                      .slice(Math.max(0, idx - 60), idx + 140)
                      .replace(/\n+/g, " ")
                  : "";
            return `<a class="searchresult" target="_blank" href="reader.html?file=${encodeURIComponent(d.path)}"><strong>${htmlEscape(d.path)}</strong><span>${htmlEscape(snip)}</span><em>${d.words} 字 ${d.tags.map((t) => "#" + t).join(" ")}</em></a>`;
          })
          .join("") || '<div class="empty">沒有結果。</div>';
    }
    input.addEventListener("input", run);
    input.value = seed;
    run();
    input.focus();
  }

  async function healthCheck() {
    const p = await getProject();
    if (!p?.manifest) return;
    const issues = [],
      docs = await collectMarkdown(p);
    for (const d of p.manifest.seriesDocs || [])
      if (!(await existsPath(p.root, d.path)))
        issues.push("缺少說明文件：" + d.path);
    for (const c of p.manifest.chapters || []) {
      if (!(await existsPath(p.root, c.folder, "directory")))
        issues.push("缺少篇章目錄：" + c.folder);
      if (
        !(await existsPath(
          p.root,
          c.imageFolder || pathJoin("assets/images", c.id),
          "directory",
        ))
      )
        issues.push("缺少圖片目錄：" + (c.imageFolder || c.id));
    }
    for (const [path] of Object.entries(p.manifest.imageMeta || {}))
      if (!(await existsPath(p.root, path)))
        issues.push("圖片記錄失效：" + path);
    for (const d of docs) {
      if (!d.text.trim()) issues.push("空 Markdown：" + d.path);
      const re = /!\[[^\]]*\]\(([^)]+)\)/g;
      let m;
      while ((m = re.exec(d.text))) {
        const target = m[1].trim().replace(/^<|>$/g, "");
        if (/^(https?:|data:)/i.test(target)) continue;
        const norm = normalizePath(pathJoin(dirname(d.path), target));
        if (!(await existsPath(p.root, norm)))
          issues.push(`圖片連結失效：${d.path} → ${target}`);
      }
    }

    for (const c of p.manifest.chapters || []) {
      if (c.audioTrack && !(await existsPath(p.root, c.audioTrack)))
        issues.push("篇章 BGM 失效：" + c.title + " → " + c.audioTrack);
      if (!normalizeThemes(p.manifest).some((t) => t.id === c.theme))
        issues.push("篇章類型不存在：" + c.title);
    }
    if (
      p.manifest.audio?.track &&
      !(await existsPath(p.root, p.manifest.audio.track))
    )
      issues.push("全局 BGM 失效：" + p.manifest.audio.track);
    issues.push(...runtimeIssues);
    showModal(
      "項目健康檢查",
      issues.length
        ? `<div class="health warn"><strong>發現 ${issues.length} 項需要檢查</strong>${issues.map((x) => `<div>• ${htmlEscape(x)}</div>`).join("")}</div>`
        : '<div class="health ok"><strong>✓ 未發現明顯問題</strong><div>說明文件、篇章目錄、圖片記錄、空文件與 Markdown 圖片連結檢查完成。</div></div>',
    );
  }
  function normalizePath(path) {
    const out = [];
    for (const p of path.split("/")) {
      if (!p || p === ".") continue;
      if (p === "..") out.pop();
      else out.push(p);
    }
    return out.join("/");
  }

  async function makeBackup() {
    const p = await getProject();
    if (!p || !window.JSZip) {
      alert("JSZip 未加載。");
      return;
    }
    if (!confirm("建立整個項目的 ZIP 快照？項目較大時會需要一些時間。")) return;
    const zip = new JSZip();
    let files = 0,
      total = 0;
    async function walk(dir, prefix = "") {
      for await (const [name, h] of dir.entries()) {
        const path = prefix ? prefix + "/" + name : name;
        if (h.kind === "directory") await walk(h, path);
        else {
          const f = await h.getFile();
          zip.file(path, f);
          files++;
          total += f.size;
        }
      }
    }
    showToast("正在建立 ZIP 快照…");
    await walk(p.root);
    const blob = await zip.generateAsync({
      type: "blob",
      compression: "DEFLATE",
      compressionOptions: { level: 6 },
    });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `Novel_snapshot_${stamp()}.zip`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 3000);
    showToast(`快照完成：${files} 文件 · ${humanBytes(total)}`);
  }

  async function trashPanel() {
    const p = await getProject();
    if (!p) return;
    const idx = await readTrashIndex(p.root),
      items = (idx.items || []).slice().reverse();
    showModal(
      "項目垃圾桶",
      items.length
        ? `<div class="trashlist">${items.map((it) => `<div class="trashrow"><span><b>${htmlEscape(it.original)}</b><small>${htmlEscape(it.deletedAt || "")} · ${htmlEscape(it.kind || "file")}</small></span><button class="btn" data-trash-id="${htmlEscape(it.id)}">還原</button></div>`).join("")}</div><p class="toolhint">Workbench 不會自動清空 _trash。永久刪除請在系統檔案管理器中自行處理。</p>`
        : '<div class="empty">垃圾桶為空。</div>',
    );
    qsa("[data-trash-id]").forEach(
      (b) => (b.onclick = () => restoreTrash(b.dataset.trashId)),
    );
  }
  async function restoreTrash(id) {
    const p = await getProject(true);
    if (!p?.manifest) return;
    const idx = await readTrashIndex(p.root),
      it = (idx.items || []).find((x) => x.id === id);
    if (!it) {
      alert("找不到垃圾桶記錄。");
      return;
    }
    if (
      await existsPath(
        p.root,
        it.original,
        it.kind === "directory" ? "directory" : "file",
      )
    ) {
      alert("原位置已有同名項目，暫不覆蓋。");
      return;
    }
    if (it.kind === "directory")
      await moveDir(p.root, it.trashPath, it.original);
    else await moveFile(p.root, it.trashPath, it.original);
    for (const c of p.manifest.chapters || [])
      if (it.meta?.chapterIds?.includes(c.id) && !c.audioTrack)
        c.audioTrack = it.original;
    if (it.meta?.audio && !p.manifest.audio?.track)
      p.manifest.audio = it.meta.audio;
    if (
      it.meta?.seriesDoc &&
      !p.manifest.seriesDocs.some((d) => d.path === it.original)
    )
      p.manifest.seriesDocs.push(it.meta.seriesDoc);
    if (it.meta?.imageMeta)
      p.manifest.imageMeta[it.original] = it.meta.imageMeta;
    await writeManifest(p.root, p.manifest);
    idx.items = idx.items.filter((x) => x.id !== id);
    await writeTrashIndex(p.root, idx);
    alert("已還原：" + it.original);
    location.reload();
  }

  async function showStats() {
    const p = await getProject();
    if (!p) return;
    await renderShowcase(p);
    const docs = await collectMarkdown(p),
      rows = [];
    for (const c of p.manifest.chapters || []) {
      const sum = docs
        .filter((d) => d.path.startsWith(c.folder + "/"))
        .reduce((a, b) => a + b.words, 0);
      rows.push([c.title, sum]);
    }
    const series = docs
        .filter((d) => d.path.startsWith("content/_series/"))
        .reduce((a, b) => a + b.words, 0),
      total = docs.reduce((a, b) => a + b.words, 0);
    showModal(
      "字數統計",
      `<div class="statbig"><strong>${total.toLocaleString()}</strong><span>項目總字數（中英文近似統計）</span></div><div class="statrows"><div><b>說明文件</b><span>${series.toLocaleString()}</span></div>${rows.map(([n, v]) => `<div><b>${htmlEscape(n)}</b><span>${v.toLocaleString()}</span></div>`).join("")}</div>`,
    );
  }

  function showToast(msg) {
    let t = qs("#wbToast");
    if (!t) {
      document.body.insertAdjacentHTML(
        "beforeend",
        '<div class="wbtoast" id="wbToast"></div>',
      );
      t = qs("#wbToast");
    }
    t.textContent = msg;
    t.classList.add("show");
    setTimeout(() => t.classList.remove("show"), 2600);
  }

  function injectWorkbenchTools() {
    if (window.SHOWCASE_BROWSE || qs("#wbQuickTools")) return;
    document.body.insertAdjacentHTML(
      "beforeend",
      `<div class="wbquick" id="wbQuickTools"><button title="全局搜尋" onclick="WB.search()">⌕</button><button title="項目快照 ZIP" onclick="WB.backup()">ZIP</button><button title="健康檢查" onclick="WB.health()">✓</button><button title="字數統計" onclick="WB.stats()">字</button><button title="垃圾桶" onclick="WB.trash()">🗑</button></div>`,
    );
    const sb = qs("#bySidebar .sidebrand small");
    if (sb) sb.textContent = "ver1.3";
  }

  async function collectShowcaseImages(p, chapterId = "") {
    const all = [];
    for (const [path, meta] of Object.entries(p.manifest.imageMeta || {})) {
      const ch = chapterForImagePath(p.manifest, path);
      if (!ch || !meta) continue;
      if (chapterId && ch.id !== chapterId) continue;
      if (meta.role !== "showcase") continue;
      try {
        all.push({ path, meta, ch, url: await objectUrlForPath(p.root, path) });
      } catch (e) {
        reportIssue("讀取資料或素材", e);
      }
    }
    return all;
  }

  async function chapterVisual(p, chapterId, role) {
    for (const [path, meta] of Object.entries(p.manifest.imageMeta || {})) {
      const ch = chapterForImagePath(p.manifest, path);
      if (ch?.id === chapterId && meta?.role === role) {
        try {
          return { path, meta, ch, url: await objectUrlForPath(p.root, path) };
        } catch (e) {
          reportIssue("讀取資料或素材", e);
        }
      }
    }
    return null;
  }

  async function renderShowcase(p, chapterId = "") {
    const host = chapterId ? qs("#chapterShowcase") : qs("#homeShowcase");
    if (!host) return;
    const items = await collectShowcaseImages(p, chapterId);
    if (!items.length) {
      host.innerHTML = `<div class="showcase-empty">還沒有展臺圖。到圖片庫把圖片用途設為「展臺圖」，或用「派生圖」一鍵生成。</div>`;
      return;
    }
    let active = 0;
    host.innerHTML = `<div class="focus-stage">${items.map((x, i) => `<a class="focus-card" data-focus-index="${i}" href="chapter.html?id=${encodeURIComponent(x.ch.id)}" title="進入《${htmlEscape(x.ch.title)}》"><img src="${x.url}" alt="${htmlEscape(x.meta.caption || x.ch.title)}"><span><b>${htmlEscape(x.ch.title)}</b><small>${htmlEscape(x.meta.caption || roleLabel(x.meta.role))}</small></span></a>`).join("")}</div><div class="showcase-nav"><button class="btn" data-show-prev aria-label="上一張">←</button><span><b data-show-count>1 / ${items.length}</b> · 滾轮切換 · 點圖進入篇章</span><button class="btn" data-show-next aria-label="下一張">→</button></div>`;
    const cards = [...host.querySelectorAll(".focus-card")],
      count = host.querySelector("[data-show-count]");
    const paint = () => {
      const n = cards.length;
      cards.forEach((c, i) => {
        c.classList.remove("is-prev", "is-active", "is-next", "is-hidden");
        const delta = i - active;
        if (delta === 0) c.classList.add("is-active");
        else if (delta === -1 || (active === 0 && i === n - 1))
          c.classList.add("is-prev");
        else if (delta === 1 || (active === n - 1 && i === 0))
          c.classList.add("is-next");
        else c.classList.add("is-hidden");
      });
      if (count) count.textContent = `${active + 1} / ${cards.length}`;
    };
    const step = (dir) => {
      if (cards.length < 2) return;
      active = (active + dir + cards.length) % cards.length;
      paint();
    };
    host
      .querySelector("[data-show-prev]")
      ?.addEventListener("click", () => step(-1));
    host
      .querySelector("[data-show-next]")
      ?.addEventListener("click", () => step(1));
    let wheelLock = false;
    host.querySelector(".focus-stage")?.addEventListener(
      "wheel",
      (e) => {
        e.preventDefault();
        if (wheelLock || cards.length < 2) return;
        wheelLock = true;
        step((e.deltaY || e.deltaX) > 0 ? 1 : -1);
        setTimeout(() => (wheelLock = false), 260);
      },
      { passive: false },
    );
    paint();
  }

  async function renderChapterVisuals() {
    const p = await getProject();
    if (!p?.manifest) return;
    const id = new URLSearchParams(location.search).get("id");
    const hero = qs(".hero");
    if (!hero) return;
    const cover = await chapterVisual(p, id, "cover"),
      header =
        (await chapterVisual(p, id, "header")) ||
        (await chapterVisual(p, id, "showcase"));
    let wrap = qs("#chapterVisuals");
    if (!wrap) {
      hero.insertAdjacentHTML("afterend", '<div id="chapterVisuals"></div>');
      wrap = qs("#chapterVisuals");
    }
    let html = "";
    if (cover)
      html += `<section class="chapter-cover-stage"><img src="${cover.url}" alt="封面"><div class="chapter-cover-label">封面</div></section>`;
    if (header)
      html += `<div class="sticky-chapter-header"><img src="${header.url}" alt="抬頭圖"><span>${htmlEscape(header.meta.caption || header.ch.title)}</span></div>`;
    wrap.innerHTML = html;
  }

  async function renderReaderHeader() {
    const p = await getProject();
    if (!p?.manifest) return;
    const path = new URLSearchParams(location.search).get("file");
    if (!path) return;
    const ch = (p.manifest.chapters || []).find((c) =>
      path.startsWith(c.folder + "/"),
    );
    if (!ch) return;
    const header =
      (await chapterVisual(p, ch.id, "header")) ||
      (await chapterVisual(p, ch.id, "showcase"));
    if (!header) return;
    const main = qs("main.reader");
    if (!main) return;
    let bar = qs("#readerStickyHeader");
    if (!bar) {
      main.insertAdjacentHTML(
        "afterbegin",
        `<div class="sticky-reader-header" id="readerStickyHeader"><img src="${header.url}" alt="${htmlEscape(ch.title)} 抬頭圖"><div><b>${htmlEscape(ch.title)}</b><span>${htmlEscape(header.meta.caption || "抬頭圖")}</span></div></div>`,
      );
    }
  }

  async function deriveImage(encoded) {
    const path = decodeURIComponent(encoded),
      p = await getProject(true);
    if (!p?.manifest) return;
    let file;
    try {
      file = await (await getFileHandleByPath(p.root, path)).getFile();
    } catch (e) {
      alert("讀取原圖失敗：" + e);
      return;
    }
    const url = URL.createObjectURL(file);
    showModal(
      "生成固定比例派生圖",
      `<div class="derivebox"><img class="derive-preview" src="${url}" alt="原圖"><div><p><b>${htmlEscape(basename(path))}</b></p><label class="toolfield">裁切焦點<select id="deriveFocus"><option value="center">居中</option><option value="left">偏左</option><option value="right">偏右</option><option value="top">偏上</option><option value="bottom">偏下</option></select></label><p class="toolhint">原圖不會修改。派生圖寫入本篇圖片目錄下的 <code>derived/</code>。</p><div class="derive-presets"><button class="btn" data-preset="showcase">展臺圖 · 3:2</button><button class="btn" data-preset="header">抬頭圖 · 16:9</button><button class="btn" data-preset="cover">封面圖 · 2:3</button><button class="btn" data-preset="all">一次生成三種</button></div></div></div>`,
    );
    const presets = {
      showcase: {
        w: 1200,
        h: 800,
        suffix: "showcase_3x2",
        role: "showcase",
        variant: "showcase",
      },
      header: {
        w: 1600,
        h: 900,
        suffix: "header_16x9",
        role: "header",
        variant: "header",
      },
      cover: {
        w: 1000,
        h: 1500,
        suffix: "cover_2x3",
        role: "cover",
        variant: "cover",
      },
    };
    const make = async (key) => {
      const spec = presets[key],
        focus = qs("#deriveFocus")?.value || "center",
        bmp = await createImageBitmap(file),
        sw = bmp.width,
        sh = bmp.height,
        target = spec.w / spec.h;
      let cw = sw,
        ch = sh;
      if (sw / sh > target) cw = sh * target;
      else ch = sw / target;
      let sx = (sw - cw) / 2,
        sy = (sh - ch) / 2;
      if (focus === "left") sx = 0;
      if (focus === "right") sx = sw - cw;
      if (focus === "top") sy = 0;
      if (focus === "bottom") sy = sh - ch;
      const canvas = document.createElement("canvas");
      canvas.width = spec.w;
      canvas.height = spec.h;
      canvas
        .getContext("2d")
        .drawImage(bmp, sx, sy, cw, ch, 0, 0, spec.w, spec.h);
      bmp.close?.();
      const blob = await new Promise((r) =>
        canvas.toBlob(r, "image/webp", 0.9),
      );
      const chp = chapterForImagePath(p.manifest, path);
      const baseDir = chp
        ? chp.imageFolder || pathJoin("assets/images", chp.id)
        : dirname(path);
      const outDir = pathJoin(baseDir, "derived");
      await getDir(p.root, outDir, true);
      const stem = basename(path).replace(/\.[^.]+$/, "");
      let out = pathJoin(outDir, `${stem}_${spec.suffix}.webp`);
      if (
        (await existsPath(p.root, out)) &&
        !confirm(`派生圖已存在：\n${out}\n\n覆蓋嗎？`)
      )
        return null;
      await writeBlob(p.root, out, blob);
      p.manifest.imageMeta ||= {};
      p.manifest.imageMeta[out] = {
        role: spec.role,
        caption:
          (p.manifest.imageMeta?.[path]?.caption || stem) +
          " · " +
          (key === "cover" ? "封面" : key === "header" ? "抬頭" : "展臺"),
        derivedFrom: path,
        variant: spec.variant,
        ratio: `${spec.w}:${spec.h}`,
      };
      return out;
    };
    qsa("[data-preset]").forEach(
      (b) =>
        (b.onclick = async () => {
          b.disabled = true;
          try {
            const key = b.dataset.preset;
            if (key === "all") {
              for (const k of ["showcase", "header", "cover"]) await make(k);
            } else await make(key);
            await writeManifest(p.root, p.manifest);
            showToast("派生圖已生成");
            setTimeout(() => location.reload(), 500);
          } catch (e) {
            alert("生成失敗：" + (e.message || e));
          } finally {
            b.disabled = false;
          }
        }),
    );
  }

  async function initHome() {
    await native.initHome();
    await ensureSchema();
    injectWorkbenchTools();
    const p = await getProject();
    if (!p) return;
    await renderShowcase(p);
    const docs = await collectMarkdown(p),
      total = docs.reduce((a, b) => a + b.words, 0),
      hero = qs(".hero"),
      heroCopy = qs(".hero-copy") || hero;
    if (heroCopy && !qs("#wbDashboard"))
      heroCopy.insertAdjacentHTML(
        "beforeend",
        `<div class="wb-dashboard" id="wbDashboard"><span><b>${docs.length}</b> Markdown</span><span><b>${total.toLocaleString()}</b> 字</span><button class="btn" onclick="WB.search()">全局搜尋</button><button class="btn" onclick="WB.backup()">建立快照</button></div>`,
      );
    const last = localStorage.getItem("NOVEL_DEMO_WB_LAST_URL");
    if (last && last !== location.href) {
      const n = document.createElement("div");
      n.className = "continue-work";
      n.innerHTML = `<span>上次工作：</span><a href="${htmlEscape(last)}">繼續上次位置 →</a>`;
      heroCopy?.appendChild(n);
    }
  }

  // workspace persistence
  if (location.pathname && !/index\.html?$/.test(location.pathname))
    localStorage.setItem("NOVEL_DEMO_WB_LAST_URL", location.href);
  function saveScroll() {
    if (editorPath && !qs("#mdEditor"))
      localStorage.setItem(
        "NOVEL_DEMO_WB_SCROLL:" + editorPath,
        String(window.scrollY),
      );
  }
  function restoreScroll(path) {
    const y = Number(localStorage.getItem("NOVEL_DEMO_WB_SCROLL:" + path) || 0);
    if (y) setTimeout(() => scrollTo(0, y), 100);
  }
  window.addEventListener("pagehide", saveScroll);

  BY.initHome = initHome;
  BY.initReader = initReader;
  const wrapInit = (name) => {
    const orig = BY[name];
    BY[name] = async function () {
      await orig.apply(this, arguments);
      await ensureSchema();
      injectWorkbenchTools();
      if (name === "initChapter") await renderChapterVisuals();
    };
  };
  wrapInit("initChapter");
  wrapInit("initImages");

  window.WB = {
    version: WB_VERSION,
    closeModal,
    search: () => openSearch(),
    backup: makeBackup,
    health: healthCheck,
    stats: showStats,
    trash: trashPanel,
    save: saveEditor,
    deriveImage,
  };
  setTimeout(injectWorkbenchTools, 300);
})();
