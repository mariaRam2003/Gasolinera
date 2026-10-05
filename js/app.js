import { TIME_ZONE } from "./config.js";

import {
  isConfigured,
  rpc,
  adminLogin,
  adminRpc,
  adminLogout,
  hasAdminSession,
  clearAdminSession,
  getAdminExpiresAt,
} from "./api.js";

import { exportExcel, exportPDF } from "./reports.js";

const FUELS = [
  {
    id: "super",
    name: "Súper",
  },
  {
    id: "regular",
    name: "Regular",
  },
  {
    id: "diesel",
    name: "Diésel",
  },
];

const state = {
  tab: "vender",

  adminExpiresAt: null,

  prices: null,

  sale: {
    fuel: "regular",
    pay: "efectivo",
    mode: "q",
  },

  corteDate: today(),
};

const $ = (selector) => document.querySelector(selector);

const view = () => $("#view");

function today() {
  return new Date().toLocaleDateString("en-CA", {
    timeZone: TIME_ZONE,
  });
}

function money(value) {
  return `Q${Number(value || 0).toLocaleString("es-GT", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

function gallons(value) {
  return `${Number(value || 0).toLocaleString("es-GT", {
    minimumFractionDigits: 3,
    maximumFractionDigits: 3,
  })} gal`;
}

function time(value) {
  return new Date(value).toLocaleTimeString("es-GT", {
    timeZone: TIME_ZONE,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

function fuelName(id) {
  return FUELS.find((fuel) => fuel.id === id)?.name || id;
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function message(text, type = "error") {
  return `
    <div class="message ${type}">
      ${escapeHtml(text)}
    </div>
  `;
}

function setConnection(status, text) {
  const el = $("#connection-status");

  el.className = `connection-status ${status}`;

  el.innerHTML = `
    <span class="status-dot"></span>
    <span>${escapeHtml(text)}</span>
  `;
}

function loading() {
  view().innerHTML = `
    <div class="card loading">
      Cargando información…
    </div>
  `;
}

function setActiveTab() {
  document.querySelectorAll(".tab").forEach((button) => {
    button.classList.toggle("is-active", button.dataset.tab === state.tab);
  });
}

function adminAvailable() {
  const available = hasAdminSession();

  if (!available) {
    state.adminExpiresAt = null;
    return false;
  }

  state.adminExpiresAt = getAdminExpiresAt();

  return true;
}

async function render() {
  setActiveTab();

  if (!isConfigured()) {
    setConnection("error", "Configuración pendiente");

    view().innerHTML = `
      <div class="card auth-card">
        <div class="lock-icon">⚙️</div>

        <h2>
          Configuración pendiente
        </h2>

        <p class="muted">
          Configura las credenciales de Supabase
          en <code>js/config.js</code> para
          iniciar la aplicación.
        </p>
      </div>
    `;

    return;
  }

  if (state.tab !== "vender" && !adminAvailable()) {
    renderLogin();
    return;
  }

  if (state.tab === "vender") {
    await renderSales();
  }

  if (state.tab === "precios") {
    await renderPrices();
  }

  if (state.tab === "corte") {
    await renderCut();
  }
}

/* ============================================================
   LOGIN ADMINISTRATIVO
   ============================================================ */

function renderLogin() {
  view().innerHTML = `
    <div class="card auth-card">

      <div class="lock-icon">
        🔐
      </div>

      <h2>
        Área administrativa
      </h2>

      <p class="muted">
        Precios y cortes están protegidos.
        Ingresa la contraseña para continuar.
      </p>

      <div class="field">

        <label for="admin-password">
          Contraseña
        </label>

        <input
          class="input"
          id="admin-password"
          type="password"
          autocomplete="off"
          autocapitalize="none"
          spellcheck="false"
          placeholder="Ingresa la contraseña"
        >

      </div>

      <div id="login-message"></div>

      <button
        class="btn btn-primary"
        id="login-btn"
      >
        Entrar
      </button>

    </div>
  `;

  $("#login-btn").addEventListener("click", unlockAdmin);

  $("#admin-password").addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      unlockAdmin();
    }
  });

  $("#admin-password").focus();
}

async function unlockAdmin() {
  const input = $("#admin-password");
  const target = $("#login-message");
  const button = $("#login-btn");

  const password = input.value.trim();

  if (!password) {
    target.innerHTML = message("Ingresa la contraseña.");

    input.focus();

    return;
  }

  if (password.length < 6) {
    target.innerHTML = message(
      "La contraseña debe tener al menos 6 caracteres.",
    );

    input.focus();

    return;
  }

  button.disabled = true;
  button.textContent = "Verificando…";

  try {
    const result = await adminLogin(password);

    state.adminExpiresAt = result.expiresAt;

    setConnection("online", "Administración autorizada");

    await render();
  } catch (error) {
    target.innerHTML = message(error.message);

    button.disabled = false;
    button.textContent = "Entrar";

    input.select();
  }
}

/* ============================================================
   BLOQUEAR ADMINISTRACIÓN
   ============================================================ */

async function lockAdmin() {
  await adminLogout();

  clearAdminSession();

  state.adminExpiresAt = null;

  state.tab = "vender";

  setActiveTab();

  setConnection("online", "Conectado");

  await render();
}

/* ============================================================
   VENTAS
   ============================================================ */

async function renderSales() {
  loading();

  try {
    state.prices = await rpc("get_prices");

    setConnection("online", "Conectado");
  } catch (error) {
    setConnection("error", "Sin conexión");

    view().innerHTML = `
      <div class="card">
        ${message(error.message)}
      </div>
    `;

    return;
  }

  if (!state.prices) {
    view().innerHTML = `
      <div class="card">

        <div class="card-header">

          <div>
            <p class="section-label">
              Operación
            </p>

            <h2>
              Registra una venta
            </h2>

            <p class="muted">
              Primero configura los precios
              del día desde la sección
              Precios.
            </p>
          </div>

          <span class="badge">
            Sin precios
          </span>

        </div>

        ${message("Aún no hay precios configurados para hoy.", "warning")}

      </div>
    `;

    return;
  }

  const prices = FUELS.map(
    (fuel) => `
      <button
        class="option ${state.sale.fuel === fuel.id ? "is-selected" : ""}"
        data-action="fuel"
        data-value="${fuel.id}"
      >
        <span class="option-title">
          ${fuel.name}
        </span>

        <span class="option-detail">
          ${money(state.prices[fuel.id])}
          / galón
        </span>
      </button>
    `,
  ).join("");

  const payment = `
    <button
      class="option ${state.sale.pay === "efectivo" ? "is-selected" : ""}"
      data-action="pay"
      data-value="efectivo"
    >
      <span class="option-title">
        💵 Efectivo
      </span>

      <span class="option-detail">
        Pago en caja
      </span>
    </button>

    <button
      class="option ${state.sale.pay === "tarjeta" ? "is-selected" : ""}"
      data-action="pay"
      data-value="tarjeta"
    >
      <span class="option-title">
        💳 Tarjeta
      </span>

      <span class="option-detail">
        Pago electrónico
      </span>
    </button>
  `;

  const modes = `
    <button
      class="option ${state.sale.mode === "q" ? "is-selected" : ""}"
      data-action="mode"
      data-value="q"
    >
      <span class="option-title">
        En quetzales
      </span>

      <span class="option-detail">
        Indica cuánto dinero
      </span>
    </button>

    <button
      class="option ${state.sale.mode === "g" ? "is-selected" : ""}"
      data-action="mode"
      data-value="g"
    >
      <span class="option-title">
        En galones
      </span>

      <span class="option-detail">
        Indica cuánto combustible
      </span>
    </button>
  `;

  view().innerHTML = `
    <div class="grid grid-2">

      <div class="card">

        <div class="card-header">

          <div>
            <p class="section-label">
              Nueva venta
            </p>

            <h2>
              Registrar despacho
            </h2>

            <p class="muted">
              Completa los datos y registra
              la venta.
            </p>
          </div>

          <span class="badge">
            Hoy · ${today()}
          </span>

        </div>


        <p class="section-label">
          1 · Combustible
        </p>

        <div class="grid grid-3">
          ${prices}
        </div>


        <div class="field">

          <p class="section-label">
            2 · Forma de pago
          </p>

          <div class="grid grid-2">
            ${payment}
          </div>

        </div>


        <div class="field">

          <p class="section-label">
            3 · Cantidad
          </p>

          <div class="grid grid-2">
            ${modes}
          </div>

        </div>


        <div class="field">

          <label for="amount">
            ${
              state.sale.mode === "q" ? "Monto a cobrar" : "Galones a despachar"
            }
          </label>

          <input
            class="input amount-input"
            id="amount"
            type="number"
            inputmode="decimal"
            min="0"
            step="any"
            placeholder="${
              state.sale.mode === "q" ? "Q 0.00" : "0.000 galones"
            }"
          >

        </div>


        <div class="result-box">

          <span class="result-label">
            Total calculado
          </span>

          <strong
            class="result-value"
            id="result"
          >
            —
          </strong>

        </div>


        <div id="sale-message"></div>


        <button
          class="btn btn-success"
          id="register-sale"
          style="margin-top:14px"
        >
          ✓ Registrar venta
        </button>

      </div>


      <div class="card">

        <div class="card-header">

          <div>
            <p class="section-label">
              Actividad
            </p>

            <h2>
              Ventas de hoy
            </h2>
          </div>

          <span
            class="badge"
            id="sales-count"
          >
            Cargando…
          </span>

        </div>

        <div
          id="sales-list"
          class="sale-list"
        >
          <div class="loading">
            Cargando ventas…
          </div>
        </div>

      </div>

    </div>
  `;

  document.querySelectorAll("[data-action]").forEach((button) => {
    button.addEventListener("click", () => {
      state.sale[button.dataset.action] = button.dataset.value;

      renderSales();
    });
  });

  $("#amount").addEventListener("input", calculate);

  $("#register-sale").addEventListener("click", registerSale);

  await loadTodaySales();
}

function calculate() {
  const amount = Number($("#amount").value);

  const price = Number(state.prices[state.sale.fuel]);

  const result = $("#result");

  if (!(amount > 0) || !(price > 0)) {
    result.textContent = "—";

    return;
  }

  result.textContent =
    state.sale.mode === "q"
      ? gallons(amount / price)
      : money(Math.round(amount * price * 100) / 100);
}

async function registerSale() {
  const amount = Number($("#amount").value);

  const button = $("#register-sale");

  const target = $("#sale-message");

  if (!(amount > 0)) {
    target.innerHTML = message("Ingresa un monto o cantidad válida.");

    return;
  }

  button.disabled = true;

  button.textContent = "Guardando…";

  try {
    const result = await rpc("add_sale", {
      p_fuel: state.sale.fuel,

      p_pay: state.sale.pay,

      p_mode: state.sale.mode,

      p_value: amount,
    });

    state.sale.lastMessage = `Venta guardada: ${money(result.q)} · ${gallons(
      result.gal,
    )}`;

    await renderSales();
  } catch (error) {
    target.innerHTML = message(error.message);

    button.disabled = false;

    button.textContent = "✓ Registrar venta";
  }
}

async function loadTodaySales() {
  const list = $("#sales-list");

  const count = $("#sales-count");

  try {
    const sales = await rpc("today_sales");

    count.textContent = `${sales.length} venta${sales.length === 1 ? "" : "s"}`;

    if (!sales.length) {
      list.innerHTML = `
        <div class="empty">
          Todavía no hay ventas
          registradas hoy.
        </div>
      `;

      return;
    }

    list.innerHTML = sales
      .map(
        (sale) => `
            <div class="sale-row">

              <div class="sale-main">

                <div class="sale-title">
                  ${escapeHtml(fuelName(sale.fuel))}
                </div>

                <div class="sale-meta">
                  ${time(sale.created_at)}
                  ·
                  ${sale.pay === "efectivo" ? "💵 Efectivo" : "💳 Tarjeta"}
                  ·
                  ${gallons(sale.gal)}
                </div>

              </div>

              <div class="sale-total">
                ${money(sale.q)}
              </div>

            </div>
          `,
      )
      .join("");
  } catch (error) {
    list.innerHTML = message(error.message);

    count.textContent = "Error";
  }
}

/* ============================================================
   PRECIOS
   ============================================================ */

async function renderPrices() {
  loading();

  try {
    const prices = await rpc("get_prices");

    const current = prices || {
      super: "",
      regular: "",
      diesel: "",
    };

    const isToday = current.day === today();

    view().innerHTML = `
      <div class="grid grid-2">

        <div class="card">

          <div class="card-header">

            <div>
              <p class="section-label">
                Administración
              </p>

              <h2>
                Precios por galón
              </h2>

              <p class="muted">
                Estos precios serán utilizados
                para calcular las próximas ventas.
              </p>
            </div>

            <span class="badge">
              ${isToday ? "Actualizados hoy" : "Últimos precios"}
            </span>

          </div>


          ${
            !isToday
              ? message(
                  "Los precios de hoy todavía no se han fijado. Se muestran los últimos disponibles.",
                  "warning",
                )
              : ""
          }


          <div class="price-grid">

            ${FUELS.map(
              (fuel) => `
                <div class="price-card">

                  <strong>
                    ${fuel.name}
                  </strong>

                  <input
                    class="input"
                    id="price-${fuel.id}"
                    type="number"
                    inputmode="decimal"
                    step="0.01"
                    min="0"
                    value="${current[fuel.id] ?? ""}"
                    placeholder="0.00"
                  >

                </div>
              `,
            ).join("")}

          </div>


          <div id="price-message"></div>


          <button
            class="btn btn-primary"
            id="save-prices"
            style="margin-top:16px"
          >
            Guardar precios de hoy
          </button>

        </div>


        <div class="card">

          <div class="card-header">

            <div>

              <p class="section-label">
                Seguridad
              </p>

              <h2>
                Cambiar contraseña
              </h2>

              <p class="muted">
                Actualiza la contraseña del
                área administrativa.
              </p>

            </div>

            <span class="badge">
              Protegido
            </span>

          </div>


          <div class="field">

            <label for="new-password">
              Nueva contraseña
            </label>

            <input
              class="input"
              id="new-password"
              type="password"
              autocomplete="new-password"
              placeholder="Mínimo 6 caracteres"
            >

          </div>


          <div id="password-message"></div>


          <button
            class="btn btn-primary"
            id="change-password"
            style="margin-top:16px"
          >
            Cambiar contraseña
          </button>


          <button
            class="btn btn-secondary"
            id="lock-admin"
            style="margin-top:10px"
          >
            🔒 Bloquear administración
          </button>

        </div>

      </div>
    `;

    $("#save-prices").addEventListener("click", savePrices);

    $("#change-password").addEventListener("click", changePin);

    $("#lock-admin").addEventListener("click", lockAdmin);

    setConnection("online", "Administración autorizada");
  } catch (error) {
    if (error.message.includes("sesión administrativa")) {
      state.adminExpiresAt = null;

      await render();

      return;
    }

    setConnection("error", "Sin conexión");

    view().innerHTML = `
      <div class="card">
        ${message(error.message)}
      </div>
    `;
  }
}

async function savePrices() {
  const values = FUELS.map((fuel) => Number($(`#price-${fuel.id}`).value));

  const target = $("#price-message");

  const button = $("#save-prices");

  if (values.some((value) => !(value > 0))) {
    target.innerHTML = message(
      "Revisa que los tres precios sean mayores que cero.",
    );

    return;
  }

  button.disabled = true;

  button.textContent = "Guardando…";

  try {
    await adminRpc("admin_set_prices", {
      p_super: values[0],

      p_regular: values[1],

      p_diesel: values[2],
    });

    target.innerHTML = message("Precios guardados correctamente.", "success");
  } catch (error) {
    if (error.message.includes("sesión administrativa")) {
      state.adminExpiresAt = null;

      await render();

      return;
    }

    target.innerHTML = message(error.message);
  } finally {
    if ($("#save-prices")) {
      $("#save-prices").disabled = false;

      $("#save-prices").textContent = "Guardar precios de hoy";
    }
  }
}

