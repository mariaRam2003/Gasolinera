import { SUPABASE_URL, SUPABASE_KEY } from "./config.js";

function ensureConfig() {
  if (!SUPABASE_URL || !SUPABASE_KEY) {
    throw new Error("Falta configurar Supabase. Revisa js/config.js.");
  }
}

const ERROR_MESSAGES = {
  PIN_INCORRECTO: "Contraseña incorrecta.",
  SIN_PRECIOS: "Aún no hay precios del día.",
  PIN_CORTO: "La contraseña debe tener al menos 4 caracteres.",
  MONTO_INVALIDO: "Monto inválido.",
};

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
  } catch {
    throw new Error("No se pudo conectar con Supabase.");
  }

  const text = await response.text();
  let data = null;

  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    // La API puede responder sin JSON.
  }

  if (!response.ok) {
    const message = data?.message || data?.error || "Error inesperado de Supabase.";
    throw new Error(ERROR_MESSAGES[message] || message);
  }

  return data;
}

export function isConfigured() {
  return Boolean(SUPABASE_URL && SUPABASE_KEY);
}
