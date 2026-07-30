import { Role } from "@prisma/client";
import type { Request } from "express";

export interface JwtPayload {
  sub: string;
  email: string;
  role: Role;
  companyId: string | null;
}

export interface AuthenticatedRequest extends Request {
  user: JwtPayload;
}
