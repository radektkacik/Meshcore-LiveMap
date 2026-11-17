import { getLocale, t } from "./i18n.js";

export function createFeedbackController({ elements, getJson, postJson, formatNodeDate }) {
let nodeContext = null;

function setFeedbackStatus(text, isError) {
  elements.feedbackStatus.textContent = text;
  elements.feedbackStatus.classList.toggle("error", Boolean(isError));
}

function renderFeedbackPublic(entries) {
  if (!entries.length) {
    const empty = document.createElement("li");
    empty.className = "fb-empty";
    empty.textContent = t("feedback.emptyPublic");
    elements.feedbackList.replaceChildren(empty);
    return;
  }
  elements.feedbackList.replaceChildren(...entries.map((entry) => {
    const item = document.createElement("li");
    const head = document.createElement("div");
    head.className = "fb-head";
    const name = document.createElement("span");
    name.className = "fb-name";
    name.textContent = entry.name || t("feedback.visitor");
    const time = document.createElement("time");
    time.textContent = formatNodeDate(entry.created_at);
    head.append(name, time);
    const body = document.createElement("p");
    body.textContent = entry.message;
    item.append(head, body);
    return item;
  }));
}

async function loadFeedbackPublic() {
  try {
    const data = await getJson("/api/feedback/public");
    renderFeedbackPublic(data.entries || []);
  } catch (error) {
    console.error("Veřejné vzkazy se nepodařilo načíst", error);
  }
}

function openForNode(node) {
  const key = String(node?.public_key || "").toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(key)) return;
  nodeContext = { key, name: node.name || t("common.unknownNode") };
  elements.feedbackForm.reset();
  elements.feedbackPublic.checked = false;
  elements.feedbackPublic.disabled = true;
  elements.feedbackCategory.value = "other";
  elements.feedbackNodeContext.textContent = t("feedback.nodeContext", {
    key: key.slice(0, 12),
    name: nodeContext.name,
  });
  elements.feedbackNodeContext.hidden = false;
  const prefix = t("feedback.nodePrefix", { key, name: nodeContext.name });
  elements.feedbackMessage.maxLength = Math.max(5, 2000 - prefix.length - 2);
  setFeedbackStatus("", false);
  if (!elements.feedbackDialog.open) elements.feedbackDialog.showModal();
  void loadFeedbackPublic();
  elements.feedbackMessage.focus();
}

elements.feedbackToggle.addEventListener("click", () => {
  nodeContext = null;
  elements.feedbackNodeContext.hidden = true;
  elements.feedbackMessage.maxLength = 2000;
  elements.feedbackPublic.disabled = false;
  setFeedbackStatus("", false);
  if (!elements.feedbackDialog.open) elements.feedbackDialog.showModal();
  void loadFeedbackPublic();
});

elements.feedbackClose.addEventListener("click", () => elements.feedbackDialog.close());
elements.feedbackCancel.addEventListener("click", () => elements.feedbackDialog.close());
elements.feedbackDialog.addEventListener("click", (event) => {
  if (event.target === elements.feedbackDialog) elements.feedbackDialog.close();
});
elements.feedbackDialog.addEventListener("close", () => {
  nodeContext = null;
  elements.feedbackNodeContext.hidden = true;
  elements.feedbackMessage.maxLength = 2000;
  elements.feedbackPublic.disabled = false;
});

elements.feedbackForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const userMessage = elements.feedbackMessage.value.trim();
  const message = nodeContext
    ? `${t("feedback.nodePrefix", { key: nodeContext.key, name: nodeContext.name })}\n\n${userMessage}`
    : userMessage;
  if (message.length < 5) {
    setFeedbackStatus(t("feedback.tooShort"), true);
    return;
  }
  elements.feedbackSend.disabled = true;
  setFeedbackStatus(t("feedback.sending"), false);
  try {
    await postJson("/api/feedback", {
      category: elements.feedbackCategory.value,
      contact: elements.feedbackContact.value.trim(),
      isPublic: elements.feedbackPublic.checked,
      message,
      name: elements.feedbackName.value.trim(),
    });
    elements.feedbackForm.reset();
    nodeContext = null;
    elements.feedbackNodeContext.hidden = true;
    elements.feedbackMessage.maxLength = 2000;
    elements.feedbackPublic.disabled = false;
    setFeedbackStatus(t("feedback.sent"), false);
    void loadFeedbackPublic();
    setTimeout(() => {
      if (elements.feedbackDialog.open) elements.feedbackDialog.close();
    }, 1_500);
  } catch (error) {
    setFeedbackStatus(
      getLocale() === "en" ? t("feedback.failed") : t("feedback.failedWith", { message: error.message }),
      true,
    );
  } finally {
    elements.feedbackSend.disabled = false;
  }
});
  return { loadFeedbackPublic, openForNode, renderFeedbackPublic, setFeedbackStatus };
}
