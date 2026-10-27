import {
  AIAgentRole,
  AIMessageRole,
  DeliveryProblemReason,
  CashMovementType,
  CashSessionStatus,
  DeliveryStatus,
  FiscalCertificateStatus,
  FiscalDocumentStatus,
  FiscalEmissionType,
  FiscalEnvironment,
  MessagingChannelStatus,
  OrderFulfillmentType,
  OrderStatus,
  PaymentMethod,
  PaymentStatus,
  PromotionStatus,
  Role,
  TaxOrigin,
  TaxRegime,
  WhatsAppConversationMode,
  WhatsAppConversationStatus,
  WhatsAppMessageDirection,
  WhatsAppMessageStatus,
} from "@chegowia/shared";

export interface Paginated<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

export interface Company {
  id: string;
  name: string;
  slug: string;
  cnpj?: string | null;
  phone?: string | null;
  whatsapp?: string | null;
  addressLine?: string | null;
  city?: string | null;
  state?: string | null;
  zipCode?: string | null;
  latitude?: number | null;
  longitude?: number | null;
  locationConfirmedAt?: string | null;
  deliveryFeeBase: number;
  deliveryFeePerKm: number;
  deliveryRadiusKm: number;
  avgDeliveryTimeMinutes: number;
  isOpen?: boolean;
  logoUrl?: string | null;
  isActive: boolean;
  createdAt: string;
  settings?: CompanySettings;
  deliveryAreas?: DeliveryArea[];
  _count?: { orders: number; users: number };
}

export interface CompanySettings {
  openingHours?: Record<string, string> | null;
  paymentMethodsEnabled?: string[] | null;
  pickupEnabled?: boolean;
  aiEnabled: boolean;
  aiKnowledgeBase?: string | null;
  whatsappNumber?: string | null;
  plan: string;
  maxUsers?: number | null;
  maxProducts?: number | null;
}

export interface DeliveryArea {
  id: string;
  neighborhood: string;
  city: string;
  deliveryFee?: number | null;
  isActive: boolean;
}

export interface Category {
  id: string;
  name: string;
  description?: string | null;
  position: number;
  isActive: boolean;
  products?: Product[];
}

export interface ProductVariation {
  id: string;
  name: string;
  priceDelta: number;
  isActive: boolean;
}

export interface ProductAddon {
  id: string;
  name: string;
  price: number;
  isActive: boolean;
}

export type ProductOptionSelectionType = "SINGLE" | "MULTIPLE";
export type ProductOptionPricingRule = "SUM" | "HIGHEST" | "AVERAGE";

export interface ProductOption {
  id: string;
  name: string;
  priceDelta: number;
  position: number;
  isActive: boolean;
}

/**
 * Grupo de montagem reutilizável em qualquer alimento: tamanhos, sabores,
 * ponto de preparo, acompanhamentos, massa, cobertura etc.
 */
export interface ProductOptionGroup {
  id: string;
  name: string;
  description?: string | null;
  selectionType: ProductOptionSelectionType;
  minSelections: number;
  maxSelections: number;
  pricingRule: ProductOptionPricingRule;
  position: number;
  isActive: boolean;
  options: ProductOption[];
}

export interface ProductOptionSelectionInput {
  groupId: string;
  optionIds: string[];
}

export interface OrderItemOptionSelection {
  groupId: string;
  groupName: string;
  pricingRule: ProductOptionPricingRule;
  priceDelta: number;
  options: Array<{ id: string; name: string; priceDelta: number }>;
}

export interface Product {
  id: string;
  categoryId: string;
  name: string;
  description?: string | null;
  price: number;
  imageUrl?: string | null;
  isActive: boolean;
  isFeatured: boolean;
  costPrice?: number | null;
  variations: ProductVariation[];
  addons: ProductAddon[];
  optionGroups: ProductOptionGroup[];
  /** Tributação do item. Nulo em qualquer campo = herda o padrão da empresa. */
  ncm?: string | null;
  cest?: string | null;
  cfop?: string | null;
  taxOrigin?: TaxOrigin | null;
  icmsCode?: string | null;
  icmsRate?: number | null;
  pisCode?: string | null;
  pisRate?: number | null;
  cofinsCode?: string | null;
  cofinsRate?: number | null;
  unit?: string | null;
}

