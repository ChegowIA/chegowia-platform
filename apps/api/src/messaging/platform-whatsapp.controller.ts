import { BadRequestException, Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, Patch, Post, Put, Query, UploadedFile, UseInterceptors } from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import { ApiTags } from "@nestjs/swagger";
import { Throttle } from "@nestjs/throttler";
import { Role } from "@prisma/client";
import { CurrentUser } from "../common/decorators/current-user.decorator";
import { Roles } from "../common/decorators/roles.decorator";
import { ConnectWhatsAppGupshupDto } from "./dto/connect-whatsapp-gupshup.dto";
import { UpdateWhatsAppProfileDto } from "./dto/update-whatsapp-profile.dto";
import { SendWhatsAppMessageDto } from "./dto/send-whatsapp-message.dto";
import { UpdatePlatformWhatsAppAutomationDto } from "./dto/update-platform-whatsapp-automation.dto";
import { UpdatePlatformWhatsAppConversationDto } from "./dto/update-platform-whatsapp-conversation.dto";
import { UpdatePlatformOutreachTemplateDto } from "./dto/update-platform-outreach-template.dto";
import { StartPlatformConversationDto } from "./dto/start-platform-conversation.dto";
import { CreateOutreachCampaignDto } from "./dto/create-outreach-campaign.dto";
import { AnalyzeOutreachListDto } from "./dto/analyze-outreach-list.dto";
import { BlockOutreachPhoneDto } from "./dto/block-outreach-phone.dto";
import { PlatformWhatsAppService } from "./platform-whatsapp.service";
import { PlatformOutreachService } from "./platform-outreach.service";
import { OutreachIntelligenceService } from "./outreach-intelligence.service";
import { OutreachMapping } from "./outreach-intelligence";

/**
 * Canal institucional da ChegowIA.
 *
 * As rotas não recebem `companyId` e são exclusivas de SUPER_ADMIN: isso
 * mantém o número comercial da plataforma, seus tokens e suas conversas fora
 * do espaço de qualquer empresa cliente.
 */
@ApiTags("platform-whatsapp")
@Roles(Role.SUPER_ADMIN)
@Controller("platform/whatsapp")
export class PlatformWhatsAppController {
  constructor(
    private readonly platformWhatsApp: PlatformWhatsAppService,
    private readonly outreach: PlatformOutreachService,
    private readonly intelligence: OutreachIntelligenceService,
  ) {}

  @Get("channel")
  channel() {
    return this.platformWhatsApp.getChannel();
  }

  /** Vínculo manual do modo self-serve do Gupshup para o número institucional. */
  @Put("channel/gupshup")
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  connectGupshup(@Body() dto: ConnectWhatsAppGupshupDto) {
    return this.platformWhatsApp.connectGupshupManual(dto);
  }

  /** Perfil que o interessado vê ao abrir a conversa com a ChegowIA. */
  @Get("channel/profile")
  profile() {
    return this.platformWhatsApp.getProfile();
  }

  @Patch("channel/profile")
  updateProfile(@Body() dto: UpdateWhatsAppProfileDto) {
    return this.platformWhatsApp.updateProfile(dto);
  }

  @Post("channel/profile/photo")
  @UseInterceptors(FileInterceptor("file", { limits: { fileSize: 5 * 1024 * 1024 } }))
  updateProfilePhoto(@UploadedFile() file: any) {
    // A Meta só aceita JPEG/PNG quadrado no perfil; barrar aqui evita uma ida ao
    // BSP para receber a mesma recusa.
    if (!file?.buffer) {
      throw new BadRequestException("Envie uma imagem para o perfil do WhatsApp.");
    }
    if (!["image/jpeg", "image/png"].includes(String(file.mimetype))) {
      throw new BadRequestException("A foto do perfil precisa ser JPEG ou PNG.");
    }
    return this.platformWhatsApp.updateProfilePhoto({
      buffer: file.buffer,
      mimeType: String(file.mimetype),
      fileName: String(file.originalname ?? "perfil.jpg"),
    });
  }

  @Patch("automation")
  updateAutomation(@Body() dto: UpdatePlatformWhatsAppAutomationDto) {
    return this.platformWhatsApp.updateAutomation(dto);
  }

