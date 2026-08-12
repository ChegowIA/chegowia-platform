"use client";

import { useAuthStore } from "@/lib/auth-store";
import { ChangePasswordCard } from "@/components/auth/change-password-card";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

/**
 * Conta do superadmin. Existe porque a conta da plataforma é criada pelo shell
 * do servidor, muitas vezes com senha sorteada — e sem esta tela não haveria
 * como trocá-la sem passar por "esqueci minha senha".
 */
export default function SuperAdminAccountPage() {
  const user = useAuthStore((state) => state.user);

  return (
    <div className="space-y-5">
      <header>
        <h1 className="text-2xl font-bold text-slate-900 dark:text-slate-100">Minha conta</h1>
        <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
          Dados de acesso da conta da plataforma.
        </p>
      </header>

      <Card>
        <CardHeader>
          <CardTitle>Identificação</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          <Field label="Nome" value={user?.name ?? "—"} />
          <Field label="E-mail" value={user?.email ?? "—"} />
          <Field label="Perfil" value={user?.role ?? "—"} />
        </CardContent>
      </Card>

      <ChangePasswordCard />
    </div>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-[11px] font-black uppercase tracking-wide text-slate-400">{label}</p>
      <p className="mt-1 text-sm text-slate-700 dark:text-slate-300">{value}</p>
    </div>
  );
}
