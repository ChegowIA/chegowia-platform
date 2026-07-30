import { useMutation } from "@tanstack/react-query";
import { api } from "./api-client";
import { useAuthStore } from "./auth-store";

interface LoginPayload {
  email: string;
  password: string;
}

interface RegisterPayload extends LoginPayload {
  name: string;
  phone?: string;
}

export function useLogin() {
  const setSession = useAuthStore((s) => s.setSession);
  return useMutation({
    mutationFn: async (payload: LoginPayload) => {
      const { data } = await api.post("/auth/login", payload);
      return data;
    },
    onSuccess: (data) => setSession(data.accessToken, data.user),
  });
}

export function useRegisterCustomer() {
  const setSession = useAuthStore((s) => s.setSession);
  return useMutation({
    mutationFn: async (payload: RegisterPayload) => {
      const { data } = await api.post("/auth/register", payload);
      return data;
    },
    onSuccess: (data) => setSession(data.accessToken, data.user),
  });
}

export function useLogout() {
  const clear = useAuthStore((s) => s.clear);
  return useMutation({
    mutationFn: async () => {
      await api.post("/auth/logout");
    },
    onSuccess: () => clear(),
  });
}
