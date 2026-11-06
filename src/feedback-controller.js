import { getLocale, t } from "./i18n.js";

export function createFeedbackController({ elements, getJson, postJson, formatNodeDate }) {
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

elements.feedbackToggle.addEventListener("click", () => {
  setFeedbackStatus("", false);
  if (!elements.feedbackDialog.open) elements.feedbackDialog.showModal();
  void loadFeedbackPublic();
});

elements.feedbackClose.addEventListener("click", () => elements.feedbackDialog.close());
elements.feedbackCancel.addEventListener("click", () => elements.feedbackDialog.close());
elements.feedbackDialog.addEventListener("click", (event) => {
  if (event.target === elements.feedbackDialog) elements.feedbackDialog.close();
});

elements.feedbackForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const message = elements.feedbackMessage.value.trim();
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
  return { loadFeedbackPublic, renderFeedbackPublic, setFeedbackStatus };
}
