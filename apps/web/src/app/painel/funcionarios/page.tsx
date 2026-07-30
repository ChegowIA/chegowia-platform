"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { DEFAULT_PERMISSIONS_BY_ROLE, PERMISSION_LABELS, ROLE_LABELS, Role } from "@chegowia/shared";
import { api, apiErrorMessage } from "@/lib/api-client";
import { Employee, PermissionCatalogItem } from "@/lib/types";
import { formatDateTime } from "@/lib/format";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { FormField, Input, Select } from "@/components/ui/input";
import { Modal } from "@/components/ui/modal";
import { Badge } from "@/components/ui/badge";
import { Table } from "@/components/ui/table";

const INTERNAL_ROLES = [Role.FUNCIONARIO, Role.COZINHA, Role.MOTOBOY];

export default function FuncionariosPage() {
  const queryClient = useQueryClient();
  const [error, setError] = useState<string | null>(null);

  const [createModalOpen, setCreateModalOpen] = useState(false);
  const [createForm, setCreateForm] = useState({
    name: "",
    email: "",
    password: "",
    role: Role.FUNCIONARIO as string,
    position: "",
  });
  const [createPermissions, setCreatePermissions] = useState<string[]>(
    DEFAULT_PERMISSIONS_BY_ROLE[Role.FUNCIONARIO] ?? [],
  );

  const [editingEmployee, setEditingEmployee] = useState<Employee | null>(null);
  const [editForm, setEditForm] = useState({ name: "", position: "", isActive: true });

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
    setCreateForm({ name: "", email: "", password: "", role: Role.FUNCIONARIO, position: "" });
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
        role: createForm.role,
        position: createForm.position || undefined,
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
    setEditForm({ name: employee.user.name, position: employee.position ?? "", isActive: employee.user.isActive });
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
        <Button onClick={openCreateModal}>Novo funcionário</Button>
      </div>

      {error && <p className="rounded-lg bg-red-50 px-4 py-2 text-sm text-red-600 dark:bg-red-900/20">{error}</p>}

      <Card>
        {isLoading ? (
          <p className="px-5 py-8 text-center text-sm text-slate-500">Carregando...</p>
        ) : (
          <Table
            columns={[
              { header: "Nome", render: (e: Employee) => e.user.name },
              { header: "E-mail", render: (e: Employee) => e.user.email },
              { header: "Cargo", render: (e: Employee) => e.position ?? "-" },
              { header: "Papel", render: (e: Employee) => ROLE_LABELS[e.user.role] ?? e.user.role },
              {
                header: "Status",
                render: (e: Employee) => (
                  <Badge tone={e.user.isActive ? "success" : "neutral"}>{e.user.isActive ? "Ativo" : "Inativo"}</Badge>
                ),
              },
              { header: "Desde", render: (e: Employee) => formatDateTime(e.createdAt) },
              {
                header: "",
                render: (e: Employee) => (
                  <div className="flex gap-2">
                    <button className="font-medium text-brand-600 hover:underline" onClick={() => openEditModal(e)}>
                      Editar
                    </button>
                    <button
                      className="font-medium text-slate-500 hover:underline"
                      onClick={() => openPermissionsModal(e)}
                    >
                      Permissões
                    </button>
                  </div>
                ),
              },
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
              value={createForm.password}
              onChange={(e) => setCreateForm((f) => ({ ...f, password: e.target.value }))}
            />
          </FormField>
          <FormField label="Papel">
            <Select value={createForm.role} onChange={(e) => handleRoleChange(e.target.value)}>
              {INTERNAL_ROLES.map((r) => (
                <option key={r} value={r}>
                  {ROLE_LABELS[r]}
                </option>
              ))}
            </Select>
          </FormField>
          <FormField label="Cargo (opcional)">
            <Input
              value={createForm.position}
              onChange={(e) => setCreateForm((f) => ({ ...f, position: e.target.value }))}
            />
          </FormField>
          <div>
            <p className="mb-2 text-sm font-medium text-slate-700 dark:text-slate-300">Permissões</p>
            <div className="space-y-1">
              {permissionCatalog?.map((p) => (
                <label key={p.key} className="flex items-center gap-2 text-sm text-slate-700 dark:text-slate-300">
                  <input
                    type="checkbox"
                    checked={createPermissions.includes(p.key)}
                    onChange={() => togglePermission(createPermissions, setCreatePermissions, p.key)}
                  />
                  {PERMISSION_LABELS[p.key as keyof typeof PERMISSION_LABELS] ?? p.description}
                </label>
              ))}
            </div>
          </div>
          <Button
            className="w-full"
            disabled={!createForm.name || !createForm.email || createForm.password.length < 6}
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
            <Input
              value={editForm.position}
              onChange={(e) => setEditForm((f) => ({ ...f, position: e.target.value }))}
            />
          </FormField>
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
        title={`Permissões de ${permissionsEmployee?.user.name ?? ""}`}
      >
        <div className="space-y-4">
          <div className="space-y-1">
            {permissionCatalog?.map((p) => (
              <label key={p.key} className="flex items-center gap-2 text-sm text-slate-700 dark:text-slate-300">
                <input
                  type="checkbox"
                  checked={permissionsDraft.includes(p.key)}
                  onChange={() => togglePermission(permissionsDraft, setPermissionsDraft, p.key)}
                />
                {PERMISSION_LABELS[p.key as keyof typeof PERMISSION_LABELS] ?? p.description}
              </label>
            ))}
          </div>
          <Button className="w-full" isLoading={savePermissions.isPending} onClick={() => savePermissions.mutate()}>
            Salvar permissões
          </Button>
        </div>
      </Modal>
    </div>
  );
}
