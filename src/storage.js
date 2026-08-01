// ============================================================================
// Capa de almacenamiento de SubGestor.
//
// Hoy usa localStorage del navegador/Electron: los datos quedan guardados en
// ESTE equipo únicamente. Para que varios equipos vean y editen los mismos
// datos (por ejemplo, que el Administrador General vea las facturas que
// captura un Administrador de Sucursal en otra computadora), este archivo es
// el ÚNICO que hay que reemplazar por una conexión a una base de datos
// compartida (ver "storage.supabase.js" de ejemplo y el README).
//
// El resto de la aplicación (App.jsx) no necesita cambiar: solo usa
// loadState(), saveState(state) y deleteState().
// ============================================================================

const STORAGE_KEY = "subgestor_state_v1";

function isValidState(s) {
  return !!(
    s &&
    Array.isArray(s.users) && s.users.length &&
    Array.isArray(s.branches) &&
    Array.isArray(s.products) &&
    Array.isArray(s.lots) &&
    s.config
  );
}

export async function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (isValidState(parsed)) return parsed;
    }
  } catch (e) {
    console.error("No se pudo leer el almacenamiento local", e);
  }
  return null;
}

export async function saveState(state) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch (e) {
    console.error("No se pudo guardar en el almacenamiento local", e);
  }
}

export async function deleteState() {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch (e) {
    console.error("No se pudo borrar el almacenamiento local", e);
  }
}

// No hay sincronización en tiempo real con localStorage (es solo de este
// equipo) — se deja esta función vacía para que App.jsx pueda importar lo
// mismo sin importar cuál de los dos archivos de almacenamiento esté activo.
export function subscribeToChanges() {
  return () => {};
}
