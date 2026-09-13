/* Simple manifest-backed timeline for browse and local folder modes. */
(function () {
  const state = { manifest: null, browse: true };

  function chapterOf(event) {
    return state.manifest.chapters.find((c) => c.id === event.chapterId) || null;
  }

  function sortedEvents() {
    return (state.manifest.timeline || [])
      .slice()
      .sort((a, b) => Number(a.order || 0) - Number(b.order || 0));
  }

  function render() {
    const host = qs("#timelineList"),
      filter = qs("#timelineFilter")?.value || "",
      events = sortedEvents().filter((event) => !filter || event.chapterId === filter);
    if (!events.length) {
      host.innerHTML = '<div class="empty">目前沒有符合條件的事件。可在本地整理模式新增第一個節點。</div>';
      return;
    }
    host.innerHTML = events
      .map((event) => {
        const chapter = chapterOf(event),
          theme = themeInfo(state.manifest, chapter?.theme),
          documentLink = event.document
            ? `<a class="action" href="reader.html?file=${encodeURIComponent(event.document)}">查看文檔</a>`
            : "",
          controls = state.browse
            ? ""
            : `<button class="action" data-edit="${esc(event.id)}">編輯</button><button class="action dangerbtn" data-delete="${esc(event.id)}">刪除</button>`;
        return `<article class="timeline-item" style="--accent:${esc(theme.color)}"><div class="timeline-dot"></div><div class="timeline-card"><div class="timeline-meta"><span>${esc(event.moment || "未定時間")}</span><span>${esc(chapter?.title || "全局事件")}</span><span>${esc(event.type || "事件")}</span><span>${esc(event.status || "未標記")}</span></div><h2>${esc(event.title || "未命名事件")}</h2><p>${esc(event.description || "")}</p><div class="actions">${documentLink}${controls}</div></div></article>`;
      })
      .join("");
    qsa("[data-edit]", host).forEach((button) => {
      button.onclick = () => openEditor(button.dataset.edit);
    });
    qsa("[data-delete]", host).forEach((button) => {
      button.onclick = () => removeEvent(button.dataset.delete);
    });
  }

  function fillChapterChoices(selected = "") {
    const select = qs("#timelineChapter");
    select.innerHTML =
      '<option value="">全局事件</option>' +
      state.manifest.chapters
        .map((chapter) => `<option value="${esc(chapter.id)}" ${chapter.id === selected ? "selected" : ""}>${esc(chapter.title)}</option>`)
        .join("");
  }

  function openEditor(id = "") {
    if (state.browse) return;
    const event = (state.manifest.timeline || []).find((item) => item.id === id) || {};
    qs("#timelineDialogTitle").textContent = id ? "編輯時間線事件" : "新增時間線事件";
    qs("#timelineEventId").value = id;
    qs("#timelineMoment").value = event.moment || "";
    qs("#timelineTitleInput").value = event.title || "";
    qs("#timelineType").value = event.type || "主線";
    qs("#timelineStatus").value = event.status || "待寫";
    qs("#timelineOrder").value = event.order ?? sortedEvents().length * 10 + 10;
    qs("#timelineDescription").value = event.description || "";
    qs("#timelineDocument").value = event.document || "";
    fillChapterChoices(event.chapterId || "");
    qs("#timelineDialog").classList.add("open");
    qs("#timelineTitleInput").focus();
  }

  function closeEditor() {
    qs("#timelineDialog")?.classList.remove("open");
  }

  async function saveEvent() {
    const project = await getProject(true);
    if (!project?.manifest) return;
    const id = qs("#timelineEventId").value,
      title = qs("#timelineTitleInput").value.trim();
    if (!title) {
      alert("請填寫事件名稱。");
      return;
    }
    const event = {
      id: id || `event-${Date.now().toString(36)}`,
      order: Number(qs("#timelineOrder").value || 0),
      moment: qs("#timelineMoment").value.trim(),
      title,
      chapterId: qs("#timelineChapter").value,
      type: qs("#timelineType").value.trim() || "事件",
      status: qs("#timelineStatus").value.trim() || "待寫",
      description: qs("#timelineDescription").value.trim(),
      document: qs("#timelineDocument").value.trim(),
    };
    project.manifest.timeline ||= [];
    const index = project.manifest.timeline.findIndex((item) => item.id === event.id);
    if (index >= 0) project.manifest.timeline[index] = event;
    else project.manifest.timeline.push(event);
    await writeManifest(project.root, project.manifest);
    state.manifest = project.manifest;
    closeEditor();
    render();
    setStatus("時間線已保存");
  }

  async function removeEvent(id) {
    const event = (state.manifest.timeline || []).find((item) => item.id === id);
    if (!event || !confirm(`刪除時間線事件「${event.title}」？\n這只會刪除事件記錄，不會刪除相關 Markdown。`)) return;
    const project = await getProject(true);
    if (!project?.manifest) return;
    project.manifest.timeline = (project.manifest.timeline || []).filter((item) => item.id !== id);
    await writeManifest(project.root, project.manifest);
    state.manifest = project.manifest;
    render();
    setStatus("時間線事件已刪除");
  }

  async function init() {
    state.browse = Boolean(window.SHOWCASE_BROWSE);
    if (state.browse) {
      state.manifest = window.SHOWCASE_DEMO?.manifest;
      setStatus("目前為唯讀時間線；連接本地企劃後可新增或修改事件。");
    } else {
      const project = await getProject();
      if (!project?.manifest) return;
      state.manifest = project.manifest;
      setStatus("已連接：" + project.root.name);
    }
    if (!state.manifest) return;
    const filter = qs("#timelineFilter");
    filter.innerHTML =
      '<option value="">全部篇章</option>' +
      state.manifest.chapters.map((chapter) => `<option value="${esc(chapter.id)}">${esc(chapter.title)}</option>`).join("");
    filter.onchange = render;
    const add = qs("#addTimelineBtn");
    add.hidden = state.browse;
    add.onclick = () => openEditor();
    render();
  }

  window.Timeline = { init, openEditor, closeEditor, saveEvent };
})();
