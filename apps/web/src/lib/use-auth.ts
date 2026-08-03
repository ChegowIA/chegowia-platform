import { useMutation } from "@tanstack/react-query";
import { api } from "./api-client";
import { useAuthStore } from "./auth-store";

interface LoginPayload {
  email: string;
  password: string;
}

interface RegisterPayload extends LoginPayload {
  confirmPassword: string;
  name: string;
  phone?: string;
  street: string;
  number: string;
  neighborhood: string;
  city: string;
  state: string;
  zipCode?: string;
  complement?: string;
  acceptTerms: boolean;
  acceptPrivacy: boolean;
}

export function useLogin() {
  const setSession = useAuthStore((s) => s.setSession);
  return useMutation({
    mutationFn: async (payload: LoginPayload) => {
      const { data } = await api.post("/auth/login", payload);
      return data;
    },
    onSuccess: (data) => {
      if (!data.mfaRequired) setSession(data.accessToken, data.user);
    },
  });
}

export function useRegisterCustomer() {
  return useMutation({
    mutationFn: async (payload: RegisterPayload) => {
      const { data } = await api.post("/auth/register", payload);
      return data;
    },
  });
}

export function useVerifyMfa() {
  const setSession = useAuthStore((s) => s.setSession);
  return useMutation({
    mutationFn: async (payload: { challengeId: string; code: string }) => {
      const { data } = await api.post("/auth/mfa/verify", payload);
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
