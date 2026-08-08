"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  DEFAULT_PERMISSIONS_BY_ROLE,
  PERMISSION_LABELS,
  PERMISSION_SECTIONS,
  PermissionKey,
  ROLE_LABELS,
  Role,
} from "@chegowia/shared";
import { api, apiErrorMessage } from "@/lib/api-client";
import { useAuthStore } from "@/lib/auth-store";
import { Employee, PermissionCatalogItem } from "@/lib/types";
import { formatDateTime } from "@/lib/format";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { FormField, Input, Select } from "@/components/ui/input";
import { Modal } from "@/components/ui/modal";
import { Badge } from "@/components/ui/badge";
import { Table } from "@/components/ui/table";

const INTERNAL_ROLES = [Role.FUNCIONARIO, Role.COZINHA, Role.MOTOBOY, Role.GARCOM];

export default function FuncionariosPage() {
  const queryClient = useQueryClient();
  const user = useAuthStore((state) => state.user);
  const canManageEmployees = user?.role === Role.ADMIN || user?.permissionKeys?.includes(PermissionKey.FUNCIONARIOS_EDITAR);
  const [error, setError] = useState<string | null>(null);

  const [createModalOpen, setCreateModalOpen] = useState(false);
  const [createForm, setCreateForm] = useState({
    name: "",
    email: "",
    password: "",
    confirmPassword: "",
    role: Role.FUNCIONARIO as string,
  });
  const [createPermissions, setCreatePermissions] = useState<string[]>(
    DEFAULT_PERMISSIONS_BY_ROLE[Role.FUNCIONARIO] ?? [],
  );

  const [editingEmployee, setEditingEmployee] = useState<Employee | null>(null);
  const [editForm, setEditForm] = useState({ name: "", role: Role.FUNCIONARIO as string, isActive: true });

  const [permissionsEmployee, setPermissionsEmployee] = useState<Employee | null>(null);
  const [permissionsDraft, setPermissionsDraft] = useState<string[]>([]);

  const { data: employees, isLoading } = useQuery({
    queryKey: ["employees"],
    queryFn: async () => {
      const { data } = await api.get<Employee[]>("/employees");
      return data;
    },
  });

  const { data: permissionCatalog } = useQuery({
    queryKey: ["permissions-catalog"],
    queryFn: async () => {
      const { data } = await api.get<PermissionCatalogItem[]>("/permissions");
      return data;
    },
  });

  function openCreateModal() {
    setCreateForm({ name: "", email: "", password: "", confirmPassword: "", role: Role.FUNCIONARIO });
    setCreatePermissions(DEFAULT_PERMISSIONS_BY_ROLE[Role.FUNCIONARIO] ?? []);
    setCreateModalOpen(true);
  }

  function handleRoleChange(role: string) {
    setCreateForm((f) => ({ ...f, role }));
    setCreatePermissions(DEFAULT_PERMISSIONS_BY_ROLE[role] ?? []);
  }

  function togglePermission(list: string[], setList: (v: string[]) => void, key: string) {
    setList(list.includes(key) ? list.filter((k) => k !== key) : [...list, key]);
  }

  const createEmployee = useMutation({
    mutationFn: async () => {
      const { data } = await api.post("/employees", {
        name: createForm.name,
        email: createForm.email,
        password: createForm.password,
        confirmPassword: createForm.confirmPassword,
        role: createForm.role,
        permissionKeys: createPermissions,
      });
      return data;
    },
    onSuccess: () => {
      setError(null);
      setCreateModalOpen(false);
      queryClient.invalidateQueries({ queryKey: ["employees"] });
    },
    onError: (err) => setError(apiErrorMessage(err)),
  });

  function openEditModal(employee: Employee) {
    setEditingEmployee(employee);
    setEditForm({ name: employee.user.name, role: employee.user.role, isActive: employee.user.isActive });
  }

  const saveEdit = useMutation({
    mutationFn: async () => {
      if (!editingEmployee) return;
      const { data } = await api.patch(`/employees/${editingEmployee.id}`, editForm);
      return data;
    },
    onSuccess: () => {
      setError(null);
      setEditingEmployee(null);
      queryClient.invalidateQueries({ queryKey: ["employees"] });
    },
    onError: (err) => setError(apiErrorMessage(err)),
  });

  function openPermissionsModal(employee: Employee) {
    setPermissionsEmployee(employee);
    setPermissionsDraft(employee.rolePermissions.map((rp) => rp.permission.key));
  }

  const savePermissions = useMutation({
    mutationFn: async () => {
      if (!permissionsEmployee) return;
      const { data } = await api.patch(`/employees/${permissionsEmployee.id}/permissions`, {
        permissionKeys: permissionsDraft,
      });
      return data;
    },
    onSuccess: () => {
      setError(null);
      setPermissionsEmployee(null);
      queryClient.invalidateQueries({ queryKey: ["employees"] });
    },
    onError: (err) => setError(apiErrorMessage(err)),
  });

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-slate-900 dark:text-slate-50">Funcionários</h1>
        {canManageEmployees && <Button onClick={openCreateModal}>Novo funcionário</Button>}
      </div>

      {error && <p className="rounded-lg bg-red-50 px-4 py-2 text-sm text-red-600 dark:bg-red-900/20 dark:text-red-400">{error}</p>}

      <Card>
        {isLoading ? (
          <p className="px-5 py-8 text-center text-sm text-slate-500 dark:text-slate-400">Carregando...</p>
        ) : (
          <Table
            columns={[
              { header: "Nome", render: (e: Employee) => e.user.name },
              { header: "E-mail", render: (e: Employee) => e.user.email },
              { header: "Cargo", render: (e: Employee) => ROLE_LABELS[e.user.role] ?? e.user.role },
              {
                header: "Acessos",
                render: (e: Employee) => (
                  <span className="text-sm text-slate-500 dark:text-slate-400">{e.rolePermissions.length} liberado{e.rolePermissions.length === 1 ? "" : "s"}</span>
                ),
              },
              {
                header: "Status",
                render: (e: Employee) => (
                  <Badge tone={e.user.isActive ? "success" : "neutral"}>{e.user.isActive ? "Ativo" : "Inativo"}</Badge>
                ),
              },
              { header: "Desde", render: (e: Employee) => formatDateTime(e.createdAt) },
              ...(canManageEmployees
                ? [{
                  header: "",
                  render: (e: Employee) => (
                    <div className="flex gap-2">
                      <button className="font-medium text-brand-600 hover:underline" onClick={() => openEditModal(e)}>
                        Editar
                      </button>
                      <button
                        className="font-medium text-slate-500 hover:underline dark:text-slate-400"
                        onClick={() => openPermissionsModal(e)}
                      >
                        Liberar acessos
                      </button>
                    </div>
                  ),
                }]
                : []),
            ]}
            rows={employees ?? []}
            rowKey={(e) => e.id}
          />
        )}
      </Card>

      <Modal open={createModalOpen} onClose={() => setCreateModalOpen(false)} title="Novo funcionário">
        <div className="max-h-[70vh] space-y-4 overflow-y-auto pr-1">
          <FormField label="Nome">
            <Input value={createForm.name} onChange={(e) => setCreateForm((f) => ({ ...f, name: e.target.value }))} />
          </FormField>
          <FormField label="E-mail">
            <Input
              type="email"
              value={createForm.email}
              onChange={(e) => setCreateForm((f) => ({ ...f, email: e.target.value }))}
            />
          </FormField>
          <FormField label="Senha">
            <Input
              type="password"
              minLength={8}
              pattern="(?=.*[a-z])(?=.*[A-Z])(?=.*[^A-Za-z0-9\s]).{8,}"
              title="Use ao menos 8 caracteres, uma letra maiúscula, uma minúscula e um símbolo."
              value={createForm.password}
              onChange={(e) => setCreateForm((f) => ({ ...f, password: e.target.value }))}
            />
            <p className="text-xs leading-5 text-slate-400">Mínimo de 8 caracteres, com maiúscula, minúscula e símbolo.</p>
          </FormField>
          <FormField label="Confirmar senha">
            <Input
              type="password"
              value={createForm.confirmPassword}
              onChange={(e) => setCreateForm((f) => ({ ...f, confirmPassword: e.target.value }))}
            />
            {createForm.confirmPassword && createForm.password !== createForm.confirmPassword && <p className="text-xs font-bold text-rose-600 dark:text-rose-400">As senhas não coincidem.</p>}
          </FormField>
          <FormField label="Cargo">
            <Select value={createForm.role} onChange={(e) => handleRoleChange(e.target.value)}>
              {INTERNAL_ROLES.map((r) => (
                <option key={r} value={r}>
                  {ROLE_LABELS[r]}
                </option>
              ))}
            </Select>
          </FormField>
          <div className="rounded-2xl border border-brand-100 bg-brand-50/60 p-3 text-xs leading-5 text-slate-600 dark:border-brand-900/60 dark:bg-brand-950/30 dark:text-slate-300">
            Selecionamos os acessos mais usados para <b>{ROLE_LABELS[createForm.role as Role] ?? "este cargo"}</b>. Ajuste abaixo se quiser liberar mais ferramentas; o que não estiver marcado fica bloqueado no painel e na API.
          </div>
          <AccessSelector
            permissionCatalog={permissionCatalog}
            selected={createPermissions}
            onToggle={(key) => togglePermission(createPermissions, setCreatePermissions, key)}
          />
          <Button
            className="w-full"
            disabled={!createForm.name || !createForm.email || !/^(?=.*[a-z])(?=.*[A-Z])(?=.*[^A-Za-z0-9\s]).{8,}$/.test(createForm.password) || createForm.password !== createForm.confirmPassword}
            isLoading={createEmployee.isPending}
            onClick={() => createEmployee.mutate()}
          >
            Criar funcionário
          </Button>
        </div>
      </Modal>

      <Modal open={!!editingEmployee} onClose={() => setEditingEmployee(null)} title="Editar funcionário">
        <div className="space-y-4">
          <FormField label="Nome">
            <Input value={editForm.name} onChange={(e) => setEditForm((f) => ({ ...f, name: e.target.value }))} />
          </FormField>
          <FormField label="Cargo">
            <Select value={editForm.role} onChange={(e) => setEditForm((f) => ({ ...f, role: e.target.value }))}>
              {INTERNAL_ROLES.map((role) => (
                <option key={role} value={role}>{ROLE_LABELS[role]}</option>
              ))}
            </Select>
          </FormField>
          <p className="-mt-2 rounded-xl bg-brand-50 px-3 py-2 text-xs leading-5 text-brand-900 dark:bg-brand-950/30 dark:text-brand-200">Ao trocar o cargo, os acessos voltam ao padrão dele. Depois, use <b>Liberar acessos</b> na listagem para habilitar somente as ações extras que esta pessoa precisar.</p>
          <label className="flex items-center gap-2 text-sm text-slate-700 dark:text-slate-300">
            <input
              type="checkbox"
              checked={editForm.isActive}
              onChange={(e) => setEditForm((f) => ({ ...f, isActive: e.target.checked }))}
            />
            Funcionário ativo
          </label>
          <Button className="w-full" isLoading={saveEdit.isPending} onClick={() => saveEdit.mutate()}>
            Salvar
          </Button>
        </div>
      </Modal>

      <Modal
        open={!!permissionsEmployee}
        onClose={() => setPermissionsEmployee(null)}
        title={`Liberar acessos · ${permissionsEmployee?.user.name ?? ""}`}
      >
        <div className="space-y-4">
          <p className="text-sm leading-6 text-slate-500 dark:text-slate-400">Marque as ações que esta pessoa pode usar. As demais ficam indisponíveis no painel e bloqueadas pela API.</p>
          <button
            type="button"
            className="text-xs font-black text-brand-700 hover:underline dark:text-brand-300"
            onClick={() => setPermissionsDraft(DEFAULT_PERMISSIONS_BY_ROLE[permissionsEmployee?.user.role ?? ""] ?? [])}
          >
            Restaurar acessos padrão do papel
          </button>
          <AccessSelector
            permissionCatalog={permissionCatalog}
            selected={permissionsDraft}
            onToggle={(key) => togglePermission(permissionsDraft, setPermissionsDraft, key)}
          />
          <Button className="w-full" isLoading={savePermissions.isPending} onClick={() => savePermissions.mutate()}>
            Salvar acessos
          </Button>
        </div>
      </Modal>
    </div>
  );
}

