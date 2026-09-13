const DB = "novel-demo-folder-db",
  STORE = "handles",
  KEY = "root";
const DEFAULT_COLORS = {
  baizi: "#ffffff",
  unknown: "#050505",
  horror: "#b91c1c",
  melancholy: "#2563eb",
};
const DEFAULT_THEMES = [
  { id: "baizi", label: "中性", color: "#f4f4f5" },
  { id: "unknown", label: "未知", color: "#3f3f46" },
  { id: "horror", label: "恐怖懸疑", color: "#b91c1c" },
  { id: "melancholy", label: "憂鬱", color: "#2563eb" },
  { id: "light", label: "輕快", color: "#65a30d" },
  { id: "romance", label: "戀愛", color: "#db2777" },
  { id: "passion", label: "熱血", color: "#d97706" },
];
let CURRENT_PROJECT = null,
  AUDIO_URL = "";
let CURRENT_EDIT_CHAPTER = "";
const runtimeIssues = [];
function reportIssue(context, error) {
  if (error?.name === "AbortError") return;
  const message = context + "：" + (error?.message || String(error));
  if (!runtimeIssues.includes(message)) runtimeIssues.push(message);
  let panel = qs("#runtimeIssues");
  if (!panel) {
    panel = document.createElement("details");
    panel.id = "runtimeIssues";
    panel.className = "notice";
    panel.style.cssText =
      "margin:16px;padding:16px;border:1px solid #ef4444;border-radius:12px";
    (qs("main") || document.body).prepend(panel);
  }
  panel.replaceChildren();
  const summary = document.createElement("summary");
  summary.textContent =
    "有 " + runtimeIssues.length + " 項操作或讀取問題（點此查看）";
  panel.append(summary);
  for (const issue of runtimeIssues) {
    const row = document.createElement("p");
    row.textContent = issue;
    panel.append(row);
  }
  setStatus("部分操作未完成，請查看問題提示。");
}
window.addEventListener("unhandledrejection", (e) => {
  reportIssue("操作未完成", e.reason);
  e.preventDefault();
});
window.addEventListener(
  "error",
  (e) => {
    if (e.target?.tagName === "IMG")
      reportIssue("圖片無法顯示", e.target.alt || "未命名圖片");
    else if (e.error) reportIssue("頁面程式錯誤", e.error);
  },
  true,
);
function deletionUnavailable() {
  reportIssue(
    "無法刪除",
    new Error("安全刪除模組未載入，操作已停止，原檔保留。"),
  );
  return false;
}

