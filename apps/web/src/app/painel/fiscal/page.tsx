"use client";

import { Suspense } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Tabs } from "@/components/ui/tabs";
import { CadastroFiscal } from "@/components/fiscal/cadastro-fiscal";
import { NotasFiscais } from "@/components/fiscal/notas-fiscais";

type AbaFiscal = "cadastro" | "notas";

/**
 * Área fiscal.
 *
 * A aba fica na URL (`?aba=notas`) em vez de em estado local: o alerta de
 * vencimento de certificado manda o lojista para cá por e-mail, e a tela de
 * notas é para onde o suporte aponta quando uma emissão falha. Com a aba só na
 * memória do componente, nenhum dos dois consegue levar ao lugar certo.
 */
export default function FiscalPage() {
  return (
    // `useSearchParams` exige fronteira de Suspense para a página continuar
    // sendo pré-renderizada no build.
    <Suspense fallback={<p className="text-sm text-slate-500 dark:text-slate-400">Carregando...</p>}>
      <ConteudoFiscal />
    </Suspense>
  );
}

function ConteudoFiscal() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const aba: AbaFiscal = searchParams.get("aba") === "notas" ? "notas" : "cadastro";

  function trocarAba(proxima: AbaFiscal) {
    // `replace` em vez de `push`: alternar aba não é navegação, e empilhar no
    // histórico faria o botão Voltar percorrer abas em vez de sair da tela.
    const params = new URLSearchParams(searchParams.toString());
    if (proxima === "cadastro") params.delete("aba");
    else params.set("aba", proxima);
    const query = params.toString();
    router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false });
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-900 dark:text-slate-50">Fiscal</h1>
        <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
          {aba === "cadastro"
            ? "Dados que a SEFAZ exige no emitente da nota e o certificado digital que assina os documentos."
            : "NFC-e emitidas, situação na SEFAZ e ações de cancelamento e inutilização."}
        </p>
      </div>

      <Tabs
        value={aba}
        onChange={trocarAba}
        items={[
          { value: "cadastro", label: "Cadastro fiscal" },
          { value: "notas", label: "Notas emitidas" },
        ]}
      />

      {aba === "cadastro" ? <CadastroFiscal /> : <NotasFiscais />}
    </div>
  );
}
