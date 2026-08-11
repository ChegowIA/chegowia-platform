"use client";

import { Component, type ErrorInfo, type ReactNode } from "react";

type NonCriticalBoundaryProps = {
  children: ReactNode;
  /** Identifica o bloco nos logs do navegador sem expor detalhes à pessoa usuária. */
  name: string;
};

type NonCriticalBoundaryState = { failed: boolean };

/**
 * Assistentes flutuantes e acompanhamentos ao vivo melhoram a experiência,
 * mas não podem impedir o uso do sistema se uma integração externa estiver
 * temporariamente indisponível ou devolver dados inesperados.
 */
export class NonCriticalBoundary extends Component<NonCriticalBoundaryProps, NonCriticalBoundaryState> {
  state: NonCriticalBoundaryState = { failed: false };

  static getDerivedStateFromError(): NonCriticalBoundaryState {
    return { failed: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    // Mantém o detalhe disponível para diagnóstico no Console, sem jogar a
    // pessoa para a tela global de erro por causa de um widget secundário.
    console.error(`[ChegowIA] Falha no widget ${this.props.name}.`, error, info);
  }

  render() {
    if (this.state.failed) return null;
    return this.props.children;
  }
}
