"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { LeadStatus } from "@chegowia/shared";
import { api, apiErrorMessage } from "@/lib/api-client";
import { connectSocket } from "@/lib/socket-client";
import { Button } from "@/components/ui/button";

type Lead = {
  id: string;
  name: string;
  companyName?: string | null;
  city?: string | null;
  state?: string | null;
  message: string;
  phone?: string;
  email?: string;
  status: LeadStatus;
  createdAt: string;
};

const DISMISSED_KEY = "chegowia:dismissed-live-leads";

function playLeadSound(audioEnabled: boolean) {
  if (!audioEnabled) return;
  const AudioContextClass = window.AudioContext || (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!AudioContextClass) return;
  const context = new AudioContextClass();
  const now = context.currentTime;
  [523.25, 659.25, 783.99].forEach((frequency, index) => {
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    oscillator.type = "sine";
    oscillator.frequency.value = frequency;
    gain.gain.setValueAtTime(0, now + index * 0.11);
    gain.gain.linearRampToValueAtTime(0.13, now + index * 0.11 + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.001, now + index * 0.11 + 0.32);
    oscillator.connect(gain);
    gain.connect(context.destination);
    oscillator.start(now + index * 0.11);
    oscillator.stop(now + index * 0.11 + 0.34);
  });
  window.setTimeout(() => context.close(), 900);
}