export interface MarketplaceProduct {
  id: string;
  name: string;
  description?: string | null;
  price: number;
  imageUrl?: string | null;
  isFeatured: boolean;
  category: { id: string; name: string; description?: string | null };
  publicType: { id: string; name: string; description?: string | null; icon: string };
  company: {
    id: string;
    name: string;
    slug: string;
    city?: string | null;
    state?: string | null;
    logoUrl?: string | null;
    deliveryFeeBase: number;
    avgDeliveryTimeMinutes: number;
  };
}

export interface MarketplaceProductType {
  id: string;
  name: string;
  description?: string | null;
  icon: string;
}

export interface MarketplaceSection {
  categoryId: string;
  categoryName: string;
  description?: string | null;
  icon: string;
  products: MarketplaceProduct[];
}

export interface MarketplaceResponse {
  productTypes: MarketplaceProductType[];
  featuredProducts: MarketplaceProduct[];
  sections: MarketplaceSection[];
}

export interface Address {
  id: string;
  label?: string | null;
  street: string;
  number: string;
  complement?: string | null;
  neighborhood: string;
  city: string;
  state: string;
  zipCode?: string | null;
  reference?: string | null;
  latitude?: number | null;
  longitude?: number | null;
  locationConfirmedAt?: string | null;
  isDefault: boolean;
}

export interface OrderItem {
  id: string;
  productId: string;
  productName: string;
  quantity: number;
  unitPrice: number;
  variationName?: string | null;
  addons?: { name: string; price: number }[] | null;
  optionSelections?: OrderItemOptionSelection[] | null;
  notes?: string | null;
  totalPrice: number;
}

export interface Order {
  id: string;
  companyId: string;
  fulfillmentType?: OrderFulfillmentType;
  status: OrderStatus;
  paymentMethod: PaymentMethod;
  paymentStatus: PaymentStatus;
  subtotal: number;
  deliveryFee: number;
  deliveryDistanceKm?: number | null;
  deliveryRouteDurationMinutes?: number | null;
  discount: number;
  total: number;
  notes?: string | null;
  pickupAddressLine?: string | null;
  pickupCity?: string | null;
  pickupState?: string | null;
  pickupZipCode?: string | null;
  deliveryStreet: string | null;
  deliveryNumber: string | null;
  deliveryNeighborhood: string | null;
  deliveryCity: string | null;
  deliveryState: string | null;
  deliveryLatitude?: number | null;
  deliveryLongitude?: number | null;
  createdAt: string;
  updatedAt: string;
  items: OrderItem[];
  statusHistory: { status: OrderStatus; createdAt: string }[];
  customerName?: string | null;
  customerPhone?: string | null;
  source?: "SITE" | "WHATSAPP";
  customer?: { id: string; name: string; email: string };
  delivery?: {
    id: string;
    status: DeliveryStatus;
    motoboyId?: string | null;
    motoboy?: { id: string; name: string } | null;
    motoboyLatitude?: number | null;
    motoboyLongitude?: number | null;
    motoboyLocationUpdatedAt?: string | null;
  } | null;
  company?: { id: string; name: string; slug: string; whatsapp?: string | null; addressLine?: string | null; city?: string | null; state?: string | null };
}

export interface DeliveryQuote {
  distanceKm: number;
  durationMinutes: number;
  deliveryFee: number;
  estimatedByPostalCode?: boolean;
  whatsappNotificationsAvailable?: boolean;
}

export interface Employee {
  id: string;
  position?: string | null;
  createdAt: string;
  user: { id: string; name: string; email: string; role: Role; isActive: boolean };
  rolePermissions: { permission: { key: string; description: string } }[];
}

