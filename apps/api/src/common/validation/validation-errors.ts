import { ValidationError } from "class-validator";

const FIELD_LABELS: Record<string, string> = {
  acceptAutomatedAnalysis: "Autorização da análise automatizada",
  acceptPrivacy: "Aceite da Política de Privacidade",
  acceptTerms: "Aceite dos Termos de Uso",
  addressId: "Endereço",
  addressLine: "Endereço",
  addons: "Adicionais",
  addonIds: "Adicionais",
  agentRole: "Papel do agente",
  aiEnabled: "Ativação da inteligência artificial",
  aiKnowledgeBase: "Base de conhecimento da inteligência artificial",
  approve: "Decisão de aprovação",
  area: "Área",
  avgDeliveryTimeMinutes: "Tempo médio de entrega",
  businessType: "Ramo de atividade",
  categoryId: "Categoria",
  challengeId: "Identificação da verificação",
  city: "Cidade",
  cnpj: "CNPJ",
  code: "Código",
  commitment: "Comprometimento",
  companyName: "Empresa",
  companySlug: "Loja",
  complement: "Complemento",
  confirmPassword: "Confirmação de senha",
  content: "Conteúdo",
  currentPassword: "Senha atual",
  customerName: "Nome do cliente",
  customerPhone: "Telefone do cliente",
  deliveryFeeBase: "Taxa base de entrega",
  deliveryFeePerKm: "Taxa por quilômetro",
  deliveryRadiusKm: "Raio de entrega",
  description: "Descrição",
  discountType: "Tipo de desconto",
  discountValue: "Valor do desconto",
  document: "CPF/CNPJ",
  email: "E-mail",
  endsAt: "Data final",
  experience: "Experiência",
  fullName: "Nome completo",
  guestCount: "Quantidade de pessoas",
  imageUrl: "Imagem",
  isActive: "Situação ativa",
  isDefault: "Definição como padrão",
  isFeatured: "Destaque",
  items: "Itens",
  label: "Rótulo",
  latitude: "Latitude",
  linkedinUrl: "LinkedIn",
  logoUrl: "Logotipo",
  longitude: "Longitude",
  maxProducts: "Limite de produtos",
  maxUsers: "Limite de usuários",
  message: "Mensagem",
  motivation: "Motivação",
  motoboyId: "Motoboy",
  name: "Nome",
  neighborhood: "Bairro",
  newPassword: "Nova senha",
  notes: "Observações",
  number: "Número",
  openingHours: "Horários de funcionamento",
  operationDetails: "Detalhes da operação",
  page: "Página",
  pageSize: "Quantidade por página",
  password: "Senha",
  paymentMethod: "Forma de pagamento",
  paymentMethodsEnabled: "Formas de pagamento habilitadas",
  permissionKeys: "Permissões",
  phone: "Telefone",
  plan: "Plano",
  planId: "Plano",
  position: "Posição",
  price: "Preço",
  priceDelta: "Acréscimo de preço",
  problemDescription: "Descrição do problema",
  problemReason: "Motivo do problema",
  productId: "Produto",
  quantity: "Quantidade",
  reference: "Referência",
  resellerCode: "Código de revendedor",
  responsibleName: "Responsável",
  resumeText: "Resumo profissional",
  role: "Perfil",
  search: "Busca",
  seats: "Lugares",
  slug: "Identificador da empresa",
  sourceLeadId: "Contato de origem",
  stage: "Etapa",
  startsAt: "Data inicial",
  state: "Estado",
  status: "Status",
  street: "Rua",
  title: "Título",
  token: "Código de segurança",
  tradeName: "Nome fantasia",
  variationId: "Variação",
  variations: "Variações",
  whatsapp: "WhatsApp",
  whatsappNumber: "Número do WhatsApp",
  zipCode: "CEP",
};

export function validationMessages(errors: ValidationError[]): string[] {
  const messages = errors.flatMap((error) => messagesForError(error));
  return [...new Set(messages)];
}

function messagesForError(error: ValidationError, parent = ""): string[] {
  const path = parent ? `${parent}.${error.property}` : error.property;
  const ownMessages = Object.entries(error.constraints ?? {}).map(([constraint, original]) =>
    translateConstraint(constraint, original, path),
  );
  return [
    ...ownMessages,
    ...error.children?.flatMap((child) => messagesForError(child, path)) ?? [],
  ];
}

function translateConstraint(constraint: string, original: string, property: string) {
  if (isPortugueseMessage(original)) return original;

  const label = fieldLabel(property);
  const number = original.match(/\d+/)?.[0];
  const translations: Record<string, string> = {
    arrayMinSize: `${label} deve conter pelo menos ${number ?? "um"} item.`,
    isArray: `${label} deve ser uma lista válida.`,
    isBoolean: `${label} deve ser informado como sim ou não.`,
    isDateString: `${label} deve ser uma data válida.`,
    isEmail: "Informe um e-mail válido.",
    isEnum: `${label} possui uma opção inválida.`,
    isIn: `${label} possui uma opção inválida.`,
    isInt: `${label} deve ser um número inteiro.`,
    isNumber: `${label} deve ser um número válido.`,
    isObject: `${label} deve ser preenchido corretamente.`,
    isString: `${label} deve ser um texto válido.`,
    length: `${label} deve ter exatamente ${number ?? "a quantidade correta de"} caracteres.`,
    max: `${label} deve ser menor ou igual a ${number ?? "o limite permitido"}.`,
    maxLength: `${label} deve ter no máximo ${number ?? "o limite permitido de"} caracteres.`,
    min: `${label} deve ser maior ou igual a ${number ?? "o mínimo permitido"}.`,
    minLength: `${label} deve ter no mínimo ${number ?? "a quantidade necessária de"} caracteres.`,
    nestedValidation: `${label} contém dados inválidos.`,
    whitelistValidation: `O campo ${label.toLocaleLowerCase("pt-BR")} não é permitido.`,
  };
  return translations[constraint] ?? `O valor informado para ${label.toLocaleLowerCase("pt-BR")} é inválido.`;
}

function fieldLabel(property: string) {
  const key = property.split(".").at(-1) ?? property;
  if (/^\d+$/.test(key)) return `Item ${Number(key) + 1}`;
  return FIELD_LABELS[key]
    ?? key
      .replace(/([a-z])([A-Z])/g, "$1 $2")
      .replace(/^./, (character) => character.toUpperCase());
}

function isPortugueseMessage(message: string) {
  return (
    /[áàâãéêíóôõúç]/i.test(message)
    || /^(A|As|Este|Esta|É|Informe|Não|O|Os|Selecione|Sua|Você)\s+(senha|confirmação|conta|campo|documento|valor|dados|opção|motivo|termos|política)\b/i.test(message)
  );
}
