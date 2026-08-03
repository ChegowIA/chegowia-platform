import { Matches, MinLength } from "class-validator";

export const STRONG_PASSWORD_MESSAGE =
  "A senha deve ter no mínimo 8 caracteres, incluindo uma letra maiúscula, uma minúscula e um símbolo.";

export function IsStrongPassword() {
  return function (target: object, propertyKey: string) {
    MinLength(8, { message: STRONG_PASSWORD_MESSAGE })(target, propertyKey);
    Matches(/^(?=.*[a-z])(?=.*[A-Z])(?=.*[^A-Za-z0-9\s]).{8,}$/, {
      message: STRONG_PASSWORD_MESSAGE,
    })(target, propertyKey);
  };
}