export function LiveLeadOffer() {
  const queryClient = useQueryClient();
  const [dismissed, setDismissed] = useState<string[]>([]);
  const [claimedLead, setClaimedLead] = useState<Lead | null>(null);
  const audioEnabled = useRef(false);

  useEffect(() => {
    try {
      setDismissed(JSON.parse(sessionStorage.getItem(DISMISSED_KEY) ?? "[]"));
    } catch {
      sessionStorage.removeItem(DISMISSED_KEY);
    }
    const unlockAudio = () => {
      audioEnabled.current = true;
      window.removeEventListener("pointerdown", unlockAudio);
      window.removeEventListener("keydown", unlockAudio);
    };
    window.addEventListener("pointerdown", unlockAudio);
    window.addEventListener("keydown", unlockAudio);
    return () => {
      window.removeEventListener("pointerdown", unlockAudio);
      window.removeEventListener("keydown", unlockAudio);
    };
  }, []);

  const { data: leads = [] } = useQuery({
    queryKey: ["reseller-leads"],
    queryFn: async () => (await api.get<Lead[]>("/resellers/me/leads")).data,
    refetchInterval: 20_000,
  });

  const available = useMemo(
    () => leads.filter((lead) => lead.status === LeadStatus.DISPONIVEL && !dismissed.includes(lead.id)),
    [dismissed, leads],
  );
  const activeLead = available[0] ?? null;

  useEffect(() => {
    if (!activeLead) return;
    const ring = () => playLeadSound(audioEnabled.current);
    ring();
    const interval = window.setInterval(ring, 2_000);
    return () => window.clearInterval(interval);
  }, [activeLead]);

  useEffect(() => {
    const socket = connectSocket();
    const availableHandler = () => queryClient.invalidateQueries({ queryKey: ["reseller-leads"] });
    const claimedHandler = () => queryClient.invalidateQueries({ queryKey: ["reseller-leads"] });
    socket.on("lead.available", availableHandler);
    socket.on("lead.claimed", claimedHandler);
    return () => {
      socket.off("lead.available", availableHandler);
      socket.off("lead.claimed", claimedHandler);
    };
  }, [queryClient]);

  const claim = useMutation({
    mutationFn: async (id: string) => (await api.post<Lead>(`/resellers/me/leads/${id}/claim`)).data,
    onSuccess: (lead) => {
      setClaimedLead(lead);
      queryClient.invalidateQueries({ queryKey: ["reseller-leads"] });
    },
  });

  const dismiss = (id: string) => {
    const next = [...new Set([...dismissed, id])];
    setDismissed(next);
    sessionStorage.setItem(DISMISSED_KEY, JSON.stringify(next));
  };

  if (claimedLead) {
    const whatsapp = claimedLead.phone?.replace(/\D/g, "");
    return (
      <div className="fixed inset-x-4 bottom-4 z-[90] mx-auto max-w-md animate-[lead-in_.35s_ease-out] rounded-[28px] border border-emerald-300 bg-slate-950 p-5 text-white shadow-[0_24px_80px_rgba(15,23,42,.45)] sm:bottom-6 sm:right-6 sm:left-auto sm:mx-0 sm:w-[410px]">
        <div className="flex gap-4">
          <div className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl bg-emerald-400 text-xl text-slate-950 dark:text-slate-100">✓</div>
          <div className="min-w-0 flex-1">
            <p className="text-[10px] font-black uppercase tracking-[.2em] text-emerald-300">Lead assumido por você</p>
            <h2 className="mt-1 truncate text-xl font-black">{claimedLead.name}</h2>
            <p className="mt-1 text-sm text-slate-300">{claimedLead.companyName || claimedLead.email}</p>
            <div className="mt-4 flex gap-2">
              {whatsapp && <a className="flex-1 rounded-xl bg-emerald-500 px-4 py-2.5 text-center text-sm font-black text-slate-950 transition hover:bg-emerald-400 dark:text-slate-100" href={`https://wa.me/${whatsapp}`} target="_blank" rel="noreferrer">Chamar no WhatsApp</a>}
              <Button variant="ghost" className="text-slate-300 hover:bg-white/10 hover:text-white" onClick={() => setClaimedLead(null)}>Fechar</Button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (!activeLead) return null;

  return (
    <div role="dialog" aria-live="assertive" aria-label="Novo lead disponível" className="fixed inset-x-3 bottom-3 z-[90] mx-auto max-w-md animate-[lead-in_.35s_ease-out] overflow-hidden rounded-[30px] bg-slate-950 text-white shadow-[0_28px_90px_rgba(15,23,42,.5)] sm:bottom-6 sm:right-6 sm:left-auto sm:mx-0 sm:w-[430px]">
      <div className="h-1 bg-gradient-to-r from-brand-500 via-amber-300 to-emerald-400" />
      <div className="relative p-5">
        <div className="absolute -right-12 -top-12 h-36 w-36 animate-pulse rounded-full bg-brand-500/20 blur-2xl" />
        <div className="relative flex items-start gap-4">
          <div className="relative grid h-14 w-14 shrink-0 place-items-center rounded-2xl bg-brand-500 text-2xl shadow-lg shadow-brand-500/30">
            <span className="absolute inset-0 animate-ping rounded-2xl border border-brand-300/50" />
            <span>⚡</span>
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-center justify-between gap-3">
              <p className="text-[10px] font-black uppercase tracking-[.2em] text-brand-300">Nova oportunidade ao vivo</p>
              {available.length > 1 && <span className="rounded-full bg-white/10 px-2 py-1 text-[10px] font-black">+{available.length - 1}</span>}
            </div>
            <h2 className="mt-1 truncate text-xl font-black">{activeLead.name}</h2>
            <p className="text-xs font-semibold text-slate-400">{activeLead.companyName || "Novo negócio"}{activeLead.city ? ` · ${activeLead.city}${activeLead.state ? `/${activeLead.state}` : ""}` : ""}</p>
          </div>
        </div>
        <p className="relative mt-4 line-clamp-3 rounded-2xl border border-white/10 bg-white/[.06] p-3 text-sm leading-6 text-slate-200">{activeLead.message}</p>
        {claim.error && <p className="relative mt-3 rounded-xl bg-rose-500/15 px-3 py-2 text-xs font-bold text-rose-200">{apiErrorMessage(claim.error, "Este lead acabou de ser assumido por outro parceiro.")}</p>}
        <div className="relative mt-4 grid grid-cols-[1fr_auto] gap-2">
          <Button size="lg" className="rounded-xl font-black" isLoading={claim.isPending} onClick={() => claim.mutate(activeLead.id)}>Quero atender agora</Button>
          <Button size="lg" variant="ghost" className="rounded-xl text-slate-400 hover:bg-white/10 hover:text-white" onClick={() => dismiss(activeLead.id)}>Agora não</Button>
        </div>
        <p className="relative mt-3 text-center text-[10px] font-semibold text-slate-500 dark:text-slate-400">O primeiro parceiro que aceitar fica responsável pelo atendimento.</p>
      </div>
    </div>
  );
}
