import request from "supertest";
import { Role, SubscriptionStatus } from "@prisma/client";
import { MailService } from "../src/common/mail/mail.service";
import { Harness, createHarness } from "./harness";
import { createCompany, createCustomer } from "./fixtures";

describe("unidades: criação, acesso e vitrine privada (e2e)", () => {
  let harness: Harness;
  let invite: jest.SpyInstance;
  let mfaMail: jest.SpyInstance;

  beforeEach(async () => {
    harness = await createHarness();
    const mail = harness.app.get(MailService);
    invite = jest.spyOn(mail, "sendUnitAdminInvite").mockResolvedValue(undefined);
    mfaMail = jest.spyOn(mail, "sendMfaCode").mockResolvedValue(undefined);
    await harness.reset();
    await harness.prisma.postalCodeLocation.upsert({
      where: { zipCode: "30130000" },
      create: { zipCode: "30130000", latitude: -19.9227, longitude: -43.9451 },
      update: { latitude: -19.9227, longitude: -43.9451 },
    });
  });

  afterEach(async () => {
    invite?.mockRestore();
    mfaMail?.mockRestore();
    await harness?.close();
  });

  async function prepareRoot(seed: string) {
    const root = await createCompany(harness.prisma, seed);
    const plan = await harness.prisma.softwarePlan.findFirstOrThrow({ where: { isActive: true } });
    await harness.prisma.clientSubscription.create({
      data: { companyId: root.id, planId: plan.id, status: SubscriptionStatus.ATIVA,
        currentPeriodStart: new Date(), currentPeriodEnd: new Date(Date.now() + 86400000) },
    });
    return root;
  }

  function payload(adminEmail: string) {
    return { name: `Loja ${adminEmail.split("@")[0]}`, cnpj: "11222333000181",
      phone: "31999999999", addressLine: "Av. Afonso Pena, 1000", city: "Belo Horizonte",
      state: "MG", zipCode: "30130000", adminName: "Gestor Local", adminEmail };
  }

  it("cria tenant e cobrança separados; titular troca de painel, gestor local ativa senha e usa MFA", async () => {
    const root = await prepareRoot("matriz-unit");
    const ownerToken = harness.tokenFor(root.admin);
    const created = await request(harness.app.getHttpServer())
      .post("/api/companies/my-units").set("Authorization", `Bearer ${ownerToken}`)
      .send(payload("local-unit@e2e.local")).expect(201);
    const branchId = created.body.id as string;

    const branch = await harness.prisma.company.findUniqueOrThrow({ where: { id: branchId }, include: { subscription: true } });
    expect(branch).toMatchObject({ ownerUserId: root.admin.id, cnpj: "11222333000181", isPublished: false, isTestOnly: false });
    expect(branch.subscription).toMatchObject({ status: SubscriptionStatus.EM_TESTE, asaasCustomerId: null, asaasSubscriptionId: null });
    expect(await harness.prisma.product.count({ where: { companyId: branchId } })).toBe(0);
    expect(await harness.prisma.user.count({ where: { companyId: branchId, role: Role.ADMIN } })).toBe(1);
    expect(invite).toHaveBeenCalledWith("local-unit@e2e.local", "Gestor Local", branch.name, expect.any(String));

    const switched = await request(harness.app.getHttpServer())
      .post("/api/auth/my-companies/switch").set("Authorization", `Bearer ${ownerToken}`)
      .send({ companyId: branchId }).expect(200);
    expect(switched.body.user.companyId).toBe(branchId);
    const ownerBranch = await request(harness.app.getHttpServer())
      .get("/api/companies/me").set("Authorization", `Bearer ${switched.body.accessToken}`).expect(200);
    expect(ownerBranch.body.id).toBe(branchId);

    const invitationToken = invite.mock.calls[0][3] as string;
    await request(harness.app.getHttpServer()).post("/api/auth/reset-password")
      .send({ token: invitationToken, password: "SenhaLocal@2026", confirmPassword: "SenhaLocal@2026" }).expect(200);
    const challenge = await request(harness.app.getHttpServer()).post("/api/auth/login")
      .send({ email: "local-unit@e2e.local", password: "SenhaLocal@2026" }).expect(200);
    expect(challenge.body.mfaRequired).toBe(true);
    const code = mfaMail.mock.calls[0][2] as string;
    const localSession = await request(harness.app.getHttpServer()).post("/api/auth/mfa/verify")
      .send({ challengeId: challenge.body.challengeId, code }).expect(200);
    expect(localSession.body.user.companyId).toBe(branchId);
    await request(harness.app.getHttpServer()).post("/api/auth/my-companies/switch")
      .set("Authorization", `Bearer ${localSession.body.accessToken}`)
      .send({ companyId: root.id }).expect(404);

    // Um CNPJ repetido não autoriza outra loja física, nem um segundo titular.
    await request(harness.app.getHttpServer()).post("/api/companies/my-units")
      .set("Authorization", `Bearer ${ownerToken}`)
      .send({ ...payload("outro-unit@e2e.local"), shareCnpj: true, addressLine: "Outra rua, 200" }).expect(409);
    const sameAddress = await request(harness.app.getHttpServer()).post("/api/companies/my-units")
      .set("Authorization", `Bearer ${ownerToken}`)
      .send({ ...payload("outro-unit@e2e.local"), shareCnpj: true }).expect(201);
    expect(sameAddress.body.id).not.toBe(branchId);
  });

  it("filial demo permanece invisível a outros clientes e aparece só ao e-mail autorizado no raio", async () => {
    const root = await prepareRoot("demo-unit");
    await harness.prisma.company.update({ where: { id: root.id }, data: {
      slug: "operacao-demo-chegowia", isTestOnly: true, ownerUserId: root.admin.id,
    } });
    const target = await createCustomer(harness.prisma, "target-unit");
    await harness.prisma.user.update({ where: { id: target.id }, data: { email: "thiagolpssouza@gmail.com" } });
    const outsider = await createCustomer(harness.prisma, "outsider-unit");
    const ownerToken = harness.tokenFor(root.admin);
    const created = await request(harness.app.getHttpServer())
      .post("/api/companies/my-units").set("Authorization", `Bearer ${ownerToken}`)
      .send({ ...payload("demo-local@e2e.local"), cnpj: "" }).expect(201);
    const branchId = created.body.id as string;
    const branch = await harness.prisma.company.findUniqueOrThrow({ where: { id: branchId }, include: { subscription: true } });
    expect(branch).toMatchObject({ isTestOnly: true, demoRootCompanyId: root.id, isPublished: false });
    expect(branch.subscription).toMatchObject({ status: SubscriptionStatus.ATIVA, asaasCustomerId: null, asaasSubscriptionId: null });

    await harness.prisma.company.update({ where: { id: branchId }, data: {
      latitude: -19.9227, longitude: -43.9451, locationConfirmedAt: new Date(),
    } });
    const category = await harness.prisma.category.create({ data: { companyId: branchId, name: "Pizzas", isActive: true } });
    await harness.prisma.product.create({ data: { companyId: branchId, categoryId: category.id,
      name: "Pizza da demo", price: 40, isActive: true } });
    const publication = await request(harness.app.getHttpServer()).patch(`/api/companies/my-units/${branchId}/publication`)
      .set("Authorization", `Bearer ${ownerToken}`).send({ published: true });
    expect({ status: publication.status, body: publication.body }).toEqual({ status: 200, body: { id: branchId, isPublished: true } });

    const authorized = await request(harness.app.getHttpServer()).get("/api/companies/public")
      .set("Authorization", `Bearer ${harness.tokenFor({ ...target, email: "thiagolpssouza@gmail.com" })}`).expect(200);
    expect(authorized.body.some((company: { id: string }) => company.id === branchId)).toBe(true);
    await request(harness.app.getHttpServer()).get(`/api/catalog/public/${branch.slug}`)
      .set("Authorization", `Bearer ${harness.tokenFor({ ...target, email: "thiagolpssouza@gmail.com" })}`).expect(200);
    const anonymous = await request(harness.app.getHttpServer()).get("/api/companies/public").expect(200);
    expect(anonymous.body.some((company: { id: string }) => company.id === branchId)).toBe(false);
    const other = await request(harness.app.getHttpServer()).get("/api/companies/public")
      .set("Authorization", `Bearer ${harness.tokenFor(outsider)}`).expect(200);
    expect(other.body.some((company: { id: string }) => company.id === branchId)).toBe(false);
    await request(harness.app.getHttpServer()).get(`/api/catalog/public/${branch.slug}`).expect(404);
    await request(harness.app.getHttpServer()).get(`/api/catalog/public/${branch.slug}`)
      .set("Authorization", `Bearer ${harness.tokenFor(outsider)}`).expect(404);

    // Mesmo a conta autorizada deixa de vê-la quando o endereço salvo sai do raio.
    await harness.prisma.postalCodeLocation.upsert({ where: { zipCode: "22290030" },
      create: { zipCode: "22290030", latitude: -22.9510, longitude: -43.1822 },
      update: { latitude: -22.9510, longitude: -43.1822 } });
    await harness.prisma.address.updateMany({ where: { userId: target.id },
      data: { zipCode: "22290030", city: "Rio de Janeiro", state: "RJ" } });
    const distant = await request(harness.app.getHttpServer()).get("/api/companies/public")
      .set("Authorization", `Bearer ${harness.tokenFor({ ...target, email: "thiagolpssouza@gmail.com" })}`).expect(200);
    expect(distant.body.some((company: { id: string }) => company.id === branchId)).toBe(false);
  });
});