  /** Modelo aprovado na Meta, usado para abrir conversa com número novo. */
  @Patch("outreach/template")
  updateOutreachTemplate(@Body() dto: UpdatePlatformOutreachTemplateDto) {
    return this.platformWhatsApp.updateOutreachTemplate(dto);
  }

  @Get("conversations")
  conversations() {
    return this.platformWhatsApp.listConversations();
  }

  /**
   * Abre conversa com um número digitado.
   *
   * Limite baixo de propósito: é a rota que manda mensagem para quem nunca
   * escreveu, e um erro de laço aqui custa a reputação do número.
   */
  @Post("conversations")
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  startConversation(
    @CurrentUser("sub") userId: string,
    @Body() dto: StartPlatformConversationDto,
  ) {
    return this.platformWhatsApp.startConversation(userId, dto);
  }

  @Get("conversations/:id")
  conversation(@Param("id") id: string) {
    return this.platformWhatsApp.getConversation(id);
  }

  @Patch("conversations/:id")
  updateConversation(@Param("id") id: string, @Body() dto: UpdatePlatformWhatsAppConversationDto) {
    return this.platformWhatsApp.updateConversation(id, dto);
  }

  @Delete("conversations/:id/messages")
  clearConversation(@Param("id") id: string) {
    return this.platformWhatsApp.clearConversation(id);
  }

  /** Apaga a conversa da lista, e não só as mensagens dela. */
  @Delete("conversations/:id")
  deleteConversation(@Param("id") id: string) {
    return this.platformWhatsApp.deleteConversation(id);
  }

  @Post("conversations/:id/messages")
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  sendHumanMessage(
    @CurrentUser("sub") userId: string,
    @Param("id") id: string,
    @Body() dto: SendWhatsAppMessageDto,
  ) {
    return this.platformWhatsApp.sendHumanMessage(userId, id, dto.content);
  }

  // ---------------------------------------------------------------------------
  // Prospecção em lista
  // ---------------------------------------------------------------------------

  /**
   * Confere a lista colada sem criar disparo nem enviar nada.
   *
   * `POST` porque a lista é grande demais para caber na URL, mas o status é 200:
   * nada é criado, e 201 diria o contrário a quem lê a resposta.
   */
  @Post("outreach/analyze")
  @HttpCode(HttpStatus.OK)
  analyzeList(@Body() dto: AnalyzeOutreachListDto) {
    return this.outreach.analisarLista(dto.contacts);
  }

  @Post("outreach/import/preview")
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @UseInterceptors(FileInterceptor("file", { limits: { fileSize: 5 * 1024 * 1024 } }))
  previewImport(@UploadedFile() file: any, @Body("sheet") sheet?: string, @Body("mapping") rawMapping?: string) {
    if (!file?.buffer) throw new BadRequestException("Envie um arquivo XLSX.");
    let mapping: OutreachMapping | undefined;
    if (rawMapping) {
      try { mapping = JSON.parse(rawMapping); }
      catch { throw new BadRequestException("Mapeamento inválido."); }
    }
    return this.intelligence.preview(file.buffer, sheet, mapping);
  }

  @Post("outreach/import/confirm")
  @Throttle({ default: { limit: 3, ttl: 60_000 } })
  @UseInterceptors(FileInterceptor("file", { limits: { fileSize: 5 * 1024 * 1024 } }))
  confirmImport(@CurrentUser("sub") userId: string, @UploadedFile() file: any, @Body() body: Record<string, string>) {
    if (!file?.buffer) throw new BadRequestException("Envie o mesmo arquivo da prévia.");
    let mapping: OutreachMapping;
    try { mapping = JSON.parse(body.mapping ?? ""); }
    catch { throw new BadRequestException("Mapeamento da planilha inválido."); }
    return this.intelligence.confirmImport(file.buffer, {
      hash: body.hash, previewFingerprint: body.previewFingerprint,
      sheet: body.sheet, name: body.name, mapping,
    }, userId);
  }

  @Get("outreach/prompt")
  outreachPrompt() { return this.intelligence.prompt(); }

