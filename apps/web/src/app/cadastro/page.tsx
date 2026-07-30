"use client";

import { useEffect } from "react";
import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { homePathForRole } from "@/lib/auth-routes";
import { useAuthStore } from "@/lib/auth-store";
import { useRegisterCustomer } from "@/lib/use-auth";
import { apiErrorMessage } from "@/lib/api-client";
import { Button } from "@/components/ui/button";
import { FormField, Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export default function CadastroPage() {
  const [form, setForm] = useState({ name: "", email: "", password: "", phone: "" });
  const [error, setError] = useState<string | null>(null);
  const register = useRegisterCustomer();
  const router = useRouter();
  const user = useAuthStore((state) => state.user);
  const hasHydrated = useAuthStore((state) => state.hasHydrated);
  const isSessionLoading = useAuthStore((state) => state.isSessionLoading);

  useEffect(() => {
    if (!hasHydrated || isSessionLoading || !user) return;
    router.replace(homePathForRole(user.role));
  }, [hasHydrated, isSessionLoading, router, user]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      await register.mutateAsync(form);
      router.replace("/");
    } catch (err) {
      setError(apiErrorMessage(err, "Não foi possível criar sua conta."));
    }
  }

  if (!hasHydrated || isSessionLoading || user) return null;

  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-50 px-4 dark:bg-slate-950">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle>Criar conta</CardTitle>
        </CardHeader>
        <CardContent>
          <form className="space-y-4" onSubmit={handleSubmit}>
            <FormField label="Nome">
              <Input required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
            </FormField>
            <FormField label="E-mail">
              <Input type="email" required value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
            </FormField>
            <FormField label="Telefone (opcional)">
              <Input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
            </FormField>
            <FormField label="Senha">
              <Input
                type="password"
                required
                minLength={6}
                value={form.password}
                onChange={(e) => setForm({ ...form, password: e.target.value })}
              />
            </FormField>
            {error && <p className="text-sm text-red-600">{error}</p>}
            <Button type="submit" className="w-full" isLoading={register.isPending}>
              Criar conta
            </Button>
          </form>
          <p className="mt-4 text-center text-sm text-slate-500">
            Já tem conta?{" "}
            <Link href="/login" className="font-medium text-brand-600 hover:underline">
              Entrar
            </Link>
          </p>
        </CardContent>
      </Card>
    </main>
  );
}
