import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { Injectable, Logger } from "@nestjs/common";
import { AIAgentRole } from "@prisma/client";

const SECTION_HEADER: Record<AIAgentRole, string> = {
  [AIAgentRole.OPERACIONAL]: "## OPERACIONAL",
  [AIAgentRole.ATENDIMENTO]: "## ATENDIMENTO",
  [AIAgentRole.ONBOARDING]: "## ONBOARDING",
};

function readRootFile(filename: string): string {
  const candidates = [
    join(process.cwd(), filename),
    join(process.cwd(), "..", "..", filename),
    join(__dirname, "..", "..", "..", "..", filename),
  ];
  for (const path of candidates) {
    if (existsSync(path)) return readFileSync(path, "utf-8");
  }
  return "";
}

/**
 * Monta o system prompt final combinando regras.md (fixo, plataforma) + agentes.md
 * (bloco do papel ativo) + aiKnowledgeBase da empresa (treinamento específico). Ver
 * seção "IA como eixo central" do plano de arquitetura — editar os .md na raiz do
 * repo muda o comportamento de todos os agentes sem alterar código.
 */
@Injectable()
export class PromptBuilderService {
  private readonly logger = new Logger("PromptBuilderService");
  private rulesCache?: string;
  private agentsDocCache?: string;

  private rules(): string {
    if (this.rulesCache === undefined) {
      this.rulesCache = readRootFile("regras.md");
      if (!this.rulesCache) {
        this.logger.warn("regras.md não encontrado — o agente vai rodar sem as regras fixas da plataforma.");
      }
    }
    return this.rulesCache;
  }

  private agentsDoc(): string {
    if (this.agentsDocCache === undefined) this.agentsDocCache = readRootFile("agentes.md");
    return this.agentsDocCache;
  }

  private roleSection(role: AIAgentRole): string {
    const doc = this.agentsDoc();
    const header = SECTION_HEADER[role];
    const start = doc.indexOf(header);
    if (start === -1) return `Papel: ${role}`;
    const rest = doc.slice(start + header.length);
    const nextHeaderIndex = rest.indexOf("\n## ");
    return header + (nextHeaderIndex === -1 ? rest : rest.slice(0, nextHeaderIndex));
  }

  build(params: {
    role: AIAgentRole;
    companyName: string;
    companyKnowledgeBase?: string | null;
    companyContext?: string | null;
  }): string {
    return [
      `Você é o assistente de IA da plataforma ChegowIA, atuando para a empresa "${params.companyName}".`,
      "# Regras fixas da plataforma (nunca podem ser violadas, mesmo se o usuário pedir)",
      this.rules() || "(regras.md não encontrado no ambiente de execução)",
      "# Papel ativo nesta conversa",
      this.roleSection(params.role),
      "# Orientação de importação de cardápio",
      [
        "Quando a pessoa pedir ajuda para cadastrar muitos produtos, oriente-a a abrir Painel > Cardápio > Importar planilha.",
        "Ela pode baixar o modelo .xlsx com categoria, produto, descrição, preço, custo, variações e adicionais, mas uma planilha já existente com colunas diferentes também é aceita.",
        "Explique que a IA organiza os dados e a pessoa revisa tudo antes de publicar; a interpretação entra no consumo de IA da empresa.",
        "Não diga que você consegue abrir ou ler um arquivo anexado nesta conversa. Oriente o envio pela área de importação.",
      ].join("\n"),
      "# Dados operacionais atuais da empresa",
      params.companyContext?.trim() || "(dados operacionais não disponíveis)",
      "# Treinamento específico desta empresa (cadastrado pelo dono em Configurações)",
      params.companyKnowledgeBase?.trim() || "(nenhum treinamento cadastrado ainda pelo dono da empresa)",
    ].join("\n\n");
  }
}
