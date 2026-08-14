import { Injectable, Logger, ServiceUnavailableException } from "@nestjs/common";
import nodemailer, { Transporter } from "nodemailer";

@Injectable()
export class MailService {
  private readonly logger = new Logger(MailService.name);
  private readonly transporter: Transporter | null;

  constructor() {
    const host = process.env.SMTP_HOST;
    this.transporter = host
      ? nodemailer.createTransport({
          host,
          port: Number(process.env.SMTP_PORT ?? 587),
          secure: String(process.env.SMTP_SECURE ?? "false") === "true",
          auth: process.env.SMTP_USER
            ? {
                user: process.env.SMTP_USER,
                pass: process.env.SMTP_PASSWORD,
              }
            : undefined,
        })
      : null;
  }

  async sendVerification(email: string, name: string, token: string) {
    const url = `${this.appUrl()}/verificar-email?token=${encodeURIComponent(token)}`;
    await this.send({
      to: email,
      subject: "Confirme seu e-mail no ChegowIA",
      text: `Olá, ${name}. Confirme seu e-mail acessando: ${url}. O link expira em 24 horas.`,
      html: this.template(
        "Confirme seu e-mail",
        `Olá, ${escapeHtml(name)}. Use o botão abaixo para confirmar que este e-mail pertence a você.`,
        "Confirmar e-mail",
        url,
        "Este link expira em 24 horas.",
      ),
      developmentUrl: url,
    });
  }

  async sendPasswordReset(email: string, name: string, token: string) {
    const url = `${this.appUrl()}/redefinir-senha?token=${encodeURIComponent(token)}`;
    await this.send({
      to: email,
      subject: "Redefinição de senha do ChegowIA",
      text: `Olá, ${name}. Redefina sua senha acessando: ${url}. O link expira em 30 minutos.`,
      html: this.template(
        "Redefina sua senha",
        `Olá, ${escapeHtml(name)}. Recebemos uma solicitação para criar uma nova senha.`,
        "Criar nova senha",
        url,
        "Se você não fez essa solicitação, ignore este e-mail. O link expira em 30 minutos.",
      ),
      developmentUrl: url,
    });
  }

  async sendMfaCode(email: string, name: string, code: string) {
    await this.send({
      to: email,
      subject: "Seu código de acesso ChegowIA",
      text: `Olá, ${name}. Seu código de acesso é ${code}. Ele expira em 10 minutos.`,
      html: this.template(
        "Confirme seu acesso",
        `Olá, ${escapeHtml(name)}. Digite este código na tela de acesso: <strong style="font-size:24px;letter-spacing:6px">${code}</strong>`,
        undefined,
        undefined,
        "O código expira em 10 minutos. Nunca compartilhe este código.",
      ),
    });
  }

  /**
   * Aviso operacional para a equipe da plataforma — não vai para o lojista.
   * Sem `OPS_ALERT_EMAIL` configurado o alerta só é registrado no log, para o
   * worker nunca falhar por causa da notificação.
   */
  async sendOperationsAlert(subject: string, lines: string[]) {
    const to = process.env.OPS_ALERT_EMAIL?.trim();
    const corpo = lines.join("\n");
    if (!to) {
      this.logger.error(`Alerta operacional sem destinatário (OPS_ALERT_EMAIL): ${subject} — ${corpo}`);
      return;
    }
    await this.send({
      to,
      subject: `[ChegowIA] ${subject}`,
      text: corpo,
      html: this.template(
        subject,
        lines.map((line) => escapeHtml(line)).join("<br>"),
        undefined,
        undefined,
        "Alerta automático do processamento em segundo plano.",
      ),
    });
  }