export interface Delivery {
  id: string;
  status: DeliveryStatus;
  pickedUpAt?: string | null;
  deliveredAt?: string | null;
  notes?: string | null;
  problemReason?: DeliveryProblemReason | null;
  problemDescription?: string | null;
  statusBeforeProblem?: DeliveryStatus | null;
  problemReportedAt?: string | null;
  problemResolvedAt?: string | null;
  incidents?: Array<{
    id: string;
    previousStatus: DeliveryStatus;
    reason: DeliveryProblemReason;
    description?: string | null;
    reportedByUserId: string;
    reportedAt: string;
    resolvedAt?: string | null;
    resolvedByUserId?: string | null;
  }>;
  motoboyLatitude?: number | null;
  motoboyLongitude?: number | null;
  motoboyLocationUpdatedAt?: string | null;
  motoboy?: { id: string; name: string } | null;
  motoboyId?: string | null;
  order: {
    id: string;
    deliveryStreet: string;
    deliveryNumber: string;
    deliveryComplement?: string | null;
    deliveryNeighborhood: string;
    deliveryCity: string;
    deliveryState: string;
    deliveryLatitude?: number | null;
    deliveryLongitude?: number | null;
    deliveryReference?: string | null;
    customerName?: string | null;
    customerPhone?: string | null;
    customer?: { id: string; name: string };
  };
}

export interface CustomerProfile {
  id: string;
  totalOrders: number;
  lastOrderAt?: string | null;
  createdAt: string;
  user: { id: string; name: string; email: string };
}

export interface Promotion {
  id: string;
  title: string;
  description?: string | null;
  discountType: "PERCENTUAL" | "VALOR_FIXO";
  discountValue: number;
  status: PromotionStatus;
  startsAt?: string | null;
  endsAt?: string | null;
  createdAt: string;
}

export interface PublicPromotion extends Promotion {
  company: {
    id: string;
    name: string;
    slug: string;
    city?: string | null;
    state?: string | null;
    logoUrl?: string | null;
    avgDeliveryTimeMinutes: number;
    deliveryFeeBase: number;
  };
}

export interface PermissionCatalogItem {
  id: string;
  key: string;
  description: string;
}

export interface AIMessage {
  id: string;
  role: AIMessageRole;
  content: string;
  toolName?: string | null;
  createdAt: string;
}

export interface AIConversation {
  id: string;
  agentRole: AIAgentRole;
  channel: string;
  title?: string | null;
  updatedAt: string;
  _count?: { messages: number };
}

export interface AIConversationDetail extends AIConversation {
  messages: AIMessage[];
}

export interface MessagingChannel {
  id: string | null;
  status: MessagingChannelStatus;
  number?: string | null;
  automationEnabled: boolean;
  welcomeMessage?: string | null;
  orderNotifications?: {
    configured: boolean;
    templateId: string | null;
    templateName: string | null;
    languageCode: string;
    state?: string | null;
    error?: string | null;
  };
  connected: boolean;
  provider: "GUPSHUP";
  gupshup: {
    appId?: string | null;
    appName?: string | null;
    /** Link que o empresário abre para concluir o cadastro com o Facebook dele. */
    signupLink?: string | null;
    /**
     * COEXISTENCE mantém o número no WhatsApp Business App; PLATFORM_ONLY é o
     * fluxo antigo/exclusivo. `null` quer dizer que a conexão é anterior a essa
     * informação e não deve ser apresentada como coexistência por suposição.
     */
    connectionMode?: "COEXISTENCE" | "PLATFORM_ONLY" | null;
    /** Quando o empresário pediu o WhatsApp; dispara o trabalho manual do superadmin. */
    accessRequestedAt?: string | null;
    /** Quando o empresário avisou que concluiu o cadastro; falta a equipe ativar. */
    signupCompletedAt?: string | null;
  };
  integration: {
    connectedAt?: string | null;
    lastWebhookAt?: string | null;
    lastError?: string | null;
  };
  webhook: {
    url: string;
    tokenConfigured: boolean;
    encryptionConfigured: boolean;
  };
}

