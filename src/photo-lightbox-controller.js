const PHOTO_SWIPE_MIN_PX = 48;
const PHOTO_SWIPE_DOMINANCE = 1.25;

export function createPhotoLightboxController({
  appPath,
  elements,
  onManage = () => {},
  onOpenNode = () => {},
  onVote = () => {},
  postJson,
  resolveNode = () => null,
  t,
}) {
  let current = null;
  let drag = null;
  let index = 0;
  let node = null;
  let panX = 0;
  let panY = 0;
  let photos = [];
  let pinch = null;
  let pointers = new Map();
  let reportPhoto = null;
  let suppressTapUntil = 0;
  let swipe = null;
  let voteBusy = false;
  let zoom = 1;
  let zoomFit = 1;

  function resolvedNode(photoValue) {
    const key = String(photoValue?.nodeKey || "").toLowerCase();
    if (key) {
      return resolveNode(key)
        || { name: photoValue.nodeName || key.slice(0, 8), public_key: key };
    }
    return node || {};
  }

  function renderVoteState(photoValue = current?.photo) {
    const myVote = Number(photoValue?.myVote) || 0;
    elements.photoLikeCount.textContent = String(Number(photoValue?.likes) || 0);
    elements.photoDislikeCount.textContent = String(Number(photoValue?.dislikes) || 0);
    elements.photoLike.classList.toggle("active", myVote === 1);
    elements.photoDislike.classList.toggle("active", myVote === -1);
    elements.photoLike.setAttribute("aria-pressed", String(myVote === 1));
    elements.photoDislike.setAttribute("aria-pressed", String(myVote === -1));
  }

  async function vote(value) {
    if (!current || voteBusy) return;
    const active = current.photo;
    const next = Number(active.myVote) === value ? 0 : value;
    voteBusy = true;
    elements.photoLike.disabled = true;
    elements.photoDislike.disabled = true;
    try {
      const summary = await onVote(active, next);
      if (!summary) return;
      const photoIndex = photos.findIndex((entry) => entry.id === active.id);
      if (photoIndex >= 0) photos[photoIndex] = { ...photos[photoIndex], ...summary };
      if (current?.photo?.id === active.id) {
        current = { ...current, photo: { ...current.photo, ...summary } };
        renderVoteState(current.photo);
      }
    } catch (error) {
      console.error("Hlasování u fotky selhalo", error);
    } finally {
      voteBusy = false;
      elements.photoLike.disabled = false;
      elements.photoDislike.disabled = false;
    }
  }

  function setPhotoReportStatus(text, isError = false) {
    elements.photoReportStatus.textContent = text;
    elements.photoReportStatus.classList.toggle("error", Boolean(isError));
  }

  function renderPhotoReportDialog() {
    elements.photoReportTitle.textContent = t("photos.reportTitle");
    elements.photoReportClose.setAttribute("aria-label", t("photos.reportClose"));
    elements.photoReportReasonLabel.textContent = t("photos.reportReason");
    elements.photoReportMessageLabel.textContent = t("photos.reportMessage");
    elements.photoReportMessage.placeholder = t("photos.reportMessagePlaceholder");
    elements.photoReportContactLabel.textContent = t("photos.reportContact");
    elements.photoReportContact.placeholder = t("photos.reportContactPlaceholder");
    elements.photoReportNote.textContent = t("photos.reportNote");
    elements.photoReportSubmit.textContent = t("photos.reportSubmit");
    elements.photoReportCancel.textContent = t("photos.reportCancel");
    elements.photoReportReason.replaceChildren(...[
      ["owner", t("photos.reportReasonOwner")],
      ["privacy", t("photos.reportReasonPrivacy")],
      ["inappropriate", t("photos.reportReasonInappropriate")],
      ["other", t("photos.reportReasonOther")],
    ].map(([value, label]) => {
      const option = document.createElement("option");
      option.value = value;
      option.textContent = label;
      return option;
    }));
    if (reportPhoto) {
      const name = reportPhoto.node?.name || t("common.unknownNode");
      elements.photoReportPhoto.textContent = reportPhoto.photo.caption
        ? `${name} · ${reportPhoto.photo.caption}`
        : name;
    }
  }

  function openReport() {
    if (!current) return;
    reportPhoto = current;
    if (elements.photoLightbox.open) elements.photoLightbox.close();
    elements.photoReportForm.reset();
    setPhotoReportStatus("");
    elements.photoReportSubmit.disabled = false;
    renderPhotoReportDialog();
    if (!elements.photoReportDialog.open) elements.photoReportDialog.showModal();
  }

  function photoZoomBounds() {
    const img = elements.photoLightboxImg;
    const stage = elements.photoLightboxStage.getBoundingClientRect();
    const width = img.naturalWidth;
    const height = img.naturalHeight;
    if (!width || !height || !stage.width || !stage.height) return null;
    const fit = Math.min(stage.width / width, stage.height / height, 1);
    const max = Math.max(1, Math.min(4, fit * 6));
    return { fit, height, max, stage, width };
  }

  function applyZoom() {
    const bounds = photoZoomBounds();
    if (!bounds) return;
    const { height, stage, width } = bounds;
    const zoomedWidth = width * zoom;
    const zoomedHeight = height * zoom;
    panX = zoomedWidth <= stage.width
      ? (stage.width - zoomedWidth) / 2
      : Math.max(stage.width - zoomedWidth, Math.min(0, panX));
    panY = zoomedHeight <= stage.height
      ? (stage.height - zoomedHeight) / 2
      : Math.max(stage.height - zoomedHeight, Math.min(0, panY));
    elements.photoLightboxImg.style.transform = `translate(${panX}px, ${panY}px) scale(${zoom})`;
    elements.photoLightboxZoomLabel.textContent = `${Math.round(zoom * 100)} %`;
  }

  function resetZoom() {
    const bounds = photoZoomBounds();
    if (!bounds) return;
    zoomFit = bounds.fit;
    zoom = bounds.fit;
    panX = 0;
    panY = 0;
    applyZoom();
  }

  function scheduleZoomReset() {
    const img = elements.photoLightboxImg;
    if (typeof img.decode === "function") {
      img.decode()
        .then(() => requestAnimationFrame(() => {
          resetZoom();
          setTimeout(resetZoom, 100);
        }))
        .catch(() => {});
    }
    if (img.complete && img.naturalWidth) {
      requestAnimationFrame(resetZoom);
      setTimeout(resetZoom, 100);
      return;
    }
    img.addEventListener("load", () => {
      requestAnimationFrame(resetZoom);
      setTimeout(resetZoom, 100);
    }, { once: true });
  }

  function zoomAt(nextZoom, clientX, clientY) {
    const bounds = photoZoomBounds();
    if (!bounds) return;
    const rect = bounds.stage;
    const anchorX = clientX == null ? rect.width / 2 : clientX - rect.left;
    const anchorY = clientY == null ? rect.height / 2 : clientY - rect.top;
    const previous = zoom || bounds.fit;
    const target = Math.max(bounds.fit, Math.min(bounds.max, nextZoom));
    panX = anchorX - (anchorX - panX) * (target / previous);
    panY = anchorY - (anchorY - panY) * (target / previous);
    zoom = target;
    applyZoom();
  }

  function zoomBy(factor, clientX, clientY) {
    zoomAt((zoom || zoomFit) * factor, clientX, clientY);
  }

  function show() {
    const active = photos[index];
    if (!active) return;
    const activeNode = resolvedNode(active);
    current = { node: activeNode, photo: active };
    elements.photoLightboxImg.style.transform = "";
    elements.photoLightboxImg.src = appPath(`/api/photos/${encodeURIComponent(active.id)}`);
    elements.photoLightboxImg.alt = t("photos.alt", { name: activeNode.name || t("common.unknownNode") });
    elements.photoLightboxNode.textContent = active.nodeKey ? (activeNode.name || t("common.unknownNode")) : "";
    elements.photoLightboxNode.hidden = !active.nodeKey;
    elements.photoLightboxCaption.textContent = active.caption || "";
    elements.photoLightboxCaption.hidden = !active.caption;
    elements.photoLightboxAuthor.textContent = active.author || "";
    elements.photoLightboxAuthor.hidden = !active.author;
    renderVoteState(active);
    elements.photoLike.title = t("photos.like");
    elements.photoLike.setAttribute("aria-label", t("photos.like"));
    elements.photoDislike.title = t("photos.dislike");
    elements.photoDislike.setAttribute("aria-label", t("photos.dislike"));
    elements.photoLightboxClose.setAttribute("aria-label", t("photos.close"));
    elements.photoNodeOpen.hidden = !/^[0-9a-f]{64}$/.test(String(active.nodeKey || activeNode.public_key || "").toLowerCase());
    elements.photoNodeOpen.textContent = t("photos.openNode");
    elements.photoNodeOpen.title = t("photos.openNodeTitle");
    elements.photoNodeOpen.setAttribute("aria-label", t("photos.openNodeTitle"));
    elements.photoReportOpen.textContent = t("photos.report");
    elements.photoManageOpen.textContent = t("photos.manage");
    elements.photoLightboxPrev.setAttribute("aria-label", t("photos.previous"));
    elements.photoLightboxNext.setAttribute("aria-label", t("photos.next"));
    elements.photoLightboxCounter.textContent = `${index + 1} / ${photos.length}`;
    const multiple = photos.length > 1;
    elements.photoLightboxPrev.hidden = !multiple;
    elements.photoLightboxNext.hidden = !multiple;
    elements.photoLightboxCounter.hidden = !multiple;
    elements.photoLightboxZoomIn.title = t("photos.zoomIn");
    elements.photoLightboxZoomIn.setAttribute("aria-label", t("photos.zoomIn"));
    elements.photoLightboxZoomOut.title = t("photos.zoomOut");
    elements.photoLightboxZoomOut.setAttribute("aria-label", t("photos.zoomOut"));
    elements.photoLightboxZoomReset.title = t("photos.zoomReset");
    elements.photoLightboxZoomReset.setAttribute("aria-label", t("photos.zoomReset"));
    scheduleZoomReset();
  }

  function open(photoValue, nodeValue, photoList = [photoValue], startIndex = 0) {
    photos = Array.isArray(photoList) && photoList.length ? photoList : [photoValue];
    index = Math.max(0, Math.min(photos.length - 1, Number(startIndex) || 0));
    node = nodeValue;
    show();
    if (!elements.photoLightbox.open) elements.photoLightbox.showModal();
    requestAnimationFrame(resetZoom);
  }

  function close() {
    if (elements.photoLightbox.open) elements.photoLightbox.close();
  }

  function step(delta) {
    if (photos.length < 2) return;
    index = (index + delta + photos.length) % photos.length;
    show();
  }

  function updatePhoto(photoId, changes) {
    const photoIndex = photos.findIndex((entry) => entry.id === photoId);
    if (photoIndex >= 0) photos[photoIndex] = { ...photos[photoIndex], ...changes };
    if (current?.photo?.id === photoId) show();
  }

  function removePhoto(photoId) {
    const wasCurrent = current?.photo?.id === photoId;
    const previousIndex = index;
    photos = photos.filter((entry) => entry.id !== photoId);
    if (!wasCurrent) return false;
    if (!photos.length) {
      close();
      return true;
    }
    index = Math.min(previousIndex, photos.length - 1);
    show();
    return true;
  }

  function pinchPoints() {
    return [...pointers.values()].slice(0, 2);
  }

  function beginPinch() {
    const points = pinchPoints();
    const bounds = photoZoomBounds();
    if (points.length < 2 || !bounds) return;
    if (swipe) {
      swipe = null;
      applyZoom();
    }
    const rect = bounds.stage;
    const centerX = (points[0].x + points[1].x) / 2 - rect.left;
    const centerY = (points[0].y + points[1].y) / 2 - rect.top;
    pinch = {
      max: bounds.max,
      min: bounds.fit,
      startCenterX: centerX,
      startCenterY: centerY,
      startDistance: Math.max(1, Math.hypot(points[0].x - points[1].x, points[0].y - points[1].y)),
      startPanX: panX,
      startPanY: panY,
      startZoom: zoom || bounds.fit,
    };
    drag = null;
    elements.photoLightboxStage.classList.remove("dragging");
    elements.photoLightboxStage.classList.add("pinching");
  }

  function updatePinch() {
    const points = pinchPoints();
    const bounds = photoZoomBounds();
    if (!pinch || points.length < 2 || !bounds) return;
    const rect = bounds.stage;
    const distance = Math.max(1, Math.hypot(points[0].x - points[1].x, points[0].y - points[1].y));
    const centerX = (points[0].x + points[1].x) / 2 - rect.left;
    const centerY = (points[0].y + points[1].y) / 2 - rect.top;
    const nextZoom = Math.max(pinch.min, Math.min(pinch.max, pinch.startZoom * (distance / pinch.startDistance)));
    const ratio = nextZoom / pinch.startZoom;
    zoom = nextZoom;
    panX = centerX - (pinch.startCenterX - pinch.startPanX) * ratio;
    panY = centerY - (pinch.startCenterY - pinch.startPanY) * ratio;
    applyZoom();
  }

  function endPointer(event) {
    const activeSwipe = swipe;
    const swipeEnded = activeSwipe?.id === event.pointerId;
    pointers.delete(event.pointerId);
    if (pinch && pointers.size < 2) {
      pinch = null;
      elements.photoLightboxStage.classList.remove("pinching");
      const remaining = [...pointers.entries()][0];
      if (remaining && zoom > zoomFit + 0.001) {
        const [id, point] = remaining;
        drag = {
          id,
          panX,
          panY,
          x: point.x,
          y: point.y,
        };
        elements.photoLightboxStage.classList.add("dragging");
        try {
          elements.photoLightboxStage.setPointerCapture(id);
        } catch {
          // The remaining pointer may already be gone.
        }
      }
    }
    if (swipeEnded) {
      swipe = null;
      elements.photoLightboxStage.classList.remove("swiping");
      const absX = Math.abs(activeSwipe.dx);
      const absY = Math.abs(activeSwipe.dy);
      const navigate = event.type === "pointerup"
        && absX >= PHOTO_SWIPE_MIN_PX
        && absX > absY * PHOTO_SWIPE_DOMINANCE;
      if (navigate) {
        suppressTapUntil = performance.now() + 450;
        step(activeSwipe.dx < 0 ? 1 : -1);
      } else {
        applyZoom();
      }
    }
    if (drag?.id === event.pointerId) {
      drag = null;
      elements.photoLightboxStage.classList.remove("dragging");
    }
    if (elements.photoLightboxStage.hasPointerCapture(event.pointerId)) {
      elements.photoLightboxStage.releasePointerCapture(event.pointerId);
    }
  }

  function bind() {
    elements.photoLightboxClose.addEventListener("click", close);
    elements.photoLightboxPrev.addEventListener("click", () => step(-1));
    elements.photoLightboxNext.addEventListener("click", () => step(1));
    elements.photoLightboxZoomIn.addEventListener("click", () => zoomBy(1.4));
    elements.photoLightboxZoomOut.addEventListener("click", () => zoomBy(1 / 1.4));
    elements.photoLightboxZoomReset.addEventListener("click", () => zoomAt(1, null, null));
    elements.photoLightboxStage.addEventListener("wheel", (event) => {
      if (!elements.photoLightbox.open) return;
      event.preventDefault();
      zoomBy(Math.exp(-event.deltaY * 0.0015), event.clientX, event.clientY);
    }, { passive: false });
    elements.photoLightboxStage.addEventListener("pointerdown", (event) => {
      if (!elements.photoLightbox.open) return;
      if (event.pointerType === "mouse" && event.button !== 0) return;
      pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
      if (pointers.size >= 2) {
        event.preventDefault();
        if (swipe) {
          swipe = null;
          applyZoom();
        }
        if (!pinch) beginPinch();
        for (const pointerId of pointers.keys()) {
          try {
            elements.photoLightboxStage.setPointerCapture(pointerId);
          } catch {
            // The pointer may already be gone.
          }
        }
        return;
      }
      if (zoom > zoomFit + 0.001) {
        event.preventDefault();
        drag = {
          id: event.pointerId,
          panX,
          panY,
          x: event.clientX,
          y: event.clientY,
        };
        elements.photoLightboxStage.classList.add("dragging");
        elements.photoLightboxStage.setPointerCapture(event.pointerId);
        return;
      }
      if (event.pointerType === "mouse" || photos.length < 2) return;
      swipe = {
        dx: 0,
        dy: 0,
        id: event.pointerId,
        startX: event.clientX,
        startY: event.clientY,
      };
      elements.photoLightboxStage.classList.add("swiping");
      elements.photoLightboxStage.setPointerCapture(event.pointerId);
    });
    elements.photoLightboxStage.addEventListener("pointermove", (event) => {
      if (!pointers.has(event.pointerId)) return;
      pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
      if (pinch) {
        event.preventDefault();
        updatePinch();
        return;
      }
      if (swipe && swipe.id === event.pointerId) {
        swipe.dx = event.clientX - swipe.startX;
        swipe.dy = event.clientY - swipe.startY;
        if (Math.abs(swipe.dx) > 8 && Math.abs(swipe.dx) > Math.abs(swipe.dy)) {
          event.preventDefault();
          elements.photoLightboxImg.style.transform = `translate(${panX + swipe.dx * 0.28}px, ${panY}px) scale(${zoom})`;
        }
        return;
      }
      if (!drag || drag.id !== event.pointerId) return;
      panX = drag.panX + (event.clientX - drag.x);
      panY = drag.panY + (event.clientY - drag.y);
      applyZoom();
    });
    elements.photoLightboxStage.addEventListener("pointerup", endPointer);
    elements.photoLightboxStage.addEventListener("pointercancel", endPointer);
    elements.photoLightboxStage.addEventListener("lostpointercapture", (event) => {
      if (pointers.has(event.pointerId)) endPointer(event);
    });
    elements.photoLightboxStage.addEventListener("dblclick", (event) => {
      if (performance.now() < suppressTapUntil) {
        event.preventDefault();
        return;
      }
      if (zoom > zoomFit * 1.1) resetZoom();
      else zoomAt(1, event.clientX, event.clientY);
    });
    window.addEventListener("resize", () => {
      if (elements.photoLightbox.open) resetZoom();
    });
    elements.photoLightbox.addEventListener("keydown", (event) => {
      if (event.key === "ArrowLeft") {
        event.preventDefault();
        step(-1);
      } else if (event.key === "ArrowRight") {
        event.preventDefault();
        step(1);
      }
    });
    elements.photoLightbox.addEventListener("click", (event) => {
      const suppressed = performance.now() < suppressTapUntil
        && (event.target === elements.photoLightbox || elements.photoLightboxStage.contains(event.target));
      if (suppressed) {
        event.preventDefault();
        return;
      }
      if (event.target === elements.photoLightbox) close();
    });
    elements.photoLightbox.addEventListener("close", () => {
      elements.photoLightboxImg.style.transform = "";
      elements.photoLightboxImg.removeAttribute("src");
      elements.photoLightboxNode.textContent = "";
      elements.photoLightboxNode.hidden = true;
      elements.photoLightboxCaption.textContent = "";
      elements.photoLightboxAuthor.textContent = "";
      elements.photoNodeOpen.hidden = true;
      drag = null;
      pointers.clear();
      pinch = null;
      swipe = null;
      suppressTapUntil = 0;
      elements.photoLightboxStage.classList.remove("dragging", "pinching", "swiping");
      zoom = 1;
      zoomFit = 1;
      panX = 0;
      panY = 0;
      current = null;
      photos = [];
      index = 0;
      node = null;
    });
    elements.photoLike.addEventListener("click", () => { void vote(1); });
    elements.photoDislike.addEventListener("click", () => { void vote(-1); });
    elements.photoNodeOpen.addEventListener("click", () => {
      if (!current) return;
      const active = current;
      close();
      onOpenNode(active.photo, active.node);
    });
    elements.photoManageOpen.addEventListener("click", () => {
      if (current) onManage(current.photo, current.node);
    });
    elements.photoReportOpen.addEventListener("click", openReport);
    elements.photoReportClose.addEventListener("click", () => elements.photoReportDialog.close());
    elements.photoReportCancel.addEventListener("click", () => elements.photoReportDialog.close());
    elements.photoReportDialog.addEventListener("click", (event) => {
      if (event.target === elements.photoReportDialog) elements.photoReportDialog.close();
    });
    elements.photoReportDialog.addEventListener("close", () => {
      reportPhoto = null;
      elements.photoReportForm.reset();
      setPhotoReportStatus("");
    });
    elements.photoReportForm.addEventListener("submit", async (event) => {
      event.preventDefault();
      if (!reportPhoto) return;
      const message = elements.photoReportMessage.value.trim();
      if (message.length < 5) {
        setPhotoReportStatus(t("photos.reportTooShort"), true);
        return;
      }
      elements.photoReportSubmit.disabled = true;
      setPhotoReportStatus(t("photos.reportSending"));
      try {
        await postJson("/api/photos/report", {
          contact: elements.photoReportContact.value.trim(),
          message,
          photoId: reportPhoto.photo.id,
          reason: elements.photoReportReason.value,
        });
        setPhotoReportStatus(t("photos.reportSent"));
        elements.photoReportForm.reset();
        setTimeout(() => {
          if (elements.photoReportDialog.open) elements.photoReportDialog.close();
        }, 2_000);
      } catch (error) {
        setPhotoReportStatus(error.message || t("photos.reportFailed"), true);
      } finally {
        elements.photoReportSubmit.disabled = false;
      }
    });
  }

  return {
    bind,
    close,
    current: () => current,
    open,
    removePhoto,
    updatePhoto,
  };
}
