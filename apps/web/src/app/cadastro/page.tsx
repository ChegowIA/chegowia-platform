import { redirect } from "next/navigation";

export default function LegacyRegisterPage() {
  redirect("/acesso?modo=cadastro");
}
