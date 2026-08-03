import axios, { AxiosError, InternalAxiosRequestConfig } from "axios";
import { useAuthStore } from "./auth-store";

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

let refreshPromise: Promise<string | null> | null = null;

export async function refreshAccessToken(): Promise<string | null> {
  try {
    const { data } = await axios.post(`${API_BASE}/auth/refresh`, {}, { withCredentials: true });
    useAuthStore.getState().setSession(data.accessToken, data.user);
    return data.accessToken as string;
  } catch {
    useAuthStore.getState().clear();
    return null;
  }
}

api.interceptors.response.use(
  (response) => response,
  async (error: AxiosError) => {
    const original = error.config as RetriableConfig | undefined;
    if (error.response?.status === 401 && original && !original._retry && !original.url?.includes("/auth/")) {
      original._retry = true;
      if (!refreshPromise) {
        refreshPromise = refreshAccessToken().finally(() => {
          refreshPromise = null;
        });
      }
      const newToken = await refreshPromise;
      if (newToken) {
        original.headers.Authorization = `Bearer ${newToken}`;
        return api(original);
      }
    }
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