export interface WhatsAppMessage {
  id: string;
  direction: WhatsAppMessageDirection;
  status: WhatsAppMessageStatus;
  type: string;
  body?: string | null;
  pricingCategory?: string | null;
  errorMessage?: string | null;
  createdAt: string;
  sentBy?: { id: string; name: string } | null;
}

export interface WhatsAppConversation {
  id: string;
  customerPhone: string;
  customerName?: string | null;
  mode: WhatsAppConversationMode;
  status: WhatsAppConversationStatus;
  assignedToUserId?: string | null;
  assignedTo?: { id: string; name: string; email: string } | null;
  lastMessageText?: string | null;
  lastMessageAt: string;
  lastInboundAt?: string | null;
  humanRequestedAt?: string | null;
  channel?: {
    id: string;
    status: MessagingChannelStatus;
    metaDisplayPhoneNumber?: string | null;
    metaVerifiedName?: string | null;
    metaQualityRating?: string | null;
    automationEnabled: boolean;
  };
  _count?: { messages: number };
  orderDraft?: WhatsAppOrderDraft | null;
}

export interface WhatsAppOrderDraft {
  status: "MONTANDO" | "AGUARDANDO_CONFIRMACAO" | "CONCLUIDO" | "CANCELADO";
  customerName?: string | null;
  paymentMethod?: PaymentMethod | null;
  addressStreet?: string | null;
  addressNumber?: string | null;
  addressNeighborhood?: string | null;
  addressCity?: string | null;
  addressState?: string | null;
  quoteSnapshot?: {
    type?: string;
    checkout?: {
      subtotal?: number;
      total?: number;
      delivery?: { deliveryFee?: number; distanceKm?: number; durationMinutes?: number };
    };
    delivery?: { deliveryFee?: number; distanceKm?: number; durationMinutes?: number };
  } | null;
  updatedAt?: string;
}

export interface WhatsAppConversationDetail extends WhatsAppConversation {
  messages: WhatsAppMessage[];
  company: Pick<
    Company,
    | "id"
    | "name"
    | "phone"
    | "whatsapp"
    | "addressLine"
    | "city"
    | "state"
    | "deliveryFeeBase"
    | "deliveryFeePerKm"
    | "deliveryRadiusKm"
    | "avgDeliveryTimeMinutes"
    | "logoUrl"
  > & {
    settings?: Pick<CompanySettings, "openingHours" | "paymentMethodsEnabled" | "aiEnabled" | "aiKnowledgeBase"> | null;
  };
}

export interface PublicDiscoveryProduct {
  id: string;
  name: string;
  description?: string | null;
  price: number;
  imageUrl?: string | null;
  isFeatured: boolean;
  categoryName?: string | null;
  company: {
    id: string;
    name: string;
    slug: string;
    city?: string | null;
    state?: string | null;
    logoUrl?: string | null;
    deliveryFeeBase: number;
    avgDeliveryTimeMinutes: number;
  };
}

export interface PublicDiscoveryCompany {
  id: string;
  name: string;
  slug: string;
  city?: string | null;
  state?: string | null;
  logoUrl?: string | null;
  deliveryFeeBase: number;
  avgDeliveryTimeMinutes: number;
  deliveryAreas: string[];
  featuredProducts: {
    id: string;
    name: string;
    price: number;
    imageUrl?: string | null;
    isFeatured: boolean;
  }[];
}

export interface PublicDiscoveryResponse {
  summary: string;
  query: string;
  city?: string | null;
  neighborhood?: string | null;
  suggestions: string[];
  products: PublicDiscoveryProduct[];
  companies: PublicDiscoveryCompany[];
}

export interface SalesReport {
  period: { from: string; to: string };
  ordersCount: number;
  revenue: number;
  averageTicket: number;
}

export interface OrdersByStatusReport {
  status: OrderStatus;
  count: number;
}

