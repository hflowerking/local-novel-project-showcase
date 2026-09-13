/* DOCX one-way importer: converts local Word/WPS documents to Markdown. */
(function () {
  "use strict";

  const WORD_NS = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
  const REL_NS = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";

  function local(node) {
    return node?.localName || String(node?.nodeName || "").split(":").pop();
  }

  function children(node, name) {
    return [...(node?.childNodes || [])].filter(
      (child) => child.nodeType === 1 && (!name || local(child) === name),
    );
  }

  function first(node, name) {
    return children(node, name)[0] || null;
  }

  function descendants(node, name) {
    return [...(node?.getElementsByTagNameNS?.("*", name) || [])];
  }

  function attr(node, name, namespace = WORD_NS) {
    return (
      node?.getAttributeNS?.(namespace, name) ||
      node?.getAttribute?.("w:" + name) ||
      node?.getAttribute?.("r:" + name) ||
      node?.getAttribute?.(name) ||
      ""
    );
  }

  function parseXml(text, label) {
    const xml = new DOMParser().parseFromString(text, "application/xml");
    const error = xml.getElementsByTagName("parsererror")[0];
    if (error) throw new Error(label + " 無法解析");
    return xml;
  }

  function normalizeZipPath(path) {
    const out = [];
    for (const part of path.replace(/\\/g, "/").split("/")) {
      if (!part || part === ".") continue;
      if (part === "..") out.pop();
      else out.push(part);
    }
    return out.join("/");
  }

  function resolveTarget(baseFile, target) {
    const base = baseFile.split("/");
    base.pop();
    return normalizeZipPath(base.concat(target.split("/")).join("/"));
  }

  function safeAssetName(name, fallback) {
    const cleaned = String(name || fallback)
      .replace(/[\\/:*?"<>|]/g, "_")
      .replace(/^\.+/, "")
      .trim();
    return cleaned || fallback;
  }

  function mimeFor(name) {
    const ext = name.split(".").pop().toLowerCase();
    return (
      {
        png: "image/png",
        jpg: "image/jpeg",
        jpeg: "image/jpeg",
        gif: "image/gif",
        webp: "image/webp",
        svg: "image/svg+xml",
        bmp: "image/bmp",
        tif: "image/tiff",
        tiff: "image/tiff",
      }[ext] || "application/octet-stream"
    );
  }

  function mdText(value) {
    return String(value || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/([\\`*_\[\]])/g, "\\$1");
  }

  function safeLink(value) {
    const url = String(value || "").trim();
    if (!/^(https?:|mailto:)/i.test(url)) return "";
    return encodeURI(url).replace(/\(/g, "%28").replace(/\)/g, "%29");
  }

  function buildStyles(xml) {
    const styles = new Map();
    if (!xml) return styles;
    for (const style of descendants(xml, "style")) {
      if (attr(style, "type") !== "paragraph") continue;
      const id = attr(style, "styleId");
      const name = attr(first(style, "name"), "val") || id;
      const props = first(style, "pPr"), numPr = props && first(props, "numPr");
      if (id)
        styles.set(id, {
          name,
          numId: attr(first(numPr, "numId"), "val"),
          level: Number(attr(first(numPr, "ilvl"), "val") || 0),
        });
    }
    return styles;
  }

  function buildNumbering(xml) {
    const abstracts = new Map(), nums = new Map();
    if (!xml) return { abstracts, nums };
    for (const abstract of descendants(xml, "abstractNum")) {
      const id = attr(abstract, "abstractNumId"), levels = new Map();
      for (const level of children(abstract, "lvl")) {
        const index = Number(attr(level, "ilvl") || 0);
        levels.set(index, attr(first(level, "numFmt"), "val") || "decimal");
      }
      abstracts.set(id, levels);
    }
    for (const num of descendants(xml, "num")) {
      const id = attr(num, "numId");
      const abstractId = attr(first(num, "abstractNumId"), "val");
      if (id) nums.set(id, abstractId);
    }
    return { abstracts, nums };
  }

  async function buildRelationships(zip, assetBase) {
    const relFile = zip.file("word/_rels/document.xml.rels");
    const links = new Map(), images = new Map(), media = [];
    if (!relFile) return { links, images, media };
    const relXml = parseXml(await relFile.async("text"), "DOCX 關聯資料");
    const usedNames = new Set();
    for (const rel of descendants(relXml, "Relationship")) {
      const id = rel.getAttribute("Id") || "";
      const target = rel.getAttribute("Target") || "";
      const type = rel.getAttribute("Type") || "";
      if (!id || !target) continue;
      if (rel.getAttribute("TargetMode") === "External" || /hyperlink$/i.test(type)) {
        links.set(id, target);
        continue;
      }
      if (!/image$/i.test(type) && !/(^|\/)media\//i.test(target)) continue;
      const zipPath = resolveTarget("word/document.xml", target);
      const entry = zip.file(zipPath);
      if (!entry) continue;
      let name = safeAssetName(zipPath.split("/").pop(), "image.bin");
      const original = name, dot = name.lastIndexOf(".");
      let index = 2;
      while (usedNames.has(name.toLowerCase())) {
        name = dot > 0
          ? original.slice(0, dot) + "-" + index++ + original.slice(dot)
          : original + "-" + index++;
      }
      usedNames.add(name.toLowerCase());
      const path = (assetBase ? assetBase.replace(/\/$/, "") + "/" : "") + name;
      media.push({ name, path, blob: await entry.async("blob"), mime: mimeFor(name) });
      images.set(id, path);
    }
    return { links, images, media };
  }

  function runContent(node, images) {
    let text = "";
    for (const child of children(node)) {
      const name = local(child);
      if (name === "t") text += mdText(child.textContent);
      else if (name === "tab") text += "\t";
      else if (name === "br" || name === "cr") text += "  \n";
      else if (name === "blip") {
        const id = attr(child, "embed", REL_NS);
        if (images.has(id)) text += `\n\n![匯入圖片](${images.get(id)})\n\n`;
      } else if (name !== "rPr") text += runContent(child, images);
    }
    return text;
  }

  function runMarkdown(run, images) {
    let text = runContent(run, images);
    if (!text) return "";
    const props = first(run, "rPr");
    if (props && first(props, "strike")) text = "~~" + text + "~~";
    if (props && first(props, "i")) text = "*" + text + "*";
    if (props && first(props, "b")) text = "**" + text + "**";
    return text;
  }

  function inlineMarkdown(node, rels) {
    let out = "";
    for (const child of children(node)) {
      if (local(child) === "r") out += runMarkdown(child, rels.images);
      else if (local(child) === "hyperlink") {
        const label = inlineMarkdown(child, rels);
        const url = safeLink(rels.links.get(attr(child, "id", REL_NS)));
        out += url && label ? `[${label}](${url})` : label;
      } else if (["smartTag", "sdt", "ins"].includes(local(child))) {
        out += inlineMarkdown(child, rels);
      }
    }
    return out;
  }

  function headingLevel(paragraph, styles) {
    const props = first(paragraph, "pPr");
    if (!props) return 0;
    const styleId = attr(first(props, "pStyle"), "val");
    const styleName = styles.get(styleId)?.name || styleId || "";
    if (/^(title|標題|标题)$/i.test(styleName)) return 1;
    const match = styleName.match(/(?:heading|標題|标题)\s*([1-6])/i);
    if (match) return Number(match[1]);
    const outline = attr(first(props, "outlineLvl"), "val");
    return outline !== "" && Number(outline) < 6 ? Number(outline) + 1 : 0;
  }

  function listInfo(paragraph, styles, numbering, counters) {
    const props = first(paragraph, "pPr"), directNum = props && first(props, "numPr");
    const styleId = attr(first(props, "pStyle"), "val"), style = styles.get(styleId);
    if (!directNum && !style?.numId && !/list|清單|列表/i.test(style?.name || ""))
      return null;
    const numId = attr(first(directNum, "numId"), "val") || style?.numId || styleId;
    const level = directNum
      ? Number(attr(first(directNum, "ilvl"), "val") || 0)
      : Number(style?.level || 0);
    const abstractId = numbering.nums.get(numId);
    const styleFormat = /number|編號|编号/i.test(style?.name || "")
      ? "decimal"
      : "bullet";
    const format = numbering.abstracts.get(abstractId)?.get(level) || styleFormat;
    const key = numId + ":" + level;
    const ordered = !/bullet|none/i.test(format);
    const count = (counters.get(key) || 0) + 1;
    counters.set(key, count);
    return { indent: "  ".repeat(level), marker: ordered ? count + ". " : "- " };
  }

  function paragraphMarkdown(paragraph, context) {
    const text = inlineMarkdown(paragraph, context.rels).trim();
    if (!text) return "";
    const level = headingLevel(paragraph, context.styles);
    if (level) return "#".repeat(level) + " " + text;
    const list = listInfo(paragraph, context.styles, context.numbering, context.counters);
    if (list) return list.indent + list.marker + text;
    return text;
  }

  function tableMarkdown(table, context) {
    const rows = children(table, "tr").map((row) =>
      children(row, "tc").map((cell) =>
        children(cell, "p")
          .map((p) => paragraphMarkdown(p, context))
          .filter(Boolean)
          .join("<br>")
          .replace(/\|/g, "\\|"),
      ),
    );
    if (!rows.length) return "";
    const width = Math.max(...rows.map((row) => row.length));
    rows.forEach((row) => { while (row.length < width) row.push(""); });
    const line = (row) => "| " + row.join(" | ") + " |";
    return [line(rows[0]), line(Array(width).fill("---")), ...rows.slice(1).map(line)].join("\n");
  }

  async function optionalXml(zip, path, label) {
    const entry = zip.file(path);
    return entry ? parseXml(await entry.async("text"), label) : null;
  }

  async function convert(file, options = {}) {
    if (!file || !/\.docx$/i.test(file.name || ""))
      throw new Error("請選擇 .docx 文件；舊版 .doc 格式不受支援");
    if (file.size && file.size > 50 * 1024 * 1024)
      throw new Error("DOCX 超過 50 MB，請先壓縮圖片或拆分文件後再匯入");
    if (!window.JSZip) throw new Error("DOCX 解壓模組未載入");
    const zip = await JSZip.loadAsync(await file.arrayBuffer());
    const documentEntry = zip.file("word/document.xml");
    if (!documentEntry) throw new Error("找不到 Word 正文，文件可能損壞或並非標準 DOCX");
    const [documentXml, stylesXml, numberingXml, rels] = await Promise.all([
      documentEntry.async("text").then((x) => parseXml(x, "DOCX 正文")),
      optionalXml(zip, "word/styles.xml", "DOCX 樣式"),
      optionalXml(zip, "word/numbering.xml", "DOCX 清單"),
      buildRelationships(zip, options.assetBase || ""),
    ]);
    const body = descendants(documentXml, "body")[0];
    if (!body) throw new Error("DOCX 沒有可讀取的正文");
    const context = {
      styles: buildStyles(stylesXml),
      numbering: buildNumbering(numberingXml),
      counters: new Map(),
      rels,
    };
    const blocks = [];
    for (const node of children(body)) {
      if (local(node) === "p") blocks.push(paragraphMarkdown(node, context));
      else if (local(node) === "tbl") blocks.push(tableMarkdown(node, context));
    }
    let markdown = blocks.filter(Boolean).join("\n\n").replace(/\n{4,}/g, "\n\n\n").trim();
    const title = String(options.title || file.name.replace(/\.docx$/i, "")).trim();
    if (!/^#\s/m.test(markdown)) markdown = `# ${mdText(title || "匯入文件")}\n\n${markdown}`;
    return {
      markdown: markdown.trim() + "\n",
      media: rels.media,
      warnings: [
        "頁首頁尾、註解、修訂記錄、腳註、文字方塊與複雜版面不保證保留。",
      ],
    };
  }

  window.DocxImporter = { convert };
})();
