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
    return (error.response?.data as any)?.message ?? fallback;
  }
  return fallback;
}

export function assetUrl(url?: string | null): string | undefined {
  if (!url) return undefined;
  if (/^(https?:|data:|blob:)/.test(url)) return url;
  return `${API_ORIGIN}${url.startsWith("/") ? url : `/${url}`}`;
}
