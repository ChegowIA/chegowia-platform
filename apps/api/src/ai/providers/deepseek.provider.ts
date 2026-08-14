import { Injectable, Logger, ServiceUnavailableException } from "@nestjs/common";
import { AIChatMessage, AIChatOptions, AIChatResult, AIProvider, AIToolDefinition } from "./ai-provider.interface";

/**
 * DeepSeek expõe uma API compatível com o formato "chat completions" da OpenAI,
 * então esta implementação é só um cliente HTTP fino — trocar de provedor no futuro
 * é implementar AIProvider de novo (ex.: OpenAIProvider) e trocar o binding no
 * ai.module.ts / env AI_PROVIDER, sem tocar em ToolsService, PromptBuilder ou AiService.
 */
@Injectable()
export class DeepSeekProvider implements AIProvider {
  private readonly logger = new Logger("DeepSeekProvider");

  async chat(messages: AIChatMessage[], tools?: AIToolDefinition[], options?: AIChatOptions): Promise<AIChatResult> {
    const apiKey = process.env.DEEPSEEK_API_KEY;
    if (!apiKey) {
      throw new ServiceUnavailableException(
        "DEEPSEEK_API_KEY não configurada. Defina a chave no .env para habilitar o agente de IA.",
      );
    }

    const baseUrl = process.env.DEEPSEEK_BASE_URL ?? "https://api.deepseek.com";
    const model = process.env.DEEPSEEK_MODEL ?? "deepseek-v4-flash";

    const body: Record<string, unknown> = {
      model,
      messages: messages.map((m) => {
        const raw: Record<string, unknown> = { role: m.role, content: m.content };
        if (m.name) raw.name = m.name;
        if (m.role === "tool" && m.toolCallId) raw.tool_call_id = m.toolCallId;
        if (m.role === "assistant" && m.toolCalls?.length) {
          raw.content = m.content || null;
          raw.tool_calls = m.toolCalls.map((call) => ({
            id: call.id,
            type: "function",
            function: { name: call.name, arguments: JSON.stringify(call.arguments) },
          }));
        }
        return raw;
      }),
    };
    if (tools?.length) {
      body.tools = tools.map((t) => ({
        type: "function",
        function: { name: t.name, description: t.description, parameters: t.parameters },
      }));
      body.tool_choice = "auto";
    }
    if (options?.responseFormat === "json_object") {
      body.response_format = { type: "json_object" };
    }
    if (options?.thinking === false) {
      // O modelo usado hoje aceita este formato; mantê-lo opcional preserva
      // compatibilidade caso a variável de ambiente aponte para outro modelo.
      body.thinking = { type: "disabled" };
    }
    if (typeof options?.maxTokens === "number" && options.maxTokens > 0) {
      body.max_tokens = Math.floor(options.maxTokens);
    }
    if (typeof options?.temperature === "number" && options.temperature >= 0 && options.temperature <= 2) {
      body.temperature = options.temperature;
    }

    const response = await fetch(`${baseUrl}/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const errorText = await response.text().catch(() => "");
      this.logger.error(`DeepSeek API respondeu ${response.status}: ${errorText}`);
      throw new ServiceUnavailableException("Falha ao consultar o agente de IA. Tente novamente.");
    }

    const data = (await response.json()) as any;
    const choice = data.choices?.[0]?.message;

    return {
      content: choice?.content ?? null,
      toolCalls: (choice?.tool_calls ?? []).map((call: any) => ({
        id: call.id,
        name: call.function?.name,
        arguments: safeParseJson(call.function?.arguments),
      })),
      requestId: typeof data.id === "string" ? data.id : null,
      usage: data.usage
        ? {
            inputTokens: data.usage.prompt_tokens ?? null,
            cachedInputTokens: data.usage.prompt_cache_hit_tokens ?? null,
            uncachedInputTokens: data.usage.prompt_cache_miss_tokens ?? null,
            outputTokens: data.usage.completion_tokens ?? null,
            totalTokens: data.usage.total_tokens ?? null,
          }
        : null,
    };
  }
}

function safeParseJson(raw: string | undefined): Record<string, unknown> {
  if (!raw) return {};
  try {
    return JSON.parse(raw);
  } catch {
    return {};
  }
}
