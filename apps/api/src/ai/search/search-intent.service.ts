import { Inject, Injectable, Logger } from "@nestjs/common";
import { AI_PROVIDER, AIProvider } from "../providers/ai-provider.interface";
import { PUBLIC_PRODUCT_TYPE_INDEX, normalizeSearchText } from "../../catalog/public-product-types";

export interface SearchIntent {
  /** O que a pessoa digitou, sem alteração. */
  query: string;
  /** Termos usados na consulta ao banco: o texto original mais o que a IA relacionou. */
  terms: string[];
  /** Tipos públicos (hamburgueres-lanches, pizzas, ...) que a IA considerou pertinentes. */
  productTypeIds: string[];
  /** Teto de preço detectado em linguagem natural ("até 30 reais"). */
  maxPrice: number | null;
  /** Frase curta em pt-BR explicando a interpretação — exibida ao cliente. */
  explanation: string;
  source: "ia" | "cache" | "fallback";
}

const CACHE_TTL_MS = 6 * 60 * 60 * 1000;
const CACHE_MAX_ENTRIES = 500;
const MAX_TERMS = 24;

/**
 * Grupos usados quando a IA está indisponível ou devolve algo inválido. É a
 * mesma expansão determinística que existia antes de a busca virar assistida,
 * mantida como rede de segurança: sem chave de IA, a busca continua funcionando.
 */
const FALLBACK_SYNONYM_GROUPS = [
  ["sanduiche", "lanche", "hamburguer", "hamburger", "burger", "burguer", "smash", "xsalada", "xbacon", "hotdog"],
  ["pizza", "pizzaria", "esfiha", "esfirra", "calzone"],
  ["almoco", "refeicao", "prato", "marmita", "marmitex", "caseira", "executivo"],
  ["sobremesa", "doce", "acai", "sorvete", "milkshake", "bolo", "pudim"],
  ["bebida", "refrigerante", "refri", "suco", "agua", "cerveja"],
  ["japonesa", "japones", "sushi", "sashimi", "temaki", "yakisoba"],
  ["saudavel", "fitness", "fit", "salada", "vegetariano", "vegano"],
  ["massa", "macarrao", "lasanha", "nhoque", "italiana"],
  ["frango", "galeto", "ave"],
  ["carne", "bife", "churrasco", "churrascaria", "costela"],
] as const;

const STOP_WORDS = new Set([
  "que", "com", "sem", "para", "pra", "por", "uma", "um", "dos", "das", "de", "do", "da",
  "quero", "queria", "gostaria", "algo", "alguma", "coisa", "hoje", "agora", "perto",
  "restaurante", "delivery", "loja", "comida", "pedido", "pedir", "me", "the",
]);

interface CacheEntry {
  intent: SearchIntent;
  expiresAt: number;
}

@Injectable()
export class SearchIntentService {
  private readonly logger = new Logger(SearchIntentService.name);
  private readonly cache = new Map<string, CacheEntry>();

  constructor(@Inject(AI_PROVIDER) private readonly ai: AIProvider) {}

  /**
   * Traduz o que a pessoa escreveu em filtros de busca. O resultado é cacheado
   * pelo texto normalizado: termos de busca se repetem muito entre visitantes,
   * então a mesma consulta só custa tokens uma vez — o que também impede que o
   * endpoint público seja usado para queimar crédito de propósito.
   */
  async resolve(rawQuery: string): Promise<SearchIntent> {
    const query = rawQuery.trim();
    const cacheKey = normalizeSearchText(query);
    if (!cacheKey) return this.fallbackIntent(query);

    const cached = this.cache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) {
      return { ...cached.intent, source: "cache" };
    }

    let intent: SearchIntent;
    try {
      intent = await this.askProvider(query);
    } catch (error) {
      this.logger.warn(`Busca assistida indisponível para "${query}"; usando expansão determinística.`, error as Error);
      intent = this.fallbackIntent(query);
    }

