// ============================================================================
// Almacenamiento COMPARTIDO con Supabase — úsalo en vez de storage.js cuando
// quieras que varios equipos (o la versión de escritorio y la web) vean y
// editen los MISMOS datos en tiempo real.
//
// Cómo activarlo:
//   1. Sigue los pasos del README para crear tu proyecto gratuito en
//      supabase.com y la tabla "subgestor_state".
//   2. Crea un archivo ".env" en la raíz del proyecto (junto a package.json)
//      con:
//        VITE_SUPABASE_URL=https://tuproyecto.supabase.co
//        VITE_SUPABASE_ANON_KEY=tu-clave-anon-publica
//      Si publicas en Vercel/Netlify, agrega esas mismas dos variables en la
//      configuración del sitio (Environment Variables) ANTES de publicar —
//      si las agregas después, vuelve a publicar para que se apliquen.
//   3. Instala el cliente: npm install @supabase/supabase-js
//   4. En src/App.jsx, cambia la línea:
//        import { loadState, saveState, deleteState } from "./storage.js";
//      por:
//        import { loadState, saveState, deleteState, subscribeToChanges } from "./storage.supabase.js";
//
// La clave "anon" es segura para usarse en el código del cliente (está
// diseñada para eso) — NUNCA uses aquí la "service_role key", esa es secreta.
// ============================================================================

import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY;
const CONFIGURED = !!(SUPABASE_URL && SUPABASE_ANON_KEY);

if (!CONFIGURED) {
  console.error(
    "SubGestor: faltan las variables VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY. " +
    "La app usará datos de muestra sin guardar cambios hasta que se configuren " +
    "(en Netlify/Vercel: Site settings → Environment Variables, y luego volver a publicar)."
  );
}

// Si faltan las credenciales, NO se llama a createClient (evita que la app
// entera se caiga con una pantalla en blanco) — en su lugar, todas las
// funciones de abajo se comportan como si no hubiera datos guardados.
export const supabase = CONFIGURED ? createClient(SUPABASE_URL, SUPABASE_ANON_KEY) : null;

const ROW_ID = "main";

export async function loadState() {
  if (!supabase) return null;
  try {
    const { data, error } = await supabase
      .from("subgestor_state")
      .select("data")
      .eq("id", ROW_ID)
      .maybeSingle();
    if (error) throw error;
    return data?.data || null;
  } catch (e) {
    console.error("No se pudo leer de Supabase", e);
    return null;
  }
}

export async function saveState(state) {
  if (!supabase) return;
  try {
    const { error } = await supabase
      .from("subgestor_state")
      .upsert({ id: ROW_ID, data: state, updated_at: new Date().toISOString() });
    if (error) throw error;
  } catch (e) {
    console.error("No se pudo guardar en Supabase", e);
  }
}

export async function deleteState() {
  if (!supabase) return;
  try {
    await supabase.from("subgestor_state").delete().eq("id", ROW_ID);
  } catch (e) {
    console.error("No se pudo borrar en Supabase", e);
  }
}

// Opcional: sincronización instantánea (sin esperar el sondeo de 20s).
// Llama a esta función una vez, con una función que reciba el estado nuevo
// cada vez que otro equipo guarde un cambio.
export function subscribeToChanges(onChange) {
  if (!supabase) return () => {};
  const channel = supabase
    .channel("subgestor_state_changes")
    .on(
      "postgres_changes",
      { event: "*", schema: "public", table: "subgestor_state" },
      (payload) => {
        if (payload.new && payload.new.data) onChange(payload.new.data);
      }
    )
    .subscribe();
  return () => supabase.removeChannel(channel);
}
