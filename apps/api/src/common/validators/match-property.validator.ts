import { registerDecorator, ValidationArguments, ValidationOptions } from "class-validator";

export function MatchesProperty(property: string, validationOptions?: ValidationOptions) {
  return (object: object, propertyName: string) => {
    registerDecorator({
      name: "matchesProperty",
      target: object.constructor,
      propertyName,
      constraints: [property],
      options: {
        message: "A confirmação de senha não corresponde à senha informada.",
        ...validationOptions,
      },
      validator: {
        validate(value: unknown, args: ValidationArguments) {
          return value === (args.object as Record<string, unknown>)[args.constraints[0]];
        },
      },
    });
  };
}
