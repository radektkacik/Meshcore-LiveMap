export function createPhotoManageController({
  appPath,
  elements,
  getCurrentPhoto = () => null,
  onPhotoDeleted = () => {},
  onPhotoUpdated = () => {},
  refreshNodePhotoList = () => {},
  t,
  tokenStore,
}) {
  let saving = false;
  let target = null;
  let uploads = tokenStore.uploads();

  function setStatus(text, isError = false) {
    elements.photoManageStatus.textContent = text;
    elements.photoManageStatus.classList.toggle("error", Boolean(isError));
  }

  function renderUploads() {
    const container = elements.photoManageUploads;
    if (!container) return;
    container.replaceChildren();
    container.hidden = uploads.length === 0;
    for (const entry of uploads) {
      const button = document.createElement("button");
      button.type = "button";
      const label = entry.photo.caption || entry.photo.author || entry.photo.id.slice(0, 8);
      button.textContent = t("photos.manageUpload", { caption: `${entry.node.name || t("common.unknownNode")} · ${label}` });
      button.addEventListener("click", () => open(entry.photo, entry.node));
      container.appendChild(button);
    }
  }

  function open(photoValue = null, nodeValue = null) {
    const current = photoValue && nodeValue
      ? { node: nodeValue, photo: photoValue }
      : getCurrentPhoto();
    if (!current?.photo?.id) return;
    target = { ...current };
    saving = false;
    const photo = current.photo;
    const token = tokenStore.get(photo.id);
    elements.photoManageForm.reset();
    elements.photoManageTitle.textContent = t("photos.manageTitle");
    elements.photoManagePhoto.textContent = [current.node?.name || t("common.unknownNode"), photo.caption]
      .filter(Boolean).join(" · ");
    elements.photoManagePasswordAuthLabel.textContent = t("photos.managePasswordAuth");
    elements.photoManagePasswordWrap.hidden = Boolean(token);
    elements.photoManageAuthorLabel.textContent = t("photos.manageAuthor");
    elements.photoManageCaptionLabel.textContent = t("photos.manageCaption");
    elements.photoManageAuthor.value = photo.author || "";
    elements.photoManageCaption.value = photo.caption || "";
    elements.photoManageSave.textContent = t("photos.manageSave");
    elements.photoManageDelete.textContent = t("photos.manageDelete");
    elements.photoManageCancel.textContent = t("photos.cancel");
    elements.photoManageClose.setAttribute("aria-label", t("photos.cancel"));
    elements.photoManageNote.textContent = t(token ? "photos.manageNoteToken" : "photos.manageNotePassword");
    setStatus("");
    elements.photoManageSave.disabled = false;
    elements.photoManageDelete.disabled = false;
    if (!elements.photoManageDialog.open) elements.photoManageDialog.showModal();
  }

  async function manage(action) {
    const photo = target?.photo;
    if (!photo?.id || saving) return;
    const token = tokenStore.get(photo.id);
    const password = elements.photoManagePasswordAuth.value;
    if (!token && !password) {
      setStatus(t("photos.manageNeedAccess"), true);
      return;
    }

    saving = true;
    elements.photoManageSave.disabled = true;
    elements.photoManageDelete.disabled = true;
    setStatus(t("photos.manageSaving"));
    try {
      const headers = { "Content-Type": "application/json" };
      if (token) headers.Authorization = `Bearer ${token}`;
      const response = await fetch(appPath(`/api/photos/${encodeURIComponent(photo.id)}/manage`), {
        method: "POST",
        headers,
        body: JSON.stringify({
          action,
          author: elements.photoManageAuthor.value.trim(),
          caption: elements.photoManageCaption.value.trim(),
          password: token ? "" : password,
        }),
        signal: AbortSignal.timeout(20_000),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        if (response.status === 403 && token) {
          tokenStore.forget(photo.id);
          elements.photoManagePasswordWrap.hidden = false;
          elements.photoManageNote.textContent = t("photos.manageNotePassword");
        }
        throw new Error(data.error || t("photos.manageFailed"));
      }

      const nodeKey = photo.nodeKey || target.node?.public_key;
      if (action === "delete") {
        tokenStore.forget(photo.id);
        uploads = uploads.filter((entry) => entry.photo.id !== photo.id);
        renderUploads();
        onPhotoDeleted(photo, target);
        refreshNodePhotoList(nodeKey);
        elements.photoManageDialog.close();
        return;
      }

      const updated = { ...photo, ...(data.photo || {}) };
      target.photo = updated;
      const uploaded = uploads.find((entry) => entry.photo.id === photo.id);
      if (uploaded) {
        uploaded.photo = { ...uploaded.photo, ...(data.photo || {}) };
        if (token) tokenStore.remember(photo.id, token, uploaded);
      }
      renderUploads();
      onPhotoUpdated(updated, target);
      refreshNodePhotoList(nodeKey);
      setStatus(t("photos.manageSaved"));
    } catch (error) {
      setStatus(error?.message || t("photos.manageFailed"), true);
    } finally {
      saving = false;
      elements.photoManageSave.disabled = false;
      elements.photoManageDelete.disabled = false;
    }
  }

  function addUploaded(node, photo, token) {
    const stored = tokenStore.remember(photo.id, token, { node, photo });
    uploads.unshift({ node, photo });
    uploads = uploads.slice(0, 50);
    renderUploads();
    return stored;
  }

  function bind() {
    elements.photoManageClose.addEventListener("click", () => elements.photoManageDialog.close());
    elements.photoManageCancel.addEventListener("click", () => elements.photoManageDialog.close());
    elements.photoManageDialog.addEventListener("click", (event) => {
      if (event.target === elements.photoManageDialog) elements.photoManageDialog.close();
    });
    elements.photoManageDialog.addEventListener("close", () => {
      target = null;
      saving = false;
      elements.photoManagePasswordAuth.value = "";
    });
    elements.photoManageForm.addEventListener("submit", (event) => {
      event.preventDefault();
      void manage("edit");
    });
    elements.photoManageDelete.addEventListener("click", () => {
      if (window.confirm(t("photos.manageConfirmDelete"))) void manage("delete");
    });
  }

  return {
    addUploaded,
    bind,
    open,
    renderUploads,
    uploadsCount: () => uploads.length,
  };
}
