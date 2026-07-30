import React from "react";

// ============================================================
// FILET DE SÉCURITÉ D'AFFICHAGE
// ============================================================
// Sans ce composant, une exception levée pendant le rendu de n'importe quel
// composant démonte tout l'arbre React : l'utilisateur se retrouve devant une
// page entièrement blanche, sans message, sans bouton, sans rien. Sur iPhone
// en mode PWA plein écran c'est le pire des cas — pas de console, pas de barre
// d'adresse, aucun moyen de comprendre ni de repartir.
//
// Un ErrorBoundary doit être une classe : c'est le seul endroit où React
// expose getDerivedStateFromError / componentDidCatch, sans équivalent en
// hooks à ce jour.
export default class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    // Trace conservée pour le diagnostic quand un appareil est branché au
    // débogueur. On n'envoie rien nulle part : pas de service externe.
    console.error("Erreur de rendu :", error, info?.componentStack);
  }

  render() {
    if (!this.state.error) return this.props.children;

    const msg = this.state.error?.message || String(this.state.error);

    return (
      <div
        style={{
          minHeight: "100vh",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          padding: "2rem 1.5rem",
          textAlign: "center",
          background: "linear-gradient(160deg, #f4ecd8 0%, #e8dcc0 100%)",
          color: "#2c1810",
          fontFamily: "-apple-system, BlinkMacSystemFont, 'Helvetica Neue', sans-serif",
        }}
      >
        <div style={{ fontSize: "2.5rem", marginBottom: "0.75rem" }}>📚</div>

        <h1
          style={{
            fontFamily: "Georgia, 'Times New Roman', serif",
            fontSize: "1.4rem",
            fontWeight: "bold",
            marginBottom: "0.5rem",
          }}
        >
          L'application a rencontré un problème
        </h1>

        <p style={{ color: "#5a3a28", fontSize: "0.9rem", maxWidth: "22rem", marginBottom: "1.25rem" }}>
          Vos données ne sont pas affectées : elles sont dans la base, pas dans
          cet écran. Recharger suffit presque toujours à repartir.
        </p>

        {/* Le message technique est affiché tel quel : c'est la seule chose
            exploitable pour diagnostiquer depuis un téléphone. */}
        <pre
          style={{
            background: "rgba(139, 44, 44, 0.08)",
            color: "#8b2c2c",
            padding: "0.75rem",
            borderRadius: "0.5rem",
            fontSize: "0.75rem",
            maxWidth: "100%",
            overflowX: "auto",
            textAlign: "left",
            whiteSpace: "pre-wrap",
            wordBreak: "break-word",
            marginBottom: "1.5rem",
          }}
        >
          {msg}
        </pre>

        <button
          onClick={() => window.location.reload()}
          style={{
            padding: "0.75rem 1.75rem",
            borderRadius: "9999px",
            border: "none",
            cursor: "pointer",
            fontSize: "1rem",
            fontWeight: 500,
            color: "#f4ecd8",
            background: "linear-gradient(135deg, #6b3410 0%, #4a230a 100%)",
          }}
        >
          Recharger l'application
        </button>
      </div>
    );
  }
}