export interface TopProductReport {
  productId: string;
  productName: string;
  quantitySold: number;
  revenue: number;
}

export interface RecurringCustomerReport {
  id: string;
  totalOrders: number;
  lastOrderAt?: string | null;
  user: { name: string; email: string };
}

export interface DelayedDeliveryReport {
  id: string;
  status: DeliveryStatus;
  createdAt: string;
  motoboy?: { name: string } | null;
  order: { id: string; deliveryNeighborhood: string };
}

export interface MotoboyPerformanceReport {
  motoboyId: string;
  name: string;
  deliveriesCompleted: number;
  averageMinutesPerDelivery: number;
}

export interface PeakHourReport {
  hour: number;
  count: number;
}

export interface GlobalOverview {
  activeCompanies: number;
  totalCompanies: number;
  totalOrders: number;
  estimatedRevenue: number;
}

export interface TopCompany {
  company: { id: string; name: string; slug: string } | undefined;
  ordersCount: number;
  revenue: number;
}

export interface GrowthPoint {
  date: string;
  orders: number;
  revenue: number;
}

/** Resposta de GET /catalog/public/search — busca do marketplace assistida por IA. */
export interface PublicSearchInterpretation {
  /** O texto exatamente como a pessoa digitou. */
  query: string;
  /** Termos efetivamente usados na consulta, incluindo os que a IA relacionou. */
  terms: string[];
  maxPrice: number | null;
  /** Frase em pt-BR explicando a interpretação, para exibir ao cliente. */
  explanation: string;
  /** false quando a IA estava indisponível e valeu a expansão determinística. */
  assisted: boolean;
}

export interface PublicSearchResponse {
  interpretation: PublicSearchInterpretation;
  products: Paginated<MarketplaceProduct>;
  companies: Company[];
}

/**
 * Situação fiscal da empresa (GET /fiscal/profile).
 *
 * Nada aqui carrega segredo: o certificado e o token do CSC ficam cifrados no
 * servidor e não voltam. `hasCscToken` existe para a tela saber se o campo de
 * senha deve dizer "deixe em branco para manter".
 */
export interface FiscalProfile {
  id: string;
  taxRegime: TaxRegime;
  cnae: string;
  stateRegistration: string;
  municipalRegistration: string | null;
  legalName: string;
  tradeName: string | null;
  addressStreet: string;
  addressNumber: string;
  addressComplement: string | null;
  addressDistrict: string;
  cityIbgeCode: string;
  cityName: string;
  state: string;
  zipCode: string;
  environment: FiscalEnvironment;
  nfceSeries: number;
  nfceNextNumber: number;
  autoEmit: boolean;
  cscId: string | null;
  hasCscToken: boolean;
  defaultNcm: string | null;
  defaultCest: string | null;
  defaultCfop: string;
  defaultTaxOrigin: TaxOrigin;
  defaultIcmsCode: string | null;
  defaultIcmsRate: number | null;
  defaultIcmsReductionRate: number | null;
  defaultPisCode: string | null;
  defaultPisRate: number | null;
  defaultCofinsCode: string | null;
  defaultCofinsRate: number | null;
  defaultUnit: string;
}

/** Um produto na visão fiscal: o que falta para ele poder sair numa nota. */
export interface ProductTaxStatus {
  id: string;
  name: string;
  ready: boolean;
  pendencias: string[];
  herdados: string[];
}

export interface ProductTaxStatusResponse {
  total: number;
  pending: number;
  items: ProductTaxStatus[];
}

export interface FiscalCertificateInfo {
  id: string;
  fileName: string;
  subjectName: string;
  issuerName: string;
  serialNumber: string;
  notBefore: string;
  notAfter: string;
  status: FiscalCertificateStatus;
  daysUntilExpiry: number;
  createdAt: string;
}

