const state = { companies: [], editingId: null, toastTimer: null, lastGeneration: null };

const byId = (id) => document.getElementById(id);
const form = byId("shipmentForm");
const companySelect = byId("companySelect");
const preview = byId("preview");
const printRoot = byId("printRoot");
const settingsModal = byId("settingsModal");

function showToast(message) {
  const toast = byId("toast");
  toast.textContent = message;
  toast.classList.add("show");
  clearTimeout(state.toastTimer);
  state.toastTimer = setTimeout(() => toast.classList.remove("show"), 2600);
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (char) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  }[char]));
}

function formatCnpj(value) {
  const raw = String(value ?? "").toUpperCase().replace(/[^0-9A-Z]/g, "");
  const positions = raw.slice(0, 12) + raw.slice(12).replace(/\D/g, "").slice(0, 2);
  let formatted = positions.slice(0, 2);
  if (positions.length > 2) formatted += "." + positions.slice(2, 5);
  if (positions.length > 5) formatted += "." + positions.slice(5, 8);
  if (positions.length > 8) formatted += "/" + positions.slice(8, 12);
  if (positions.length > 12) formatted += "-" + positions.slice(12, 14);
  return formatted;
}

byId("companyCnpj").addEventListener("input", (event) => {
  const input = event.currentTarget;
  const oldValue = input.value;
  const oldCursor = input.selectionStart ?? oldValue.length;
  const positionsBeforeCursor = oldValue.slice(0, oldCursor).replace(/[^0-9A-Z]/gi, "").length;
  input.value = formatCnpj(oldValue);
  let cursor = 0;
  let positionsSeen = 0;
  while (cursor < input.value.length && positionsSeen < positionsBeforeCursor) {
    if (/[0-9A-Z]/.test(input.value[cursor])) positionsSeen += 1;
    cursor += 1;
  }
  while (cursor < input.value.length && !/[0-9A-Z]/.test(input.value[cursor])) cursor += 1;
  input.setSelectionRange(cursor, cursor);
});

async function loadCompanies() {
  try {
    const response = await fetch("/api/companies", { cache: "no-store" });
    if (!response.ok) throw new Error("Não foi possível carregar as empresas.");
    state.companies = (await response.json()).map((company) => ({
      ...company,
      cnpj: formatCnpj(company.cnpj)
    }));
    renderCompanies();
  } catch (error) {
    showToast(error.message);
  }
}

function renderCompanies() {
  const selected = companySelect.value;
  companySelect.innerHTML = '<option value="">Selecione uma empresa</option>' +
    state.companies.map((company) =>
      '<option value="' + escapeHtml(company.id) + '">' + escapeHtml(company.name) + '</option>'
    ).join("");
  if (state.companies.some((company) => company.id === selected)) companySelect.value = selected;
  byId("companyHint").textContent = state.companies.length
    ? "Escolha a empresa que será impressa como remetente."
    : "Cadastre as empresas em Configurações.";
  renderCompanyList();
}

function renderCompanyList() {
  const list = byId("companyList");
  if (!state.companies.length) {
    list.innerHTML = '<div class="empty-list">Nenhuma empresa cadastrada ainda.</div>';
    return;
  }
  list.innerHTML = state.companies.map((company) => {
    const logo = company.logo
      ? '<img src="' + escapeHtml(company.logo) + '" alt="">'
      : '<div class="company-placeholder" aria-hidden="true">▧</div>';
    return '<article class="company-item">' + logo +
      '<div class="company-meta"><strong>' + escapeHtml(company.name) + '</strong><span>' + escapeHtml(company.cnpj) + '</span></div>' +
      '<div class="company-item-actions">' +
      '<button class="mini-button" type="button" data-edit="' + escapeHtml(company.id) + '">Editar</button>' +
      '<button class="mini-button" type="button" data-delete="' + escapeHtml(company.id) + '">Excluir</button>' +
      '</div></article>';
  }).join("");
}

function parseInvoices(text) {
  return text.split(/[\n,;]+/).map((invoice) => invoice.trim()).filter(Boolean);
}

function labelMarkup(company, shipment, volume) {
  const logo = company.logo
    ? '<img class="label-logo" src="' + escapeHtml(company.logo) + '" alt="">'
    : "";
  const invoiceText = shipment.invoices.join(", ");
  return '<article class="label">' +
    '<div class="label-header">' + logo +
      '<div class="label-company"><div class="label-company-name">' + escapeHtml(company.name) +
      '</div><div class="label-cnpj">CNPJ: ' + escapeHtml(company.cnpj) + '</div></div></div>' +
    '<div class="label-info"><div>' +
      '<div class="label-client"><strong>Cliente:</strong> ' + escapeHtml(shipment.client) + '</div>' +
      '<div class="label-invoices"><strong>NF:</strong> ' + escapeHtml(invoiceText) + '</div>' +
      '</div><div class="label-volume">VOL. ' + volume + '/' + shipment.total + '</div></div>' +
    '<div class="label-description"><strong>Observações</strong>' + escapeHtml(shipment.description) + '</div>' +
    '</article>';
}

