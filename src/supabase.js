import { createClient } from "@supabase/supabase-js";

// === CONFIGURATION SUPABASE ===
// Les valeurs sont chargées depuis les variables d'environnement Vercel
// (ou injectées via .env.local en développement). Elles sont préfixées par
// VITE_ pour que Vite les expose au code client.
//
// La clé "anon public" est conçue pour figurer côté navigateur — la sécurité
// est assurée par les politiques RLS configurées dans Supabase.

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
  console.warn(
    "⚠️ Variables Supabase non définies. " +
    "L'app fonctionnera en mode local uniquement. " +
    "Configurez VITE_SUPABASE_URL et VITE_SUPABASE_ANON_KEY dans Vercel."
  );
}

// Le client Supabase. Si les variables ne sont pas définies, l'app
// démarrera quand même en mode local (utile en développement).
export const supabase = (SUPABASE_URL && SUPABASE_ANON_KEY)
  ? createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      auth: {
        // Persiste la session dans localStorage pour ne pas avoir à se reconnecter
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: false,
      },
      realtime: {
        params: { eventsPerSecond: 5 },
      },
    })
  : null;

export const isSupabaseConfigured = !!supabase;
