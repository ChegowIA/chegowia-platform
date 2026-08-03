/**
 * Papel do processo.
 *
 * Os jobs em segundo plano (fila de eventos Stripe, repasses, sincronização de
 * uso, limpeza) viviam dentro do mesmo processo que atende HTTP. Isso significa
 * que uma reinicialização do container da API — deploy, OOM, health check
 * falho — segurava a fila até o próximo boot, e que um pico de tráfego
 * disputava CPU com o processamento de dinheiro. Também impedia escalar a API
 * horizontalmente: cada réplica passaria a rodar a mesma fila.
 *
 * `APP_ROLE` separa os dois. O binário é o mesmo; muda só o que ele liga.
 *
 * - `all` (padrão) — HTTP + jobs no mesmo processo. É o modo de desenvolvimento
 *   e o comportamento anterior, para nada mudar sem configuração explícita.
 * - `api` — só HTTP. Pode ter N réplicas.
 * - `worker` — só jobs. Deve ter exatamente uma réplica. Continua servindo HTTP
 *   na rede interna porque o health check do compose depende disso; ele apenas
 *   não é publicado pelo proxy.
 */
export type AppRole = "all" | "api" | "worker";

export function appRole(): AppRole {
  const value = process.env.APP_ROLE?.trim().toLowerCase();
  if (value === "api" || value === "worker") return value;
  return "all";
}

/** Se este processo é responsável por rodar os jobs em segundo plano. */
export function runsBackgroundJobs() {
  return appRole() !== "api";
}