function buildVolumeNumbers(total, largeCount) {
  const volumes = [];
  for (let number = 1; number <= total; number += 1) {
    volumes.push(number);
    if (number > total - largeCount) volumes.push(number);
  }
  return volumes;
}

function createSheets(volumes, company, shipment, className, labelsPerSheet) {
  const pages = [];
  for (let index = 0; index < volumes.length; index += labelsPerSheet) {
    pages.push(volumes.slice(index, index + labelsPerSheet));
  }
  return pages.map((page) =>
    '<section class="' + className + ' sheet-' + labelsPerSheet + '">' +
    page.map((volume) => labelMarkup(company, shipment, volume)).join("") +
    '</section>'
  ).join("");
}

function fitDescriptions(root) {
  root.querySelectorAll(".label-description").forEach((element) => {
    let size = 16;
    element.style.fontSize = size + "px";
    while (size > 8 && element.scrollHeight > element.clientHeight + 1) {
      size -= 0.5;
      element.style.fontSize = size + "px";
    }
  });
}

function autoGrow(textarea) {
  textarea.style.height = "auto";
  textarea.style.height = Math.min(textarea.scrollHeight, 320) + "px";
  textarea.style.overflowY = textarea.scrollHeight > 320 ? "auto" : "hidden";
}

function renderGeneratedLabels() {
  if (!state.lastGeneration) return;
  const { company, shipment, volumes } = state.lastGeneration;
  const labelsPerSheet = Number(byId("labelsPerSheet").value);
  preview.innerHTML = createSheets(volumes, company, shipment, "screen-sheet", labelsPerSheet);
  printRoot.innerHTML = createSheets(volumes, company, shipment, "print-sheet", labelsPerSheet);
  byId("previewTitle").textContent = volumes.length + (volumes.length === 1 ? " etiqueta gerada" : " etiquetas geradas");
  byId("printButton").disabled = false;
  requestAnimationFrame(() => {
    fitDescriptions(preview);
    const screenDescriptions = preview.querySelectorAll(".label-description");
    printRoot.querySelectorAll(".label-description").forEach((element, index) => {
      if (screenDescriptions[index]) element.style.fontSize = screenDescriptions[index].style.fontSize;
    });
  });
}

["invoiceNumbers", "description"].forEach((id) => {
  const textarea = byId(id);
  textarea.addEventListener("input", () => autoGrow(textarea));
  autoGrow(textarea);
});

form.addEventListener("submit", (event) => {
  event.preventDefault();
  const company = state.companies.find((item) => item.id === companySelect.value);
  const total = Number(byId("volumeCount").value);
  const largeCount = Number(byId("largeVolumes").value);
  const invoices = parseInvoices(byId("invoiceNumbers").value);
  const shipment = {
    client: byId("clientName").value.trim(),
    invoices,
    total,
    description: byId("description").value.trim()
  };

  if (!company) return showToast("Selecione uma empresa remetente.");
  if (!shipment.client || !invoices.length || !shipment.description) return showToast("Preencha todos os campos da remessa.");
  if (!Number.isInteger(total) || total < 1 || total > 500) return showToast("Informe de 1 a 500 volumes.");
  if (!Number.isInteger(largeCount) || largeCount < 0 || largeCount > total) {
    return showToast("Volumes grandes deve ser entre 0 e a quantidade total de volumes.");
  }

  const volumes = buildVolumeNumbers(total, largeCount);
  state.lastGeneration = { company, shipment, volumes };
  renderGeneratedLabels();
});

byId("labelsPerSheet").addEventListener("change", renderGeneratedLabels);

byId("clearButton").addEventListener("click", () => {
  form.reset();
  byId("volumeCount").value = "";
  byId("largeVolumes").value = "";
  state.lastGeneration = null;
  autoGrow(byId("invoiceNumbers"));
  autoGrow(byId("description"));
  preview.innerHTML = '<div class="empty-state"><div class="empty-icon" aria-hidden="true">▤</div>' +
    '<strong>Preencha os dados da remessa</strong><span>Depois, gere a prévia para conferir as etiquetas antes de imprimir.</span></div>';
  printRoot.innerHTML = "";
  byId("previewTitle").textContent = "Suas etiquetas aparecerão aqui";
  byId("printButton").disabled = true;
  showToast("Campos da remessa limpos.");
});

byId("printButton").addEventListener("click", () => window.print());

