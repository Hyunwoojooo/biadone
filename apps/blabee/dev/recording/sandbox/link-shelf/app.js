const sampleLinks = [
  {
    title: "MDN Web Docs",
    description: "The web platform, explained.",
    url: "https://developer.mozilla.org/en-US/",
    domain: "developer.mozilla.org",
    category: "Development",
  },
  {
    title: "Figma",
    description: "A space to shape your next idea.",
    url: "https://www.figma.com/",
    domain: "figma.com",
    category: "Design",
  },
  {
    title: "Raycast",
    description: "Everyday tools, one shortcut away.",
    url: "https://www.raycast.com/",
    domain: "raycast.com",
    category: "Tools",
  },
  {
    title: "JavaScript.info",
    description: "A practical guide to JavaScript.",
    url: "https://javascript.info/",
    domain: "javascript.info",
    category: "Development",
  },
  {
    title: "Google Fonts",
    description: "Find the right type for your next project.",
    url: "https://fonts.google.com/",
    domain: "fonts.google.com",
    category: "Design",
  },
  {
    title: "Can I use",
    description: "Check browser support before you ship.",
    url: "https://caniuse.com/",
    domain: "caniuse.com",
    category: "Tools",
  },
];

const grid = document.querySelector("#resource-grid");
const count = document.querySelector("#collection-count");
const template = document.querySelector("#resource-card-template");
const form = document.querySelector("#link-form");
const formStatus = document.querySelector("#form-status");
const allFilter = document.querySelector("#filter-all");
const developmentFilter = document.querySelector("#filter-development");
const designFilter = document.querySelector("#filter-design");
const toolsFilter = document.querySelector("#filter-tools");
const resources = [...sampleLinks];
let activeCategory = null;

function createResourceCard(resource) {
  const card = template.content.firstElementChild.cloneNode(true);
  const link = card.querySelector(".resource-card");

  link.href = resource.url;
  link.dataset.category = resource.category.toLowerCase();
  link.setAttribute("aria-label", `${resource.title} — opens in a new tab`);
  card.querySelector(".resource-category").textContent = resource.category;
  card.querySelector(".resource-title").textContent = resource.title;
  card.querySelector(".resource-description").textContent = resource.description;
  card.querySelector(".resource-domain").textContent = resource.domain;

  return card;
}

function renderResources() {
  const visibleResources = activeCategory
    ? resources.filter((resource) => resource.category === activeCategory)
    : resources;

  grid.replaceChildren(...visibleResources.map(createResourceCard));
  count.textContent = `${resources.length} links`;
}

function setFieldError(name, message) {
  const input = form.elements.namedItem(name);
  const error = document.querySelector(`#${name}-error`);

  input.setAttribute("aria-invalid", message ? "true" : "false");
  error.textContent = message;
}

function parseWebUrl(value) {
  try {
    const parsed = new URL(value);

    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      return { error: "Use an http:// or https:// URL." };
    }

    return { url: parsed };
  } catch {
    return { error: "Enter a complete URL such as https://example.com." };
  }
}

function validateForm(data) {
  const title = String(data.get("title") ?? "").trim();
  const rawUrl = String(data.get("url") ?? "").trim();
  let firstInvalidInput = null;

  setFieldError("title", title ? "" : "Enter a title.");
  if (!title) {
    firstInvalidInput = form.elements.namedItem("title");
  }

  const parsedUrl = rawUrl ? parseWebUrl(rawUrl) : { error: "Enter a URL." };
  setFieldError("url", parsedUrl.error ?? "");
  if (parsedUrl.error && !firstInvalidInput) {
    firstInvalidInput = form.elements.namedItem("url");
  }

  if (firstInvalidInput) {
    formStatus.textContent = "Check the highlighted fields.";
    formStatus.dataset.state = "error";
    firstInvalidInput.focus();
    return null;
  }

  return {
    title,
    description: String(data.get("description") ?? "").trim() || "No notes yet.",
    url: parsedUrl.url.href,
    domain: parsedUrl.url.host.replace(/^www\./, ""),
    category: String(data.get("category")),
  };
}

form.addEventListener("input", (event) => {
  if (event.target.name === "title" || event.target.name === "url") {
    setFieldError(event.target.name, "");
    formStatus.textContent = "";
    delete formStatus.dataset.state;
  }
});

form.addEventListener("submit", (event) => {
  event.preventDefault();

  const resource = validateForm(new FormData(form));
  if (!resource) {
    return;
  }

  resources.unshift(resource);
  renderResources();
  form.reset();
  formStatus.textContent = `${resource.title} was added.`;
  formStatus.dataset.state = "success";
  grid.querySelector(".resource-card").focus();
});

developmentFilter.addEventListener("click", () => {
  activeCategory = "Development";
  allFilter.setAttribute("aria-pressed", "false");
  developmentFilter.setAttribute("aria-pressed", "true");
  designFilter.setAttribute("aria-pressed", "false");
  toolsFilter.setAttribute("aria-pressed", "false");
  renderResources();
});

allFilter.addEventListener("click", () => {
  activeCategory = null;
  allFilter.setAttribute("aria-pressed", "true");
  developmentFilter.setAttribute("aria-pressed", "false");
  designFilter.setAttribute("aria-pressed", "false");
  toolsFilter.setAttribute("aria-pressed", "false");
  renderResources();
});

designFilter.addEventListener("click", () => {
  activeCategory = "Design";
  allFilter.setAttribute("aria-pressed", "false");
  developmentFilter.setAttribute("aria-pressed", "false");
  designFilter.setAttribute("aria-pressed", "true");
  toolsFilter.setAttribute("aria-pressed", "false");
  renderResources();
});

toolsFilter.addEventListener("click", () => {
  activeCategory = "Tools";
  allFilter.setAttribute("aria-pressed", "false");
  developmentFilter.setAttribute("aria-pressed", "false");
  designFilter.setAttribute("aria-pressed", "false");
  toolsFilter.setAttribute("aria-pressed", "true");
  renderResources();
});

renderResources();
