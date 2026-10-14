import { registerDecorator, ValidationArguments, ValidationOptions } from "class-validator";

export function normalizeBrazilDocument(value: string): string {
  return String(value ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");
}

function hasRepeatedDigits(value: string): boolean {
  return /^(\d)\1+$/.test(value);
}

function validCpf(value: string): boolean {
  if (!/^\d{11}$/.test(value) || hasRepeatedDigits(value)) return false;
  for (let position = 9; position <= 10; position += 1) {
    let sum = 0;
    for (let index = 0; index < position; index += 1) {
      sum += Number(value[index]) * (position + 1 - index);
    }
    const digit = ((sum * 10) % 11) % 10;
    if (digit !== Number(value[position])) return false;
  }
  return true;
}

function validCnpj(value: string): boolean {
  if (!/^[A-Z0-9]{12}\d{2}$/.test(value) || hasRepeatedDigits(value)) return false;
  const calculate = (length: number) => {
    const weights = length === 12
      ? [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]
      : [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
    const sum = value.slice(0, length).split("").reduce((total, char, index) => total + (char.charCodeAt(0) - 48) * weights[index], 0);
    const remainder = sum % 11;
    return remainder < 2 ? 0 : 11 - remainder;
  };
  return calculate(12) === Number(value[12]) && calculate(13) === Number(value[13]);
}

export function isValidBrazilDocument(value: string): boolean {
  const normalized = normalizeBrazilDocument(value);
  return validCpf(normalized) || validCnpj(normalized);
}

export function IsBrazilDocument(validationOptions?: ValidationOptions) {
  return (object: object, propertyName: string) => {
    registerDecorator({
      name: "isBrazilDocument",
      target: object.constructor,
      propertyName,
      options: {
        message: "Informe um CPF ou CNPJ válido.",
        ...validationOptions,
      },
      validator: {
        validate(value: unknown, _args: ValidationArguments) {
          return typeof value === "string" && isValidBrazilDocument(value);
        },
      },
    });
  };
}

export function IsCnpj(validationOptions?: ValidationOptions) {
  return (object: object, propertyName: string) => {
    registerDecorator({
      name: "isCnpj",
      target: object.constructor,
      propertyName,
      options: {
        message: "Informe um CNPJ válido.",
        ...validationOptions,
      },
      validator: {
        validate(value: unknown) {
          return typeof value === "string" && validCnpj(normalizeBrazilDocument(value));
        },
      },
    });
  };
}