/* ============================================================
   CAMBIAR CONTRASEÑA
   ============================================================ */

async function changePin() {
  const newPassword = $("#new-password").value.trim();

  const target = $("#password-message");

  const button = $("#change-password");

  if (newPassword.length < 6) {
    target.innerHTML = message(
      "La contraseña debe tener al menos 6 caracteres.",
    );

    return;
  }

  button.disabled = true;

  button.textContent = "Actualizando…";

  try {
    await adminRpc("admin_change_pin", {
      p_new: newPassword,
    });

    /*
     * El backend invalida todas las sesiones
     * después de cambiar la contraseña.
     */
    clearAdminSession();

    state.adminExpiresAt = null;

    view().innerHTML = `
      <div class="card auth-card">

        <div class="lock-icon">
          ✓
        </div>

        <h2>
          Contraseña actualizada
        </h2>

        <p class="muted">
          La contraseña fue cambiada correctamente.
          Por seguridad, vuelve a ingresar con
          la nueva contraseña.
        </p>

        <button
          class="btn btn-primary"
          id="continue-after-password"
        >
          Continuar
        </button>

      </div>
    `;

    $("#continue-after-password").addEventListener("click", render);
  } catch (error) {
    if (error.message.includes("sesión administrativa")) {
      state.adminExpiresAt = null;

      await render();

      return;
    }

    target.innerHTML = message(error.message);

    button.disabled = false;

    button.textContent = "Cambiar contraseña";
  }
}