  /** Envia o modelo de prospecção para aprovação da Meta ou confere a situação dele. */
  @Post("outreach/template/sync")
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 6, ttl: 60_000 } })
  syncOutreachTemplate() { return this.platformWhatsApp.syncOutreachTemplate(); }

  @Put("outreach/prompt")
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  updateOutreachPrompt(@CurrentUser("sub") userId: string, @Body("systemPrompt") content: string) {
    return this.intelligence.updatePrompt(content, userId);
  }

  @Get("outreach/campaigns")
  campaigns() {
    return this.outreach.listarCampanhas();
  }

  @Get("outreach/sender")
  senderStatus() { return this.outreach.senderStatus(); }

  @Post("outreach/sender/reconcile")
  @Throttle({ default: { limit: 3, ttl: 60_000 } })
  reconcileSender(@Body("targetId") targetId: string, @CurrentUser("sub") userId: string) {
    return this.outreach.reconcileSender(targetId, userId);
  }

  @Post("outreach/campaigns")
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  createCampaign(@CurrentUser("sub") userId: string, @Body() dto: CreateOutreachCampaignDto) {
    return this.outreach.criarCampanha(userId, dto);
  }

  @Get("outreach/campaigns/:id")
  campaign(@Param("id") id: string) {
    return this.outreach.detalharCampanha(id);
  }

  @Get("outreach/campaigns/:id/targets")
  targets(@Param("id") id: string, @Query("page") page?: string) {
    return this.intelligence.listTargets(id, Number(page ?? 1));
  }

  @Get("outreach/campaigns/:id/import-issues")
  importIssues(@Param("id") id: string, @Query("page") page?: string) {
    return this.intelligence.listImportRows(id, Number(page ?? 1));
  }

  @Post("outreach/campaigns/:id/prepare")
  prepareCampaign(@Param("id") id: string) { return this.intelligence.requestGeneration(id); }

  @Post("outreach/campaigns/:id/simulate")
  @HttpCode(HttpStatus.OK)
  simulateCampaign(@Param("id") id: string) { return this.intelligence.simulate(id); }

  @Post("outreach/campaigns/:id/approve-messages")
  @HttpCode(HttpStatus.OK)
  approveMessages(@Param("id") id: string, @CurrentUser("sub") userId: string, @Body("ids") ids: string[]) {
    return this.intelligence.approveBatch(id, ids, userId);
  }

  @Post("outreach/campaigns/:id/approve")
  @HttpCode(HttpStatus.OK)
  approveCampaign(@Param("id") id: string, @CurrentUser("sub") userId: string) {
    return this.intelligence.approveCampaign(id, userId);
  }

  @Patch("outreach/targets/:id/consent")
  consent(@Param("id") id: string, @Body() body: { status: string; source?: string; evidence?: string; at?: string }) {
    return this.intelligence.updateConsent(id, body);
  }

  @Patch("outreach/targets/:id/variables")
  variables(@Param("id") id: string, @Body() body: { nomeCurto?: string; atividade?: string }) {
    return this.intelligence.editVariables(id, body);
  }

  @Post("outreach/targets/:id/regenerate")
  regenerate(@Param("id") id: string) { return this.intelligence.regenerate(id); }

  @Post("outreach/targets/:id/review")
  review(@Param("id") id: string, @Body("approved") approved: boolean, @CurrentUser("sub") userId: string) {
    if (typeof approved !== "boolean") throw new BadRequestException("Informe a decisão de revisão.");
    return this.intelligence.reviewTarget(id, approved, userId);
  }

  @Delete("outreach/targets/:id")
  excludeTarget(@Param("id") id: string) { return this.intelligence.excludeTarget(id); }

  @Post("outreach/campaigns/:id/start")
  startCampaign(@Param("id") id: string) {
    return this.outreach.iniciar(id);
  }

  @Post("outreach/campaigns/:id/pause")
  pauseCampaign(@Param("id") id: string) {
    return this.outreach.pausar(id);
  }

  @Delete("outreach/campaigns/:id")
  cancelCampaign(@Param("id") id: string) {
    return this.outreach.cancelar(id);
  }

  @Post("outreach/campaigns/:id/delete")
  @HttpCode(HttpStatus.OK)
  deleteCampaign(@Param("id") id: string) {
    return this.outreach.excluir(id);
  }

  @Get("outreach/blocks")
  blocks() {
    return this.outreach.listarBloqueios();
  }

  @Post("outreach/blocks")
  block(@CurrentUser("sub") userId: string, @Body() dto: BlockOutreachPhoneDto) {
    return this.outreach.bloquear(dto, userId);
  }

  @Delete("outreach/blocks/:id")
  unblock(@Param("id") id: string) {
    return this.outreach.desbloquear(id);
  }
}
