import { Injectable } from "@nestjs/common";
import { JwtPayload } from "../interfaces/jwt-payload.interface";

/**
 * Regra de transição após encerrar a homologação fechada.
 *
 * Empresas históricas marcadas como `isTestOnly` nunca são promovidas pela
 * simples remoção do modo temporário. A promoção ou remoção deve ser feita
 * conscientemente pelo superadministrador depois da revisão individual.
 */
@Injectable()
export class LegacyTestDataService {
  publicCompanyVisibilityWhere(_viewer?: JwtPayload | null) {
    return { isTestOnly: false };
  }

  publicCompanyVisibilityWhereForUserId(_userId?: string | null) {
    return { isTestOnly: false };
  }
}
