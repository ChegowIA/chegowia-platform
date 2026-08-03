import { FiscalEnvironment } from "@prisma/client";

/**
 * Endpoints da SEFAZ por UF.
 *
 * A NFC-e não tem servidor nacional: cada estado publica os seus, e vários
 * delegam para o SVRS (Sefaz Virtual do Rio Grande do Sul). Manter a tabela
 * explícita em vez de montar a URL por padrão é proposital — os que fogem do
 * padrão são justamente os grandes (SP, MG), e uma URL errada só aparece como
 * timeout na hora da venda.
 *
 * Habilitar um estado novo é acrescentar uma entrada aqui e a URL do QR Code
 * em qr-code.ts. O plano previa começar por um estado; MG está completo e
 * serve de referência.
 */

export interface SefazEndpoints {
  autorizacao: string;
  retAutorizacao: string;
  consultaProtocolo: string;
  recepcaoEvento: string;
  inutilizacao: string;
  statusServico: string;
}

interface UfEndpoints {
  homologacao: SefazEndpoints;
  producao: SefazEndpoints;
}

/** SVRS atende a maioria dos estados na NFC-e. */
function svrs(): UfEndpoints {
  const base = (ambiente: "homologacao" | "producao") =>
    `https://nfce-${ambiente}.svrs.rs.gov.br/ws`;
  const build = (ambiente: "homologacao" | "producao"): SefazEndpoints => ({
    autorizacao: `${base(ambiente)}/NfeAutorizacao/NFeAutorizacao4.asmx`,
    retAutorizacao: `${base(ambiente)}/NfeRetAutorizacao/NFeRetAutorizacao4.asmx`,
    consultaProtocolo: `${base(ambiente)}/NfeConsulta/NfeConsulta4.asmx`,
    recepcaoEvento: `${base(ambiente)}/recepcaoevento/recepcaoevento4.asmx`,
    inutilizacao: `${base(ambiente)}/nfeinutilizacao/nfeinutilizacao4.asmx`,
    statusServico: `${base(ambiente)}/NfeStatusServico/NfeStatusServico4.asmx`,
  });
  return { homologacao: build("homologacao"), producao: build("producao") };
}

const ENDPOINTS: Record<string, UfEndpoints> = {
  MG: {
    homologacao: {
      autorizacao: "https://hnfce.fazenda.mg.gov.br/nfce/services/NFeAutorizacao4",
      retAutorizacao: "https://hnfce.fazenda.mg.gov.br/nfce/services/NFeRetAutorizacao4",
      consultaProtocolo: "https://hnfce.fazenda.mg.gov.br/nfce/services/NFeConsultaProtocolo4",
      recepcaoEvento: "https://hnfce.fazenda.mg.gov.br/nfce/services/NFeRecepcaoEvento4",
      inutilizacao: "https://hnfce.fazenda.mg.gov.br/nfce/services/NFeInutilizacao4",
      statusServico: "https://hnfce.fazenda.mg.gov.br/nfce/services/NFeStatusServico4",
    },
    producao: {
      autorizacao: "https://nfce.fazenda.mg.gov.br/nfce/services/NFeAutorizacao4",
      retAutorizacao: "https://nfce.fazenda.mg.gov.br/nfce/services/NFeRetAutorizacao4",
      consultaProtocolo: "https://nfce.fazenda.mg.gov.br/nfce/services/NFeConsultaProtocolo4",
      recepcaoEvento: "https://nfce.fazenda.mg.gov.br/nfce/services/NFeRecepcaoEvento4",
      inutilizacao: "https://nfce.fazenda.mg.gov.br/nfce/services/NFeInutilizacao4",
      statusServico: "https://nfce.fazenda.mg.gov.br/nfce/services/NFeStatusServico4",
    },
  },
  SP: {
    homologacao: {
      autorizacao: "https://homologacao.nfce.fazenda.sp.gov.br/ws/NFeAutorizacao4.asmx",
      retAutorizacao: "https://homologacao.nfce.fazenda.sp.gov.br/ws/NFeRetAutorizacao4.asmx",
      consultaProtocolo: "https://homologacao.nfce.fazenda.sp.gov.br/ws/NFeConsultaProtocolo4.asmx",
      recepcaoEvento: "https://homologacao.nfce.fazenda.sp.gov.br/ws/NFeRecepcaoEvento4.asmx",
      inutilizacao: "https://homologacao.nfce.fazenda.sp.gov.br/ws/NFeInutilizacao4.asmx",
      statusServico: "https://homologacao.nfce.fazenda.sp.gov.br/ws/NFeStatusServico4.asmx",
    },
    producao: {
      autorizacao: "https://nfce.fazenda.sp.gov.br/ws/NFeAutorizacao4.asmx",
      retAutorizacao: "https://nfce.fazenda.sp.gov.br/ws/NFeRetAutorizacao4.asmx",
      consultaProtocolo: "https://nfce.fazenda.sp.gov.br/ws/NFeConsultaProtocolo4.asmx",
      recepcaoEvento: "https://nfce.fazenda.sp.gov.br/ws/NFeRecepcaoEvento4.asmx",
      inutilizacao: "https://nfce.fazenda.sp.gov.br/ws/NFeInutilizacao4.asmx",
      statusServico: "https://nfce.fazenda.sp.gov.br/ws/NFeStatusServico4.asmx",
    },
  },
  // Delegam para o SVRS.
  AC: svrs(), AL: svrs(), AP: svrs(), DF: svrs(), ES: svrs(), PB: svrs(),
  PI: svrs(), RJ: svrs(), RN: svrs(), RO: svrs(), RR: svrs(), RS: svrs(),
  SC: svrs(), SE: svrs(), TO: svrs(), PA: svrs(), MA: svrs(), CE: svrs(),
  GO: svrs(), MS: svrs(), MT: svrs(), PE: svrs(), PR: svrs(), AM: svrs(), BA: svrs(),
};

export function sefazEndpoints(uf: string, environment: FiscalEnvironment): SefazEndpoints {
  const entry = ENDPOINTS[uf.toUpperCase()];
  if (!entry) {
    throw new Error(
      `A UF ${uf} não está habilitada para NFC-e nesta instalação. `
      + "Acrescente os endpoints do estado em fiscal/nfce/sefaz-endpoints.ts.",
    );
  }
  return environment === FiscalEnvironment.PRODUCAO ? entry.producao : entry.homologacao;
}

export function isUfSupported(uf: string) {
  return Boolean(ENDPOINTS[uf.toUpperCase()]);
}

export function supportedUfs() {
  return Object.keys(ENDPOINTS).sort();
}