function AccessSelector({
  permissionCatalog,
  selected,
  onToggle,
}: {
  permissionCatalog?: PermissionCatalogItem[];
  selected: string[];
  onToggle: (key: string) => void;
}) {
  const catalogByKey = new Map((permissionCatalog ?? []).map((permission) => [permission.key, permission]));

  return (
    <div className="space-y-3">
      {PERMISSION_SECTIONS.map((section) => {
        const permissions = section.keys
          .map((key) => catalogByKey.get(key))
          .filter((permission): permission is PermissionCatalogItem => Boolean(permission));
        if (!permissions.length) return null;

        return (
          <section key={section.title} className="rounded-2xl border border-slate-200 bg-slate-50/70 p-3 dark:border-slate-800 dark:bg-slate-800/40">
            <p className="text-sm font-black text-slate-800 dark:text-slate-100">{section.title}</p>
            <p className="mt-0.5 text-xs leading-5 text-slate-500 dark:text-slate-400">{section.description}</p>
            <div className="mt-2 space-y-2">
              {permissions.map((permission) => (
                <label key={permission.key} className="flex cursor-pointer items-center gap-2 text-sm text-slate-700 dark:text-slate-300">
                  <input
                    type="checkbox"
                    checked={selected.includes(permission.key)}
                    onChange={() => onToggle(permission.key)}
                  />
                  {PERMISSION_LABELS[permission.key as keyof typeof PERMISSION_LABELS] ?? permission.description}
                </label>
              ))}
            </div>
          </section>
        );
      })}
    </div>
  );
}
