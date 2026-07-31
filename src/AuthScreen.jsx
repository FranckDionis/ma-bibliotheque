import React, { useState } from "react";
import { BookMarked, Loader2, LogIn, UserPlus, AlertCircle, KeyRound, ArrowLeft } from "lucide-react";
import { supabase } from "./supabase";

// ============================================================
// LECTURE DU JETON DE RÉCUPÉRATION PRÉSENT DANS L'URL
// ============================================================
// Le client Supabase est volontairement configuré avec
// `detectSessionInUrl: false` (voir supabase.js) : il ne consomme donc pas
// tout seul le jeton renvoyé par le lien reçu par email. C'est ce qui
// permet d'intercepter le retour ici et d'imposer la saisie d'un nouveau
// mot de passe avant tout accès à la bibliothèque.
//
// Deux formats coexistent selon la version du modèle d'email Supabase :
//   - un fragment `#access_token=…&refresh_token=…` (modèle par défaut)
//   - un paramètre `?token_hash=…&type=recovery` (modèle plus récent)
// On accepte les deux, faute de pouvoir garantir lequel arrivera.
function lireJetonRecuperation() {
  if (typeof window === "undefined") return null;
  const fragment = new URLSearchParams((window.location.hash || "").replace(/^#/, ""));
  const requete = new URLSearchParams(window.location.search || "");

  const erreur = fragment.get("error_description") || requete.get("error_description");
  if (erreur) return { type: "erreur", message: erreur };

  const acces = fragment.get("access_token");
  const rafraichissement = fragment.get("refresh_token");
  if (acces && rafraichissement) {
    return { type: "session", acces, rafraichissement };
  }

  const jeton = requete.get("token_hash") || fragment.get("token_hash");
  if (jeton) return { type: "otp", jeton };

  return null;
}

// Efface le jeton de la barre d'adresse une fois consommé : il ne doit
// pas rester dans l'historique du navigateur ni repartir dans un partage
// de lien.
function nettoyerUrl() {
  if (typeof window === "undefined") return;
  window.history.replaceState({}, document.title, window.location.pathname);
}

export default function AuthScreen({ onAuthSuccess, onSkip, recovery = false }) {
  // signin | signup | oubli | nouveau
  const [mode, setMode] = useState(recovery ? "nouveau" : "signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [info, setInfo] = useState(null);

  // Les messages de Supabase arrivent en anglais et avec une casse variable
  // selon l'erreur (« Invalid login credentials », « Invalid JWT structure »,
  // « token has expired »…). On compare donc en minuscules : tester la casse
  // d'origine laissait passer des messages bruts sous les yeux de
  // l'utilisateur.
  const traduire = (message) => {
    const msg = (message || "Erreur").toLowerCase();
    if (msg.includes("invalid login credentials")) return "Email ou mot de passe incorrect";
    if (msg.includes("signups not allowed") || msg.includes("signup_disabled"))
      return "La création de compte est fermée. Demandez à l'administrateur de la bibliothèque de vous créer un accès.";
    if (msg.includes("user already registered")) return "Un compte existe déjà avec cet email. Connectez-vous.";
    if (msg.includes("email not confirmed")) return "Email non confirmé. Vérifiez votre boîte de réception.";
    if (msg.includes("password should be") || msg.includes("password is too short"))
      return "Mot de passe trop faible (minimum 6 caractères)";
    if (msg.includes("same as the old") || msg.includes("should be different"))
      return "Le nouveau mot de passe doit être différent de l'ancien.";
    if (msg.includes("rate limit") || msg.includes("too many") || msg.includes("for security purposes"))
      return "Trop de tentatives. Patientez quelques minutes avant de réessayer.";
    // Tous les défauts de jeton se ressemblent pour l'utilisateur : lien
    // périmé, déjà consommé, tronqué par le client mail. Même message.
    if (msg.includes("expired") || msg.includes("invalid") || msg.includes("jwt") ||
        msg.includes("token") || msg.includes("not found"))
      return "Ce lien n'est plus valable. Il a peut-être expiré, ou déjà été utilisé. Demandez-en un nouveau depuis « Mot de passe oublié ? ».";
    return message;
  };

  // === DEMANDE D'UN LIEN DE RÉINITIALISATION ===
  const demanderLien = async () => {
    if (!email.trim()) {
      setError("Renseignez votre email");
      return;
    }
    setLoading(true);
    setError(null);
    setInfo(null);
    try {
      const { error: err } = await supabase.auth.resetPasswordForEmail(email.trim(), {
        redirectTo: window.location.origin,
      });
      if (err) throw err;
      // Message volontairement identique que l'adresse existe ou non : le
      // confirmer permettrait de savoir qui a un compte ici.
      setInfo(
        "Si un compte existe pour cette adresse, un lien vient d'être envoyé. " +
        "Vérifiez votre boîte de réception, et les indésirables."
      );
    } catch (e) {
      setError(traduire(e.message || "Erreur"));
    }
    setLoading(false);
  };

  // === DÉFINITION DU NOUVEAU MOT DE PASSE ===
  const definirMotDePasse = async () => {
    if (password.length < 6) {
      setError("Le mot de passe doit faire au moins 6 caractères");
      return;
    }
    if (password !== confirmation) {
      setError("Les deux mots de passe ne correspondent pas");
      return;
    }
    setLoading(true);
    setError(null);
    setInfo(null);
    try {
      const jeton = lireJetonRecuperation();
      if (!jeton || jeton.type === "erreur") {
        throw new Error(jeton?.message || "Lien de récupération invalide ou expiré");
      }

      // On n'ouvre la session qu'au tout dernier moment, juste avant de
      // changer le mot de passe : entre les deux, le compte est accessible
      // avec le seul jeton du lien.
      if (jeton.type === "session") {
        const { error: err } = await supabase.auth.setSession({
          access_token: jeton.acces,
          refresh_token: jeton.rafraichissement,
        });
        if (err) throw err;
      } else {
        const { error: err } = await supabase.auth.verifyOtp({
          token_hash: jeton.jeton,
          type: "recovery",
        });
        if (err) throw err;
      }

      const { error: err2 } = await supabase.auth.updateUser({ password });
      if (err2) throw err2;

      nettoyerUrl();
      const { data } = await supabase.auth.getSession();
      if (data?.session) {
        onAuthSuccess(data.session);
      } else {
        setMode("signin");
        setInfo("Mot de passe modifié. Vous pouvez vous connecter.");
      }
    } catch (e) {
      setError(traduire(e.message || "Erreur"));
    }
    setLoading(false);
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (mode === "oubli") return demanderLien();
    if (mode === "nouveau") return definirMotDePasse();

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
          setInfo("Compte créé. Vérifiez votre email pour confirmer.");
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
      setError(traduire(e.message || "Erreur"));
    }
    setLoading(false);
  };

  const changerMode = (nouveau) => {
    setMode(nouveau);
    setError(null);
    setInfo(null);
    setPassword("");
    setConfirmation("");
  };

  const sousTitre =
    mode === "nouveau" ? "Choisissez un nouveau mot de passe"
    : mode === "oubli" ? "Recevez un lien pour en choisir un nouveau"
    : mode === "signup" ? "Créez un compte pour rejoindre la famille"
    : "Connectez-vous pour accéder à la bibliothèque familiale";

  const champStyle = {
    borderColor: "var(--parchment)",
    color: "var(--ink)",
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
            {mode === "nouveau" || mode === "oubli"
              ? <KeyRound className="w-8 h-8" style={{ color: "var(--gold-light)" }} />
              : <BookMarked className="w-8 h-8" style={{ color: "var(--gold-light)" }} />}
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
          <p className="text-sm" style={{ color: "var(--ink-soft)" }}>{sousTitre}</p>
        </div>

        {/* Formulaire */}
        <form onSubmit={handleSubmit} className="space-y-3 p-5 rounded-2xl shadow-md"
          style={{ background: "white", border: "1px solid var(--parchment)" }}>

          {/* L'email n'a pas de sens à l'étape du nouveau mot de passe :
              le compte concerné est déjà déterminé par le lien reçu. */}
          {mode !== "nouveau" && (
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
                style={champStyle}
              />
            </label>
          )}

          {mode !== "oubli" && (
            <label className="block">
              <span className="text-sm font-medium mb-1 block" style={{ color: "var(--ink-soft)" }}>
                {mode === "nouveau" ? "Nouveau mot de passe" : "Mot de passe"}
              </span>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete={mode === "signin" ? "current-password" : "new-password"}
                placeholder="Au moins 6 caractères"
                className="w-full p-3 rounded-lg border-2 outline-none"
                style={champStyle}
              />
            </label>
          )}

          {mode === "nouveau" && (
            <label className="block">
              <span className="text-sm font-medium mb-1 block" style={{ color: "var(--ink-soft)" }}>
                Confirmez le mot de passe
              </span>
              <input
                type="password"
                value={confirmation}
                onChange={(e) => setConfirmation(e.target.value)}
                autoComplete="new-password"
                placeholder="Le même, pour éviter une faute de frappe"
                className="w-full p-3 rounded-lg border-2 outline-none"
                style={champStyle}
              />
            </label>
          )}

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
            ) : mode === "nouveau" ? (
              <><KeyRound className="w-5 h-5" /> Enregistrer le mot de passe</>
            ) : mode === "oubli" ? (
              <><KeyRound className="w-5 h-5" /> Envoyer le lien</>
            ) : mode === "signin" ? (
              <><LogIn className="w-5 h-5" /> Se connecter</>
            ) : (
              <><UserPlus className="w-5 h-5" /> Créer mon compte</>
            )}
          </button>

          {mode === "signin" && (
            <button
              type="button"
              onClick={() => changerMode("oubli")}
              className="w-full py-2 text-sm"
              style={{ color: "var(--ink-soft)" }}
            >
              Mot de passe oublié ?
            </button>
          )}

          {(mode === "oubli" || mode === "nouveau") && (
            <button
              type="button"
              onClick={() => { nettoyerUrl(); changerMode("signin"); }}
              className="w-full py-2 text-sm flex items-center justify-center gap-1.5"
              style={{ color: "var(--leather)" }}
            >
              <ArrowLeft className="w-4 h-4" /> Retour à la connexion
            </button>
          )}

          {(mode === "signin" || mode === "signup") && (
            <button
              type="button"
              onClick={() => changerMode(mode === "signin" ? "signup" : "signin")}
              className="w-full py-2 text-sm"
              style={{ color: "var(--leather)" }}
            >
              {mode === "signin"
                ? "Pas encore de compte ? Créer un compte"
                : "Déjà un compte ? Se connecter"}
            </button>
          )}
        </form>

        {/* Mode local en secours — sans objet pendant une récupération */}
        {onSkip && mode !== "nouveau" && (
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
