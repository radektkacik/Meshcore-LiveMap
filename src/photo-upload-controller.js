import { preparePhotoBlob } from "./photo-file-utils.js";

const MAX_FILES = 5;
const MAX_BYTES = 5 * 1024 * 1024;

export function createPhotoUploadController({
  appPath,
  elements,
  manage,
  onPublished = () => {},
  onUploaded = () => {},
  t,
  tCount,
}) {
  let autoApprove = null;
  let previewUrls = [];
  let target = null;
  let uploading = false;

  function setStatus(text, isError = false) {
    elements.photoStatus.textContent = text;
    elements.photoStatus.classList.toggle("error", Boolean(isError));
  }

  function resetPreview() {
    for (const url of previewUrls) URL.revokeObjectURL(url);
    previewUrls = [];
    elements.photoPreviewWrap.replaceChildren();
    elements.photoPreviewWrap.hidden = true;
  }

  function renderPreviews(files) {
    resetPreview();
    if (!files.length) return;
    elements.photoPreviewWrap.hidden = false;
    const showCoverChoice = files.length > 1;
    files.forEach((file, index) => {
      const url = URL.createObjectURL(file);
      previewUrls.push(url);
      const item = document.createElement("div");
      item.className = "photo-preview-item";
      const image = document.createElement("img");
      image.alt = t("photos.previewAlt");
      image.src = url;
      const caption = document.createElement("input");
      caption.type = "text";
      caption.className = "photo-caption-input";
      caption.maxLength = 240;
      caption.placeholder = t("photos.captionPlaceholder");
      caption.setAttribute("aria-label", t("photos.caption"));
      item.append(image, caption);
      if (showCoverChoice) {
        const cover = document.createElement("label");
        cover.className = "photo-cover-pick";
        cover.title = t("photos.coverPickTitle");
        const radio = document.createElement("input");
        radio.type = "radio";
        radio.name = "photo-cover";
        radio.value = String(index);
        radio.setAttribute("aria-label", t("photos.coverPickTitle"));
        const text = document.createElement("span");
        text.textContent = t("photos.coverPick");
        cover.append(radio, text);
        item.appendChild(cover);
      }
      elements.photoPreviewWrap.appendChild(item);
    });
  }

  function noteText() {
    return autoApprove ? t("photos.noteAuto") : t("photos.note");
  }

  async function loadConfig() {
    if (autoApprove !== null) return;
    try {
      const data = await getJson("/api/photos/config");
      autoApprove = data.autoApprove === true;
    } catch {
      autoApprove = false;
    }
    if (elements.photoDialog.open) elements.photoNote.textContent = noteText();
  }

  async function getJson(path) {
    const response = await fetch(appPath(path), {
      cache: "no-store",
      signal: AbortSignal.timeout(20_000),
    });
    if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
    return response.json();
  }

  function resetDialog() {
    elements.photoForm.reset();
    setStatus("");
    resetPreview();
    manage.renderUploads();
    elements.photoSubmit.disabled = false;
    uploading = false;
  }

  function renderDialog() {
    elements.photoTitle.textContent = t("photos.addTitle");
    elements.photoClose.setAttribute("aria-label", t("photos.cancel"));
    elements.photoFileLabel.textContent = t("photos.files");
    elements.photoAuthorLabel.textContent = t("photos.author");
    elements.photoAuthor.placeholder = t("photos.authorPlaceholder");
    elements.photoManagePasswordLabel.textContent = t("photos.managePassword");
    elements.photoManagePasswordNote.textContent = t("photos.managePasswordNote");
    elements.photoConsentLabel.textContent = t("photos.consent");
    elements.photoNote.textContent = noteText();
    elements.photoSubmit.textContent = t("photos.submit");
    elements.photoCancel.textContent = t("photos.cancel");
    elements.photoNode.textContent = target
      ? `${target.name || t("common.unknownNode")} · ${target.key.slice(0, 8).toUpperCase()}`
      : "";
  }

  function open(node) {
    const key = String(node.public_key || "").toLowerCase();
    if (!/^[0-9a-f]{64}$/.test(key)) return;
    target = { key, name: node.name || t("common.unknownNode") };
    resetDialog();
    renderDialog();
    void loadConfig();
    if (!elements.photoDialog.open) elements.photoDialog.showModal();
  }

  async function upload(event) {
    event.preventDefault();
    if (uploading) return;
    const files = [...(elements.photoFile.files || [])].slice(0, MAX_FILES);
    if (!files.length || !target) {
      setStatus(t("photos.invalid"), true);
      return;
    }
    if (!elements.photoConsent.checked) {
      setStatus(t("photos.consentRequired"), true);
      return;
    }
    const managePassword = elements.photoManagePassword.value;
    if (managePassword && (managePassword.length < 8 || managePassword.length > 128)) {
      setStatus(t("photos.managePasswordInvalid"), true);
      return;
    }
    uploading = true;
    elements.photoSubmit.disabled = true;
    let created = 0;
    let published = 0;
    let pending = 0;
    let failed = 0;
    let tokenStorageFailed = 0;
    let lastError = "";
    const batchId = files.length > 1
      ? (globalThis.crypto?.randomUUID?.() || `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`)
      : "";
    const coverChoice = elements.photoPreviewWrap.querySelector('input[name="photo-cover"]:checked');
    const coverIndex = coverChoice ? Number(coverChoice.value) : -1;
    let coverUploaded = false;
    let coverPending = false;
    try {
      for (let index = 0; index < files.length; index += 1) {
        setStatus(t("photos.uploadingFile", { current: index + 1, total: files.length }));
        let blob;
        try {
          blob = await preparePhotoBlob(files[index]);
        } catch (error) {
          failed += 1;
          lastError = error?.message === "heic" ? t("photos.heicFailed") : t("photos.invalid");
          continue;
        }
        if (blob.size > MAX_BYTES) {
          failed += 1;
          lastError = t("photos.tooLarge");
          continue;
        }
        try {
          const caption = elements.photoPreviewWrap
            .querySelectorAll(".photo-caption-input")[index]?.value.trim() || "";
          const headers = {
            "Content-Type": blob.type,
            "X-Photo-Author": encodeURIComponent(elements.photoAuthor.value.trim()),
            "X-Photo-Caption": encodeURIComponent(caption),
            "X-Photo-Manage-Password": encodeURIComponent(managePassword),
            "X-Photo-Batch-Index": String(index),
            "X-Photo-Batch-Size": String(files.length),
            "X-Photo-Consent": "1",
            "X-Photo-Key": target.key,
          };
          if (batchId) headers["X-Photo-Batch-Id"] = batchId;
          if (index === coverIndex) headers["X-Photo-Cover"] = "1";
          const response = await fetch(appPath("/api/photos"), {
            method: "POST",
            headers,
            body: blob,
            signal: AbortSignal.timeout(60_000),
          });
          const data = await response.json().catch(() => ({}));
          if (!response.ok) {
            lastError = data.error || t("photos.failed");
            if (response.status === 429) {
              failed += files.length - index;
              break;
            }
            failed += 1;
            continue;
          }
          created += 1;
          if (data.id && data.manageToken) {
            const managedPhoto = {
              author: elements.photoAuthor.value.trim(),
              caption,
              createdAt: Date.now(),
              id: data.id,
              nodeKey: target.key,
              status: data.status,
            };
            const managedNode = { name: target.name, public_key: target.key };
            if (!manage.addUploaded(managedNode, managedPhoto, data.manageToken)) {
              tokenStorageFailed += 1;
            }
          }
          if (data.status === "approved") published += 1;
          else pending += 1;
          if (index === coverIndex) {
            coverUploaded = true;
            coverPending = data.status !== "approved";
          }
        } catch (error) {
          failed += 1;
          lastError = error?.message || t("photos.failed");
        }
      }
      if (created > 0) {
        onUploaded();
        let statusText = t("photos.failed");
        if (failed > 0) statusText = t("photos.partial", { created, failed, total: files.length });
        else if (published === created) statusText = tCount("photos.publishedCount", published);
        else if (pending === created) statusText = tCount("photos.pendingCount", pending);
        else statusText = t("photos.mixed", { pending, published });
        if (coverIndex >= 0 && created > 0) {
          if (!coverUploaded) statusText = `${statusText} ${t("photos.coverNotUploaded")}`;
          else if (coverPending) statusText = `${statusText} ${t("photos.coverPending")}`;
        }
        if (tokenStorageFailed) statusText = `${statusText} ${t("photos.tokenStorageFailed")}`;
        if (manage.uploadsCount()) statusText = `${statusText} ${t("photos.manageUploadedHelp")}`;
        setStatus(statusText, failed > 0);
        if (published > 0) onPublished(target);
        elements.photoForm.reset();
        resetPreview();
        if (failed === 0 && manage.uploadsCount() === 0) {
          setTimeout(() => {
            if (elements.photoDialog.open) elements.photoDialog.close();
          }, 1_800);
        }
      } else {
        setStatus(lastError || t("photos.failed"), true);
      }
    } finally {
      uploading = false;
      elements.photoSubmit.disabled = false;
    }
  }

  function bind() {
    elements.photoClose.addEventListener("click", () => elements.photoDialog.close());
    elements.photoCancel.addEventListener("click", () => elements.photoDialog.close());
    elements.photoDialog.addEventListener("click", (event) => {
      if (event.target === elements.photoDialog) elements.photoDialog.close();
    });
    elements.photoDialog.addEventListener("close", resetDialog);
    elements.photoFile.addEventListener("change", () => {
      const files = [...(elements.photoFile.files || [])];
      renderPreviews(files.slice(0, MAX_FILES));
      setStatus(files.length > MAX_FILES ? t("photos.tooMany") : "");
    });
    elements.photoForm.addEventListener("submit", upload);
  }

  return { bind, open };
}
