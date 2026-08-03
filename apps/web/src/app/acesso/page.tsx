"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import gsap from "gsap";
import { AuthShell } from "@/components/auth/auth-shell";
import { Button } from "@/components/ui/button";
import { FormField, Input } from "@/components/ui/input";
import { BrazilStateSelect, MaskedInput } from "@/components/ui/brazil-fields";
import { apiErrorMessage } from "@/lib/api-client";
import { homePathForRole } from "@/lib/auth-routes";
import { useAuthStore } from "@/lib/auth-store";
import { useLogin, useLogout, useRegisterCustomer, useVerifyMfa } from "@/lib/use-auth";

type Mode = "login" | "cadastro";

export default function AccessPage() {
  const [mode, setMode] = useState<Mode>("login");
  const [step, setStep] = useState<1 | 2>(1);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const [switching, setSwitching] = useState(false);
  const [mfaChallenge, setMfaChallenge] = useState<{ id: string; emailHint: string } | null>(null);
  const [mfaCode, setMfaCode] = useState("");
  const [verificationEmail, setVerificationEmail] = useState<string | null>(null);
  const card = useRef<HTMLDivElement>(null);
  const router = useRouter();
  const login = useLogin();
  const logout = useLogout();
  const register = useRegisterCustomer();
  const verifyMfa = useVerifyMfa();
  const user = useAuthStore((s) => s.user);
  const hydrated = useAuthStore((s) => s.hasHydrated);
  const sessionLoading = useAuthStore((s) => s.isSessionLoading);
  const [form, setForm] = useState({
    name: "", email: "", password: "", confirmPassword: "", phone: "",
    street: "", number: "", neighborhood: "", city: "", state: "", zipCode: "", complement: "",
    acceptTerms: false, acceptPrivacy: false,
  });

  useLayoutEffect(() => {
    if (!card.current) return;
    const shellCard = card.current.closest(".auth-card");
    if (shellCard) gsap.set(shellCard, { transformPerspective: 1400, transformOrigin: "50% 50%" });
  }, []);

  useEffect(() => {
    if (!hydrated || sessionLoading) return;
    const params = new URLSearchParams(window.location.search);
    if (params.get("modo") === "cadastro" || params.has("novo")) setMode("cadastro");
    const mustSwitch = params.has("trocar-conta");
    if (mustSwitch && user) {
      setSwitching(true);
      logout.mutateAsync().catch(() => useAuthStore.getState().clear()).finally(() => {
        setSwitching(false);
        setReady(true);
      });
      return;
    }
    if (user) {
      router.replace(homePathForRole(user.role));
      return;
    }
    setReady(true);
  }, [hydrated, sessionLoading]); // eslint-disable-line react-hooks/exhaustive-deps

  function changeMode(next: Mode) {
    if (next === mode || !card.current) return;
    setError(null);
    const el = card.current.closest(".auth-card");
    if (!el) return;
    gsap.timeline({ defaults: { ease: "power3.inOut" } })
      .to(el, { rotateY: 90, scale: .94, filter: "blur(3px)", duration: .34 })
      .call(() => {
        setMode(next);
        setStep(1);
        window.history.replaceState(null, "", next === "cadastro" ? "/acesso?modo=cadastro" : "/acesso");
      })
      .set(el, { rotateY: -90, filter: "blur(3px)" })
      .to(el, { rotateY: 0, scale: 1, filter: "blur(0px)", duration: .48, ease: "back.out(1.25)" });
  }

  async function submitLogin(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    try {
      const data = await login.mutateAsync({ email, password });
      if (data.mfaRequired) {
        setMfaChallenge({ id: data.challengeId, emailHint: data.emailHint });
        return;
      }
      router.replace(homePathForRole(data.user.role));
    } catch (err) {
      setError(apiErrorMessage(err, "E-mail ou senha inválidos."));
    }
  }

  async function submitRegister(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    if (step === 1) {
      if (form.password !== form.confirmPassword) return setError("As senhas precisam ser iguais.");
      setStep(2);
      return;
    }
    try {
      const data = await register.mutateAsync(form);
      setVerificationEmail(data.email);
    } catch (err) {
      setError(apiErrorMessage(err, "Não foi possível criar sua conta."));
    }
  }

  async function submitMfa(event: React.FormEvent) {
    event.preventDefault();
    if (!mfaChallenge) return;
    setError(null);
    try {
      const data = await verifyMfa.mutateAsync({
        challengeId: mfaChallenge.id,
        code: mfaCode,
      });
      router.replace(homePathForRole(data.user.role));
    } catch (err) {
      setError(apiErrorMessage(err, "Código inválido ou expirado."));
    }
  }

  if (!ready || switching) return <main className="grid h-dvh place-items-center bg-slate-950 text-sm font-bold text-white">Preparando seu acesso...</main>;

  const registerMode = mode === "cadastro";
  return (
    <AuthShell
      eyebrow={registerMode ? "Seu acesso começa aqui" : "Que bom ter você de volta"}
      title={registerMode ? "Crie sua conta" : "Entre para pedir"}
      description={registerMode ? "Em duas etapas rápidas, mostramos o que chega até você." : "Seus endereços, pedidos e favoritos estão esperando."}
      variant="register"
    >
      <div ref={card} className="will-change-transform">
        <div className="mb-5 grid grid-cols-2 rounded-xl bg-slate-100 p-1 dark:bg-slate-800" role="tablist" aria-label="Escolha como continuar">
          <button type="button" onClick={() => changeMode("login")} className={`rounded-lg px-3 py-2.5 text-sm font-extrabold transition-colors ${!registerMode ? "bg-white text-slate-950 shadow-sm dark:bg-slate-700 dark:text-slate-50" : "text-slate-500 hover:text-slate-900 dark:text-slate-400"}`}>Entrar</button>
          <button type="button" onClick={() => changeMode("cadastro")} className={`rounded-lg px-3 py-2.5 text-sm font-extrabold transition-colors ${registerMode ? "bg-white text-slate-950 shadow-sm dark:bg-slate-700 dark:text-slate-50" : "text-slate-500 hover:text-slate-900 dark:text-slate-400"}`}>Criar conta</button>
        </div>

        {verificationEmail ? (
          <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-5 text-center dark:bg-emerald-950/30 dark:border-emerald-900/60">
            <div className="mx-auto grid h-12 w-12 place-items-center rounded-2xl bg-emerald-500 text-xl font-black text-white">✓</div>
            <h2 className="mt-4 text-xl font-black text-emerald-950 dark:text-emerald-200">Confira seu e-mail</h2>
            <p className="mt-2 text-sm leading-6 text-emerald-800 dark:text-emerald-300">
              Enviamos o link de confirmação para <strong>{verificationEmail}</strong>. Depois de confirmar, sua sessão será aberta.
            </p>
            <button type="button" className="mt-4 text-sm font-black text-brand-700 hover:underline dark:text-brand-300" onClick={() => {
              setVerificationEmail(null);
              changeMode("login");
            }}>Voltar para entrar</button>
          </div>
        ) : mfaChallenge ? (
          <form className="space-y-5" onSubmit={submitMfa}>
            <div className="rounded-2xl bg-brand-50 p-4 dark:bg-brand-950/30">
              <p className="font-black text-slate-950 dark:text-slate-100">Confirme que é você</p>
              <p className="mt-1 text-sm leading-6 text-slate-600 dark:text-slate-400">
                Enviamos um código de 6 dígitos para {mfaChallenge.emailHint}.
              </p>
            </div>
            <FormField label="Código de segurança">
              <Input
                inputMode="numeric"
                autoComplete="one-time-code"
                maxLength={6}
                pattern="[0-9]{6}"
                className="h-14 text-center text-xl font-black tracking-[.35em]"
                value={mfaCode}
                onChange={(event) => setMfaCode(event.target.value.replace(/\D/g, "").slice(0, 6))}
                autoFocus
                required
              />
            </FormField>
            {error && <ErrorMessage>{error}</ErrorMessage>}
            <Button className="h-12 w-full" type="submit" isLoading={verifyMfa.isPending} disabled={mfaCode.length !== 6}>
              Confirmar acesso
            </Button>
            <button type="button" className="w-full text-sm font-bold text-slate-500 hover:text-slate-900 dark:text-slate-400" onClick={() => {
              setMfaChallenge(null);
              setMfaCode("");
            }}>Usar outra conta</button>
          </form>
        ) : !registerMode ? (
          <form className="mx-auto max-w-lg space-y-5" onSubmit={submitLogin}>
            <FormField label="E-mail"><Input className="h-12 rounded-xl bg-white dark:bg-slate-900" type="email" autoComplete="email" placeholder="seunome@email.com" required value={email} onChange={(e) => setEmail(e.target.value)} /></FormField>
            <FormField label="Senha"><Input className="h-12 rounded-xl bg-white dark:bg-slate-900" type="password" autoComplete="current-password" placeholder="Digite sua senha" required value={password} onChange={(e) => setPassword(e.target.value)} /></FormField>
            <div className="-mt-2 text-right"><Link href="/recuperar-senha" className="text-sm font-bold text-brand-700 hover:underline dark:text-brand-300">Esqueci minha senha</Link></div>
            {error && <ErrorMessage>{error}</ErrorMessage>}
            <Button type="submit" size="lg" className="h-12 w-full rounded-xl font-bold" isLoading={login.isPending}>Entrar</Button>
            <p className="text-center text-sm text-slate-500 dark:text-slate-400">Primeira vez por aqui? <button type="button" onClick={() => changeMode("cadastro")} className="font-bold text-brand-600 hover:underline">Crie sua conta grátis</button></p>
          </form>
        ) : (
          <>
            <div className="mb-4 flex items-center gap-3"><span className="h-1.5 flex-1 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800"><span className="block h-full rounded-full bg-brand-500 transition-[width] duration-500" style={{ width: step === 1 ? "50%" : "100%" }} /></span><span className="text-xs font-extrabold text-slate-400">{step}/2</span></div>
            <form className="lg:[&_input]:h-11 lg:[&_select]:h-11" onSubmit={submitRegister}>
              <div key={step} className="auth-step-enter">
                {step === 1 ? (
                  <div className="space-y-3">
                    <FormField label="Como podemos te chamar?"><Input className="h-12 rounded-xl bg-white dark:bg-slate-900" autoComplete="name" placeholder="Seu nome" required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></FormField>
                    <div className="grid gap-3 sm:grid-cols-2">
                      <FormField label="E-mail"><Input className="h-12 rounded-xl bg-white dark:bg-slate-900" type="email" autoComplete="email" placeholder="seunome@email.com" required value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} /></FormField>
                      <FormField label="Celular (opcional)"><MaskedInput mask="phone" type="tel" autoComplete="tel" placeholder="(11) 99999-9999" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} /></FormField>
                    </div>
                    <FormField label="Crie uma senha"><Input className="h-12 rounded-xl bg-white dark:bg-slate-900" type="password" autoComplete="new-password" placeholder="Maiúscula, minúscula e símbolo" required minLength={8} pattern="(?=.*[a-z])(?=.*[A-Z])(?=.*[^A-Za-z0-9\\s]).{8,}" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} /><p className="text-xs text-slate-400">8 caracteres ou mais, com maiúscula, minúscula e símbolo.</p></FormField>
                    <FormField label="Confirme sua senha"><Input className="h-12 rounded-xl bg-white dark:bg-slate-900" type="password" autoComplete="new-password" placeholder="Repita a senha" required value={form.confirmPassword} onChange={(e) => setForm({ ...form, confirmPassword: e.target.value })} /></FormField>
                  </div>
                ) : (
                  <div>
                    <div className="mb-4"><p className="font-black text-slate-900 dark:text-slate-100">Onde você quer receber?</p><p className="text-xs text-slate-500 dark:text-slate-400">Mostraremos lojas que entregam nesse endereço.</p></div>
                    <div className="grid gap-3 sm:grid-cols-[1fr_110px]"><FormField label="Rua"><Input className="h-12 rounded-xl bg-white dark:bg-slate-900" required value={form.street} onChange={(e) => setForm({ ...form, street: e.target.value })} /></FormField><FormField label="Número"><Input className="h-12 rounded-xl bg-white dark:bg-slate-900" required value={form.number} onChange={(e) => setForm({ ...form, number: e.target.value })} /></FormField></div>
                    <div className="mt-3 grid gap-3 sm:grid-cols-2"><FormField label="Bairro"><Input className="h-12 rounded-xl bg-white dark:bg-slate-900" required value={form.neighborhood} onChange={(e) => setForm({ ...form, neighborhood: e.target.value })} /></FormField><FormField label="Cidade"><Input className="h-12 rounded-xl bg-white dark:bg-slate-900" required value={form.city} onChange={(e) => setForm({ ...form, city: e.target.value })} /></FormField></div>
                    <div className="mt-3 grid gap-3 sm:grid-cols-[100px_1fr]"><FormField label="UF"><BrazilStateSelect required value={form.state} onChange={(e) => setForm({ ...form, state: e.target.value })} /></FormField><FormField label="CEP (opcional)"><MaskedInput mask="cep" placeholder="00000-000" value={form.zipCode} onChange={(e) => setForm({ ...form, zipCode: e.target.value })} /></FormField></div>
                    <div className="mt-4 space-y-3 rounded-2xl border border-slate-200 bg-white p-4 dark:bg-slate-900 dark:border-slate-800">
                      <label className="flex cursor-pointer items-start gap-3 text-xs leading-5 text-slate-600 dark:text-slate-400">
                        <input className="mt-1 h-4 w-4 accent-brand-600" type="checkbox" required checked={form.acceptTerms} onChange={(e) => setForm({ ...form, acceptTerms: e.target.checked })} />
                        <span>Li e aceito os <Link className="font-bold text-brand-700 hover:underline dark:text-brand-300" href="/termos" target="_blank">Termos de Uso</Link>.</span>
                      </label>
                      <label className="flex cursor-pointer items-start gap-3 text-xs leading-5 text-slate-600 dark:text-slate-400">
                        <input className="mt-1 h-4 w-4 accent-brand-600" type="checkbox" required checked={form.acceptPrivacy} onChange={(e) => setForm({ ...form, acceptPrivacy: e.target.checked })} />
                        <span>Li e aceito a <Link className="font-bold text-brand-700 hover:underline dark:text-brand-300" href="/privacidade" target="_blank">Política de Privacidade</Link>.</span>
                      </label>
                    </div>
                  </div>
                )}
              </div>
              {error && <div className="mt-3"><ErrorMessage>{error}</ErrorMessage></div>}
              <div className="mt-4 flex gap-3">{step === 2 && <Button type="button" className="h-11 bg-slate-100 text-slate-700 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-300" onClick={() => setStep(1)}>Voltar</Button>}<Button type="submit" className="h-11 flex-1" disabled={(step === 1 && (!form.confirmPassword || form.password !== form.confirmPassword)) || (step === 2 && (!form.acceptTerms || !form.acceptPrivacy))} isLoading={register.isPending}>{step === 1 ? "Continuar" : "Criar minha conta"}</Button></div>
              <p className="mt-3 text-center text-sm text-slate-500 dark:text-slate-400">Já faz parte? <button type="button" onClick={() => changeMode("login")} className="font-bold text-brand-600 hover:underline">Entrar</button></p>
            </form>
          </>
        )}
      </div>
    </AuthShell>
  );
}

function ErrorMessage({ children }: { children: React.ReactNode }) {
  return <p role="alert" className="rounded-xl border border-red-100 bg-red-50 px-4 py-3 text-sm font-medium text-red-700 dark:bg-red-950/30 dark:border-red-900/50 dark:text-red-300">{children}</p>;
}
