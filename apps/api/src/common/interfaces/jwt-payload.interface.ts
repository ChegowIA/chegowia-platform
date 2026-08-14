import { Role } from "@prisma/client";
import type { Request } from "express";

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
}

export interface AuthenticatedRequest extends Request {
  user: JwtPayload;
}
