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
 * Nem todo estado delega: AM, GO, MS, MT, PR e RS mantêm serviço próprio de
 * NFC-e, e apontar esses para o SVRS não dá erro de configuração — dá timeout
 * na hora da venda, que é bem pior de diagnosticar.
 *
 * Habilitar um estado novo é acrescentar uma entrada aqui e a URL do QR Code
 * em qr-code.ts.
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
  AM: {
    homologacao: {
      autorizacao: "https://homnfce.sefaz.am.gov.br/nfce-services/services/NfeAutorizacao4",
      retAutorizacao: "https://homnfce.sefaz.am.gov.br/nfce-services/services/NfeRetAutorizacao4",
      consultaProtocolo: "https://homnfce.sefaz.am.gov.br/nfce-services/services/NfeConsulta4",
      recepcaoEvento: "https://homnfce.sefaz.am.gov.br/nfce-services/services/RecepcaoEvento4",
      inutilizacao: "https://homnfce.sefaz.am.gov.br/nfce-services/services/NfeInutilizacao4",
      statusServico: "https://homnfce.sefaz.am.gov.br/nfce-services/services/NfeStatusServico4",
    },
    producao: {
      autorizacao: "https://nfce.sefaz.am.gov.br/nfce-services/services/NfeAutorizacao4",
      retAutorizacao: "https://nfce.sefaz.am.gov.br/nfce-services/services/NfeRetAutorizacao4",
      consultaProtocolo: "https://nfce.sefaz.am.gov.br/nfce-services/services/NfeConsulta4",
      recepcaoEvento: "https://nfce.sefaz.am.gov.br/nfce-services/services/RecepcaoEvento4",
      inutilizacao: "https://nfce.sefaz.am.gov.br/nfce-services/services/NfeInutilizacao4",
      statusServico: "https://nfce.sefaz.am.gov.br/nfce-services/services/NfeStatusServico4",
    },
  },
  GO: {
    homologacao: {
      autorizacao: "https://homolog.sefaz.go.gov.br/nfe/services/NFeAutorizacao4",
      retAutorizacao: "https://homolog.sefaz.go.gov.br/nfe/services/NFeRetAutorizacao4",
      consultaProtocolo: "https://homolog.sefaz.go.gov.br/nfe/services/NFeConsultaProtocolo4",
      recepcaoEvento: "https://homolog.sefaz.go.gov.br/nfe/services/NFeRecepcaoEvento4",
      inutilizacao: "https://homolog.sefaz.go.gov.br/nfe/services/NFeInutilizacao4",
      statusServico: "https://homolog.sefaz.go.gov.br/nfe/services/NFeStatusServico4",
    },
    producao: {
      autorizacao: "https://nfe.sefaz.go.gov.br/nfe/services/NFeAutorizacao4",
      retAutorizacao: "https://nfe.sefaz.go.gov.br/nfe/services/NFeRetAutorizacao4",
      consultaProtocolo: "https://nfe.sefaz.go.gov.br/nfe/services/NFeConsultaProtocolo4",
      recepcaoEvento: "https://nfe.sefaz.go.gov.br/nfe/services/NFeRecepcaoEvento4",
      inutilizacao: "https://nfe.sefaz.go.gov.br/nfe/services/NFeInutilizacao4",
      statusServico: "https://nfe.sefaz.go.gov.br/nfe/services/NFeStatusServico4",
    },
  },
  MS: {
    homologacao: {
      autorizacao: "https://hom.nfce.sefaz.ms.gov.br/ws/NFeAutorizacao4",
      retAutorizacao: "https://hom.nfce.sefaz.ms.gov.br/ws/NFeRetAutorizacao4",
      consultaProtocolo: "https://hom.nfce.sefaz.ms.gov.br/ws/NFeConsultaProtocolo4",
      recepcaoEvento: "https://hom.nfce.sefaz.ms.gov.br/ws/NFeRecepcaoEvento4",
      inutilizacao: "https://hom.nfce.sefaz.ms.gov.br/ws/NFeInutilizacao4",
      statusServico: "https://hom.nfce.sefaz.ms.gov.br/ws/NFeStatusServico4",
    },
    producao: {
      autorizacao: "https://nfce.sefaz.ms.gov.br/ws/NFeAutorizacao4",
      retAutorizacao: "https://nfce.sefaz.ms.gov.br/ws/NFeRetAutorizacao4",
      consultaProtocolo: "https://nfce.sefaz.ms.gov.br/ws/NFeConsultaProtocolo4",
      recepcaoEvento: "https://nfce.sefaz.ms.gov.br/ws/NFeRecepcaoEvento4",
      inutilizacao: "https://nfce.sefaz.ms.gov.br/ws/NFeInutilizacao4",
      statusServico: "https://nfce.sefaz.ms.gov.br/ws/NFeStatusServico4",
    },
  },
  MT: {
    homologacao: {
      autorizacao: "https://homologacao.sefaz.mt.gov.br/nfcews/services/NfeAutorizacao4",
      retAutorizacao: "https://homologacao.sefaz.mt.gov.br/nfcews/services/NfeRetAutorizacao4",
      consultaProtocolo: "https://homologacao.sefaz.mt.gov.br/nfcews/services/NfeConsulta4",
      recepcaoEvento: "https://homologacao.sefaz.mt.gov.br/nfcews/services/RecepcaoEvento4",
      inutilizacao: "https://homologacao.sefaz.mt.gov.br/nfcews/services/NfeInutilizacao4",
      statusServico: "https://homologacao.sefaz.mt.gov.br/nfcews/services/NfeStatusServico4",
    },
    producao: {
      autorizacao: "https://nfce.sefaz.mt.gov.br/nfcews/services/NfeAutorizacao4",
      retAutorizacao: "https://nfce.sefaz.mt.gov.br/nfcews/services/NfeRetAutorizacao4",
      consultaProtocolo: "https://nfce.sefaz.mt.gov.br/nfcews/services/NfeConsulta4",
      recepcaoEvento: "https://nfce.sefaz.mt.gov.br/nfcews/services/RecepcaoEvento4",
      inutilizacao: "https://nfce.sefaz.mt.gov.br/nfcews/services/NfeInutilizacao4",
      statusServico: "https://nfce.sefaz.mt.gov.br/nfcews/services/NfeStatusServico4",
    },
  },
  PR: {
    homologacao: {
      autorizacao: "https://homologacao.nfce.sefa.pr.gov.br/nfce/NFeAutorizacao4",
      retAutorizacao: "https://homologacao.nfce.sefa.pr.gov.br/nfce/NFeRetAutorizacao4",
      consultaProtocolo: "https://homologacao.nfce.sefa.pr.gov.br/nfce/NFeConsultaProtocolo4",
      recepcaoEvento: "https://homologacao.nfce.sefa.pr.gov.br/nfce/NFeRecepcaoEvento4",
      inutilizacao: "https://homologacao.nfce.sefa.pr.gov.br/nfce/NFeInutilizacao4",
      statusServico: "https://homologacao.nfce.sefa.pr.gov.br/nfce/NFeStatusServico4",
    },
    producao: {
      autorizacao: "https://nfce.sefa.pr.gov.br/nfce/NFeAutorizacao4",
      retAutorizacao: "https://nfce.sefa.pr.gov.br/nfce/NFeRetAutorizacao4",
      consultaProtocolo: "https://nfce.sefa.pr.gov.br/nfce/NFeConsultaProtocolo4",
      recepcaoEvento: "https://nfce.sefa.pr.gov.br/nfce/NFeRecepcaoEvento4",
      inutilizacao: "https://nfce.sefa.pr.gov.br/nfce/NFeInutilizacao4",
      statusServico: "https://nfce.sefa.pr.gov.br/nfce/NFeStatusServico4",
    },
  },
  RS: {
    homologacao: {
      autorizacao: "https://nfce-homologacao.sefazrs.rs.gov.br/ws/NfeAutorizacao/NFeAutorizacao4.asmx",
      retAutorizacao: "https://nfce-homologacao.sefazrs.rs.gov.br/ws/NfeRetAutorizacao/NFeRetAutorizacao4.asmx",
      consultaProtocolo: "https://nfce-homologacao.sefazrs.rs.gov.br/ws/NfeConsulta/NfeConsulta4.asmx",
      recepcaoEvento: "https://nfce-homologacao.sefazrs.rs.gov.br/ws/recepcaoevento/recepcaoevento4.asmx",
      inutilizacao: "https://nfce-homologacao.sefazrs.rs.gov.br/ws/nfeinutilizacao/nfeinutilizacao4.asmx",
      statusServico: "https://nfce-homologacao.sefazrs.rs.gov.br/ws/NfeStatusServico/NfeStatusServico4.asmx",
    },
    producao: {
      autorizacao: "https://nfce.sefazrs.rs.gov.br/ws/NfeAutorizacao/NFeAutorizacao4.asmx",
      retAutorizacao: "https://nfce.sefazrs.rs.gov.br/ws/NfeRetAutorizacao/NFeRetAutorizacao4.asmx",
      consultaProtocolo: "https://nfce.sefazrs.rs.gov.br/ws/NfeConsulta/NfeConsulta4.asmx",
      recepcaoEvento: "https://nfce.sefazrs.rs.gov.br/ws/recepcaoevento/recepcaoevento4.asmx",
      inutilizacao: "https://nfce.sefazrs.rs.gov.br/ws/nfeinutilizacao/nfeinutilizacao4.asmx",
      statusServico: "https://nfce.sefazrs.rs.gov.br/ws/NfeStatusServico/NfeStatusServico4.asmx",
    },
  },
  // Delegam para o SVRS.
  AC: svrs(), AL: svrs(), AP: svrs(), BA: svrs(), CE: svrs(), DF: svrs(),
  ES: svrs(), MA: svrs(), PA: svrs(), PB: svrs(), PE: svrs(), PI: svrs(),
  RJ: svrs(), RN: svrs(), RO: svrs(), RR: svrs(), SC: svrs(), SE: svrs(),
  TO: svrs(),
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