/* ============================================================
   CORTE
   ============================================================ */

async function renderCut() {
  loading();

  try {
    const sales = await adminRpc("admin_corte", {
      p_day: state.corteDate,
    });

    const totals = {
      q: 0,
      g: 0,
      ef: 0,
      ta: 0,
    };

    const rows = FUELS.map((fuel) => {
      const fuelSales = sales.filter((sale) => sale.fuel === fuel.id);

      const gal = fuelSales.reduce((sum, sale) => sum + Number(sale.gal), 0);

      const q = fuelSales.reduce((sum, sale) => sum + Number(sale.q), 0);

      totals.g += gal;
      totals.q += q;

      fuelSales.forEach((sale) => {
        if (sale.pay === "efectivo") {
          totals.ef += Number(sale.q);
        } else {
          totals.ta += Number(sale.q);
        }
      });

      return `
              <tr>

                <td>
                  ${fuel.name}
                </td>

                <td>
                  ${gallons(gal)}
                </td>

                <td>
                  ${money(q)}
                </td>

              </tr>
            `;
    }).join("");

    const detail = sales
      .slice()
      .reverse()
      .map(
        (sale) => `
            <div class="sale-row">

              <div class="sale-main">

                <div class="sale-title">
                  ${escapeHtml(fuelName(sale.fuel))}
                </div>

                <div class="sale-meta">

                  ${time(sale.created_at)}

                  ·

                  ${sale.pay === "efectivo" ? "💵 Efectivo" : "💳 Tarjeta"}

                  ·

                  ${gallons(sale.gal)}

                </div>

              </div>


              <div class="sale-actions">

                <strong>
                  ${money(sale.q)}
                </strong>

                <button
                  class="delete-btn"
                  data-delete="${sale.id}"
                  title="Eliminar venta"
                  aria-label="Eliminar venta"
                >
                  ×
                </button>

              </div>

            </div>
          `,
      )
      .join("");

    view().innerHTML = `
      <div class="card">

        <div class="card-header">

          <div>

            <p class="section-label">
              Cierre operativo
            </p>

            <h2>
              Corte del día
            </h2>

            <p class="muted">
              Consulta las ventas y genera
              el reporte de cualquier fecha.
            </p>

          </div>


          <span class="badge">
            ${state.corteDate}
          </span>

        </div>


        <div class="cut-toolbar">

          <div class="cut-date-control">

            <label for="cut-date">
              Fecha del corte
            </label>

            <input
              class="input date-control"
              id="cut-date"
              type="date"
              value="${state.corteDate}"
            />

          </div>


          <div class="export-actions">

            <button
              class="btn btn-export btn-excel"
              id="export-excel"
              ${sales.length ? "" : "disabled"}
            >
              📊 Excel
            </button>


            <button
              class="btn btn-export btn-pdf"
              id="export-pdf"
              ${sales.length ? "" : "disabled"}
            >
              📄 PDF
            </button>

          </div>

        </div>


        ${
          !sales.length
            ? message("No hay ventas registradas para esta fecha.", "warning")
            : ""
        }


        <div class="summary-grid">

          <div class="metric">

            <div class="metric-label">
              VENTAS
            </div>

            <div class="metric-value">
              ${sales.length}
            </div>

          </div>


          <div class="metric">

            <div class="metric-label">
              GALONES
            </div>

            <div class="metric-value">
              ${gallons(totals.g)}
            </div>

          </div>


          <div class="metric">

            <div class="metric-label">
              TOTAL
            </div>

            <div class="metric-value">
              ${money(totals.q)}
            </div>

          </div>


          <div class="metric">

            <div class="metric-label">
              EFECTIVO
            </div>

            <div class="metric-value">
              ${money(totals.ef)}
            </div>

          </div>

        </div>

      </div>


      <div class="card">

        <div class="card-header">

          <div>

            <p class="section-label">
              Resumen
            </p>

            <h2>
              Ventas por combustible
            </h2>

          </div>


          <span class="badge">
            ${state.corteDate}
          </span>

        </div>


        <div class="table-wrap">

          <table>

            <thead>

              <tr>
                <th>Combustible</th>
                <th>Galones</th>
                <th>Total</th>
              </tr>

            </thead>


            <tbody>

              ${rows}


              <tr class="total-row">

                <td>
                  TOTAL
                </td>

                <td>
                  ${gallons(totals.g)}
                </td>

                <td>
                  ${money(totals.q)}
                </td>

              </tr>

            </tbody>

          </table>

        </div>


        <div class="payment-summary">

          <div class="sale-row">

            <span>
              💵 Efectivo
            </span>

            <strong>
              ${money(totals.ef)}
            </strong>

          </div>


          <div class="sale-row">

            <span>
              💳 Tarjeta
            </span>

            <strong>
              ${money(totals.ta)}
            </strong>

          </div>

        </div>

      </div>


      <div class="card">

        <div class="card-header">

          <div>

            <p class="section-label">
              Auditoría
            </p>

            <h2>
              Detalle de ventas
            </h2>

          </div>


          <span class="badge">
            ${sales.length}
            registros
          </span>

        </div>


        <div class="sale-list">

          ${
            detail ||
            `
              <div class="empty">
                No hay ventas para esta fecha.
              </div>
            `
          }

        </div>


        <div id="cut-message"></div>


        <button
          class="btn btn-secondary"
          id="lock-admin"
          style="margin-top:16px"
        >
          🔒 Bloquear administración
        </button>

      </div>
    `;

    $("#cut-date").addEventListener("change", async (event) => {
      state.corteDate = event.target.value;

      await renderCut();
    });

    if (sales.length) {
      $("#export-excel").addEventListener("click", () => {
        try {
          exportExcel(sales, state.corteDate);
        } catch (error) {
          $("#cut-message").innerHTML = message(error.message);
        }
      });

      $("#export-pdf").addEventListener("click", () => {
        try {
          exportPDF(sales, state.corteDate);
        } catch (error) {
          $("#cut-message").innerHTML = message(error.message);
        }
      });
    }

    document.querySelectorAll("[data-delete]").forEach((button) => {
      button.addEventListener("click", () => deleteSale(button.dataset.delete));
    });

    $("#lock-admin").addEventListener("click", lockAdmin);

    setConnection("online", "Administración autorizada");
  } catch (error) {
    if (error.message.includes("sesión administrativa")) {
      state.adminExpiresAt = null;

      await render();

      return;
    }

    setConnection("error", "Sin conexión");

    view().innerHTML = `
      <div class="card">
        ${message(error.message)}
      </div>
    `;
  }
}

/* ============================================================
   ELIMINAR VENTA
   ============================================================ */

async function deleteSale(id) {
  if (
    !window.confirm(
      "¿Seguro que deseas eliminar esta venta? Esta acción no se puede deshacer.",
    )
  ) {
    return;
  }

  try {
    await adminRpc("admin_delete_sale", {
      p_id: Number(id),
    });

    await renderCut();
  } catch (error) {
    if (error.message.includes("sesión administrativa")) {
      state.adminExpiresAt = null;

      await render();

      return;
    }

    $("#cut-message").innerHTML = message(error.message);
  }
}

/* ============================================================
   NAVEGACIÓN
   ============================================================ */

document.querySelectorAll(".tab").forEach((button) => {
  button.addEventListener("click", async () => {
    state.tab = button.dataset.tab;

    /*
     * IMPORTANTE:
     * Ya NO hacemos:
     *
     * state.pin = null
     *
     * porque la sesión administrativa
     * puede seguir activa durante
     * 30 minutos.
     */

    await render();
  });
});

/* ============================================================
   INICIO
   ============================================================ */

render();
