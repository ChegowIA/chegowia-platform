"use client";

import { useEffect } from "react";
import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { homePathForRole } from "@/lib/auth-routes";
import { useAuthStore } from "@/lib/auth-store";
import { useLogin } from "@/lib/use-auth";
import { apiErrorMessage } from "@/lib/api-client";
import { Button } from "@/components/ui/button";
import { FormField, Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const login = useLogin();
  const router = useRouter();
  const user = useAuthStore((s) => s.user);
  const hasHydrated = useAuthStore((s) => s.hasHydrated);
  const isSessionLoading = useAuthStore((s) => s.isSessionLoading);

  useEffect(() => {
    if (!hasHydrated || isSessionLoading || !user) return;
    router.replace(homePathForRole(user.role));
  }, [hasHydrated, isSessionLoading, router, user]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      const data = await login.mutateAsync({ email, password });
      router.replace(homePathForRole(data.user.role));
    } catch (err) {
      setError(apiErrorMessage(err, "E-mail ou senha inválidos."));
    }
  }

  if (!hasHydrated || isSessionLoading || user) return null;

  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-50 px-4 dark:bg-slate-950">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle>Entrar no ChegowIA</CardTitle>
        </CardHeader>
        <CardContent>
          <form className="space-y-4" onSubmit={handleSubmit}>
            <FormField label="E-mail">
              <Input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
            </FormField>
            <FormField label="Senha">
              <Input type="password" required value={password} onChange={(e) => setPassword(e.target.value)} />
            </FormField>
            {error && <p className="text-sm text-red-600">{error}</p>}
            <Button type="submit" className="w-full" isLoading={login.isPending}>
              Entrar
            </Button>
          </form>
          <p className="mt-4 text-center text-sm text-slate-500">
            Ainda não tem conta?{" "}
            <Link href="/cadastro" className="font-medium text-brand-600 hover:underline">
              Cadastre-se
            </Link>
          </p>
        </CardContent>
      </Card>
    </main>
  );
}
