"use client";

import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { PermissionKey, Role, TaxRegime } from "@chegowia/shared";
import { api, apiErrorMessage } from "@/lib/api-client";
import { useAuthStore } from "@/lib/auth-store";
import { Category, FiscalStatus, Paginated, Product } from "@/lib/types";
import { formatCurrency } from "@/lib/format";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { FormField, Input, Select, Textarea } from "@/components/ui/input";
import {
  EMPTY_PRODUCT_TAX,
  ProductTaxDraft,
  ProductTaxFields,
  productTaxDraftFrom,
  productTaxPayload,
} from "@/components/catalog/product-tax-fields";
import { Modal } from "@/components/ui/modal";
import { Badge } from "@/components/ui/badge";
import { ProductImage } from "@/components/catalog/product-image";
import { CatalogImportPanel } from "@/components/catalog/catalog-import-panel";

interface VariationDraft {
  name: string;
  priceDelta: string;
}

interface AddonDraft {
  name: string;
  price: string;
}

export default function CardapioPage() {
  const queryClient = useQueryClient();
  const user = useAuthStore((state) => state.user);
  const canEditMenu = user?.role === Role.ADMIN || user?.permissionKeys?.includes(PermissionKey.CARDAPIO_EDITAR);
  const [error, setError] = useState<string | null>(null);

  const [categoryModalOpen, setCategoryModalOpen] = useState(false);
  const [editingCategory, setEditingCategory] = useState<Category | null>(null);
  const [categoryName, setCategoryName] = useState("");
  const [categoryDescription, setCategoryDescription] = useState("");

  const [productModalOpen, setProductModalOpen] = useState(false);
  const [editingProduct, setEditingProduct] = useState<Product | null>(null);
  const [productForm, setProductForm] = useState({
    categoryId: "",
    name: "",
    description: "",
    price: "",
    costPrice: "",
    imageUrl: "",
    isFeatured: false,
  });
  const [productImageFile, setProductImageFile] = useState<File | null>(null);
  const [imagePreviewUrl, setImagePreviewUrl] = useState<string | null>(null);
  const [variationsDraft, setVariationsDraft] = useState<VariationDraft[]>([]);
  const [addonsDraft, setAddonsDraft] = useState<AddonDraft[]>([]);
  const [taxDraft, setTaxDraft] = useState<ProductTaxDraft>(EMPTY_PRODUCT_TAX);

  // O regime decide se o campo de ICMS oferece CSOSN ou CST. Sem cadastro
  // fiscal ainda, o Simples é o padrão — é o caso da esmagadora maioria dos
  // restaurantes que assinam sozinhos pelo site.
  const { data: fiscal } = useQuery({
    queryKey: ["fiscal-profile"],
    queryFn: async () => {
      const { data } = await api.get<FiscalStatus>("/fiscal/profile");
      return data;
    },
    retry: false,
  });
  const taxRegime = fiscal?.profile?.taxRegime ?? TaxRegime.SIMPLES_NACIONAL;

  useEffect(() => {
    if (!productImageFile) {
      setImagePreviewUrl(productForm.imageUrl || null);
      return;
    }
    const objectUrl = URL.createObjectURL(productImageFile);
    setImagePreviewUrl(objectUrl);
    return () => URL.revokeObjectURL(objectUrl);
  }, [productForm.imageUrl, productImageFile]);

  const { data: categories, isLoading: loadingCategories } = useQuery({
    queryKey: ["categories"],
    queryFn: async () => {
      const { data } = await api.get<Category[]>("/catalog/categories");
      return data;
    },
  });

  const { data: productsData, isLoading: loadingProducts } = useQuery({
    queryKey: ["products-all"],
    queryFn: async () => {
      const { data: firstPage } = await api.get<Paginated<Product>>("/catalog/products", { params: { pageSize: 100 } });
      // A importação aceita mais de uma página de itens. Buscar as páginas
      // restantes evita que um cardápio recém-importado pareça incompleto só
      // porque a API protege cada resposta individual com o limite de 100.
      if (firstPage.totalPages <= 1) return firstPage;
      const pages = await Promise.all(
        Array.from({ length: firstPage.totalPages - 1 }, (_, index) =>
          api.get<Paginated<Product>>("/catalog/products", { params: { page: index + 2, pageSize: 100 } }).then((response) => response.data),
        ),
      );
      return { ...firstPage, items: [...firstPage.items, ...pages.flatMap((page) => page.items)] };
    },
  });

  const products = productsData?.items ?? [];
  const featuredCount = products.filter((product) => product.isFeatured).length;
  const activeCount = products.filter((product) => product.isActive).length;

  const productsByCategory = new Map<string, Product[]>();
  for (const product of products) {
    const list = productsByCategory.get(product.categoryId) ?? [];
    list.push(product);
    productsByCategory.set(product.categoryId, list);
  }

  function openCreateCategory() {
    setEditingCategory(null);
    setCategoryName("");
    setCategoryDescription("");
    setCategoryModalOpen(true);
  }

  function openEditCategory(category: Category) {
    setEditingCategory(category);
    setCategoryName(category.name);
    setCategoryDescription(category.description ?? "");
    setCategoryModalOpen(true);
  }

  const saveCategory = useMutation({
    mutationFn: async () => {
      if (editingCategory) {
        const { data } = await api.patch(`/catalog/categories/${editingCategory.id}`, {
          name: categoryName,
          description: categoryDescription || undefined,
        });
        return data;
      }
      const { data } = await api.post("/catalog/categories", {
        name: categoryName,
        description: categoryDescription || undefined,
      });
      return data;
    },
    onSuccess: () => {
      setError(null);
      setCategoryModalOpen(false);
      queryClient.invalidateQueries({ queryKey: ["categories"] });
    },
    onError: (err) => setError(apiErrorMessage(err)),
  });

  const toggleCategoryActive = useMutation({
    mutationFn: async (category: Category) => {
      const { data } = await api.patch(`/catalog/categories/${category.id}`, { isActive: !category.isActive });
      return data;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["categories"] }),
    onError: (err) => setError(apiErrorMessage(err)),
  });

  function resetProductForm(categoryId = "") {
    setProductForm({ categoryId, name: "", description: "", price: "", costPrice: "", imageUrl: "", isFeatured: false });
    setTaxDraft(EMPTY_PRODUCT_TAX);
    setProductImageFile(null);
    setVariationsDraft([]);
    setAddonsDraft([]);
  }

  function openCreateProduct(categoryId?: string) {
    setEditingProduct(null);
    resetProductForm(categoryId ?? "");
    setProductModalOpen(true);
  }

  function openEditProduct(product: Product) {
    setEditingProduct(product);
    setProductForm({
      categoryId: product.categoryId,
      name: product.name,
      description: product.description ?? "",
      price: String(product.price),
      costPrice: product.costPrice === null || product.costPrice === undefined ? "" : String(product.costPrice),
      imageUrl: product.imageUrl ?? "",
      isFeatured: product.isFeatured,
    });
    setTaxDraft(productTaxDraftFrom(product as never));
    setProductImageFile(null);
    setVariationsDraft([]);
    setAddonsDraft([]);
    setProductModalOpen(true);
  }

  async function uploadProductImage(productId: string) {
    if (!productImageFile) return null;
    const formData = new FormData();
    formData.append("file", productImageFile);
    const { data } = await api.post(`/catalog/products/${productId}/image`, formData);
    return data;
  }

  const saveProduct = useMutation({
    mutationFn: async () => {
      const basePayload = {
        categoryId: productForm.categoryId,
        name: productForm.name,
        description: productForm.description || undefined,
        price: Number(productForm.price),
        // Vazio significa "sem custo cadastrado", não zero: custo zero faria a
        // margem do turno aparecer como 100%.
        costPrice: productForm.costPrice.trim() ? Number(productForm.costPrice) : undefined,
        imageUrl: productForm.imageUrl || undefined,
        isFeatured: productForm.isFeatured,
        ...productTaxPayload(taxDraft),
      };

      const saved = editingProduct
        ? await api.patch<Product>(`/catalog/products/${editingProduct.id}`, basePayload).then((response) => response.data)
        : await api
            .post<Product>("/catalog/products", {
              ...basePayload,
              variations: variationsDraft
                .filter((variation) => variation.name)
                .map((variation) => ({ name: variation.name, priceDelta: Number(variation.priceDelta || 0) })),
              addons: addonsDraft
                .filter((addon) => addon.name)
                .map((addon) => ({ name: addon.name, price: Number(addon.price || 0) })),
            })
            .then((response) => response.data);

      if (productImageFile) await uploadProductImage(saved.id);
      return saved;
    },
    onSuccess: () => {
      setError(null);
      setProductModalOpen(false);
      queryClient.invalidateQueries({ queryKey: ["products-all"] });
    },
    onError: (err) => setError(apiErrorMessage(err)),
  });

  const toggleProductActive = useMutation({
    mutationFn: async (product: Product) => {
      const { data } = await api.patch(`/catalog/products/${product.id}`, { isActive: !product.isActive });
      return data;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["products-all"] }),
    onError: (err) => setError(apiErrorMessage(err)),
  });

  return (
    <div className="space-y-6">
      <div className="flex flex-col justify-between gap-4 lg:flex-row lg:items-end">
        <div>
          <p className="text-xs font-bold uppercase tracking-wide text-brand-700 dark:text-brand-300">Catálogo da empresa</p>
          <h1 className="mt-1 text-3xl font-black text-slate-950 dark:text-slate-50">Cardápio</h1>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
            Organize categorias, fotos, preços, adicionais e destaques que aparecem para os clientes.
          </p>
        </div>
        {canEditMenu && (
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" onClick={openCreateCategory}>
              Nova categoria
            </Button>
            <Button onClick={() => openCreateProduct()}>Novo produto</Button>
          </div>
        )}
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <Metric label="Produtos ativos" value={activeCount} tone="brand" />
        <Metric label="Em destaque" value={featuredCount} tone="accent" />
        <Metric label="Categorias" value={categories?.length ?? 0} tone="slate" />
      </div>

      {canEditMenu && (
        <CatalogImportPanel
          onComplete={() => {
            queryClient.invalidateQueries({ queryKey: ["categories"] });
            queryClient.invalidateQueries({ queryKey: ["products-all"] });
          }}
        />
      )}

      {error && <p className="rounded-lg bg-red-50 px-4 py-2 text-sm text-red-600 dark:bg-red-900/20 dark:text-red-400">{error}</p>}
      {loadingCategories && <p className="text-sm text-slate-500 dark:text-slate-400">Carregando categorias...</p>}

      <div className="space-y-6">
        {categories?.map((category) => {
          const categoryProducts = productsByCategory.get(category.id) ?? [];
          return (
            <Card key={category.id}>
              <CardHeader className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <CardTitle>{category.name}</CardTitle>
                    <Badge tone={category.isActive ? "success" : "neutral"}>
                      {category.isActive ? "Ativa" : "Inativa"}
                    </Badge>
                    <Badge tone="info">{categoryProducts.length} produtos</Badge>
                  </div>
                  {category.description && <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">{category.description}</p>}
                </div>
                {canEditMenu && (
                  <div className="flex flex-wrap gap-2">
                    <Button size="sm" variant="outline" onClick={() => openEditCategory(category)}>
                      Editar
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      isLoading={toggleCategoryActive.isPending}
                      onClick={() => toggleCategoryActive.mutate(category)}
                    >
                      {category.isActive ? "Desativar" : "Ativar"}
                    </Button>
                    <Button size="sm" onClick={() => openCreateProduct(category.id)}>
                      Produto
                    </Button>
                  </div>
                )}
              </CardHeader>
              <CardContent>
                {loadingProducts ? (
                  <p className="text-sm text-slate-500 dark:text-slate-400">Carregando produtos...</p>
                ) : categoryProducts.length ? (
                  <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                    {categoryProducts.map((product) => (
                      <AdminProductCard
                        key={product.id}
                        product={product}
                        onEdit={() => openEditProduct(product)}
                        onToggle={() => toggleProductActive.mutate(product)}
                        canEdit={Boolean(canEditMenu)}
                      />
                    ))}
                  </div>
                ) : (
                  <div className="rounded-lg border border-dashed border-slate-300 bg-slate-50 p-6 text-center dark:bg-slate-800/60 dark:border-slate-700">
                    <p className="text-sm font-medium text-slate-600 dark:text-slate-400">Nenhum produto nesta categoria.</p>
                    {canEditMenu && (
                      <Button className="mt-3" size="sm" onClick={() => openCreateProduct(category.id)}>
                        Cadastrar produto
                      </Button>
                    )}
                  </div>
                )}
              </CardContent>
            </Card>
          );
        })}
      </div>

      <Modal
        open={categoryModalOpen}
        onClose={() => setCategoryModalOpen(false)}
        title={editingCategory ? "Editar categoria" : "Nova categoria"}
      >
        <div className="space-y-4">
          <FormField label="Nome">
            <Input value={categoryName} onChange={(e) => setCategoryName(e.target.value)} />
          </FormField>
          <FormField label="Descrição">
            <Textarea value={categoryDescription} onChange={(e) => setCategoryDescription(e.target.value)} />
          </FormField>
          <Button className="w-full" isLoading={saveCategory.isPending} onClick={() => saveCategory.mutate()}>
            Salvar
          </Button>
        </div>
      </Modal>

      <Modal
        open={productModalOpen}
        onClose={() => setProductModalOpen(false)}
        title={editingProduct ? "Editar produto" : "Novo produto"}
      >
        <div className="max-h-[72vh] space-y-4 overflow-y-auto pr-1">
          <div className="grid gap-3 sm:grid-cols-[140px_1fr]">
            <ProductImage src={imagePreviewUrl} alt={productForm.name || "Produto"} className="h-36 w-full" />
            <div className="space-y-3">
              <label className="block cursor-pointer rounded-lg border border-dashed border-brand-200 bg-brand-50 px-4 py-3 text-sm font-semibold text-brand-800 hover:bg-brand-100 dark:bg-brand-950/30 dark:border-brand-900/60 dark:text-brand-300">
                Enviar foto do produto
                <input
                  type="file"
                  accept="image/*"
                  className="sr-only"
                  onChange={(event) => setProductImageFile(event.target.files?.[0] ?? null)}
                />
              </label>
              <FormField label="URL da imagem">
                <Input
                  placeholder="https://..."
                  value={productForm.imageUrl}
                  onChange={(event) => {
                    setProductImageFile(null);
                    setProductForm((form) => ({ ...form, imageUrl: event.target.value }));
                  }}
                />
              </FormField>
            </div>
          </div>

          <FormField label="Categoria">
            <Select
              value={productForm.categoryId}
              onChange={(e) => setProductForm((form) => ({ ...form, categoryId: e.target.value }))}
            >
              <option value="">Selecione...</option>
              {categories?.map((category) => (
                <option key={category.id} value={category.id}>
                  {category.name}
                </option>
              ))}
            </Select>
          </FormField>
          <FormField label="Nome">
            <Input
              value={productForm.name}
              onChange={(e) => setProductForm((form) => ({ ...form, name: e.target.value }))}
            />
          </FormField>
          <FormField label="Descrição">
            <Textarea
              value={productForm.description}
              onChange={(e) => setProductForm((form) => ({ ...form, description: e.target.value }))}
            />
          </FormField>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <FormField label="Preço de venda">
              <Input
                type="number"
                step="0.01"
                value={productForm.price}
                onChange={(e) => setProductForm((form) => ({ ...form, price: e.target.value }))}
              />
            </FormField>
            <FormField label="Custo (opcional)">
              <Input
                type="number"
                step="0.01"
                min="0"
                placeholder="Sem custo cadastrado"
                value={productForm.costPrice}
                onChange={(e) => setProductForm((form) => ({ ...form, costPrice: e.target.value }))}
              />
            </FormField>
          </div>
          <p className="-mt-2 text-xs text-slate-400 dark:text-slate-500">
            O custo alimenta a margem no fechamento de caixa. Sem ele, o turno mostra faturamento e
            não calcula lucro — e basta um item sem custo para a margem do dia inteiro ficar
            indisponível, porque margem parcial engana.
          </p>
          <label className="flex items-center justify-between rounded-lg border border-slate-200 px-3 py-2 text-sm font-medium text-slate-700 dark:border-slate-800 dark:text-slate-300">
            Produto em destaque
            <input
              type="checkbox"
              checked={productForm.isFeatured}
              onChange={(e) => setProductForm((form) => ({ ...form, isFeatured: e.target.checked }))}
            />
          </label>

          <ProductTaxFields value={taxDraft} onChange={setTaxDraft} regime={taxRegime} />

          {!editingProduct && (
            <>
              <DraftList
                title="Variações"
                actionLabel="Variação"
                onAdd={() => setVariationsDraft((list) => [...list, { name: "", priceDelta: "0" }])}
              >
                {variationsDraft.map((variation, index) => (
                  <div key={index} className="grid gap-2 sm:grid-cols-[1fr_120px_auto]">
                    <Input
                      placeholder="Nome (ex: Grande)"
                      value={variation.name}
                      onChange={(e) =>
                        setVariationsDraft((list) =>
                          list.map((item, itemIndex) =>
                            itemIndex === index ? { ...item, name: e.target.value } : item,
                          ),
                        )
                      }
                    />
                    <Input
                      type="number"
                      step="0.01"
                      placeholder="+ Preço"
                      value={variation.priceDelta}
                      onChange={(e) =>
                        setVariationsDraft((list) =>
                          list.map((item, itemIndex) =>
                            itemIndex === index ? { ...item, priceDelta: e.target.value } : item,
                          ),
                        )
                      }
                    />
                    <Button
                      variant="ghost"
                      size="sm"
                      type="button"
                      onClick={() => setVariationsDraft((list) => list.filter((_, itemIndex) => itemIndex !== index))}
                    >
                      Remover
                    </Button>
                  </div>
                ))}
              </DraftList>

              <DraftList
                title="Adicionais"
                actionLabel="Adicional"
                onAdd={() => setAddonsDraft((list) => [...list, { name: "", price: "0" }])}
              >
                {addonsDraft.map((addon, index) => (
                  <div key={index} className="grid gap-2 sm:grid-cols-[1fr_120px_auto]">
                    <Input
                      placeholder="Nome (ex: Bacon)"
                      value={addon.name}
                      onChange={(e) =>
                        setAddonsDraft((list) =>
                          list.map((item, itemIndex) => (itemIndex === index ? { ...item, name: e.target.value } : item)),
                        )
                      }
                    />
                    <Input
                      type="number"
                      step="0.01"
                      placeholder="Preço"
                      value={addon.price}
                      onChange={(e) =>
                        setAddonsDraft((list) =>
                          list.map((item, itemIndex) => (itemIndex === index ? { ...item, price: e.target.value } : item)),
                        )
                      }
                    />
                    <Button
                      variant="ghost"
                      size="sm"
                      type="button"
                      onClick={() => setAddonsDraft((list) => list.filter((_, itemIndex) => itemIndex !== index))}
                    >
                      Remover
                    </Button>
                  </div>
                ))}
              </DraftList>
            </>
          )}

          <Button
            className="w-full"
            disabled={!productForm.categoryId || !productForm.name || !productForm.price}
            isLoading={saveProduct.isPending}
            onClick={() => saveProduct.mutate()}
          >
            Salvar produto
          </Button>
        </div>
      </Modal>
    </div>
  );
}

