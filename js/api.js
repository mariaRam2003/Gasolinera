import { SUPABASE_URL, SUPABASE_KEY } from "./config.js";

/*
 * ============================================================
 * CONFIGURACIÓN
 * ============================================================
 */

function ensureConfig() {
  if (!SUPABASE_URL || !SUPABASE_KEY) {
    throw new Error("Falta configurar Supabase. Revisa js/config.js.");
  }
}

/*
 * ============================================================
 * MENSAJES DE ERROR
 * ============================================================
 */

const ERROR_MESSAGES = {
  PIN_INCORRECTO: "PIN incorrecto.",
  PIN_BLOQUEADO:
    "Demasiados intentos incorrectos. Intenta nuevamente en unos minutos.",

  PIN_INVALIDO: "El PIN debe tener exactamente 6 dígitos.",

  SESION_ADMIN_INVALIDA:
    "La sesión administrativa expiró. Ingresa el PIN nuevamente.",

  SIN_PRECIOS: "Aún no hay precios configurados.",

  MONTO_INVALIDO: "Monto inválido.",

  PRECIOS_INVALIDOS: "Los precios ingresados no son válidos.",

  COMBUSTIBLE_INVALIDO: "Combustible inválido.",

  PAGO_INVALIDO: "Forma de pago inválida.",

  MODO_INVALIDO: "Modo de venta inválido.",

  ERROR_INESPERADO: "Ocurrió un error inesperado.",
};

/*
 * ============================================================
 * RPC BASE
 * ============================================================
 */

export async function rpc(name, body = {}) {
  ensureConfig();

  let response;

  try {
    response = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${name}`, {
      method: "POST",

      headers: {
        "Content-Type": "application/json",
        apikey: SUPABASE_KEY,
        Authorization: `Bearer ${SUPABASE_KEY}`,
      },

      body: JSON.stringify(body),
    });
  } catch (error) {
    throw new Error(
      "No se pudo conectar con Supabase. Verifica tu conexión a internet.",
    );
  }

  const text = await response.text();

  let data = null;

  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    // La respuesta no necesariamente contiene JSON.
  }

  if (!response.ok) {
    const rawMessage =
      data?.message || data?.error || data?.hint || "ERROR_INESPERADO";

    /*
     * Supabase/PostgREST puede devolver información
     * adicional alrededor del mensaje de PostgreSQL.
     */

    const matchedKey = Object.keys(ERROR_MESSAGES).find(
      (key) => rawMessage === key || String(rawMessage).includes(key),
    );

    const friendlyMessage = matchedKey
      ? ERROR_MESSAGES[matchedKey]
      : rawMessage;

    throw new Error(friendlyMessage);
  }

  return data;
}

/*
 * ============================================================
 * SESIÓN ADMINISTRATIVA
 *
 * El token solamente vive en memoria.
 * NO se guarda en localStorage.
 * NO se guarda en sessionStorage.
 * ============================================================
 */

let adminSession = {
  token: null,
  expiresAt: null,
};

let expirationTimer = null;

/*
 * Iniciar sesión administrativa
 */

export async function adminLogin(pin) {
  if (!/^\d{6}$/.test(pin)) {
    throw new Error("El PIN debe tener exactamente 6 dígitos.");
  }

  const result = await rpc("admin_unlock", {
    p_pin: pin,
  });

  if (!result?.token || !result?.expires_at) {
    throw new Error("Supabase no devolvió una sesión administrativa válida.");
  }

  adminSession.token = result.token;
  adminSession.expiresAt = result.expires_at;

  scheduleExpiration();

  return {
    token: adminSession.token,
    expiresAt: adminSession.expiresAt,
  };
}

/*
 * Ejecutar una función administrativa.
 *
 * El token se agrega automáticamente como p_token.
 */

export async function adminRpc(name, body = {}) {
  if (!hasAdminSession()) {
    clearAdminSession();

    throw new Error(
      "La sesión administrativa expiró. Ingresa el PIN nuevamente.",
    );
  }

  return rpc(name, {
    p_token: adminSession.token,
    ...body,
  });
}

/*
 * Cerrar sesión administrativa en Supabase
 */

export async function adminLogout() {
  if (!adminSession.token) {
    clearAdminSession();
    return;
  }

  try {
    await rpc("admin_lock", {
      p_token: adminSession.token,
    });
  } catch {
    /*
     * Aunque falle la petición, eliminamos el token
     * localmente por seguridad.
     */
  }

  clearAdminSession();
}

/*
 * Verificar si existe una sesión administrativa válida
 */

export function hasAdminSession() {
  if (!adminSession.token || !adminSession.expiresAt) {
    return false;
  }

  const expiresAt = new Date(adminSession.expiresAt).getTime();

  if (Number.isNaN(expiresAt)) {
    clearAdminSession();
    return false;
  }

  if (Date.now() >= expiresAt) {
    clearAdminSession();
    return false;
  }

  return true;
}

/*
 * Obtener fecha de expiración
 */

export function getAdminExpiresAt() {
  return adminSession.expiresAt;
}

/*
 * Eliminar sesión local
 */

export function clearAdminSession() {
  adminSession.token = null;
  adminSession.expiresAt = null;

  if (expirationTimer) {
    clearTimeout(expirationTimer);
    expirationTimer = null;
  }
}

/*
 * Programar expiración automática
 */

function scheduleExpiration() {
  if (expirationTimer) {
    clearTimeout(expirationTimer);
  }

  if (!adminSession.expiresAt) {
    return;
  }

  const expiresAt = new Date(adminSession.expiresAt).getTime();

  const delay = expiresAt - Date.now();

  if (delay <= 0) {
    clearAdminSession();
    return;
  }

  expirationTimer = setTimeout(() => {
    clearAdminSession();

    /*
     * Avisamos al resto de la aplicación.
     * app.js escucha este evento.
     */

    window.dispatchEvent(new CustomEvent("admin-session-expired"));
  }, delay);
}

/*
 * ============================================================
 * CONFIGURACIÓN
 * ============================================================
 */

export function isConfigured() {
  return Boolean(SUPABASE_URL && SUPABASE_KEY);
}