export interface FiscalStatus {
  profile: FiscalProfile | null;
  certificate: FiscalCertificateInfo | null;
  products: { total: number; pending: number };
  readiness: {
    canEmitInProduction: boolean;
    /** Impedem emitir. */
    pendencias: string[];
    /** Não impedem emitir, mas o lojista precisa saber. */
    avisos: string[];
  };
  /** Última conversa real com a SEFAZ (consulta de status do serviço). */
  sefaz: {
    checkedAt: string;
    code: string | null;
    reason: string | null;
    online: boolean;
  } | null;
}

/** Resposta de POST /fiscal/sefaz/testar. */
export interface SefazCheckResult {
  online: boolean;
  uf: string;
  environment: FiscalEnvironment;
  code: string | null;
  reason: string | null;
  checkedAt: string;
}

/** Ponto de venda físico (GET /caixa/pontos). */
export interface CashRegister {
  id: string;
  name: string;
  isActive: boolean;
  sessions?: Array<{ id: string; status: CashSessionStatus; openedAt: string }>;
}

export interface CashMovement {
  id: string;
  type: CashMovementType;
  amount: number;
  reason: string;
  createdAt: string;
}

/**
 * Apuração de um turno.
 *
 * `margin.available` é falso quando algum item vendido não tinha custo
 * cadastrado. Nesse caso `grossProfit` vem nulo em vez de um número inflado —
 * margem calculada sobre custo parcial é pior que margem nenhuma, porque
 * parece confiável.
 */
export interface CashSessionSummary {
  expected: { cash: number; card: number; pix: number };
  sales: {
    total: number;
    products: number;
    delivery: number;
    discount: number;
    orderCount: number;
    averageTicket: number;
  };
  margin: {
    available: boolean;
    cost: number;
    grossProfit: number | null;
    grossMarginPercent: number | null;
    itemsWithoutCost: number;
    itemsTotal: number;
  };
  losses: {
    cancelled: number;
    cancelledCount: number;
    unpaid: number;
    unpaidCount: number;
  };
  /** Totais de sangria e suprimento — distinto da lista de movimentações. */
  cashFlow: { supply: number; withdrawal: number };
}

/**
 * Relatório do turno. Enquanto aberto é calculado em tempo real; ao fechar
 * vira documento congelado — a conferência precisa ser a foto do momento em
 * que a gaveta foi contada.
 */
export interface CashSessionReport extends CashSessionSummary {
  id: string;
  status: CashSessionStatus;
  cashRegister: { id: string; name: string };
  openedAt: string;
  closedAt: string | null;
  openingAmount: number;
  countedAmount: number | null;
  difference: number | null;
  movements: CashMovement[];
  notes: string | null;
}

/** Um turno na listagem do histórico. */
export interface CashSessionListItem {
  id: string;
  status: CashSessionStatus;
  cashRegister: { id: string; name: string };
  openedAt: string;
  closedAt: string | null;
  openingAmount: number;
  countedAmount: number | null;
  difference: number | null;
  notes: string | null;
  /** Nulo em turnos fechados antes desta funcionalidade existir. */
  summary: CashSessionSummary | null;
}

export interface CashHistoryResponse {
  items: CashSessionListItem[];
  totals: {
    sessions: number;
    revenue: number;
    orderCount: number;
    cancelled: number;
    difference: number;
    withdrawals: number;
    /** Nulo quando algum turno do período tem item sem custo cadastrado. */
    grossProfit: number | null;
  };
}

/** NFC-e emitida (GET /fiscal/nfce). */
export interface FiscalDocument {
  id: string;
  orderId: string | null;
  tableSessionId: string | null;
  status: FiscalDocumentStatus;
  emissionType: FiscalEmissionType;
  environment: FiscalEnvironment;
  series: number;
  number: number;
  accessKey: string | null;
  issuedAt: string;
  authorizedAt: string | null;
  protocolNumber: string | null;
  totalAmount: number;
  qrCodeUrl: string | null;
  statusCode: string | null;
  statusReason: string | null;
  /** Instrução em português do que fazer — ver fiscal/nfce/rejections.ts. */
  actionHint: string | null;
  attempts: number;
  createdAt: string;
}
