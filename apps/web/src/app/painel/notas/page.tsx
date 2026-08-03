import { redirect } from "next/navigation";

/**
 * As notas viraram uma aba dentro de Fiscal. A rota antiga permanece e
 * redireciona porque ela já foi divulgada em mensagens de suporte e pode estar
 * salva no navegador de alguém — remover devolveria 404 sem explicação.
 */
export default function NotasRedirect() {
  redirect("/painel/fiscal?aba=notas");
}
