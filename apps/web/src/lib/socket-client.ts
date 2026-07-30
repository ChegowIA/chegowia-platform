import { io, Socket } from "socket.io-client";
import { useAuthStore } from "./auth-store";

let socket: Socket | null = null;

export function getSocket(): Socket {
  if (!socket) {
    socket = io(`${process.env.NEXT_PUBLIC_SOCKET_URL ?? "http://localhost:3001"}/realtime`, {
      autoConnect: false,
      auth: (cb) => cb({ token: useAuthStore.getState().accessToken }),
    });
  }
  return socket;
}

export function connectSocket(): Socket {
  const instance = getSocket();
  if (!instance.connected) instance.connect();
  return instance;
}

export function disconnectSocket() {
  socket?.disconnect();
}