  /**
   * Aviso operacional para o lojista (hoje: validade do certificado digital).
   * Diferente de `sendOperationsAlert`, que vai para a equipe da plataforma.
   */
  async sendFiscalAlert(email: string, subject: string, lines: string[]) {
    await this.send({
      to: email,
      subject: `ChegowIA — ${subject}`,
      text: lines.join("\n"),
      html: this.template(
        subject,
        lines.map((line) => escapeHtml(line)).join("<br>"),
        "Abrir o painel",
        `${this.appUrl()}/painel/fiscal`,
        "Você recebe este aviso porque é administrador da empresa no ChegowIA.",
      ),
    });
  }

  /**
   * Aviso transacional ao revendedor: o valor só é comunicado depois de a
   * compensação estar concluída e a comissão efetivamente entrar em saque.
   * Falhas neste e-mail nunca podem desfazer nem atrasar o lançamento contábil.
   */
  async sendResellerCommissionAvailable(input: {
    email: string;
    name: string;
    amount: number;
    companyName: string;
  }) {
    const amount = new Intl.NumberFormat("pt-BR", {
      style: "currency",
      currency: "BRL",
    }).format(input.amount);
    const url = `${this.appUrl()}/revendedor/financeiro`;
    await this.send({
      to: input.email,
      subject: "Sua comissão está disponível para saque",
      text: `Olá, ${input.name}. A comissão de ${amount} referente a ${input.companyName} foi compensada e está disponível para saque no ChegowIA. Acesse ${url} para consultar o extrato e solicitar o repasse.`,
      html: this.template(
        "Comissão disponível para saque",
        `Olá, ${escapeHtml(input.name)}. A comissão de <strong>${escapeHtml(amount)}</strong> referente a <strong>${escapeHtml(input.companyName)}</strong> foi compensada pelo Asaas e já está disponível para saque.`,
        "Abrir financeiro",
        url,
        "A disponibilidade acontece somente após o pagamento da mensalidade ser recebido pelo Asaas.",
      ),
      developmentUrl: url,
    });
  }

  async verifyConnection() {
    if (!this.transporter) return process.env.NODE_ENV !== "production";
    return this.transporter.verify();
  }

  private async send(input: {
    to: string;
    subject: string;
    text: string;
    html: string;
    developmentUrl?: string;
  }) {
    if (!this.transporter) {
      if (process.env.NODE_ENV === "production") {
        throw new ServiceUnavailableException("O serviço de e-mail está indisponível.");
      }
      this.logger.warn(
        `E-mail de desenvolvimento para ${input.to}: ${input.subject}${input.developmentUrl ? ` — ${input.developmentUrl}` : ""}`,
      );
      return;
    }
    await this.transporter.sendMail({
      from: process.env.MAIL_FROM ?? "ChegowIA <contato@chegowia.com.br>",
      to: input.to,
      subject: input.subject,
      text: input.text,
      html: input.html,
    });
  }

  private appUrl() {
    return (process.env.APP_URL ?? "http://localhost:3000").replace(/\/+$/, "");
  }

  private template(title: string, body: string, action?: string, url?: string, footer?: string) {
    const button = action && url
      ? `<a href="${escapeHtml(url)}" style="display:inline-block;background:#f2550b;color:#fff;text-decoration:none;font-weight:700;padding:14px 22px;border-radius:12px;margin:18px 0">${escapeHtml(action)}</a>`
      : "";
    return `<!doctype html><html lang="pt-BR"><body style="margin:0;background:#f4f6f9;font-family:Arial,sans-serif;color:#071126"><div style="max-width:560px;margin:32px auto;background:#fff;border-radius:22px;padding:32px"><div style="font-size:22px;font-weight:800;color:#f2550b">ChegowIA</div><h1 style="font-size:26px;margin:24px 0 12px">${escapeHtml(title)}</h1><p style="line-height:1.65;color:#516079">${body}</p>${button}<p style="font-size:12px;line-height:1.5;color:#8490a5">${escapeHtml(footer ?? "")}</p></div></body></html>`;
  }
}

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#039;",
  })[char] ?? char);
}
