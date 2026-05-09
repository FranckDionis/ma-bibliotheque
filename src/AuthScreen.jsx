import React, { useState } from "react";
import { BookMarked, Loader2, LogIn, UserPlus, AlertCircle } from "lucide-react";
import { supabase } from "./supabase";

export default function AuthScreen({ onAuthSuccess, onSkip }) {
  const [mode, setMode] = useState("signin"); // signin | signup
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [info, setInfo] = useState(null);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!email.trim() || !password) {
      setError("Email et mot de passe requis");
      return;
    }
    if (password.length < 6) {
      setError("Le mot de passe doit faire au moins 6 caractères");
      return;
    }
    setLoading(true);
    setError(null);
    setInfo(null);
    try {
      if (mode === "signup") {
        const { data, error: err } = await supabase.auth.signUp({
          email: email.trim(),
          password,
        });
        if (err) throw err;
        if (data.user && !data.session) {
          // Email confirmation requise
          setInfo("Compte créé. Vérifiez votre email pour confirmer (ou désactivez la confirmation dans Supabase pour vous connecter directement).");
        } else if (data.session) {
          onAuthSuccess(data.session);
        }
      } else {
        const { data, error: err } = await supabase.auth.signInWithPassword({
          email: email.trim(),
          password,
        });
        if (err) throw err;
        onAuthSuccess(data.session);
      }
    } catch (e) {
      // Messages d'erreur en français pour les cas courants
      const msg = e.message || "Erreur";
      if (msg.includes("Invalid login credentials")) {
        setError("Email ou mot de passe incorrect");
      } else if (msg.includes("User already registered")) {
        setError("Un compte existe déjà avec cet email. Connectez-vous.");
      } else if (msg.includes("Email not confirmed")) {
        setError("Email non confirmé. Vérifiez votre boîte de réception.");
      } else if (msg.includes("Password should be")) {
        setError("Mot de passe trop faible (minimum 6 caractères)");
      } else {
        setError(msg);
      }
    }
    setLoading(false);
  };

  return (
    <div className="min-h-screen flex flex-col items-center justify-center px-6 py-8"
      style={{ background: "linear-gradient(160deg, var(--cream) 0%, var(--parchment) 100%)" }}>
      <style>{`
        :root {
          --cream: #f4ecd8;
          --parchment: #e8dcc0;
          --leather: #6b3410;
          --leather-dark: #4a230a;
          --gold: #b8860b;
          --gold-light: #d4a72c;
          --ink: #2c1810;
          --ink-soft: #5a3a28;
          --accent: #8b2c2c;
          --font-display: Georgia, 'Times New Roman', serif;
          --font-body: -apple-system, BlinkMacSystemFont, 'Helvetica Neue', sans-serif;
        }
        body { font-family: var(--font-body); }
      `}</style>

      <div className="w-full max-w-sm">
        {/* Logo */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl mb-4 shadow-lg"
            style={{ background: "linear-gradient(135deg, var(--leather) 0%, var(--leather-dark) 100%)" }}>
            <BookMarked className="w-8 h-8" style={{ color: "var(--gold-light)" }} />
          </div>
          <h1 style={{
            fontFamily: "var(--font-display)",
            fontSize: "1.8rem",
            color: "var(--ink)",
            fontWeight: "bold",
            marginBottom: "0.25rem",
          }}>
            Ma Bibliothèque
          </h1>
          <p className="text-sm" style={{ color: "var(--ink-soft)" }}>
            {mode === "signin" ? "Connectez-vous pour accéder à la bibliothèque familiale" : "Créez un compte pour rejoindre la famille"}
          </p>
        </div>

        {/* Formulaire */}
        <form onSubmit={handleSubmit} className="space-y-3 p-5 rounded-2xl shadow-md"
          style={{ background: "white", border: "1px solid var(--parchment)" }}>
          <label className="block">
            <span className="text-sm font-medium mb-1 block" style={{ color: "var(--ink-soft)" }}>Email</span>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              autoComplete="email"
              autoCapitalize="none"
              autoCorrect="off"
              placeholder="vous@exemple.fr"
              className="w-full p-3 rounded-lg border-2 outline-none"
              style={{ borderColor: "var(--parchment)", color: "var(--ink)" }}
            />
          </label>

          <label className="block">
            <span className="text-sm font-medium mb-1 block" style={{ color: "var(--ink-soft)" }}>Mot de passe</span>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete={mode === "signup" ? "new-password" : "current-password"}
              placeholder="Au moins 6 caractères"
              className="w-full p-3 rounded-lg border-2 outline-none"
              style={{ borderColor: "var(--parchment)", color: "var(--ink)" }}
            />
          </label>

          {error && (
            <div className="rounded-lg p-3 text-sm flex items-start gap-2"
              style={{ background: "rgba(139, 44, 44, 0.1)", color: "var(--accent)" }}>
              <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5" />
              <span>{error}</span>
            </div>
          )}

          {info && (
            <div className="rounded-lg p-3 text-sm"
              style={{ background: "rgba(212, 167, 44, 0.15)", color: "var(--ink)" }}>
              {info}
            </div>
          )}

          <button
            type="submit"
            disabled={loading}
            className="w-full py-3 rounded-xl font-medium flex items-center justify-center gap-2 disabled:opacity-50 mt-2"
            style={{
              background: "linear-gradient(135deg, var(--leather) 0%, var(--leather-dark) 100%)",
              color: "var(--cream)",
            }}
          >
            {loading ? (
              <Loader2 className="w-5 h-5 animate-spin" />
            ) : mode === "signin" ? (
              <><LogIn className="w-5 h-5" /> Se connecter</>
            ) : (
              <><UserPlus className="w-5 h-5" /> Créer mon compte</>
            )}
          </button>

          <button
            type="button"
            onClick={() => {
              setMode(mode === "signin" ? "signup" : "signin");
              setError(null);
              setInfo(null);
            }}
            className="w-full py-2 text-sm"
            style={{ color: "var(--leather)" }}
          >
            {mode === "signin"
              ? "Pas encore de compte ? Créer un compte"
              : "Déjà un compte ? Se connecter"}
          </button>
        </form>

        {/* Mode local en secours */}
        {onSkip && (
          <button
            type="button"
            onClick={onSkip}
            className="w-full mt-4 py-2 text-xs text-center"
            style={{ color: "var(--ink-soft)" }}
          >
            Continuer sans compte (mode local uniquement)
          </button>
        )}

        <p className="text-xs text-center mt-4 px-4" style={{ color: "var(--ink-soft)" }}>
          Vos données sont stockées chez Supabase, hébergement Paris (RGPD).
          La bibliothèque est partagée entre tous les comptes de la famille.
        </p>
      </div>
    </div>
  );
}
