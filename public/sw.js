// Service worker mínimo: solo lo necesario para que Chrome ofrezca "Instalar
// aplicación". No cachea datos de la app (la app siempre carga la versión más
// reciente y los datos siempre vienen de Supabase, no de caché).
self.addEventListener("install", (event) => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  // Deja pasar todas las peticiones normalmente (sin caché personalizada).
});
