import axios, { AxiosError, InternalAxiosRequestConfig } from "axios";
import { useAuthStore } from "./auth-store";
import { toast } from "./toast";

declare module "axios" {
  export interface AxiosRequestConfig {
    /** Controle opcional da notificação global desta requisição. */
    notify?: boolean | { success?: string | false; error?: string | false };
  }
}

const API_ORIGIN = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001";
const API_BASE = `${API_ORIGIN}/api`;

export const api = axios.create({ baseURL: API_BASE, withCredentials: true });

api.interceptors.request.use((config) => {
  const token = useAuthStore.getState().accessToken;
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

interface RetriableConfig extends InternalAxiosRequestConfig {
  _retry?: boolean;
}

function notificationConfig(config?: RetriableConfig) {
  return config?.notify;
}

function shouldSilenceAutomaticSuccess(config?: RetriableConfig) {
  const url = config?.url ?? "";
  // Conversas, autenticação e prévias são fluxos que já têm retorno próprio;
  // exibir um toast para cada mensagem enviada deixaria a interface ruidosa.
  return /(^|\/)auth\//.test(url)
    || /\/messages(?:$|[/?])/.test(url)
    || /(^|\/)ai\//.test(url)
    || /\/public-discovery\//.test(url)
    || /\/quote(?:$|[/?])/.test(url)
    || /\/import\/preview(?:$|[/?])/.test(url);
}

function defaultSuccessMessage(config?: RetriableConfig) {
  const method = config?.method?.toLowerCase();
  if (!method || method === "get" || shouldSilenceAutomaticSuccess(config)) return null;
  if (method === "delete") return "Item removido com sucesso.";
  if (method === "patch" || method === "put") return "Alterações salvas com sucesso.";
  return "Ação concluída com sucesso.";
}

function notifySuccess(config?: RetriableConfig) {
  if (typeof window === "undefined") return;
  const notify = notificationConfig(config);
  if (notify === false) return;
  const custom = typeof notify === "object" ? notify.success : undefined;
  if (custom === false) return;
  const message = custom || defaultSuccessMessage(config);
  if (message) toast.success(message);
}

function notifyError(error: AxiosError) {
  if (typeof window === "undefined") return;
  const config = error.config as RetriableConfig | undefined;
  const notify = notificationConfig(config);
  if (notify === false) return;
  const custom = typeof notify === "object" ? notify.error : undefined;
  if (custom === false) return;
  toast.error(custom || apiErrorMessage(error));
}

let refreshPromise: Promise<string | null> | null = null;

/** Faz uma única renovação HTTP; a coordenação fica na função pública abaixo. */
async function requestFreshAccessToken(): Promise<string | null> {
  try {
    const { data } = await axios.post(`${API_BASE}/auth/refresh`, {}, { withCredentials: true });
    useAuthStore.getState().setSession(data.accessToken, data.user, data.sessionExpiresAt);
    return data.accessToken as string;
  } catch {
    useAuthStore.getState().clear();
    return null;
  }
}

/**
 * O refresh token é rotativo e de uso único. Em uma recarga, várias queries
 * podem receber 401 antes de o bootstrap restaurar o access token; em mais de
 * uma aba isso também acontece em paralelo. Sem uma trava, uma renovação
 * vence e a outra interpreta a rotação normal como sessão inválida.
 *
 * `refreshPromise` cobre chamadas dentro desta aba e Web Locks cobre as abas
 * do mesmo navegador. Em navegadores sem Web Locks ainda preservamos a
 * coordenação local, que é a parte essencial para não disputar o bootstrap.
 */
async function requestFreshAccessTokenExclusively(): Promise<string | null> {
  if (typeof navigator === "undefined" || !navigator.locks) {
    return requestFreshAccessToken();
  }
  try {
    return await navigator.locks.request("chegowia-auth-refresh", () => requestFreshAccessToken());
  } catch {
    // Se o navegador não puder adquirir a trava, a chamada normal ainda é
    // preferível a abandonar uma sessão válida por um detalhe de suporte.
    return requestFreshAccessToken();
  }
}

export function refreshAccessToken(): Promise<string | null> {
  if (!refreshPromise) {
    refreshPromise = requestFreshAccessTokenExclusively().finally(() => {
      refreshPromise = null;
    });
  }
  return refreshPromise;
}

api.interceptors.response.use(
  (response) => {
    notifySuccess(response.config as RetriableConfig);
    return response;
  },
  async (error: AxiosError) => {
    const original = error.config as RetriableConfig | undefined;
    if (error.response?.status === 401 && original && !original._retry && !original.url?.includes("/auth/")) {
      original._retry = true;
      const newToken = await refreshAccessToken();
      if (newToken) {
        original.headers.Authorization = `Bearer ${newToken}`;
        return api(original);
      }
    }
    notifyError(error);
    return Promise.reject(error);
  },
);

export function apiErrorMessage(error: unknown, fallback = "Algo deu errado. Tente novamente."): string {
  if (axios.isAxiosError(error)) {
    const rawMessage = (error.response?.data as any)?.message;
    const message = Array.isArray(rawMessage) ? rawMessage.join(" ") : rawMessage;
    const translatedDefaults: Record<string, string> = {
      "Bad Request": "Os dados informados são inválidos.",
      Conflict: "Não foi possível concluir porque os dados entram em conflito.",
      Forbidden: "Você não tem permissão para realizar esta ação.",
      "Internal Server Error": "Erro interno inesperado.",
      "Network Error": "Não foi possível conectar ao servidor. Verifique sua conexão.",
      "Not Found": "O recurso solicitado não foi encontrado.",
      "Payload Too Large": "O arquivo ou conteúdo enviado excede o tamanho permitido.",
      "Service Unavailable": "Serviço temporariamente indisponível. Tente novamente.",
      "Too Many Requests": "Muitas tentativas em pouco tempo. Aguarde alguns instantes.",
      Unauthorized: "Sua sessão não é válida. Entre novamente.",
    };
    const statusDefaults: Record<number, string> = {
      400: translatedDefaults["Bad Request"],
      401: translatedDefaults.Unauthorized,
      403: translatedDefaults.Forbidden,
      404: translatedDefaults["Not Found"],
      409: translatedDefaults.Conflict,
      413: translatedDefaults["Payload Too Large"],
      429: translatedDefaults["Too Many Requests"],
      500: translatedDefaults["Internal Server Error"],
      503: translatedDefaults["Service Unavailable"],
    };
    const looksLikeUntranslatedTechnicalMessage = typeof message === "string"
      && /\b(bad request|conflict|forbidden|internal server error|not found|payload too large|service unavailable|too many requests|unauthorized|invalid|required|must be|failed|unable to|something went wrong)\b/i.test(message);
    if (looksLikeUntranslatedTechnicalMessage) {
      return statusDefaults[error.response?.status ?? 0] ?? fallback;
    }
    return translatedDefaults[message ?? error.message] ?? message ?? translatedDefaults[error.message] ?? fallback;
  }
  return fallback;
}

export function assetUrl(url?: string | null): string | undefined {
  if (!url) return undefined;
  if (/^(https?:|data:|blob:)/.test(url)) return url;
  if (url.startsWith("/assets/")) return url;
  return `${API_ORIGIN}${url.startsWith("/") ? url : `/${url}`}`;
}
