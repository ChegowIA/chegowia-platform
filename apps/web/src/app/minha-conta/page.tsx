"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Role } from "@chegowia/shared";
import { api, apiErrorMessage, assetUrl } from "@/lib/api-client";
import { Address, Order } from "@/lib/types";
import { useAuthStore, AuthUser } from "@/lib/auth-store";
import { formatCurrency, formatDateTime } from "@/lib/format";
import { PublicHeader } from "@/components/layout/public-header";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { FormField, Input } from "@/components/ui/input";
import { OrderStatusBadge } from "@/components/ui/badge";
import { ChangePasswordCard } from "@/components/auth/change-password-card";

export default function MinhaContaPage() {
  const queryClient = useQueryClient();
  const authUser = useAuthStore((state) => state.user);
  const accessToken = useAuthStore((state) => state.accessToken);
  const setSession = useAuthStore((state) => state.setSession);
  const [profileName, setProfileName] = useState(authUser?.name ?? "");
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [profileError, setProfileError] = useState<string | null>(null);
  const [passwordError, setPasswordError] = useState<string | null>(null);
  const [profileSaved, setProfileSaved] = useState(false);
  const [passwordSaved, setPasswordSaved] = useState(false);
  const [avatarFile, setAvatarFile] = useState<File | null>(null);
  const [avatarPreview, setAvatarPreview] = useState<string | null>(null);
  const [avatarError, setAvatarError] = useState<string | null>(null);
  const [avatarSaved, setAvatarSaved] = useState(false);

  const { data: me } = useQuery({
    queryKey: ["auth-me"],
    queryFn: async () => {
      const { data } = await api.get<AuthUser>("/auth/me");
      return data;
    },
  });

  const { data: addresses } = useQuery({
    queryKey: ["my-addresses"],
    queryFn: async () => {
      const { data } = await api.get<Address[]>("/addresses");
      return data;
    },
  });

  const { data: orders } = useQuery({
    queryKey: ["my-orders"],
    queryFn: async () => {
      const { data } = await api.get<Order[]>("/me/orders");
      return data;
    },
  });

  useEffect(() => {
    if (me?.name) setProfileName(me.name);
  }, [me?.name]);

  useEffect(() => {
    if (!avatarFile) {
      setAvatarPreview(assetUrl(me?.avatarUrl ?? authUser?.avatarUrl) ?? null);
      return;
    }
    const objectUrl = URL.createObjectURL(avatarFile);
    setAvatarPreview(objectUrl);
    return () => URL.revokeObjectURL(objectUrl);
  }, [avatarFile, authUser?.avatarUrl, me?.avatarUrl]);

  const updateProfile = useMutation({
    mutationFn: async () => {
      const { data } = await api.patch<AuthUser>("/users/me", { name: profileName });
      return data;
    },
    onSuccess: (updated) => {
      setProfileError(null);
      setProfileSaved(true);
      queryClient.invalidateQueries({ queryKey: ["auth-me"] });
      if (accessToken && authUser) setSession(accessToken, { ...authUser, ...updated });
      window.setTimeout(() => setProfileSaved(false), 2400);
    },
    onError: (err) => setProfileError(apiErrorMessage(err)),
  });

  const changePassword = useMutation({
    mutationFn: async () => {
      const { data } = await api.patch("/users/me/password", { currentPassword, newPassword, confirmPassword });
      return data;
    },
    onSuccess: () => {
      setPasswordError(null);
      setPasswordSaved(true);
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
      window.setTimeout(() => setPasswordSaved(false), 2400);
    },
    onError: (err) => setPasswordError(apiErrorMessage(err)),
  });

  const uploadAvatar = useMutation({
    mutationFn: async () => {
      if (!avatarFile) return null;
      const formData = new FormData();
      formData.append("file", avatarFile);
      const { data } = await api.post<AuthUser>("/users/me/avatar", formData);
      return data;
    },
    onSuccess: (updated) => {
      if (!updated) return;
      setAvatarError(null);
      setAvatarSaved(true);
      setAvatarFile(null);
      queryClient.invalidateQueries({ queryKey: ["auth-me"] });
      if (accessToken && authUser) setSession(accessToken, { ...authUser, ...updated });
      window.setTimeout(() => setAvatarSaved(false), 2400);
    },
    onError: (err) => setAvatarError(apiErrorMessage(err)),
  });
  const exportData = useMutation({
    mutationFn: async () => (await api.get("/users/me/export")).data,
    onSuccess: (data) => {
      const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: "application/json" }));
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `meus-dados-chegowia-${new Date().toISOString().slice(0, 10)}.json`;
      anchor.click();
      URL.revokeObjectURL(url);
    },
  });

  const defaultAddress = addresses?.find((address) => address.isDefault) ?? addresses?.[0];
  const recentOrders = orders?.slice(0, 3) ?? [];
  const totalSpent = (orders ?? []).reduce((sum, order) => sum + Number(order.total), 0);

  return (
    <>
      <PublicHeader />
      <main className="mx-auto max-w-6xl px-4 py-8">
        <div className="mb-6 flex flex-col justify-between gap-4 lg:flex-row lg:items-end">
          <div>
            <p className="text-xs font-bold uppercase tracking-wide text-brand-700 dark:text-brand-300">Configurações do cliente</p>
            <h1 className="mt-1 text-3xl font-black text-slate-950 dark:text-slate-100">Minha conta</h1>
            <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">Gerencie perfil, senha, endereços e histórico de compras.</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Link href="/minha-conta/enderecos">
              <Button variant="outline">Endereços</Button>
            </Link>
            <Link href="/minha-conta/pedidos">
              <Button>Meus pedidos</Button>
            </Link>
          </div>
        </div>

        <div className="grid gap-4 sm:grid-cols-3">
          <SummaryCard label="Pedidos feitos" value={orders?.length ?? 0} tone="brand" />
          <SummaryCard label="Endereços salvos" value={addresses?.length ?? 0} tone="accent" />
          <SummaryCard label="Total comprado" value={formatCurrency(totalSpent)} tone="slate" />
        </div>

        <div className="mt-6 grid gap-6 lg:grid-cols-[minmax(0,1fr)_360px]">
          <div className="space-y-6">
            <Card>
              <CardHeader>
                <CardTitle>Foto do perfil</CardTitle>
              </CardHeader>
              <CardContent className="flex flex-col gap-4 sm:flex-row sm:items-center">
                <div className="grid h-24 w-24 shrink-0 place-items-center overflow-hidden rounded-lg border border-brand-100 bg-brand-50 text-2xl font-black text-brand-700 dark:bg-brand-950/30 dark:border-brand-900/50 dark:text-brand-300">
                  {avatarPreview ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={avatarPreview} alt={profileName || "Foto do perfil"} className="h-full w-full object-cover" />
                  ) : (
                    initials(profileName || me?.name || authUser?.name || "Cliente")
                  )}
                </div>
                <div className="flex-1">
                  <p className="text-sm text-slate-500 dark:text-slate-400">
                    Use uma foto quadrada ou bem centralizada. O arquivo pode ter até 4MB.
                  </p>
                  <div className="mt-3 flex flex-wrap gap-2">
                    <label className="inline-flex min-h-10 cursor-pointer items-center justify-center rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 shadow-sm transition hover:border-brand-200 hover:bg-brand-50 hover:text-brand-700 dark:bg-slate-900 dark:border-slate-700 dark:text-slate-300">
                      Escolher foto
                      <input
                        type="file"
                        accept="image/*"
                        className="sr-only"
                        onChange={(event) => setAvatarFile(event.target.files?.[0] ?? null)}
                      />
                    </label>
                    <Button disabled={!avatarFile} isLoading={uploadAvatar.isPending} onClick={() => uploadAvatar.mutate()}>
                      Salvar foto
                    </Button>
                  </div>
                  {avatarError && <p className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600 dark:bg-red-950/30 dark:text-red-400">{avatarError}</p>}
                  {avatarSaved && <p className="mt-3 rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-700 dark:bg-emerald-950/30 dark:text-emerald-300">Foto atualizada.</p>}
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Dados pessoais</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid gap-4 sm:grid-cols-3">
                  <FormField label="Nome">
                    <Input value={profileName} onChange={(event) => setProfileName(event.target.value)} />
                  </FormField>
                  <FormField label="E-mail">
                    <Input value={me?.email ?? authUser?.email ?? ""} readOnly className="bg-slate-50 text-slate-500 dark:bg-slate-800/60 dark:text-slate-400" />
                  </FormField>
                </div>
                <div className="grid gap-4 sm:grid-cols-2">
                  <FormField label="Tipo de conta">
                    <Input value={accountRoleLabel(me?.role ?? authUser?.role)} readOnly className="bg-slate-50 text-slate-500 dark:bg-slate-800/60 dark:text-slate-400" />
                  </FormField>
                  <FormField label="Status">
                    <Input value="Conta ativa" readOnly className="bg-slate-50 text-slate-500 dark:bg-slate-800/60 dark:text-slate-400" />
                  </FormField>
                </div>
                {profileError && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600 dark:bg-red-950/30 dark:text-red-400">{profileError}</p>}
                {profileSaved && <p className="rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-700 dark:bg-emerald-950/30 dark:text-emerald-300">Perfil atualizado.</p>}
                <Button disabled={!profileName.trim()} isLoading={updateProfile.isPending} onClick={() => updateProfile.mutate()}>
                  Salvar perfil
                </Button>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Segurança</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid gap-4 sm:grid-cols-2">
                  <FormField label="Senha atual">
                    <Input type="password" value={currentPassword} onChange={(event) => setCurrentPassword(event.target.value)} />
                  </FormField>
                  <FormField label="Nova senha">
                    <Input type="password" minLength={8} pattern="(?=.*[a-z])(?=.*[A-Z])(?=.*[^A-Za-z0-9\s]).{8,}" title="Use ao menos 8 caracteres, uma letra maiúscula, uma minúscula e um símbolo." value={newPassword} onChange={(event) => setNewPassword(event.target.value)} />
                  </FormField>
                  <FormField label="Confirmar nova senha">
                    <Input type="password" value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} />
                  </FormField>
                </div>
                <p className="text-xs text-slate-500 dark:text-slate-400">A nova senha precisa ter no mínimo 8 caracteres, uma letra maiúscula, uma minúscula e um símbolo.</p>
                {confirmPassword && newPassword !== confirmPassword && <p className="text-xs font-bold text-rose-600 dark:text-rose-400">As senhas não coincidem.</p>}
                {passwordError && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600 dark:bg-red-950/30 dark:text-red-400">{passwordError}</p>}
                {passwordSaved && <p className="rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-700 dark:bg-emerald-950/30 dark:text-emerald-300">Senha alterada.</p>}
                <Button
                  variant="secondary"
                  disabled={!currentPassword || !/^(?=.*[a-z])(?=.*[A-Z])(?=.*[^A-Za-z0-9\s]).{8,}$/.test(newPassword) || newPassword !== confirmPassword}
                  isLoading={changePassword.isPending}
                  onClick={() => changePassword.mutate()}
                >
                  Alterar senha
                </Button>
              </CardContent>
            </Card>
          </div>

          <aside className="space-y-6">
            <Card>
              <CardHeader>
                <CardTitle>Endereço principal</CardTitle>
              </CardHeader>
              <CardContent>
                {defaultAddress ? (
                  <div className="space-y-3">
                    <div>
                      <p className="font-bold text-slate-950 dark:text-slate-100">
                        {defaultAddress.label || "Endereço"}
                        {defaultAddress.isDefault ? " padrão" : ""}
                      </p>
                      <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
                        {defaultAddress.street}, {defaultAddress.number}
                        {defaultAddress.complement ? ` · ${defaultAddress.complement}` : ""}
                      </p>
                      <p className="text-sm text-slate-500 dark:text-slate-400">
                        {defaultAddress.neighborhood}, {defaultAddress.city} - {defaultAddress.state}
                      </p>
                    </div>
                    <Link href="/minha-conta/enderecos" className="mt-4 block">
                      <Button className="w-full" variant="outline">
                        Gerenciar endereços
                      </Button>
                    </Link>
                  </div>
                ) : (
                  <div className="space-y-3">
                    <p className="text-sm text-slate-500 dark:text-slate-400">Cadastre um endereço para agilizar o checkout e a busca regional.</p>
                    <Link href="/minha-conta/enderecos" className="mt-4 block">
                      <Button className="w-full">Cadastrar endereço</Button>
                    </Link>
                  </div>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Pedidos recentes</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                {recentOrders.map((order) => (
                  <Link
                    key={order.id}
                    href={`/pedido/${order.id}`}
                    className="block rounded-lg border border-slate-200 p-3 transition hover:border-brand-200 hover:bg-brand-50/50 dark:border-slate-800"
                  >
                    <div className="mb-2 flex items-center justify-between gap-2">
                      <p className="font-bold text-slate-950 dark:text-slate-100">#{order.id.slice(0, 8)}</p>
                      <OrderStatusBadge status={order.status} />
                    </div>
                    <p className="text-xs text-slate-500 dark:text-slate-400">{formatDateTime(order.createdAt)}</p>
                    <p className="mt-1 text-sm font-bold text-brand-700 dark:text-brand-300">{formatCurrency(order.total)}</p>
                  </Link>
                ))}
                {recentOrders.length === 0 && <p className="text-sm text-slate-500 dark:text-slate-400">Você ainda não fez pedidos.</p>}
                <Link href="/minha-conta/pedidos" className="block pt-2">
                  <Button className="w-full" variant="outline">
                    Ver histórico completo
                  </Button>
                </Link>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Privacidade e seus dados</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-sm leading-6 text-slate-500 dark:text-slate-400">Baixe uma cópia legível dos dados pessoais e pedidos associados à sua conta. Para correção, eliminação ou revisão de decisão automatizada, fale com nosso canal de privacidade.</p>
                <div className="mt-4 grid gap-2">
                  <Button variant="outline" isLoading={exportData.isPending} onClick={()=>exportData.mutate()}>Baixar meus dados</Button>
                  <a className="text-center text-xs font-bold text-brand-700 hover:underline dark:text-brand-300" href="mailto:contato@chegowia.com.br">Solicitar atendimento de privacidade</a>
                </div>
                {exportData.error&&<p className="mt-3 text-xs text-rose-600 dark:text-rose-400">{apiErrorMessage(exportData.error)}</p>}
              </CardContent>
            </Card>

            <ChangePasswordCard />
          </aside>
        </div>
      </main>
    </>
  );
}

function SummaryCard({
  label,
  value,
  tone,
}: {
  label: string;
  value: number | string;
  tone: "brand" | "accent" | "slate";
}) {
  const classes = {
    brand: "bg-brand-50 text-brand-800 dark:bg-brand-950/30 dark:text-brand-300",
    accent: "bg-accent-50 text-accent-800",
    slate: "bg-white text-slate-800 dark:bg-slate-900 dark:text-slate-200",
  };

  return (
    <div className={`rounded-lg border border-slate-200 px-4 py-3 shadow-soft ${classes[tone]}`}>
      <p className="text-2xl font-black">{value}</p>
      <p className="text-xs font-bold uppercase tracking-wide opacity-75">{label}</p>
    </div>
  );
}

function accountRoleLabel(role?: Role) {
  if (role === Role.CLIENTE) return "Cliente";
  if (role === Role.ADMIN) return "Administrador";
  if (role === Role.FUNCIONARIO) return "Funcionário";
  return role ?? "-";
}

function initials(name: string) {
  return name
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part.charAt(0).toUpperCase())
    .join("");
}