function qs(s, r = document) {
  return r.querySelector(s);
}
function qsa(s, r = document) {
  return [...r.querySelectorAll(s)];
}
function esc(s = "") {
  return String(s).replace(
    /[&<>"']/g,
    (m) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        m
      ],
  );
}
function cleanName(s = "") {
  return s.replace(/[\\/:*?"<>|]/g, "_").trim();
}
function pathJoin(...parts) {
  return parts
    .filter(Boolean)
    .join("/")
    .replace(/\/+/g, "/")
    .replace(/^\/|\/$/g, "");
}
function dirname(path) {
  const a = path.split("/").filter(Boolean);
  a.pop();
  return a.join("/");
}
function basename(path) {
  return path.split("/").filter(Boolean).pop() || "";
}
function extname(path) {
  const n = basename(path),
    i = n.lastIndexOf(".");
  return i > 0 ? n.slice(i) : "";
}

function openDB() {
  return new Promise((res, rej) => {
    const r = indexedDB.open(DB, 1);
    r.onupgradeneeded = () => {
      if (!r.result.objectStoreNames.contains(STORE))
        r.result.createObjectStore(STORE);
    };
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
}
async function setRoot(h) {
  const db = await openDB();
  return new Promise((res, rej) => {
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).put(h, KEY);
    tx.oncomplete = res;
    tx.onerror = () => rej(tx.error);
  });
}
async function getRoot() {
  const db = await openDB();
  return new Promise((res, rej) => {
    const tx = db.transaction(STORE, "readonly");
    const r = tx.objectStore(STORE).get(KEY);
    r.onsuccess = () => res(r.result || null);
    r.onerror = () => rej(r.error);
  });
}
async function clearRoot() {
  const db = await openDB();
  return new Promise((res, rej) => {
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).delete(KEY);
    tx.oncomplete = res;
    tx.onerror = () => rej(tx.error);
  });
}
async function queryPermission(h, write = false) {
  if (!h) return "denied";
  try {
    return await h.queryPermission({ mode: write ? "readwrite" : "read" });
  } catch (e) {
    return "denied";
  }
}
async function requestPermission(h, write = false) {
  if (!h) return false;
  try {
    return (
      (await h.requestPermission({ mode: write ? "readwrite" : "read" })) ===
      "granted"
    );
  } catch (e) {
    if (e.name !== "NotFoundError") {
      reportIssue("檢查檔案或權限", e);
      throw e;
    }
    return false;
  }
}
async function chooseRoot() {
  if (!window.showDirectoryPicker) {
    alert("目前瀏覽器不支持 Folder Mode。請使用桌面版 Chrome / Edge。");
    return null;
  }
  const h = await showDirectoryPicker({ mode: "readwrite" });
  await setRoot(h);
  return h;
}
async function getDir(root, path, create = false) {
  let d = root;
  for (const p of path.split("/").filter(Boolean))
    d = await d.getDirectoryHandle(p, { create });
  return d;
}
async function getFileHandleByPath(root, path, create = false) {
  const parts = path.split("/").filter(Boolean),
    file = parts.pop();
  let d = root;
  for (const p of parts) d = await d.getDirectoryHandle(p, { create });
  return await d.getFileHandle(file, { create });
}
async function readText(root, path) {
  const fh = await getFileHandleByPath(root, path);
  return await (await fh.getFile()).text();
}
async function writeText(root, path, text) {
  const fh = await getFileHandleByPath(root, path, true),
    w = await fh.createWritable();
  await w.write(text);
  await w.close();
}
async function writeBlob(root, path, blob) {
  const fh = await getFileHandleByPath(root, path, true),
    w = await fh.createWritable();
  await w.write(blob);
  await w.close();
}
async function readManifest(root) {
  try {
    return JSON.parse(await readText(root, "data/manifest.json"));
  } catch (e) {
    reportIssue("讀取 data/manifest.json", e);
    return null;
  }
}
async function writeManifest(root, m) {
  await writeText(root, "data/manifest.json", JSON.stringify(m, null, 2));
}
async function existsPath(root, path, kind = "file") {
  try {
    if (kind === "directory") await getDir(root, path);
    else await getFileHandleByPath(root, path);
    return true;
  } catch (e) {
    return false;
  }
}
async function removePath(root, path, recursive = false) {
  const parts = path.split("/").filter(Boolean),
    name = parts.pop();
  const parent = await getDir(root, parts.join("/"));
  await parent.removeEntry(name, { recursive });
}
async function copyFile(root, from, to) {
  const fh = await getFileHandleByPath(root, from);
  await writeBlob(root, to, await fh.getFile());
}
async function moveFile(root, from, to) {
  if (from === to) return;
  if (await existsPath(root, to, "file")) throw new Error("目標檔案已存在");
  await copyFile(root, from, to);
  await removePath(root, from);
}
async function copyDirRecursive(srcDir, dstDir) {
  for await (const [name, h] of srcDir.entries()) {
    if (h.kind === "file") {
      const out = await dstDir.getFileHandle(name, { create: true }),
        w = await out.createWritable();
      await w.write(await h.getFile());
      await w.close();
    } else {
      const sub = await dstDir.getDirectoryHandle(name, { create: true });
      await copyDirRecursive(h, sub);
    }
  }
}
async function moveDir(root, from, to) {
  if (from === to) return;
  if (await existsPath(root, to, "directory"))
    throw new Error("目標資料夾已存在");
  const src = await getDir(root, from);
  const dst = await getDir(root, to, true);
  await copyDirRecursive(src, dst);
  await removePath(root, from, true);
}
function pickLocalFile(accept = "") {
  return new Promise((res) => {
    const i = document.createElement("input");
    i.type = "file";
    i.accept = accept;
    i.style.display = "none";
    document.body.appendChild(i);
    i.onchange = () => {
      const f = i.files?.[0] || null;
      i.remove();
      res(f);
    };
    i.oncancel = () => {
      i.remove();
      res(null);
    };
    i.click();
  });
}

async function listFilesRecursive(dir, exts = null, prefix = "") {
  const out = [];
  for await (const [name, h] of dir.entries()) {
    if (
      h.kind === "file" &&
      (!exts || exts.some((x) => name.toLowerCase().endsWith(x)))
    )
      out.push({ name, path: prefix + name, handle: h });
    else if (h.kind === "directory")
      out.push(...(await listFilesRecursive(h, exts, prefix + name + "/")));
  }
  return out.sort((a, b) =>
    a.path.localeCompare(b.path, "zh-Hans-CN", { numeric: true }),
  );
}
async function listImagesRecursive(dir, prefix = "") {
  return listFilesRecursive(
    dir,
    [".png", ".jpg", ".jpeg", ".webp", ".gif"],
    prefix,
  );
}
async function listAudioRecursive(dir, prefix = "") {
  return listFilesRecursive(dir, [".mp3", ".wav"], prefix);
}
async function scanTree(dir, prefix = "") {
  const items = [];
  for await (const [name, h] of dir.entries()) {
    if (name.startsWith(".")) continue;
    if (h.kind === "directory") {
      items.push({
        kind: "directory",
        name,
        path: prefix + name,
        children: await scanTree(h, prefix + name + "/"),
      });
    } else if (name.toLowerCase().endsWith(".md"))
      items.push({ kind: "file", name, path: prefix + name, handle: h });
  }
  items.sort((a, b) =>
    a.kind === b.kind
      ? a.name.localeCompare(b.name, "zh-Hans-CN", { numeric: true })
      : a.kind === "directory"
        ? -1
        : 1,
  );
  return items;
}

function mdInline(s) {
  return esc(s)
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    .replace(/~~(.+?)~~/g, "<del>$1</del>")
    .replace(/\*(.+?)\*/g, "<em>$1</em>")
    .replace(/`(.+?)`/g, "<code>$1</code>");
}
function splitTableRow(line) {
  return line
    .trim()
    .replace(/^\||\|$/g, "")
    .split("|")
    .map((x) => x.trim());
}
function isTableSep(line) {
  const cells = splitTableRow(line);
  return cells.length > 0 && cells.every((c) => /^:?-{3,}:?$/.test(c));
}
function mdToHtml(md) {
  const lines = md.replace(/\r/g, "").split("\n");
  let html = "",
    inUL = false,
    inOL = false,
    inCode = false,
    code = [];
  const close = () => {
    if (inUL) {
      html += "</ul>";
      inUL = false;
    }
    if (inOL) {
      html += "</ol>";
      inOL = false;
    }
  };
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    if (l.startsWith("```")) {
      close();
      if (!inCode) {
        inCode = true;
        code = [];
      } else {
        html += "<pre><code>" + esc(code.join("\n")) + "</code></pre>";
        inCode = false;
      }
      continue;
    }
    if (inCode) {
      code.push(l);
      continue;
    }
    if (!l.trim()) {
      close();
      continue;
    }
    if (/^\s*---+\s*$/.test(l)) {
      close();
      html += "<hr>";
      continue;
    }
    if (l.includes("|") && i + 1 < lines.length && isTableSep(lines[i + 1])) {
      close();
      const heads = splitTableRow(l);
      let t = '<div class="tablewrap"><table><thead><tr>';
      heads.forEach((h) => (t += "<th>" + mdInline(h) + "</th>"));
      t += "</tr></thead><tbody>";
      i += 2;
      while (i < lines.length && lines[i].includes("|") && lines[i].trim()) {
        const cells = splitTableRow(lines[i]);
        t += "<tr>";
        for (let j = 0; j < heads.length; j++)
          t += "<td>" + mdInline(cells[j] || "") + "</td>";
        t += "</tr>";
        i++;
      }
      i--;
      t += "</tbody></table></div>";
      html += t;
      continue;
    }
    let m;
    if ((m = l.match(/^(#{1,6})\s+(.+)$/))) {
      close();
      const n = m[1].length;
      html += `<h${n}>${mdInline(m[2])}</h${n}>`;
      continue;
    }
    if ((m = l.match(/^>\s?(.*)$/))) {
      close();
      html += `<blockquote>${mdInline(m[1])}</blockquote>`;
      continue;
    }
    if ((m = l.match(/^[-*+]\s+(.+)$/))) {
      if (inOL) {
        html += "</ol>";
        inOL = false;
      }
      if (!inUL) {
        html += "<ul>";
        inUL = true;
      }
      html += `<li>${mdInline(m[1])}</li>`;
      continue;
    }
    if ((m = l.match(/^\d+[.)]\s+(.+)$/))) {
      if (inUL) {
        html += "</ul>";
        inUL = false;
      }
      if (!inOL) {
        html += "<ol>";
        inOL = true;
      }
      html += `<li>${mdInline(m[1])}</li>`;
      continue;
    }
    close();
    html += `<p>${mdInline(l)}</p>`;
  }
  close();
  return html;
}
function extractSections(md) {
  const lines = md.replace(/\r/g, "").split("\n");
  const sections = [];
  let current = { title: "全文", lines: [] };
  for (const line of lines) {
    const m = line.match(/^(#{2,3})\s+(.+)$/);
    if (m) {
      if (current.lines.length || current.title !== "全文")
        sections.push(current);
      current = { title: m[2].trim(), lines: [line] };
    } else current.lines.push(line);
  }
  if (current.lines.length || current.title !== "全文") sections.push(current);
  return sections;
}

function normalizeThemes(m) {
  if (Array.isArray(m?.themes) && m.themes.length)
    return m.themes
      .filter((x) => x && x.id)
      .map((x) => ({
        id: String(x.id),
        label: String(x.label || x.id),
        color: /^#[0-9a-f]{6}$/i.test(x.color || "") ? x.color : "#71717a",
      }));
  const colors = { ...DEFAULT_COLORS, ...(m?.colors || {}) };
  return DEFAULT_THEMES.slice(0, 4).map((x) => ({
    ...x,
    color: colors[x.id] || x.color,
  }));
}
function themeInfo(m, id) {
  return (
    normalizeThemes(m).find((x) => x.id === id) || {
      id: id || "unknown",
      label: id || "未知",
      color: "#71717a",
    }
  );
}
function applyColors(m) {
  const themes = normalizeThemes(m),
    find = (id, fallback) => themes.find((x) => x.id === id)?.color || fallback;
  document.documentElement.style.setProperty("--white", find("baizi", "#fff"));
  document.documentElement.style.setProperty(
    "--black",
    find("unknown", "#050505"),
  );
  document.documentElement.style.setProperty(
    "--red",
    find("horror", "#b91c1c"),
  );
  document.documentElement.style.setProperty(
    "--blue",
    find("melancholy", "#2563eb"),
  );
}
function setStatus(msg) {
  const e = qs("#projectStatus");
  if (e) e.textContent = msg;
}
function setReconnectUI(root, needsPermission = false) {
  const b = qs("#reconnectBtn");
  if (!b) return;
  if (root) {
    b.hidden = false;
    b.textContent = needsPermission
      ? `恢復上次項目：${root.name}`
      : `重新載入：${root.name}`;
  } else b.hidden = true;
}
async function getProject(write = false) {
  if (window.SHOWCASE_BROWSE) return null;
  const root = await getRoot();
  if (!root) {
    setStatus("尚未選擇項目資料夾");
    setReconnectUI(null);
    return null;
  }
  const state = await queryPermission(root, write);
  if (state !== "granted") {
    setStatus(`已記住項目「${root.name}」，請點“恢復上次項目”授權`);
    setReconnectUI(root, true);
    return null;
  }
  const manifest = await readManifest(root);
  if (!manifest) {
    setStatus("找不到 data/manifest.json，請確認選擇的是項目根目錄");
    setReconnectUI(root, false);
    return { root, manifest: null };
  }
  manifest.imageMeta ||= {};
  manifest.audio ||= {
    folder: "assets/audio",
    track: "",
    volume: 0.35,
    loop: true,
  };
  manifest.colors = { ...DEFAULT_COLORS, ...(manifest.colors || {}) };
  manifest.themes = normalizeThemes(manifest);
  applyColors(manifest);
  setStatus("已連接：" + root.name);
  setReconnectUI(root, false);
  CURRENT_PROJECT = { root, manifest };
  renderSidebar(CURRENT_PROJECT);
  await ensureGlobalTools(CURRENT_PROJECT);
  return CURRENT_PROJECT;
}
async function reconnect() {
  const root = await getRoot();
  if (!root) return connect();
  if (await requestPermission(root, true)) location.reload();
  else alert("瀏覽器沒有授予項目資料夾權限。");
}
async function connect() {
  const h = await chooseRoot();
  if (h) location.reload();
}
async function forgetProject() {
  await clearRoot();
  location.reload();
}

function compactSeriesLabel(title = "") {
  return title;
}
function renderSidebar(p) {
  if (qs("#bySidebar") || !p?.manifest) return;
  document.body.classList.add("with-sidebar");
  const docs = p.manifest.seriesDocs || [];
  const supplements = (p.manifest.seriesDocs || []).filter(
    (x) => !docs.includes(x),
  );
  const ch = p.manifest.chapters || [];
  document.body.insertAdjacentHTML(
    "afterbegin",
    `<aside class="bysidenav" id="bySidebar"><div class="sidebrand"><div class="mark">文</div><div><strong>${esc(p.manifest.project?.title || "本地小說企劃展示與整理臺")}</strong><small>ver1.3 · Local CMS</small></div></div><div class="sidenavscroll"><div class="sidegroup"><div class="sidegrouptitle">使用說明</div>${docs.map((d) => `<div class="sidefile"><a target="_blank" href="reader.html?file=${encodeURIComponent(d.path)}" title="${esc(d.path)}">${esc(compactSeriesLabel(d.title))}</a><span class="sideops"><button title="替換" onclick="BY.replaceSeriesDoc('${encodeURIComponent(d.path)}')">↻</button><button title="刪除" class="danger" onclick="BY.deleteSeriesDoc('${encodeURIComponent(d.path)}')">×</button></span></div>`).join("")}<button class="sideadd" onclick="BY.addSeriesDoc()">＋ 新增說明 MD</button></div><div class="sidegroup"><div class="sidegrouptitle">篇章</div>${ch.map((c) => `<a class="sidelink" href="chapter.html?id=${encodeURIComponent(c.id)}"><span>${esc(c.title)}</span><small>${esc(c.subtitle || "")}</small></a>`).join("")}</div>${supplements.length ? `<details class="sidegroup"><summary class="sidegrouptitle">補充 / Guide</summary>${supplements.map((d) => `<a class="sidelink compact" target="_blank" href="reader.html?file=${encodeURIComponent(d.path)}">${esc(d.title)}</a>`).join("")}</details>` : ""}<div class="sidegroup"><div class="sidegrouptitle">素材</div><a class="sidelink compact" href="images.html">圖片庫</a></div></div><button class="sidecollapse" onclick="BY.toggleSidebar()">‹</button></aside><button class="sideopen" id="sideOpen" onclick="BY.toggleSidebar()">☰</button>`,
  );
}
function toggleSidebar() {
  document.body.classList.toggle("sidebar-collapsed");
}
function themeLabel(t, m = CURRENT_PROJECT?.manifest) {
  return themeInfo(m, t).label;
}
function fillThemeSelect(select, m, selected = "") {
  if (!select) return;
  select.innerHTML = normalizeThemes(m)
    .map(
      (t) =>
        `<option value="${esc(t.id)}" ${t.id === selected ? "selected" : ""}>${esc(t.label)}</option>`,
    )
    .join("");
}
function roleLabel(r) {
  return (
    {
      showcase: "展臺圖",
      header: "抬頭圖",
      cover: "封面",
      illustration: "插圖",
      character: "角色圖",
      reference: "參考圖",
      other: "其他",
    }[r] || "未分類"
  );
}
function audioLabel(manifest, path) {
  return (
    manifest.chapters?.find((chapter) => chapter.audioTrack === path)
      ?.audioTitle || basename(path)
  );
}
function chapterForImagePath(manifest, path) {
  return (
    manifest.chapters.find((c) =>
      path.startsWith(
        (c.imageFolder || "assets/images/" + c.id).replace(/\/$/, "") + "/",
      ),
    ) || null
  );
}
async function objectUrlForPath(root, path) {
  try {
    const fh = await getFileHandleByPath(root, path);
    return URL.createObjectURL(await fh.getFile());
  } catch (e) {
    reportIssue("讀取圖片 " + path, e);
    return "";
  }
}

async function replaceSeriesDoc(encoded) {
  const path = decodeURIComponent(encoded),
    p = await getProject(true);
  if (!p?.manifest) return;
  const f = await pickLocalFile(".md,text/markdown,text/plain");
  if (!f) return;
  if (
    !confirm(`用「${f.name}」的內容替換：\n${path}\n\n檔名與位置會保持不變。`)
  )
    return;
  await writeBlob(p.root, path, f);
  alert("已替換：" + path);
  location.reload();
}
async function deleteSeriesDoc(...args) {
  return window.SafeDelete?.deleteSeriesDoc
    ? window.SafeDelete.deleteSeriesDoc(...args)
    : deletionUnavailable();
}
async function addSeriesDoc() {
  const p = await getProject(true);
  if (!p?.manifest) return;
  let name = prompt("新系列 Markdown 檔名（例如 Guide_Notes.md）");
  if (!name) return;
  name = cleanName(name);
  if (!/\.md$/i.test(name)) name += ".md";
  const path = "content/_series/" + name;
  if (await existsPath(p.root, path)) {
    alert("同名文件已存在。");
    return;
  }
  const title =
    prompt("顯示標題", name.replace(/\.md$/i, "")) ||
    name.replace(/\.md$/i, "");
  await writeText(p.root, path, `# ${title}\n\n> 用途：（待補）\n\n`);
  p.manifest.seriesDocs.push({ title, path, group: "使用說明" });
  await writeManifest(p.root, p.manifest);
  location.reload();
}

async function initHome() {
  const p = await getProject();
  if (!p?.manifest) return;
  const { manifest, root } = p;
  qs("#projectTitle").textContent =
    manifest.project?.title || "本地小說企劃展示與整理臺";
  qs("#projectSub").textContent = manifest.project?.subtitle || "";
  const box = qs("#chapterGrid");
  box.innerHTML = "";
  for (const c of manifest.chapters) {
    let cover = "";
    const theme = themeInfo(manifest, c.theme);
    const coverPath = Object.entries(manifest.imageMeta || {}).find(
      ([path, meta]) =>
        meta?.role === "cover" &&
        chapterForImagePath(manifest, path)?.id === c.id,
    )?.[0];
    if (coverPath) cover = await objectUrlForPath(root, coverPath);
    box.insertAdjacentHTML(
      "beforeend",
      `<article class="card" data-theme-id="${esc(theme.id)}" style="--accent:${esc(theme.color)}">${cover ? `<a href="images.html?chapter=${encodeURIComponent(c.id)}" class="coverthumb"><img src="${cover}" alt="${esc(c.title)} 封面"></a>` : ""}<span class="badge"><i class="theme-dot" style="background:${esc(theme.color)}"></i>${esc(theme.label)}</span><h3>${esc(c.title)}</h3><div class="meta">${esc(c.subtitle || "")}</div><p>${esc(c.description || "點擊進入篇章頁，管理子資料夾、Markdown 與本篇圖片。")}</p><div class="actions"><a class="action" href="chapter.html?id=${encodeURIComponent(c.id)}">進入篇章</a><a class="action" href="images.html?chapter=${encodeURIComponent(c.id)}">圖片</a></div></article>`,
    );
  }
  if (!box.children.length)
    box.innerHTML = '<div class="empty">尚無篇章。</div>';
}

function folderControls(chId, rel) {
  const e = encodeURIComponent(rel);
  return `<span class="fileops"><button onclick="BY.newFolder('${chId}','${e}')">＋夾</button><button onclick="BY.newMarkdown('${chId}','${e}')">＋MD</button><button onclick="BY.importDocx('${chId}','${e}')" title="把 Word／WPS 的 DOCX 轉成 Markdown">＋DOCX</button>${rel ? `<button onclick="BY.renameChapterFolder('${chId}','${e}')">改名</button><button class="danger" onclick="BY.deleteChapterFolder('${chId}','${e}')">刪除</button>` : ""}</span>`;
}
function fileControls(chId, rel) {
  const e = encodeURIComponent(rel);
  return `<span class="fileops"><a target="_blank" href="reader.html?file=${encodeURIComponent(pathJoin(CURRENT_PROJECT.manifest.chapters.find((c) => c.id === chId).folder, rel))}">打開</a><button onclick="BY.replaceChapterFile('${chId}','${e}')">替換</button><button onclick="BY.renameChapterFile('${chId}','${e}')">改名</button><button onclick="BY.moveChapterFile('${chId}','${e}')">移動</button><button class="danger" onclick="BY.deleteChapterFile('${chId}','${e}')">刪除</button></span>`;
}
async function renderTreeNodes(ch, items, depth = 0) {
  let html = "";
  for (const item of items) {
    if (item.kind === "directory") {
      html += `<div class="treefolder" style="--depth:${depth}"><div class="treerow folderrow"><span class="treeicon">▾</span><strong>${esc(item.name)}</strong><span class="treepath">${esc(item.path)}</span>${folderControls(ch.id, item.path)}</div><div class="treechildren">${await renderTreeNodes(ch, item.children, depth + 1)}</div></div>`;
    } else {
      let secHtml = "";
      try {
        const md = await (await item.handle.getFile()).text();
        const secs = WBReader.outline(md);
        if (secs.length)
          secHtml = `<div class="treesections">${secs.map((s) => `<a target="_blank" href="reader.html?file=${encodeURIComponent(pathJoin(ch.folder, item.path))}&anchor=${encodeURIComponent(s.id)}">${esc(s.title)}</a>`).join("")}</div>`;
      } catch (e) {
        reportIssue("讀取文檔 " + item.path, e);
      }
      html += `<div class="treefile" style="--depth:${depth}"><div class="treerow"><span class="treeicon">MD</span><div class="treefilemain"><strong>${esc(item.name.replace(/\.md$/i, ""))}</strong><span class="treepath">${esc(item.path)}</span></div>${fileControls(ch.id, item.path)}</div>${secHtml}</div>`;
    }
  }
  return html;
}
async function refreshChapterTree(ch) {
  const p = CURRENT_PROJECT || (await getProject());
  if (!p) return;
  const list = qs("#docList");
  if (!list) return;
  try {
    const dir = await getDir(p.root, ch.folder);
    const tree = await scanTree(dir);
    list.innerHTML = `<div class="treebar"><div><strong>文件結構</strong><span>${esc(ch.folder)}</span></div>${folderControls(ch.id, "")}</div><div class="filetree">${await renderTreeNodes(ch, tree)}</div>`;
    if (!tree.length)
      list.innerHTML += `<div class="empty">這個篇章還沒有 Markdown。可從上方新增資料夾或 Markdown。</div>`;
  } catch (e) {
    reportIssue("讀取篇章 " + ch.folder, e);
    list.innerHTML =
      '<div class="empty">找不到篇章資料夾：' + esc(ch.folder) + "</div>";
  }
}
async function initChapter() {
  const p = await getProject();
  if (!p?.manifest) return;
  const id = new URLSearchParams(location.search).get("id");
  const c = p.manifest.chapters.find((x) => x.id === id);
  if (!c) {
    qs("#chapterTitle").textContent = "找不到篇章";
    return;
  }
  const theme = themeInfo(p.manifest, c.theme);
  qs("#chapterTitle").textContent = c.title;
  qs("#chapterSub").textContent = c.subtitle || "";
  qs("#chapterTheme").textContent = theme.label;
  qs("#chapterTheme").style.color = theme.color;
  qs("#imagesLink").href = "images.html?chapter=" + encodeURIComponent(c.id);
  const edit = qs("#editChapterBtn");
  if (edit) edit.onclick = () => openChapterSettings(c.id);
  setupDocxDropZone(c);
  await refreshChapterTree(c);
}
function getChapter(id) {
  return CURRENT_PROJECT?.manifest?.chapters?.find((c) => c.id === id);
}
async function newFolder(chId, encodedParent = "") {
  const p = await getProject(true),
    ch = getChapter(chId);
  if (!p || !ch) return;
  const parent = decodeURIComponent(encodedParent || "");
  let name = prompt("新子資料夾名稱");
  if (!name) return;
  name = cleanName(name);
  if (!name) return;
  const rel = pathJoin(parent, name),
    full = pathJoin(ch.folder, rel);
  if (await existsPath(p.root, full, "directory")) {
    alert("資料夾已存在。");
    return;
  }
  await getDir(p.root, full, true);
  await refreshChapterTree(ch);
}
async function newMarkdown(chId, encodedParent = "") {
  const p = await getProject(true),
    ch = getChapter(chId);
  if (!p || !ch) return;
  const parent = decodeURIComponent(encodedParent || "");
  let name = prompt("新 Markdown 檔名");
  if (!name) return;
  name = cleanName(name);
  if (!/\.md$/i.test(name)) name += ".md";
  const rel = pathJoin(parent, name),
    full = pathJoin(ch.folder, rel);
  if (await existsPath(p.root, full)) {
    alert("同名文件已存在。");
    return;
  }
  const title = name.replace(/\.md$/i, "");
  await writeText(p.root, full, `# ${title}\n\n（待補）\n`);
  await refreshChapterTree(ch);
}

function setupDocxDropZone(ch) {
  const list = qs("#docList");
  if (!list || qs("#docxDropZone")) return;
  const zone = document.createElement("div");
  zone.id = "docxDropZone";
  zone.className = "docx-dropzone";
  zone.innerHTML =
    '<strong>匯入 Word／WPS 文稿</strong><span>把 .docx 拖到這裡，或使用文件夾旁的「＋DOCX」。文件會在本機轉成 Markdown，原始 DOCX 不會被修改。</span>';
  list.before(zone);
  zone.addEventListener("dragover", (event) => {
    event.preventDefault();
    if (event.dataTransfer) event.dataTransfer.dropEffect = "copy";
    zone.classList.add("is-dragging");
  });
  zone.addEventListener("dragleave", () => zone.classList.remove("is-dragging"));
  zone.addEventListener("drop", async (event) => {
    event.preventDefault();
    zone.classList.remove("is-dragging");
    const file = [...(event.dataTransfer?.files || [])].find((item) =>
      /\.docx$/i.test(item.name),
    );
    if (!file) {
      alert("請拖入 .docx 文件；舊版 .doc 格式不受支援。");
      return;
    }
    await importDocx(ch.id, "", file);
  });
}

async function importDocx(chId, encodedParent = "", providedFile = null) {
  const p = await getProject(true), ch = getChapter(chId);
  if (!p || !ch) return false;
  const file =
    providedFile ||
    (await pickLocalFile(
      ".docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    ));
  if (!file) return false;
  if (!/\.docx$/i.test(file.name || "")) {
    alert("請選擇 .docx 文件；舊版 .doc 格式不受支援。");
    return false;
  }
  if (!window.DocxImporter) {
    reportIssue("匯入 DOCX", new Error("DOCX 轉換模組未載入"));
    return false;
  }
  const parent = decodeURIComponent(encodedParent || "");
  const suggested = cleanName(file.name.replace(/\.docx$/i, "")) || "imported-document";
  let name = prompt("匯入後的 Markdown 檔名", suggested + ".md");
  if (!name) return false;
  name = cleanName(name);
  if (!/\.md$/i.test(name)) name += ".md";
  const rel = pathJoin(parent, name), full = pathJoin(ch.folder, rel);
  if (await existsPath(p.root, full)) {
    alert("同名 Markdown 已存在，請換一個檔名後再匯入。");
    return false;
  }
  const title = name.replace(/\.md$/i, "");
  const imageRoot = ch.imageFolder || pathJoin("assets/images", ch.id);
  let assetFolder = pathJoin(imageRoot, "imports", cleanName(title));
  if (await existsPath(p.root, assetFolder, "directory"))
    assetFolder += "-" + new Date().toISOString().replace(/\D/g, "").slice(0, 14);
  setStatus("正在本機轉換 DOCX…");
  try {
    const result = await window.DocxImporter.convert(file, {
      title,
      assetBase: assetFolder,
    });
    for (const media of result.media) {
      await writeBlob(p.root, media.path, media.blob);
      p.manifest.imageMeta ||= {};
      p.manifest.imageMeta[media.path] = {
        role: "illustration",
        caption: title + " · DOCX 匯入圖片",
      };
    }
    if (result.media.length) await writeManifest(p.root, p.manifest);
    await writeText(p.root, full, result.markdown);
    await refreshChapterTree(ch);
    setStatus(
      `已匯入 ${file.name} → ${full}${result.media.length ? `，並抽取 ${result.media.length} 張圖片` : ""}`,
    );
    alert(
      `DOCX 已轉成 Markdown：\n${full}` +
        (result.media.length ? `\n已抽取 ${result.media.length} 張內嵌圖片。` : "") +
        "\n\n複雜排版、註解、修訂記錄與頁首頁尾可能不會保留，請打開文件檢查一次。",
    );
    return true;
  } catch (error) {
    reportIssue("匯入 DOCX " + file.name, error);
    return false;
  }
}
async function replaceChapterFile(chId, encodedRel) {
  const p = await getProject(true),
    ch = getChapter(chId);
  if (!p || !ch) return;
  const rel = decodeURIComponent(encodedRel),
    full = pathJoin(ch.folder, rel),
    f = await pickLocalFile(".md,text/markdown,text/plain");
  if (!f) return;
  if (
    !confirm(
      `替換真實文件：\n${full}\n\n將使用「${f.name}」的內容覆蓋它，目標檔案名保持不變。`,
    )
  )
    return;
  await writeBlob(p.root, full, f);
  await refreshChapterTree(ch);
}
async function deleteChapterFile(...args) {
  return window.SafeDelete?.deleteChapterFile
    ? window.SafeDelete.deleteChapterFile(...args)
    : deletionUnavailable();
}
async function renameChapterFile(chId, encodedRel) {
  const p = await getProject(true),
    ch = getChapter(chId);
  if (!p || !ch) return;
  const rel = decodeURIComponent(encodedRel),
    old = basename(rel);
  let name = prompt("新檔名", old);
  if (!name || name === old) return;
  name = cleanName(name);
  if (!/\.md$/i.test(name)) name += ".md";
  const dest = pathJoin(dirname(rel), name);
  try {
    await moveFile(p.root, pathJoin(ch.folder, rel), pathJoin(ch.folder, dest));
    await refreshChapterTree(ch);
  } catch (e) {
    alert(e.message || String(e));
  }
}
async function moveChapterFile(chId, encodedRel) {
  const p = await getProject(true),
    ch = getChapter(chId);
  if (!p || !ch) return;
  const rel = decodeURIComponent(encodedRel);
  let dest = prompt("移動到篇章內的相對路徑（需包含檔名）", rel);
  if (!dest || dest === rel) return;
  dest = dest.replace(/^\/+|\/+$/g, "");
  if (!/\.md$/i.test(dest)) {
    alert("目標必須是 .md 文件路徑。");
    return;
  }
  try {
    await moveFile(p.root, pathJoin(ch.folder, rel), pathJoin(ch.folder, dest));
    await refreshChapterTree(ch);
  } catch (e) {
    alert(e.message || String(e));
  }
}
async function renameChapterFolder(chId, encodedRel) {
  const p = await getProject(true),
    ch = getChapter(chId);
  if (!p || !ch) return;
  const rel = decodeURIComponent(encodedRel),
    old = basename(rel);
  let name = prompt("新資料夾名稱", old);
  if (!name || name === old) return;
  name = cleanName(name);
  const dest = pathJoin(dirname(rel), name);
  try {
    await moveDir(p.root, pathJoin(ch.folder, rel), pathJoin(ch.folder, dest));
    await refreshChapterTree(ch);
  } catch (e) {
    alert(e.message || String(e));
  }
}
async function deleteChapterFolder(...args) {
  return window.SafeDelete?.deleteChapterFolder
    ? window.SafeDelete.deleteChapterFolder(...args)
    : deletionUnavailable();
}

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
  let md;
  try {
    md = await readText(p.root, path);
  } catch (e) {
    qs("#readerTitle").textContent = "讀取失敗";
    qs("#md").innerHTML = "<p>" + esc(String(e)) + "</p>";
    return;
  }
  qs("#readerPath").textContent = path;
  let title = basename(path).replace(/\.md$/i, "");
  qs("#readerTitle").textContent = title;
  qs("#md").innerHTML = mdToHtml(md);
  const bar = qs("#readerManage");
  if (bar) {
    bar.innerHTML = `<button class="btn" onclick="BY.replaceReaderFile('${encodeURIComponent(path)}')">替換此 MD</button><button class="btn dangerbtn" onclick="BY.deleteReaderFile('${encodeURIComponent(path)}')">刪除此 MD</button>`;
  }
}
async function replaceReaderFile(encoded) {
  const path = decodeURIComponent(encoded),
    p = await getProject(true);
  if (!p) return;
  const f = await pickLocalFile(".md,text/markdown,text/plain");
  if (!f) return;
  if (!confirm(`用「${f.name}」替換：\n${path}？`)) return;
  await writeBlob(p.root, path, f);
  location.reload();
}
async function deleteReaderFile(...args) {
  return window.SafeDelete?.deleteReaderFile
    ? window.SafeDelete.deleteReaderFile(...args)
    : deletionUnavailable();
}

function openLightbox(url, name, caption = "") {
  const lb = qs("#lightbox");
  if (!lb) return;
  qs("#lightboxImg").src = url;
  qs("#lightboxTitle").textContent = name;
  qs("#lightboxCaption").textContent = caption || "";
  lb.classList.add("open");
  document.body.classList.add("no-scroll");
}
function closeLightbox() {
  qs("#lightbox")?.classList.remove("open");
  document.body.classList.remove("no-scroll");
}
async function saveImageMeta(path, field, value, chapterId) {
  const p = await getProject(true);
  if (!p?.manifest) return;
  p.manifest.imageMeta ||= {};
  p.manifest.imageMeta[path] ||= { role: "other", caption: "" };
  if (field === "role" && (value === "cover" || value === "header")) {
    for (const [otherPath, meta] of Object.entries(p.manifest.imageMeta)) {
      if (
        otherPath !== path &&
        meta?.role === value &&
        chapterForImagePath(p.manifest, otherPath)?.id === chapterId
      )
        meta.role = "illustration";
    }
  }
  p.manifest.imageMeta[path][field] = value;
  await writeManifest(p.root, p.manifest);
  setStatus("已保存圖片分類");
  if (field === "role" && value === "cover")
    setTimeout(() => location.reload(), 120);
}
async function initImages() {
  const p = await getProject();
  if (!p?.manifest) return;
  const id = new URLSearchParams(location.search).get("chapter");
  let title = "全部圖片庫",
    dirs = [];
  if (id) {
    const c = p.manifest.chapters.find((x) => x.id === id);
    if (c) {
      title = c.title + " · 圖片庫";
      dirs = [{ path: c.imageFolder || "assets/images/" + c.id, chapter: c }];
    }
  } else dirs = [{ path: "assets/images", chapter: null }];
  qs("#imagesTitle").textContent = title;
  const add = qs("#addImageBtn");
  if (add) add.onclick = () => addImage(id || "");
  const box = qs("#imageGrid");
  box.innerHTML = "";
  for (const item of dirs) {
    try {
      const d = await getDir(p.root, item.path);
      const imgs = await listImagesRecursive(d);
      for (const im of imgs) {
        const f = await im.handle.getFile(),
          url = URL.createObjectURL(f),
          fullPath = pathJoin(item.path, im.path),
          chapter = item.chapter || chapterForImagePath(p.manifest, fullPath),
          meta = p.manifest.imageMeta?.[fullPath] || {
            role: "other",
            caption: "",
          },
          opts = [
            "showcase",
            "header",
            "cover",
            "illustration",
            "character",
            "reference",
            "other",
          ]
            .map(
              (r) =>
                `<option value="${r}" ${meta.role === r ? "selected" : ""}>${roleLabel(r)}</option>`,
            )
            .join("");
        box.insertAdjacentHTML(
          "beforeend",
          `<figure class="imagecard"><button class="imageopen" type="button" data-url="${url}" data-name="${esc(im.name)}" data-caption="${esc(meta.caption || "")}"><img src="${url}" alt="${esc(im.name)}"><span class="zoomhint">點擊放大</span></button><figcaption class="imagecap"><div class="imagepath">${esc(fullPath)}</div><div class="imagecontrols"><label>用途<select data-image-role="${esc(fullPath)}" data-chapter="${esc(chapter?.id || "")}">${opts}</select></label><label>說明<input data-image-caption="${esc(fullPath)}" value="${esc(meta.caption || "")}" placeholder="例如：第一部封面草圖"></label><div class="miniops"><button onclick="BY.replaceImage('${encodeURIComponent(fullPath)}')">替換</button><button onclick="WB.deriveImage('${encodeURIComponent(fullPath)}')">派生圖</button><button onclick="BY.renameImage('${encodeURIComponent(fullPath)}')">改名</button><button class="danger" onclick="BY.deleteImage('${encodeURIComponent(fullPath)}')">刪除</button></div></div></figcaption></figure>`,
        );
      }
    } catch (e) {
      reportIssue("讀取圖片目錄 " + item.path, e);
    }
  }
  if (!box.children.length)
    box.innerHTML =
      '<div class="empty" style="grid-column:1/-1">圖片資料夾目前是空的。可點“＋加入圖片”。</div>';
  qsa(".imageopen").forEach((b) =>
    b.addEventListener("click", () =>
      openLightbox(b.dataset.url, b.dataset.name, b.dataset.caption),
    ),
  );
  qsa("[data-image-role]").forEach((s) =>
    s.addEventListener("change", () =>
      saveImageMeta(s.dataset.imageRole, "role", s.value, s.dataset.chapter),
    ),
  );
  qsa("[data-image-caption]").forEach((i) =>
    i.addEventListener("change", () =>
      saveImageMeta(
        i.dataset.imageCaption,
        "caption",
        i.value,
        chapterForImagePath(p.manifest, i.dataset.imageCaption)?.id || "",
      ),
    ),
  );
}
async function addImage(chapterId = "") {
  const p = await getProject(true);
  if (!p?.manifest) return;
  const f = await pickLocalFile("image/png,image/jpeg,image/webp,image/gif");
  if (!f) return;
  let folder = "assets/images";
  if (chapterId) {
    const c = p.manifest.chapters.find((x) => x.id === chapterId);
    if (c) folder = c.imageFolder || pathJoin("assets/images", c.id);
  } else {
    const id = prompt(
      "放到哪一篇？輸入篇章 ID；留空則放 assets/images/common",
      "",
    );
    if (id) {
      const c = p.manifest.chapters.find((x) => x.id === id);
      if (!c) {
        alert("找不到該篇章 ID。");
        return;
      }
      folder = c.imageFolder || pathJoin("assets/images", c.id);
    } else folder = "assets/images/common";
  }
  await getDir(p.root, folder, true);
  let name = cleanName(f.name);
  let path = pathJoin(folder, name);
  if (await existsPath(p.root, path)) {
    if (!confirm(`已存在同名圖片 ${name}，是否直接替換？`)) return;
  }
  await writeBlob(p.root, path, f);
  location.reload();
}
async function replaceImage(encoded) {
  const path = decodeURIComponent(encoded),
    p = await getProject(true);
  if (!p) return;
  const f = await pickLocalFile("image/png,image/jpeg,image/webp,image/gif");
  if (!f) return;
  if (!confirm(`替換圖片：\n${path}\n\n位置與檔名保持不變。`)) return;
  await writeBlob(p.root, path, f);
  location.reload();
}
async function deleteImage(...args) {
  return window.SafeDelete?.deleteImage
    ? window.SafeDelete.deleteImage(...args)
    : deletionUnavailable();
}
async function renameImage(encoded) {
  const old = decodeURIComponent(encoded),
    p = await getProject(true);
  if (!p?.manifest) return;
  let name = prompt("新圖片檔名", basename(old));
  if (!name || name === basename(old)) return;
  name = cleanName(name);
  if (!extname(name)) name += extname(old);
  const dest = pathJoin(dirname(old), name);
  try {
    await moveFile(p.root, old, dest);
    if (p.manifest.imageMeta?.[old]) {
      p.manifest.imageMeta[dest] = p.manifest.imageMeta[old];
      delete p.manifest.imageMeta[old];
      await writeManifest(p.root, p.manifest);
    }
    location.reload();
  } catch (e) {
    alert(e.message || String(e));
  }
}

async function createChapter() {
  const p = await getProject(true);
  if (!p?.manifest) return;
  const title = qs("#newTitle").value.trim(),
    id0 = qs("#newId").value.trim();
  if (!title || !id0) {
    alert("請填寫篇章名稱與英文 ID。");
    return;
  }
  const id = id0.replace(/[^a-zA-Z0-9_-]/g, "-").toLowerCase();
  if (p.manifest.chapters.some((x) => x.id === id)) {
    alert("這個 ID 已存在。");
    return;
  }
  const theme =
      qs("#newTheme").value || normalizeThemes(p.manifest)[0]?.id || "baizi",
    folder = "content/" + id,
    imageFolder = "assets/images/" + id;
  await getDir(p.root, folder, true);
  await getDir(p.root, imageFolder, true);
  for (const d of [
    "劇情",
    "人物",
    "時間點",
    "核心規則",
    "寫法規則",
    "伏筆",
    "待定項",
    "廢案",
  ])
    await getDir(p.root, pathJoin(folder, d), true);
  p.manifest.chapters.push({
    id,
    title,
    subtitle: "新篇章",
    theme,
    folder,
    imageFolder,
  });
  await writeManifest(p.root, p.manifest);
  closeDialog();
  location.reload();
}
async function openDialog() {
  const p = CURRENT_PROJECT || (await getProject());
  if (p?.manifest)
    fillThemeSelect(
      qs("#newTheme"),
      p.manifest,
      normalizeThemes(p.manifest)[0]?.id,
    );
  qs("#dialog")?.classList.add("open");
}
function closeDialog() {
  qs("#dialog")?.classList.remove("open");
}

function openChapterSettings(id) {
  const p = CURRENT_PROJECT,
    c = p?.manifest?.chapters?.find((x) => x.id === id);
  if (!c) return;
  CURRENT_EDIT_CHAPTER = id;
  qs("#editChapterTitle").value = c.title || "";
  qs("#editChapterSubtitle").value = c.subtitle || "";
  qs("#editChapterDescription").value = c.description || "";
  fillThemeSelect(qs("#editChapterTheme"), p.manifest, c.theme);
  qs("#chapterSettingsDialog")?.classList.add("open");
}
function closeChapterSettings() {
  CURRENT_EDIT_CHAPTER = "";
  qs("#chapterSettingsDialog")?.classList.remove("open");
}
async function saveChapterSettings() {
  const p = await getProject(true),
    c = p?.manifest?.chapters?.find((x) => x.id === CURRENT_EDIT_CHAPTER);
  if (!c) return;
  const title = qs("#editChapterTitle").value.trim();
  if (!title) {
    alert("篇章名稱不能留空。");
    return;
  }
  c.title = title;
  c.subtitle = qs("#editChapterSubtitle").value.trim();
  c.description = qs("#editChapterDescription").value.trim();
  c.theme = qs("#editChapterTheme").value;
  await writeManifest(p.root, p.manifest);
  closeChapterSettings();
  location.reload();
}

async function ensureGlobalTools(p) {
  if (qs("#byGlobalTools") || !p?.manifest) return;
  document.body.insertAdjacentHTML(
    "beforeend",
    `<div class="globaltools" id="byGlobalTools"><button class="floatbtn" id="themeToggle" title="篇章類型與色彩">🎨 主題</button><button class="floatbtn" id="bgmToggle" title="BGM 播放器">♪ BGM</button></div><aside class="toolpanel theme-manager" id="themePanel"><div class="toolhead"><strong>篇章類型與色彩</strong><button class="xbtn" data-close="#themePanel">×</button></div><p class="toolhint">名稱與顏色分開保存。可新增「輕快」「戀愛」或任何自訂類型，再到篇章頁套用。</p><div class="theme-list" id="themeList"></div><div class="toolactions"><button class="btn" id="addTheme">＋ 新增類型</button><button class="btn" id="saveTheme">保存主題</button><button class="btn" id="resetTheme">恢復預設</button></div></aside><aside class="toolpanel" id="bgmPanel"><div class="toolhead"><strong>BGM · MP3 / WAV</strong><button class="xbtn" data-close="#bgmPanel">×</button></div><p class="toolhint">音訊位於 assets/audio/。現在也可直接加入、替換或刪除。</p><p class="toolhint">隨包示例音樂含 AI 生成內容，僅供展示與測試；自行加入的素材權利仍由使用者負責確認。</p><label class="toolfield">曲目<select id="bgmSelect"></select></label><div class="playerrow"><button class="playbtn" id="bgmPlay">▶ 播放</button><label class="vol">音量 <input id="bgmVolume" type="range" min="0" max="1" step="0.01"></label></div><label class="checkrow"><input id="bgmLoop" type="checkbox"> 循環播放</label><div class="toolactions"><button class="btn" id="bgmAdd">＋加入</button><button class="btn" id="bgmReplace">替換目前</button><button class="btn dangerbtn" id="bgmDelete">刪除目前</button></div><div class="bgmstatus" id="bgmStatus">正在掃描…</div><audio id="bgmAudio" preload="metadata"></audio></aside>`,
  );
  qs("#themeToggle").addEventListener("click", () => {
    if (!qs("#themePanel").classList.contains("open"))
      renderThemeRows(
        normalizeThemes(CURRENT_PROJECT.manifest),
        CURRENT_PROJECT,
      );
    togglePanel("#themePanel");
  });
  qs("#bgmToggle").addEventListener("click", () => togglePanel("#bgmPanel"));
  qsa("[data-close]").forEach((b) =>
    b.addEventListener("click", () => {
      restoreThemePreview();
      qs(b.dataset.close)?.classList.remove("open");
    }),
  );
  setupThemePanel(p);
  await setupAudioPanel(p);
}
function restoreThemePreview() {
  if (CURRENT_PROJECT)
    for (const card of qsa(".card[data-theme-id]")) {
      const t = themeInfo(CURRENT_PROJECT.manifest, card.dataset.themeId);
      card.style.setProperty("--accent", t.color);
      const dot = qs(".theme-dot", card);
      if (dot) dot.style.background = t.color;
    }
}
function togglePanel(sel) {
  restoreThemePreview();
  const target = qs(sel);
  if (!target) return;
  qsa(".toolpanel").forEach((x) => {
    if (x !== target) x.classList.remove("open");
  });
  target.classList.toggle("open");
}
function readThemeRows() {
  return qsa("[data-theme-row]")
    .map((row) => ({
      id: row.dataset.themeId,
      label: qs("[data-theme-label]", row).value.trim(),
      color: qs("[data-theme-color]", row).value,
    }))
    .filter((x) => x.label);
}
function previewThemeRows() {
  for (const t of readThemeRows()) {
    qsa(`[data-theme-id="${CSS.escape(t.id)}"]`).forEach((card) => {
      card.style.setProperty("--accent", t.color);
      const dot = qs(".theme-dot", card);
      if (dot) dot.style.background = t.color;
    });
  }
}
function renderThemeRows(themes, p) {
  const host = qs("#themeList");
  if (!host) return;
  host.innerHTML = themes
    .map(
      (t) =>
        `<div class="theme-row" data-theme-row data-theme-id="${esc(t.id)}"><input type="text" value="${esc(t.label)}" data-theme-label aria-label="類型名稱"><input type="color" value="${esc(t.color)}" data-theme-color aria-label="類型顏色"><button class="xbtn theme-delete" type="button" data-delete-theme="${esc(t.id)}" title="刪除類型">×</button></div>`,
    )
    .join("");
  qsa("[data-theme-label]", host).forEach((i) =>
    i.addEventListener("input", previewThemeRows),
  );
  qsa("[data-theme-color]", host).forEach((i) =>
    i.addEventListener("input", previewThemeRows),
  );
  qsa("[data-delete-theme]", host).forEach(
    (b) =>
      (b.onclick = () => {
        if (
          (p.manifest.chapters || []).some(
            (c) => c.theme === b.dataset.deleteTheme,
          )
        ) {
          alert("這個類型仍有篇章使用。請先到篇章頁更換類型。");
          return;
        }
        b.closest("[data-theme-row]")?.remove();
      }),
  );
}
function setupThemePanel(p) {
  renderThemeRows(normalizeThemes(p.manifest), p);
  qs("#addTheme").onclick = () => {
    const id = "theme-" + Date.now().toString(36);
    const themes = readThemeRows();
    themes.push({ id, label: "新類型", color: "#8b5cf6" });
    renderThemeRows(themes, p);
    qs(`[data-theme-id="${id}"] [data-theme-label]`)?.select();
  };
  qs("#resetTheme").onclick = () => {
    if (confirm("恢復預設類型與顏色？尚未保存前可關閉面板取消。"))
      renderThemeRows(
        [
          ...DEFAULT_THEMES.map((x) => ({ ...x })),
          ...normalizeThemes(p.manifest).filter(
            (t) => !DEFAULT_THEMES.some((d) => d.id === t.id),
          ),
        ],
        p,
      );
  };
  qs("#saveTheme").onclick = async () => {
    const themes = readThemeRows();
    if (qsa("[data-theme-label]").some((i) => !i.value.trim())) {
      alert("類型名稱不能留空。");
      return;
    }
    if (!themes.length) {
      alert("至少保留一個篇章類型。");
      return;
    }
    const names = themes.map((x) => x.label.toLowerCase());
    if (new Set(names).size !== names.length) {
      alert("類型名稱不能重複。");
      return;
    }
    const now = await getProject(true);
    if (!now?.manifest) return;
    for (const c of now.manifest.chapters || [])
      if (!themes.some((t) => t.id === c.theme)) {
        alert(`「${c.title}」正在使用已移除的類型，請保留該類型或先修改篇章。`);
        return;
      }
    now.manifest.themes = themes;
    now.manifest.colors = {
      ...now.manifest.colors,
      ...Object.fromEntries(
        themes
          .filter((t) =>
            ["baizi", "unknown", "horror", "melancholy"].includes(t.id),
          )
          .map((t) => [t.id, t.color]),
      ),
    };
    await writeManifest(now.root, now.manifest);
    applyColors(now.manifest);
    setStatus("已保存篇章類型與色彩");
    qs("#themePanel").classList.remove("open");
    location.reload();
  };
}
async function setupAudioPanel(p) {
  const sel = qs("#bgmSelect"),
    audio = qs("#bgmAudio"),
    play = qs("#bgmPlay"),
    vol = qs("#bgmVolume"),
    loop = qs("#bgmLoop"),
    status = qs("#bgmStatus"),
    cfg = {
      ...(p.manifest.audio || {
        folder: "assets/audio",
        track: "",
        volume: 0.35,
        loop: true,
      }),
    };
  const params = new URLSearchParams(location.search);
  const activeChapter = p.manifest.chapters.find(
    (c) =>
      c.id === (params.get("id") || params.get("chapter")) ||
      (params.get("file") || "").startsWith(c.folder + "/"),
  );
  if (activeChapter?.audioTrack) cfg.track = activeChapter.audioTrack;
  vol.value = Number.isFinite(+cfg.volume) ? cfg.volume : 0.35;
  loop.checked = cfg.loop !== false;
  audio.volume = +vol.value;
  audio.loop = loop.checked;
  let files = [];
  try {
    files = await listAudioRecursive(
      await getDir(p.root, cfg.folder || "assets/audio"),
    );
  } catch (e) {
    reportIssue("讀取音樂目錄", e);
  }
  sel.innerHTML = "";
  const folder = (cfg.folder || "assets/audio").replace(/\/$/, "");
  if (!files.length) {
    sel.innerHTML = '<option value="">（沒有 MP3 / WAV）</option>';
    status.textContent = "可點“＋加入”選擇 MP3 / WAV。";
    play.disabled = true;
  } else {
    for (const f of files) {
      const full = pathJoin(folder, f.path);
      sel.insertAdjacentHTML(
        "beforeend",
        `<option value="${esc(full)}">${esc(audioLabel(p.manifest, full))}</option>`,
      );
    }
    const known = files.map((f) => pathJoin(folder, f.path));
    sel.value = known.includes(cfg.track) ? cfg.track : known[0];
    status.textContent = `找到 ${files.length} 個音訊文件。`;
    play.disabled = false;
  }
  async function loadTrack() {
    if (AUDIO_URL) {
      URL.revokeObjectURL(AUDIO_URL);
      AUDIO_URL = "";
    }
    const path = sel.value;
    if (!path) {
      audio.removeAttribute("src");
      return;
    }
    const fh = await getFileHandleByPath(p.root, path);
    AUDIO_URL = URL.createObjectURL(await fh.getFile());
    audio.src = AUDIO_URL;
    audio.load();
    play.textContent = "▶ 播放";
    status.textContent = "已選擇：" + audioLabel(p.manifest, path);
  }
  async function saveCfg() {
    const now = await getProject(true);
    if (!now?.manifest) return;
    now.manifest.audio = {
      folder,
      track: sel.value,
      volume: +vol.value,
      loop: loop.checked,
    };
    if (activeChapter) {
      const chapter = now.manifest.chapters.find(
        (c) => c.id === activeChapter.id,
      );
      if (chapter) chapter.audioTrack = sel.value;
    }
    await writeManifest(now.root, now.manifest);
  }
  sel.addEventListener("change", async () => {
    audio.pause();
    await loadTrack();
    await saveCfg();
  });
  vol.addEventListener("input", () => (audio.volume = +vol.value));
  vol.addEventListener("change", saveCfg);
  loop.addEventListener("change", () => {
    audio.loop = loop.checked;
    saveCfg();
  });
  play.addEventListener("click", async () => {
    if (!sel.value) return;
    if (!audio.src) await loadTrack();
    if (audio.paused) {
      try {
        await audio.play();
        play.textContent = "⏸ 暫停";
        status.textContent = "播放中：" + audioLabel(p.manifest, sel.value);
      } catch (e) {
        status.textContent = "瀏覽器未允許播放，請再點一次。";
      }
    } else {
      audio.pause();
      play.textContent = "▶ 播放";
      status.textContent = "已暫停";
    }
  });
  qs("#bgmAdd").addEventListener("click", async () => {
    const f = await pickLocalFile(".mp3,.wav,audio/mpeg,audio/wav");
    if (!f) return;
    await getDir(p.root, folder, true);
    const path = pathJoin(folder, cleanName(f.name));
    if (await existsPath(p.root, path)) {
      if (!(await BY.replaceAudio(path, f))) return;
    } else await writeBlob(p.root, path, f);
    location.reload();
  });
  qs("#bgmReplace").addEventListener("click", async () => {
    if (!sel.value) return;
    const f = await pickLocalFile(".mp3,.wav,audio/mpeg,audio/wav");
    if (!f) return;
    audio.pause();
    if (await BY.replaceAudio(sel.value, f)) location.reload();
  });
  qs("#bgmDelete").addEventListener("click", async () => {
    if (!sel.value) return;
    audio.pause();
    if (await BY.deleteAudio(sel.value)) location.reload();
  });
  audio.addEventListener("pause", () => {
    if (!audio.ended) play.textContent = "▶ 播放";
  });
  audio.addEventListener("play", () => (play.textContent = "⏸ 暫停"));
  await loadTrack();
}

document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") {
    restoreThemePreview();
    closeChapterSettings();
    closeDialog();
    closeLightbox();
    qsa(".toolpanel").forEach((x) => x.classList.remove("open"));
  }
});
window.BY = {
  connect,
  reconnect,
  forgetProject,
  initHome,
  initChapter,
  initReader,
  initImages,
  openDialog,
  closeDialog,
  createChapter,
  openChapterSettings,
  closeChapterSettings,
  saveChapterSettings,
  closeLightbox,
  toggleSidebar,
  replaceSeriesDoc,
  deleteSeriesDoc,
  addSeriesDoc,
  newFolder,
  newMarkdown,
  importDocx,
  replaceChapterFile,
  deleteChapterFile,
  renameChapterFile,
  moveChapterFile,
  renameChapterFolder,
  deleteChapterFolder,
  replaceReaderFile,
  deleteReaderFile,
  addImage,
  replaceImage,
  deleteImage,
  renameImage,
};