    this.remember(cacheKey, intent);
    return intent;
  }

  private remember(key: string, intent: SearchIntent) {
    if (this.cache.size >= CACHE_MAX_ENTRIES) {
      const oldest = this.cache.keys().next().value;
      if (oldest) this.cache.delete(oldest);
    }
    this.cache.set(key, { intent, expiresAt: Date.now() + CACHE_TTL_MS });
  }

  private async askProvider(query: string): Promise<SearchIntent> {
    const catalog = PUBLIC_PRODUCT_TYPE_INDEX.map((type) => `${type.id}: ${type.name}`).join("\n");
    /*
     * Custo da plataforma, não de uma empresa — e é decisão, não esquecimento.
     *
     * A busca do marketplace é anônima e procura em TODAS as lojas. Não há
     * empresa a quem atribuir: cobrar da loja que aparecer no resultado seria
     * cobrá-la por uma busca que talvez nem a mencionasse, e cobrar de todas
     * multiplicaria o custo. O cache de 6h existe justamente para limitar essa
     * despesa.
     */
    const result = await this.ai.chat([
      {
        role: "system",
        content: [
          "Você interpreta buscas de um aplicativo de delivery brasileiro e devolve SOMENTE JSON válido, sem markdown.",
          "Formato exigido:",
          '{"terms":["..."],"productTypeIds":["..."],"maxPrice":null,"explanation":"..."}',
          "",
          "Regras:",
          "- terms: até 12 palavras-chave em minúsculas e sem acento que apareceriam no nome, na descrição ou na categoria dos produtos procurados. Inclua sinônimos e formas populares no Brasil. Ex.: para 'sanduiche' inclua lanche, hamburguer, burger, smash, x-salada.",
          "- productTypeIds: escolha 0 a 3 ids da lista abaixo. Use apenas ids exatos dessa lista.",
          "- maxPrice: número em reais quando a pessoa citar um limite ('até 30 reais'), senão null.",
          '- explanation: uma frase curta em português dizendo o que você entendeu, dirigida ao cliente. Ex.: "Busquei lanches e hambúrgueres parecidos com sanduíche."',
          "- Nunca invente produtos, lojas ou preços. Você só interpreta o texto da busca.",
          "",
          "Tipos disponíveis:",
          catalog,
        ].join("\n"),
      },
      { role: "user", content: query },
    ]);

    const parsed = this.parse(result.content);
    if (!parsed) throw new Error("Resposta da IA fora do formato esperado.");

    const validTypeIds = parsed.productTypeIds.filter((id) =>
      PUBLIC_PRODUCT_TYPE_INDEX.some((type) => type.id === id),
    );

    return {
      query,
      terms: this.mergeTerms(query, parsed.terms),
      productTypeIds: validTypeIds.slice(0, 3),
      maxPrice: parsed.maxPrice,
      explanation: parsed.explanation || `Busquei opções relacionadas a "${query}".`,
      source: "ia",
    };
  }

  private parse(content: string | null) {
    if (!content) return null;
    // O modelo às vezes embrulha o JSON em cerca de código, apesar da instrução.
    const cleaned = content.replace(/```json/gi, "").replace(/```/g, "").trim();
    const start = cleaned.indexOf("{");
    const end = cleaned.lastIndexOf("}");
    if (start === -1 || end === -1 || end <= start) return null;

    try {
      const data = JSON.parse(cleaned.slice(start, end + 1)) as Record<string, unknown>;
      const terms = Array.isArray(data.terms) ? data.terms.filter((t): t is string => typeof t === "string") : [];
      const productTypeIds = Array.isArray(data.productTypeIds)
        ? data.productTypeIds.filter((t): t is string => typeof t === "string")
        : [];
      const rawPrice = typeof data.maxPrice === "number" ? data.maxPrice : null;
      return {
        terms,
        productTypeIds,
        maxPrice: rawPrice !== null && Number.isFinite(rawPrice) && rawPrice > 0 ? rawPrice : null,
        explanation: typeof data.explanation === "string" ? data.explanation.trim() : "",
      };
    } catch {
      return null;
    }
  }

  /** O texto original sempre entra na busca; a IA só acrescenta. */
  private mergeTerms(query: string, aiTerms: string[]) {
    const own = this.baseTokens(query);
    const extra = aiTerms
      .map((term) => normalizeSearchText(term))
      .filter((term) => term.length >= 3);
    return Array.from(new Set([...own, ...extra])).slice(0, MAX_TERMS);
  }

  private baseTokens(query: string) {
    return normalizeSearchText(query)
      .split(/\s+/)
      .map((token) => token.trim())
      .filter((token) => token.length >= 3 && !STOP_WORDS.has(token));
  }

  private fallbackIntent(query: string): SearchIntent {
    const normalized = normalizeSearchText(query);
    const tokens = this.baseTokens(query);
    const expanded = [...tokens];

    for (const group of FALLBACK_SYNONYM_GROUPS) {
      if (group.some((term) => normalized.includes(term) || tokens.includes(term))) {
        expanded.push(...group);
      }
    }

    return {
      query,
      terms: Array.from(new Set(expanded)).slice(0, MAX_TERMS),
      productTypeIds: [],
      maxPrice: null,
      explanation: query
        ? `Busquei por "${query}" e por termos parecidos.`
        : "Mostrando as opções disponíveis na sua região.",
      source: "fallback",
    };
  }
}