function Metric({ label, value, tone }: { label: string; value: number; tone: "brand" | "accent" | "slate" }) {
  const classes = {
    brand: "bg-brand-50 text-brand-800 dark:bg-brand-950/30 dark:text-brand-300",
    accent: "bg-accent-50 text-accent-800",
    slate: "bg-white text-slate-800 dark:bg-slate-900 dark:text-slate-200",
  };

  return (
    <div className={`rounded-lg border border-slate-200 px-4 py-3 shadow-soft ${classes[tone]}`}>
      <p className="text-2xl font-black">{value}</p>
      <p className="text-xs font-bold uppercase tracking-wide opacity-75">{label}</p>
    </div>
  );
}

function AdminProductCard({
  product,
  onEdit,
  onToggle,
  canEdit,
}: {
  product: Product;
  onEdit: () => void;
  onToggle: () => void;
  canEdit: boolean;
}) {
  return (
    <article className="overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm transition hover:border-brand-200 hover:shadow-soft dark:bg-slate-900 dark:border-slate-800">
      <ProductImage src={product.imageUrl} alt={product.name} className="h-40 w-full rounded-none" />
      <div className="space-y-3 p-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h3 className="line-clamp-1 font-bold text-slate-950 dark:text-slate-100">{product.name}</h3>
            {product.description && <p className="mt-1 line-clamp-2 text-sm text-slate-500 dark:text-slate-400">{product.description}</p>}
          </div>
          <p className="shrink-0 text-sm font-black text-brand-700 dark:text-brand-300">{formatCurrency(Number(product.price))}</p>
        </div>
        <div className="flex flex-wrap gap-1.5">
          <Badge tone={product.isActive ? "success" : "neutral"}>{product.isActive ? "Ativo" : "Inativo"}</Badge>
          {product.isFeatured && <Badge tone="brand">Destaque</Badge>}
          {product.variations.length > 0 && <Badge tone="info">{product.variations.length} variações</Badge>}
          {product.addons.length > 0 && <Badge tone="warning">{product.addons.length} adicionais</Badge>}
        </div>
        {canEdit && (
          <div className="flex gap-2">
            <Button className="flex-1" size="sm" variant="outline" onClick={onEdit}>
              Editar
            </Button>
            <Button className="flex-1" size="sm" variant="ghost" onClick={onToggle}>
              {product.isActive ? "Desativar" : "Ativar"}
            </Button>
          </div>
        )}
      </div>
    </article>
  );
}

function DraftList({
  title,
  actionLabel,
  onAdd,
  children,
}: {
  title: string;
  actionLabel: string;
  onAdd: () => void;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-lg border border-slate-200 p-3 dark:border-slate-800">
      <div className="mb-3 flex items-center justify-between gap-2">
        <p className="text-sm font-bold text-slate-800 dark:text-slate-200">{title}</p>
        <Button size="sm" variant="outline" type="button" onClick={onAdd}>
          {actionLabel}
        </Button>
      </div>
      <div className="space-y-2">{children}</div>
    </div>
  );
}
