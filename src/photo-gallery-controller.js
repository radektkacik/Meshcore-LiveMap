import { buildPhotoGallerySections, isNewPhoto } from "./photo-gallery-model.js";

const CACHE_TTL_MS = 60_000;

export function createPhotoGalleryController({
  appPath,
  elements,
  formatDateTimeShort,
  getJson,
  getLocale,
  nowMs = () => Date.now(),
  onOpenNode = () => {},
  onOpenPhoto = () => {},
  state,
  t,
  tCount,
}) {
  let error = false;
  let loadedAt = 0;
  let loading = false;
  let photos = [];
  let query = "";
  let view = [];

  function renderLabels() {
    elements.photoGalleryOpen.textContent = t("photos.galleryOpen");
    elements.photoGalleryOpen.title = t("photos.galleryOpenTitle");
    elements.photoGalleryOpen.setAttribute("aria-label", t("photos.galleryOpenTitle"));
    elements.photoGalleryTitle.textContent = t("photos.gallery");
    elements.photoGalleryClose.setAttribute("aria-label", t("photos.cancel"));
    elements.photoGallerySearch.placeholder = t("photos.gallerySearch");
    elements.photoGalleryNote.textContent = t("photos.galleryNote");
  }

  function filteredPhotos() {
    const needle = query.trim().toLowerCase();
    if (!needle) return photos;
    return photos.filter((photo) => [photo.nodeName, photo.caption, photo.author]
      .some((value) => String(value || "").toLowerCase().includes(needle)));
  }

  function createCard(photo, index, isNew) {
    const item = document.createElement("article");
    item.className = "photo-gallery-item";
    const photoButton = document.createElement("button");
    photoButton.type = "button";
    photoButton.className = "photo-gallery-photo";
    photoButton.dataset.index = String(index);
    const nodeName = photo.nodeName || t("common.unknownNode");
    photoButton.title = [nodeName, photo.caption, photo.author].filter(Boolean).join(" · ");
    photoButton.setAttribute("aria-label", t("photos.openAria"));
    if (isNew) {
      const badge = document.createElement("span");
      badge.className = "photo-gallery-new-badge";
      badge.textContent = t("photos.galleryNewBadge");
      badge.title = t("photos.galleryNewBadgeTitle");
      photoButton.appendChild(badge);
    }
    const image = document.createElement("img");
    image.src = appPath(`/api/photos/${encodeURIComponent(photo.id)}`);
    image.alt = t("photos.alt", { name: nodeName });
    image.loading = "lazy";
    image.decoding = "async";
    photoButton.appendChild(image);
    item.appendChild(photoButton);

    const meta = document.createElement("div");
    meta.className = "photo-gallery-meta";
    const nodeButton = document.createElement("button");
    nodeButton.type = "button";
    nodeButton.className = "photo-gallery-node-link";
    nodeButton.dataset.index = String(index);
    nodeButton.textContent = nodeName;
    nodeButton.title = t("photos.openNodeTitle");
    meta.appendChild(nodeButton);
    const detail = photo.caption || photo.author;
    if (detail) {
      const small = document.createElement("small");
      small.textContent = detail;
      meta.appendChild(small);
    }
    if (photo.createdAt) {
      const date = document.createElement("small");
      date.className = "photo-gallery-date";
      date.textContent = formatDateTimeShort(photo.createdAt);
      meta.appendChild(date);
    }
    item.appendChild(meta);
    return item;
  }

  function appendSection(title, groupPhotos, indexById, now) {
    const section = document.createElement("section");
    section.className = "photo-gallery-section";
    const head = document.createElement("div");
    head.className = "photo-gallery-section-head";
    const heading = document.createElement("h3");
    const nodeButton = document.createElement("button");
    nodeButton.type = "button";
    nodeButton.className = "photo-gallery-section-node";
    nodeButton.textContent = title;
    nodeButton.title = t("photos.openNodeTitle");
    nodeButton.addEventListener("click", () => onOpenNode(groupPhotos[0]));
    heading.appendChild(nodeButton);
    const count = document.createElement("small");
    count.textContent = tCount("photos.galleryCount", groupPhotos.length);
    head.append(heading, count);
    const cards = document.createElement("div");
    cards.className = "photo-gallery-cards";
    for (const photo of groupPhotos) {
      cards.appendChild(createCard(photo, indexById.get(photo.id) ?? 0, isNewPhoto(photo, now)));
    }
    section.append(head, cards);
    elements.photoGalleryGrid.appendChild(section);
  }

  function render() {
    renderLabels();
    const visible = filteredPhotos();
    elements.photoGalleryGrid.replaceChildren();

    if (loading && !photos.length) {
      elements.photoGallerySummary.textContent = "";
      elements.photoGalleryStatus.hidden = false;
      elements.photoGalleryStatus.classList.remove("error");
      elements.photoGalleryStatus.textContent = t("photos.galleryLoading");
      return;
    }

    elements.photoGalleryStatus.hidden = !error;
    elements.photoGalleryStatus.classList.toggle("error", error);
    elements.photoGalleryStatus.textContent = error ? t("photos.galleryFailed") : "";

    if (!visible.length) {
      elements.photoGallerySummary.textContent = "";
      const empty = document.createElement("p");
      empty.className = "photo-gallery-empty";
      empty.textContent = photos.length ? t("search.empty") : t("photos.galleryEmpty");
      elements.photoGalleryGrid.appendChild(empty);
      return;
    }

    const nodeCount = new Set(visible.map((photo) => photo.nodeKey).filter(Boolean)).size;
    elements.photoGallerySummary.textContent = `${tCount("photos.galleryCount", visible.length)} · ${tCount("photos.galleryNodes", nodeCount)}`;

    const groups = buildPhotoGallerySections(visible, {
      collator: new Intl.Collator(getLocale(), { numeric: true, sensitivity: "base" }),
    });
    const ordered = groups.flatMap((group) => group.photos);
    view = ordered;
    const indexById = new Map(ordered.map((photo, index) => [photo.id, index]));
    const now = nowMs();
    for (const group of groups) {
      appendSection(group.nodeName || t("common.unknownNode"), group.photos, indexById, now);
    }
  }

  async function load(force = false) {
    if (!force && loadedAt && Date.now() - loadedAt < CACHE_TTL_MS) return;
    if (loading) return;
    loading = true;
    error = false;
    render();
    try {
      const data = await getJson("/api/photos/all");
      photos = (Array.isArray(data.photos) ? data.photos : []).map((photo) => {
        const nodeKey = String(photo.nodeKey || "").toLowerCase();
        const known = nodeKey ? state.nodeByKey.get(nodeKey.toUpperCase()) : null;
        return {
          ...photo,
          nodeKey,
          nodeName: known?.name || String(photo.nodeName || "").trim() || t("common.unknownNode"),
        };
      });
      loadedAt = Date.now();
    } catch (loadError) {
      console.error("Fotogalerii se nepodařilo načíst", loadError);
      error = true;
    } finally {
      loading = false;
      if (elements.photoGalleryDialog.open) render();
    }
  }

  function open() {
    if (!elements.photoGalleryDialog.open) elements.photoGalleryDialog.showModal();
    query = "";
    elements.photoGallerySearch.value = "";
    elements.photoGalleryGrid.scrollTop = 0;
    render();
    void load();
  }

  function updatePhoto(photo) {
    const index = photos.findIndex((entry) => entry.id === photo?.id);
    if (index < 0) return;
    photos[index] = { ...photos[index], ...photo };
    if (elements.photoGalleryDialog.open) render();
  }

  function removePhoto(photoId) {
    const id = String(photoId || "");
    photos = photos.filter((entry) => entry.id !== id);
    if (elements.photoGalleryDialog.open) render();
  }

  function invalidate() {
    loadedAt = 0;
  }

  function bind() {
    elements.photoGalleryOpen.addEventListener("click", open);
    elements.photoGalleryClose.addEventListener("click", () => elements.photoGalleryDialog.close());
    elements.photoGalleryDialog.addEventListener("click", (event) => {
      if (event.target === elements.photoGalleryDialog) elements.photoGalleryDialog.close();
    });
    elements.photoGallerySearch.addEventListener("input", () => {
      query = elements.photoGallerySearch.value;
      render();
    });
    elements.photoGalleryGrid.addEventListener("click", (event) => {
      const nodeButton = event.target.closest(".photo-gallery-node-link");
      if (nodeButton) {
        const photo = view[Number(nodeButton.dataset.index)];
        if (photo) onOpenNode(photo);
        return;
      }
      const photoButton = event.target.closest(".photo-gallery-photo");
      if (!photoButton) return;
      const index = Number(photoButton.dataset.index);
      const photo = view[index];
      if (photo) onOpenPhoto(photo, view, index);
    });
  }

  return {
    bind,
    invalidate,
    open,
    removePhoto,
    updatePhoto,
  };
}
