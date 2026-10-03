# Encerramento seguro da homologação fechada

Esta versão remove as regras temporárias de criação e de catálogo usadas
durante a homologação fechada. Ela não altera assinaturas, testes gratuitos,
ou cobranças que já existem.

## Publicação da versão

Depois de publicar esta versão da API, abra o serviço da API no Render em
**Environment** e remova estas variáveis, se ainda existirem:

- `TEMP_TEST_MODE_ENABLED`
- `TEMP_TEST_ALLOWED_CREATION_IPS`
- `TEMP_TEST_CATALOG_EMAIL`

Salve as alterações e faça um redeploy do serviço. A nova versão não lê mais
essas variáveis, mas removê-las evita que uma configuração antiga gere dúvida
em operações futuras.

## Empresas criadas no modo de teste

Empresas legadas com `isTestOnly = true` continuam preservadas, mas não
aparecem no catálogo, busca, sitemap, IA pública ou fluxos públicos de pedido.
A única exceção é a operação `operacao-demo-chegowia`, mantida para uma
verificação privada: só a conta `thiagolpssouza@gmail.com`, autenticada e com
endereço salvo no raio real de entrega, pode enxergá-la. Essa regra é aplicada
no servidor, por e-mail e rota, e não transforma as demais empresas de teste
em públicas. Não promova nem apague esses registros automaticamente.

No **Shell** do Render, dentro de `/app`, use o comando abaixo para listar os
registros antes de qualquer decisão administrativa:

```sh
node -e 'const {PrismaClient}=require("@prisma/client");const p=new PrismaClient();p.company.findMany({where:{isTestOnly:true},orderBy:{createdAt:"asc"},select:{id:true,name:true,slug:true,isActive:true,isTestOnly:true,createdAt:true,updatedAt:true}}).then(r=>console.log(JSON.stringify(r,null,2))).catch(console.error).finally(()=>p.$disconnect())'
```

Envie a saída para a pessoa responsável pela plataforma e obtenha uma decisão
individual para cada empresa: **manter oculta**, **promover** ou **remover**.

## Assinaturas e preços

O preço público e das novas assinaturas é R$ 159,90. Assinaturas e períodos de
teste criados anteriormente mantêm seus próprios registros e snapshots. Não há
backfill de cobrança, nem cobrança retroativa por uso feito na homologação.

Após o deploy, a conferência abaixo mostra o valor efetivamente registrado para
cada plano no banco de produção. Ela é somente leitura:

```sh
node -e 'const {PrismaClient}=require("@prisma/client");const p=new PrismaClient();p.softwarePlan.findMany({select:{id:true,slug:true,name:true,monthlyPrice:true,isActive:true,stripePriceId:true}}).then(r=>console.log(JSON.stringify(r,null,2))).catch(console.error).finally(()=>p.$disconnect())'
```

## Verificação da migração de suporte

Antes de um novo deploy, confirme que a migração de suporte não está marcada
como falha no banco de produção:

```sh
node -e 'const {PrismaClient}=require("@prisma/client");const p=new PrismaClient();p.$queryRawUnsafe("SELECT migration_name, logs, started_at, finished_at, rolled_back_at FROM _prisma_migrations WHERE migration_name = ?","20260810170000_add_platform_support_inbox").then(r=>console.log(JSON.stringify(r,null,2))).catch(console.error).finally(()=>p.$disconnect())'
```

Se a consulta devolver uma migração sem `finished_at` e sem `rolled_back_at`,
não faça outro deploy até recuperar o estado da migração com uma revisão
técnica. A migração versionada nesta base já usa o nome curto de índice aceito
pelo MySQL.
