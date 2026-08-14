import { Role } from "@prisma/client";
import type { Request } from "express";

export type SuperAdminSupportAccessKind = "COMPANY" | "RESELLER";

export interface JwtPayload {
  sub: string;
  email: string;
  role: Role;
  companyId: string | null;
  /**
   * Marca um token em que o superadmin multiacesso assumiu outro papel/empresa.
   * `role` e `companyId` passam a ser os do contexto assumido, enquanto `sub`
   * continua sendo o usuário real — é o que permite auditar quem agiu.
   *
   * O AccountStatusGuard valida estes tokens por um caminho próprio, já que a
   * comparação estrita com o papel do banco falharia por definição.
   */
  assumed?: true;
  /** ID auditável do atalho de suporte que abriu este contexto, quando houver. */
  assumedAccessId?: string;
  /** Qual registro de auditoria valida a sessão assumida. */
  assumedAccessKind?: SuperAdminSupportAccessKind;
  /** Usuário efetivo apenas na visão de revendedor; `sub` continua sendo o ator real. */
  assumedUserId?: string;
  /** Perfil de revendedor efetivo apenas na visão de suporte de parceiro. */
  assumedResellerId?: string;
}

export interface AuthenticatedRequest extends Request {
  user: JwtPayload;
}