function setTheme(theme) {
  document.body.dataset.theme = theme;
  localStorage.setItem("etiquetas-theme", theme);
  byId("themeButton").innerHTML = theme === "dark"
    ? '☀ <span>Tema claro</span>'
    : '☾ <span>Tema escuro</span>';
}
setTheme(localStorage.getItem("etiquetas-theme") || "light");
byId("themeButton").addEventListener("click", () => {
  setTheme(document.body.dataset.theme === "dark" ? "light" : "dark");
});

function openSettings() {
  settingsModal.hidden = false;
  renderCompanyList();
  resetCompanyForm();
}
function closeSettings() {
  settingsModal.hidden = true;
  resetCompanyForm();
}
byId("settingsButton").addEventListener("click", openSettings);
byId("closeSettings").addEventListener("click", closeSettings);
settingsModal.addEventListener("click", (event) => {
  if (event.target === settingsModal) closeSettings();
});
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && !settingsModal.hidden) closeSettings();
});

function resetCompanyForm() {
  state.editingId = null;
  byId("companyForm").reset();
  byId("companyId").value = "";
  byId("companyFormTitle").textContent = "Adicionar empresa";
  byId("companyMessage").textContent = "";
  byId("companyMessage").classList.remove("error");
  byId("logoPreviewWrap").hidden = true;
  byId("logoPreview").removeAttribute("src");
  byId("removeLogo").checked = false;
}

byId("cancelCompanyEdit").addEventListener("click", resetCompanyForm);

byId("companyList").addEventListener("click", (event) => {
  const editId = event.target.dataset.edit;
  const deleteId = event.target.dataset.delete;
  if (editId) {
    const company = state.companies.find((item) => item.id === editId);
    if (!company) return;
    state.editingId = company.id;
    byId("companyId").value = company.id;
    byId("companyName").value = company.name;
    byId("companyCnpj").value = formatCnpj(company.cnpj);
    byId("companyFormTitle").textContent = "Editar empresa";
    byId("companyMessage").textContent = "";
    if (company.logo) {
      byId("logoPreview").src = company.logo;
      byId("logoPreviewWrap").hidden = false;
    } else {
      byId("logoPreviewWrap").hidden = true;
    }
    byId("removeLogo").checked = false;
  }
  if (deleteId) {
    const company = state.companies.find((item) => item.id === deleteId);
    if (!company || !confirm('Excluir a empresa "' + company.name + '"?')) return;
    saveCompanies(state.companies.filter((item) => item.id !== deleteId)).then(() => {
      if (companySelect.value === deleteId) companySelect.value = "";
      resetCompanyForm();
      showToast("Empresa excluída.");
    }).catch((error) => showToast(error.message));
  }
});

byId("companyLogo").addEventListener("change", () => {
  const file = byId("companyLogo").files[0];
  if (!file) return;
  if (file.type !== "image/png" || file.size > 2 * 1024 * 1024) {
    byId("companyLogo").value = "";
    byId("companyMessage").textContent = "Escolha uma imagem PNG de até 2 MB.";
    byId("companyMessage").classList.add("error");
    return;
  }
  const reader = new FileReader();
  reader.onload = () => {
    byId("logoPreview").src = reader.result;
    byId("logoPreviewWrap").hidden = false;
    byId("removeLogo").checked = false;
  };
  reader.readAsDataURL(file);
});

async function saveCompanies(companies) {
  const response = await fetch("/api/companies", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(companies)
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || "Não foi possível salvar a empresa.");
  state.companies = result;
  renderCompanies();
  return result;
}

byId("companyForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  const message = byId("companyMessage");
  message.textContent = "";
  message.classList.remove("error");
  const current = state.companies.find((item) => item.id === state.editingId);
  const formattedCnpj = formatCnpj(byId("companyCnpj").value);
  const cnpjPositions = formattedCnpj.replace(/[^0-9A-Z]/g, "");
  if (cnpjPositions.length !== 14 || !/^\d{2}$/.test(cnpjPositions.slice(12))) {
    message.textContent = "Informe um CNPJ com 14 posições; os 2 últimos caracteres devem ser números.";
    message.classList.add("error");
    return;
  }
  let logoData = null;
  const file = byId("companyLogo").files[0];
  if (file) {
    try {
      logoData = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = () => reject(new Error("Não foi possível ler a logo."));
        reader.readAsDataURL(file);
      });
    } catch (error) {
      message.textContent = error.message;
      message.classList.add("error");
      return;
    }
  }

  const company = {
    id: state.editingId || crypto.randomUUID(),
    name: byId("companyName").value.trim(),
    cnpj: formattedCnpj,
    logo: current?.logo || null,
    logoData,
    removeLogo: byId("removeLogo").checked
  };
  const companies = state.editingId
    ? state.companies.map((item) => item.id === state.editingId ? company : item)
    : [...state.companies, company];

  try {
    await saveCompanies(companies);
    resetCompanyForm();
    showToast("Empresa salva.");
  } catch (error) {
    message.textContent = error.message;
    message.classList.add("error");
  }
});

loadCompanies();
