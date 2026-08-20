"use client";

import { useEffect } from "react";
import { reportClientError } from "@/lib/report-client-error";

export default function GlobalErrorPage({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    // Esta é a última fronteira do app. Registrar o erro aqui transforma uma
    // tela genérica em uma causa rastreável no Console, sem mostrar stack ou
    // dados internos para a pessoa usuária.
    console.error("[ChegowIA] Erro global da aplicação.", error);
    // O console só existe no navegador de quem viu o erro. Sem relatar, quem
    // descobre a tela quebrada é o cliente, por telefone.
    reportClientError(error, { digest: error.digest });
  }, [error]);

  return (
    <html lang="pt-BR">
      <body style={{ margin: 0, background: "#020617", color: "#0f172a", fontFamily: "system-ui, sans-serif" }}>
        <main style={{ display: "grid", minHeight: "100vh", placeItems: "center", padding: 20 }}>
          <section style={{ width: "100%", maxWidth: 420, borderRadius: 28, background: "white", padding: 28, boxSizing: "border-box", textAlign: "center" }}>
            <div style={{ margin: "0 auto", display: "grid", width: 56, height: 56, placeItems: "center", borderRadius: 16, background: "#ffe4e6", color: "#be123c", fontSize: 24, fontWeight: 900 }}>
              !
            </div>
            <h1 style={{ margin: "20px 0 0", fontSize: 24 }}>O sistema encontrou um problema</h1>
            <p style={{ margin: "12px 0 0", color: "#475569", fontSize: 14, lineHeight: 1.6 }}>
              Não foi possível carregar a aplicação. Tente novamente em alguns instantes.
            </p>
            <button
              type="button"
              onClick={reset}
              style={{ marginTop: 24, minHeight: 48, width: "100%", border: 0, borderRadius: 12, background: "#ea580c", color: "white", cursor: "pointer", fontSize: 14, fontWeight: 800 }}
            >
              Tentar novamente
            </button>
          </section>
        </main>
      </body>
    </html>
  );
}
