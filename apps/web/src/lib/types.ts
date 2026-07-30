import { AIAgentRole, DeliveryStatus, OrderStatus, PaymentMethod, PaymentStatus, PromotionStatus, Role } from "@chegowia/shared";

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
  deliveryFeeBase: number;
  avgDeliveryTimeMinutes: number;
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

export interface Product {
  id: string;
  categoryId: string;
  name: string;
  description?: string | null;
  price: number;
  imageUrl?: string | null;
  isActive: boolean;
  isFeatured: boolean;
  variations: ProductVariation[];
  addons: ProductAddon[];
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
  total: number;
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
  notes?: string | null;
  totalPrice: number;
}

export interface Order {
  id: string;
  companyId: string;
  status: OrderStatus;
  paymentMethod: PaymentMethod;
  paymentStatus: PaymentStatus;
  subtotal: number;
  deliveryFee: number;
  discount: number;
  total: number;
  notes?: string | null;
  deliveryStreet: string;
  deliveryNumber: string;
  deliveryNeighborhood: string;
  deliveryCity: string;
  deliveryState: string;
  createdAt: string;
  updatedAt: string;
  items: OrderItem[];
  statusHistory: { status: OrderStatus; createdAt: string }[];
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
  company?: { id: string; name: string; slug: string; whatsapp?: string | null };
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
    deliveryReference?: string | null;
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
  role: "USER" | "ASSISTANT" | "SYSTEM" | "TOOL";
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
