import { Injectable, Logger } from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";
import {
  OnGatewayConnection,
  OnGatewayDisconnect,
  WebSocketGateway,
  WebSocketServer,
} from "@nestjs/websockets";
import { Server, Socket } from "socket.io";
import { JwtPayload } from "../common/interfaces/jwt-payload.interface";

/**
 * Um socket por usuário logado no painel. Cada conexão entra na sala da própria
 * empresa (`company:{companyId}`) para receber pedidos/entregas em tempo real sem
 * polling. Autenticação via `handshake.auth.token` (mesmo access token do REST).
 */
@Injectable()
@WebSocketGateway({
  namespace: "/realtime",
  cors: { origin: process.env.CORS_ORIGIN?.split(",") ?? "*", credentials: true },
})
export class RealtimeGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer() server: Server;

  private readonly logger = new Logger("RealtimeGateway");

  constructor(private readonly jwtService: JwtService) {}

  handleConnection(client: Socket) {
    try {
      const token = client.handshake.auth?.token as string | undefined;
      if (!token) throw new Error("missing token");
      const payload = this.jwtService.verify<JwtPayload>(token, {
        secret: process.env.JWT_ACCESS_SECRET,
      });
      (client.data as { user: JwtPayload }).user = payload;
      if (payload.companyId) {
        client.join(this.companyRoom(payload.companyId));
      }
    } catch {
      this.logger.warn(`Conexão websocket rejeitada: ${client.id}`);
      client.disconnect(true);
    }
  }

  handleDisconnect() {
    // socket.io já remove o client das salas automaticamente.
  }

  private companyRoom(companyId: string) {
    return `company:${companyId}`;
  }

  emitToCompany(companyId: string, event: string, payload: unknown) {
    this.server.to(this.companyRoom(companyId)).emit(event, payload);
  }
}
