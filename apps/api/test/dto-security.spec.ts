import { plainToInstance } from "class-transformer";
import { validate } from "class-validator";
import { DeliveryProblemReason, DeliveryStatus } from "@prisma/client";
import { RegisterCustomerDto } from "../src/auth/dto/register-customer.dto";
import { LoginDto } from "../src/auth/dto/login.dto";
import { validationMessages } from "../src/common/validation/validation-errors";
import { UpdateDeliveryStatusDto } from "../src/deliveries/dto/update-delivery-status.dto";
import { ConnectWhatsAppGupshupDto } from "../src/messaging/dto/connect-whatsapp-gupshup.dto";

describe("DTOs críticos", () => {
  it("exige motivo ao marcar uma entrega como problema", async () => {
    const dto = plainToInstance(UpdateDeliveryStatusDto, {
      status: DeliveryStatus.PROBLEMA,
    });
    const errors = await validate(dto);
    expect(errors.some((error) => error.property === "problemReason")).toBe(true);
  });

  it("aceita um motivo de incidente conhecido", async () => {
    const dto = plainToInstance(UpdateDeliveryStatusDto, {
      status: DeliveryStatus.PROBLEMA,
      problemReason: DeliveryProblemReason.CLIENTE_NAO_ATENDEU,
    });
    expect(await validate(dto)).toHaveLength(0);
  });

  it("recusa senha fraca, confirmação divergente e consentimento ausente", async () => {
    const dto = plainToInstance(RegisterCustomerDto, {
      name: "Cliente",
      email: "cliente@example.com",
      password: "fraca",
      confirmPassword: "outra",
      street: "Rua Um",
      number: "1",
      neighborhood: "Centro",
      city: "Goiânia",
      state: "GO",
      acceptTerms: false,
      acceptPrivacy: false,
    });
    const errors = await validate(dto);
    expect(errors.map((error) => error.property)).toEqual(expect.arrayContaining([
      "password",
      "confirmPassword",
      "acceptTerms",
      "acceptPrivacy",
    ]));
  });

  it("recusa e-mail fora do padrão com mensagem em português", async () => {
    const dto = plainToInstance(LoginDto, {
      email: "email-invalido",
      password: "Senha@123",
    });
    const errors = await validate(dto);
    expect(validationMessages(errors)).toContain("Informe um e-mail válido.");
    expect(validationMessages(errors).join(" ")).not.toMatch(/must|invalid|required/i);
  });

  it("recusa nome de aplicativo do Gupshup com caractere fora do permitido", async () => {
    // O nome vai na URL do callback e identifica o canal: aceitar espaço ou
    // acento produziria vínculo que o webhook nunca encontra.
    const valid = plainToInstance(ConnectWhatsAppGupshupDto, { appName: "chegowia_empresa-1" });
    expect(await validate(valid)).toHaveLength(0);

    const invalid = plainToInstance(ConnectWhatsAppGupshupDto, { appName: "chegowia empresa" });
    expect((await validate(invalid)).some((error) => error.property === "appName")).toBe(true);
  });

  it("exige protocolo no link de cadastro do cliente", async () => {
    const dto = plainToInstance(ConnectWhatsAppGupshupDto, {
      appName: "chegowia1",
      signupLink: "chegowia.com.br/cadastro",
    });
    expect((await validate(dto)).some((error) => error.property === "signupLink")).toBe(true);
  });
});
