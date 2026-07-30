/**
 * Contrato que qualquer provedor de LLM deve implementar para ser plugado na
 * plataforma (DeepSeek hoje; OpenAI/Claude/Gemini no futuro só precisam de uma nova
 * classe implementando esta interface + registro em ai.module.ts).
 */
export interface AIChatMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
  /** Nome da tool, obrigatório quando role === 'tool'. */
  name?: string;
  /** Obrigatório quando role === 'tool' — precisa apontar para o id do tool_call que a originou. */
  toolCallId?: string;
  /** Presente numa mensagem 'assistant' que pediu para chamar ferramentas. */
  toolCalls?: AIToolCall[];
}

export interface AIToolDefinition {
  name: string;
  description: string;
  /** JSON Schema dos parâmetros aceitos pela tool. */
  parameters: Record<string, unknown>;
}

export interface AIToolCall {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
}

export interface AIChatResult {
  content: string | null;
  toolCalls: AIToolCall[];
}

export const AI_PROVIDER = Symbol("AI_PROVIDER");

export interface AIProvider {
  chat(messages: AIChatMessage[], tools?: AIToolDefinition[]): Promise<AIChatResult>;
}
