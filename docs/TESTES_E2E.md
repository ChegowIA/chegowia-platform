# Testes de ponta a ponta — ChegowIA

Roteiro para validar o sistema inteiro, área por área e perfil por perfil.

**Para a IA que vai executar:** rode primeiro a seção 2 (automatizado). Ela é rápida
e pega regressão de lógica. Os roteiros manuais das seções 4 em diante existem para
o que teste automatizado não alcança: navegação real, permissão de tela, integração
com Asaas e SEFAZ, e o comportamento visto pelo consumidor.

Ao executar um roteiro, **relate o que aconteceu de verdade**. Um passo que você não
conseguiu executar não é um passo que passou — diga que não executou e por quê. Se
um resultado divergir do esperado, registre a divergência com o que apareceu na tela,
no log da API e no banco, sem tentar consertar antes de reportar.

---

## 1. Preparação

### 1.1 Banco descartável

Os testes e2e apagam dados. O harness recusa rodar contra um schema que não termine
em `_e2e`, mas o roteiro manual usa o banco de desenvolvimento — **nunca aponte
qualquer coisa daqui para produção**.

```sh
docker run -d --name chegowia-teste \
  -e MYSQL_ROOT_PASSWORD=teste -e MYSQL_DATABASE=chegowia \
  -p 3399:3306 mysql:8.0

# espere ficar de pé
until docker exec chegowia-teste mysqladmin ping -h 127.0.0.1 -uroot -pteste --silent; do sleep 1; done

export DATABASE_URL="mysql://root:teste@127.0.0.1:3399/chegowia"
npm run prisma:migrate --workspace apps/api   # ou: prisma migrate deploy
npm run prisma:seed --workspace apps/api
```

Ao terminar: `docker rm -f chegowia-teste`.

### 1.2 Variáveis mínimas para subir a API

```sh
DATABASE_URL="mysql://root:teste@127.0.0.1:3399/chegowia"
JWT_ACCESS_SECRET="segredo-de-teste-com-mais-de-32-caracteres"
APP_URL="http://localhost:3000"
CORS_ORIGIN="http://localhost:3000"
FISCAL_ENCRYPTION_KEY="MDEyMzQ1Njc4OWFiY2RlZjAxMjM0NTY3ODlhYmNkZWY="
WHATSAPP_TOKEN_ENCRYPTION_KEY="ZmVkY2JhOTg3NjU0MzIxMGZlZGNiYTk4NzY1NDMyMTA="
```

`npm run dev:api` e `npm run dev:web`. A API sobe em `:3001` com prefixo `/api`,
o web em `:3000`.

### 1.3 Credenciais do seed

| Perfil | E-mail | Senha |
|---|---|---|
| SUPER_ADMIN | definido em `SUPER_ADMIN_EMAIL` | `SUPER_ADMIN_PASSWORD` |
| ADMIN | `admin@burgerdothiago.com` | `Admin@123` |
| CLIENTE | `cliente@exemplo.com` | `Cliente@123` |

Os demais perfis (FUNCIONARIO, COZINHA, MOTOBOY, GARCOM, REVENDEDOR) **não vêm no
seed** — são criados durante os roteiros 6 e 9.

### 1.4 Dados de referência do seed

- **Empresa:** Burger do Thiago (`slug: burger-do-thiago`), São Paulo/SP
- **Área de entrega:** Moema, São Paulo — taxa R$ 8,90
- **Cardápio:**
  - Smash Clássico — R$ 28,90 · variações Simples (+0) e Duplo (+12) · adicionais Bacon (+6) e Ovo (+4)
  - Veggie Grelhado — R$ 26,90
  - Refrigerante Lata — R$ 6,50

---

## 2. Suítes automatizadas

Rode sempre as três antes de dizer que está tudo certo. **`verify` não inclui os
e2e** — são comandos separados, e o CI roda os dois.

```sh
npm run verify        # lint, dark mode, glifos, typecheck, testes unitários, audit, build
npm run test:e2e      # sobe o AppModule inteiro contra MySQL real (precisa do DATABASE_URL)
```

Para reproduzir o portão de vulnerabilidade da imagem, que só existe no CI:

```sh
docker build -f apps/api/Dockerfile -t chegowia-api:teste .
docker run --rm -v /var/run/docker.sock:/var/run/docker.sock aquasec/trivy:latest \
  image --severity CRITICAL --ignore-unfixed --exit-code 1 chegowia-api:teste
```

Para rodar um recorte: `npm test --workspace apps/api -- <padrão>`.
Nunca `npx jest` direto — sem `--runInBand` ele abre um worker por núcleo e trava a máquina.

### O que cada suíte cobre

| Assunto | Arquivos |
|---|---|
| Emissão de NFC-e, chave, tributos, DANFE | `nfce-emission`, `nfce-service`, `sefaz-soap`, `fiscal`, `product-tax` |
| Cobrança Asaas, ativação, consumo, cancelamento | `asaas-activation`, `asaas-company-billing`, `asaas-usage-and-cancel`, `asaas-webhook`, `asaas-provider` |
| Revendedor: comissão, desconto, repasse | `asaas-reseller-payout`, `commission-retry`, `payout-concurrency`, `reseller-commission-dashboard` |
| Acesso de suporte do super admin | `super-admin-reseller-access`, `multi-context-login` |
| Isolamento multiempresa e fluxo de pedido | `test-e2e/tenant-isolation`, `test-e2e/order-flow` |

---

## 3. Como reportar

Para cada roteiro, informe:

1. **Passou / falhou / não executado** (com o motivo, no terceiro caso)
2. O que apareceu na tela quando divergiu do esperado
3. Linhas relevantes do log da API
4. O estado no banco quando o roteiro pedir conferência

---

## 4. Consumidor (público, sem login e com login)

### 4.1 Vitrine e descoberta

| # | Passo | Resultado esperado |
|---|---|---|
| 4.1.1 | Abrir `/` sem login | Página institucional carrega; catálogo **não** aparece |
| 4.1.2 | Login como `cliente@exemplo.com` e abrir `/` | Se não houver endereço salvo, o catálogo continua vazio — a home só busca lojas com `hasLocation` |
| 4.1.3 | Cadastrar endereço em `/minha-conta/enderecos` (Moema, São Paulo) e voltar em `/` | Burger do Thiago aparece na lista |
| 4.1.4 | Abrir `/busca` e procurar "smash" | Smash Clássico aparece, com o nome da loja |
| 4.1.5 | Buscar com endereço de outra cidade (trocar o endereço padrão) | A loja **não** aparece — o filtro é igualdade de cidade |
| 4.1.6 | Abrir `/loja/burger-do-thiago` | Cardápio com as 3 categorias/itens e preços do seed |
| 4.1.7 | Abrir `/loja/slug-inexistente` | 404 tratado, sem stack trace |

> **Ponto de atenção conhecido:** a cidade compara por igualdade. Acento e caixa são
> ignorados pela collation do banco, mas "São Paulo" e "Sao Paulo - SP" **não** casam.
> Ao cadastrar empresa, use só o nome do município.

### 4.2 Carrinho e pedido

| # | Passo | Resultado esperado |
|---|---|---|
| 4.2.1 | Adicionar Smash Clássico, variação Duplo, adicionais Bacon + Ovo | Subtotal do item = 28,90 + 12 + 6 + 4 = **R$ 50,90** |
| 4.2.2 | Adicionar Refrigerante Lata | Carrinho soma R$ 57,40 |
| 4.2.3 | Ir para `/checkout` com endereço em Moema | Taxa de entrega **R$ 8,90**; total R$ 66,30 |
| 4.2.4 | Finalizar escolhendo Dinheiro | Pedido criado com status `RECEBIDO`; redireciona para `/pedido/[id]` |
| 4.2.5 | Acompanhar em `/pedido/[id]` | Status atualiza sozinho conforme o painel avança (websocket) |
| 4.2.6 | Abrir `/minha-conta/pedidos` | O pedido aparece no histórico |
| 4.2.7 | Tentar abrir o `/pedido/[id]` de outro cliente (trocar o id) | Acesso negado — não exibe pedido alheio |

### 4.3 Mesa por QR

| # | Passo | Resultado esperado |
|---|---|---|
| 4.3.1 | Abrir `/mesa/[token]` com o token de uma mesa ativa | Cardápio da mesa, sem exigir login |
| 4.3.2 | Lançar dois itens | `DiningOrder` criado com `source = QR_MESA`, status `RECEBIDO` |
| 4.3.3 | Abrir `/mesa/[token]` com token inválido | "QR da mesa não encontrado", sem vazar dados |
| 4.3.4 | Abrir o QR de uma mesa `INATIVA` | Recusa com a mesma mensagem |

---

## 5. Painel da empresa — ADMIN

Login: `admin@burgerdothiago.com` / `Admin@123`.

### 5.1 Pedidos (`/painel/pedidos`)

Fluxo válido: `RECEBIDO → CONFIRMADO → EM_PREPARO → PRONTO → SAIU_PARA_ENTREGA → ENTREGUE`.
`CANCELADO` sai de qualquer ponto antes de `ENTREGUE`.

| # | Passo | Resultado esperado |
|---|---|---|
| 5.1.1 | Abrir a lista | Pedido do roteiro 4.2 aparece |
| 5.1.2 | Avançar status um a um até `ENTREGUE` | Cada transição grava histórico com o usuário que mudou |
| 5.1.3 | Tentar pular de `RECEBIDO` para `ENTREGUE` | Recusado — transição inválida |
| 5.1.4 | Abrir o mesmo pedido em duas abas e avançar nas duas | A segunda recebe conflito ("o status mudou enquanto você confirmava") |
| 5.1.5 | Cancelar um pedido em `EM_PREPARO` | Vai para `CANCELADO`; não aparece mais para avançar |

### 5.2 Cardápio (`/painel/cardapio`)

| # | Passo | Resultado esperado |
|---|---|---|
| 5.2.1 | Criar categoria e produto com preço | Aparece na vitrine pública em seguida |
| 5.2.2 | Desativar o produto | Some da vitrine, permanece no painel |
| 5.2.3 | Criar variação e adicional | Refletem no preço do carrinho (ver 4.2.1) |
| 5.2.4 | Importar cardápio por planilha | Pré-visualização antes de gravar; itens com custo entram corretamente |

### 5.3 Mesas e salão (`/painel/mesas`)

| # | Passo | Resultado esperado |
|---|---|---|
| 5.3.1 | Criar mesa e gerar QR | Token gerado; `/mesa/[token]` abre |
| 5.3.2 | Abrir comanda, lançar itens, marcar `SERVIDO` | Comanda soma só o que foi servido |
| 5.3.3 | Lançar item e cancelar | Item cancelado **não** entra no total nem na nota fiscal |
| 5.3.4 | Fechar mesa com pedido ainda em preparo | Recusado: "Finalize ou cancele os pedidos ativos antes de fechar" |
| 5.3.5 | Fechar mesa com forma de pagamento | Sessão vira `FECHADA`, mesa volta a `LIVRE` |

### 5.4 Entregas (`/painel/entregas`)

Fluxo: `AGUARDANDO_RETIRADA → RETIRADO → EM_ROTA → ENTREGUE`, com desvio para `PROBLEMA`.

| # | Passo | Resultado esperado |
|---|---|---|
| 5.4.1 | Atribuir motoboy a um pedido `PRONTO` | Entrega criada em `AGUARDANDO_RETIRADA` |
| 5.4.2 | Avançar até `ENTREGUE` | Pedido correspondente chega a `ENTREGUE` |
| 5.4.3 | Registrar `PROBLEMA` com motivo | Motivo gravado; pedido não avança sozinho |

### 5.5 Caixa (`/painel/caixa`)

| # | Passo | Resultado esperado |
|---|---|---|
| 5.5.1 | Abrir caixa com valor inicial | Sessão `ABERTA` com o valor registrado |
| 5.5.2 | Registrar sangria e suprimento | Movimentos somam/subtraem do esperado |
| 5.5.3 | Fechar com divergência | Diferença registrada, não bloqueada |
| 5.5.4 | Abrir dois caixas no mesmo ponto | O segundo é recusado |

### 5.6 Funcionários e permissões (`/painel/funcionarios`)

| # | Passo | Resultado esperado |
|---|---|---|
| 5.6.1 | Criar um usuário de cada papel (FUNCIONARIO, COZINHA, MOTOBOY, GARCOM) | Cada um nasce com as permissões padrão do papel (tabela em 6.1) |
| 5.6.2 | Remover uma permissão de um funcionário | A rota correspondente passa a ser negada para ele |
| 5.6.3 | Desativar funcionário | Login recusado |

### 5.7 Clientes, relatórios e configurações

| # | Passo | Resultado esperado |
|---|---|---|
| 5.7.1 | `/painel/clientes` | Lista só clientes da própria empresa |
| 5.7.2 | `/painel/relatorios` | Números batem com os pedidos criados nos roteiros |
| 5.7.3 | `/painel/configuracoes` | Alterar horário/raio reflete na vitrine |
| 5.7.4 | `/painel/agente` | Configuração do agente de IA salva e responde |

---

## 6. Perfis restritos — o que cada um pode

### 6.1 Matriz de permissão padrão

| Papel | Permissões que nascem com ele |
|---|---|
| **FUNCIONARIO** | caixa (visualizar, operar), pedidos (visualizar, editar), mesas (visualizar, operar), cardápio (visualizar), entregas (visualizar) |
| **COZINHA** | pedidos (visualizar, editar), mesas (visualizar, operar) |
| **MOTOBOY** | entregas (visualizar, editar) |
| **GARCOM** | mesas (visualizar, operar), cardápio (visualizar) |
| **ADMIN** | tudo da empresa |

### 6.2 Roteiro por papel

Para **cada** papel abaixo, faça login e confirme os dois lados: o que deve abrir e
o que deve ser negado.

| # | Papel | Deve conseguir | Deve ser negado |
|---|---|---|---|
| 6.2.1 | FUNCIONARIO | Abrir caixa, avançar pedido, operar mesa | `/painel/funcionarios`, `/painel/fiscal`, `/painel/assinatura` |
| 6.2.2 | COZINHA | Ver pedidos e marcar `EM_PREPARO`/`PRONTO` | Marcar `SAIU_PARA_ENTREGA` ou `ENTREGUE`; abrir caixa; cardápio |
| 6.2.3 | MOTOBOY | Ver e avançar entregas atribuídas | Pedidos, mesas, cardápio, caixa |
| 6.2.4 | GARCOM | Abrir comanda, lançar item, ver cardápio | Fechar caixa, editar cardápio, ver relatórios |
| 6.2.5 | CLIENTE | Área `/minha-conta`, pedidos próprios | Qualquer rota `/painel/*` |

> A restrição da COZINHA em 6.2.2 é regra explícita do serviço, não só de tela:
> cozinha só marca `EM_PREPARO` e `PRONTO`.

### 6.3 Isolamento multiempresa

Este é o teste que mais importa e o mais fácil de esquecer.

| # | Passo | Resultado esperado |
|---|---|---|
| 6.3.1 | Criar uma segunda empresa com pedidos e produtos próprios | — |
| 6.3.2 | Logado na empresa A, listar pedidos | Só os da empresa A |
| 6.3.3 | Logado na empresa A, abrir por id um pedido da empresa B | Não encontrado |
| 6.3.4 | Repetir para produtos, clientes, mesas, caixa, notas fiscais | Sempre só a própria empresa |

---

## 7. Fiscal — NFC-e (`/painel/fiscal` e `/painel/notas`)

### 7.1 Cadastro e prontidão

| # | Passo | Resultado esperado |
|---|---|---|
| 7.1.1 | Abrir sem cadastro preenchido | Situação: **"Emissão não configurada"**, com as pendências listadas |
| 7.1.2 | Preencher emitente com município de outra UF (IBGE 3106200 com estado SP) | Recusado: o código não é de município de SP |
| 7.1.3 | Preencher com IE "ISENTO" e tentar Produção | Recusado: NFC-e exige inscrição de contribuinte |
| 7.1.4 | Enviar certificado A1 de outro CNPJ | Recusado: CNPJ do certificado não confere |
| 7.1.5 | Enviar certificado vencido | Recusado com a data de vencimento |
| 7.1.6 | Enviar `.pdf` em vez de `.pfx` | Recusado pela extensão |
| 7.1.7 | Senha errada no certificado válido | Mensagem única cobrindo arquivo e senha |

### 7.2 Conexão com a SEFAZ

| # | Passo | Resultado esperado |
|---|---|---|
| 7.2.1 | Clicar em **Testar conexão** sem certificado | Recusa pedindo o certificado |
| 7.2.2 | Clicar com certificado válido | Resposta da SEFAZ na tela, com data e código; **nenhuma nota emitida, nenhuma numeração gasta** |
| 7.2.3 | Salvar `Ambiente = Produção` | A virada só conclui se a SEFAZ responder "Serviço em Operação" |

### 7.3 Emissão

| # | Passo | Resultado esperado |
|---|---|---|
| 7.3.1 | Emitir NFC-e de um pedido pago | Documento `AUTORIZADA` com chave de 44 dígitos e protocolo |
| 7.3.2 | Clicar em emitir duas vezes no mesmo pedido | Devolve a mesma nota — não gera segunda |
| 7.3.3 | Emitir com produto sem NCM/CFOP | Recusado **antes** de reservar numeração, listando as pendências |
| 7.3.4 | Emitir comanda de mesa com item cancelado | O item cancelado não entra no valor |
| 7.3.5 | Abrir o DANFE (`?formato=texto` e HTML) | Chave em blocos de 4, total, QR Code e protocolo |
| 7.3.6 | Baixar o XML | Arquivo assinado, com `<Signature>` dentro de `<NFe>` |
| 7.3.7 | Emitir com entrega e desconto | Cada item traz `vFrete`/`vDesc` e a soma bate com o total |
| 7.3.8 | Emitir pagando com cartão | O XML traz `<card><tpIntegra>2</tpIntegra></card>` |

### 7.4 Contingência e falhas

| # | Passo | Resultado esperado |
|---|---|---|
| 7.4.1 | Simular SEFAZ fora (endpoint inacessível) | Nota sai em `CONTINGENCIA` com `tpEmis 9`; **a venda não trava** |
| 7.4.2 | Restabelecer e aguardar o worker | Transmite sozinha e vira `AUTORIZADA` |
| 7.4.3 | Provocar rejeição definitiva (ex.: IE inválida) | Status `REJEITADA`, e **e-mail sai na hora** para os administradores |
| 7.4.4 | Reemitir a venda depois da rejeição | Nova nota é criada, com número novo |

### 7.5 Eventos

| # | Passo | Resultado esperado |
|---|---|---|
| 7.5.1 | Cancelar nota autorizada com justificativa de 10 caracteres | Recusado — mínimo 15 |
| 7.5.2 | Cancelar dentro de 30 minutos com justificativa válida | Evento registrado; nota vira `CANCELADA` |
| 7.5.3 | Cancelar depois de 30 minutos | Recusado, explicando a alternativa contábil |
| 7.5.4 | Carta de correção | Registrada, com sequência incrementando |
| 7.5.5 | Inutilizar faixa que contém nota autorizada | Recusado |
| 7.5.6 | Inutilizar faixa livre | Registrada; documentos da faixa viram `INUTILIZADA` |

> **Sem certificado A1 não dá para executar 7.2 em diante.** Nesse caso, marque como
> não executado e rode a validação estrutural: gerar o XML pelo código e conferir
> contra os XSD oficiais 4.00 com `xmllint --schema`.

---

## 8. Assinatura e pagamento (`/painel/assinatura`)

Preço vigente: **R$ 159,90/mês**, com **7 dias** de teste.

### 8.1 Teste grátis e ativação

| # | Passo | Resultado esperado |
|---|---|---|
| 8.1.1 | Contratar por `/contratar` sem código de revendedor | Empresa criada; teste de 7 dias começa |
| 8.1.2 | Durante o teste, usar o painel | Tudo liberado, sem cobrança |
| 8.1.3 | Forçar o fim do teste (ajustar a data no banco) | Painel bloqueado, com a tela de ativação |
| 8.1.4 | Abrir a tela de ativação | Três formas com o valor de cada uma |
| 8.1.5 | Escolher **Pix** | Valor **R$ 159,90** |
| 8.1.6 | Escolher **Boleto** | Valor **R$ 159,90** |
| 8.1.7 | Escolher **Cartão de crédito** | Valor **R$ 165,33** (taxa por dentro; líquido volta a R$ 159,90) |
| 8.1.8 | Gerar a fatura | Abre no Asaas travada na forma escolhida |

### 8.2 Troca de forma de pagamento

| # | Passo | Resultado esperado |
|---|---|---|
| 8.2.1 | Com fatura em aberto, trocar de cartão para Pix | Valor da fatura cai para R$ 159,90 e a fatura é reaberta atualizada |
| 8.2.2 | Conferir a assinatura no Asaas | Próximas cobranças seguem a nova forma |
| 8.2.3 | Trocar a forma com a fatura **já paga** | A fatura paga não é alterada; só as futuras |

### 8.3 Pagamento e liberação

| # | Passo | Resultado esperado |
|---|---|---|
| 8.3.1 | Pagar por Pix | Acesso liberado em segundos (webhook `PAYMENT_RECEIVED`) |
| 8.3.2 | Pagar por cartão | Acesso liberado com `PAYMENT_CONFIRMED`, **antes** de o dinheiro compensar |
| 8.3.3 | Simular perda do webhook | A conciliação do worker libera assim mesmo, sem intervenção |
| 8.3.4 | Deixar vencer sem pagar | Acesso bloqueado ao fim do período |
| 8.3.5 | Pagar depois de vencido | Acesso volta |

> **Regra de ordem no worker:** se a conciliação de pagamentos do Asaas falhar numa
> rodada, o corte de acesso por vencimento **não** roda naquela rodada. Confirme no
> log a mensagem "Corte de acesso por vencimento adiado".

### 8.4 Consumo variável

| # | Passo | Resultado esperado |
|---|---|---|
| 8.4.1 | Gerar uso de IA/WhatsApp | Registro no razão de uso |
| 8.4.2 | Fechar o ciclo | Consumo entra na fatura seguinte, **fora** da base de comissão |

---

## 9. Revendedor

### 9.1 Candidatura e aprovação

| # | Passo | Resultado esperado |
|---|---|---|
| 9.1.1 | Enviar candidatura por `/revenda` | Registro criado, status pendente |
| 9.1.2 | Como SUPER_ADMIN, aprovar em `/super-admin/revendedores` | Perfil criado com **código único** e taxa de 30% |
| 9.1.3 | Reprovar outra candidatura | Sem perfil criado; motivo registrado |
| 9.1.4 | Login do revendedor | Cai em `/revendedor/dashboard` |

### 9.2 Onboarding de recebimento

| # | Passo | Resultado esperado |
|---|---|---|
| 9.2.1 | Iniciar cadastro da subconta Asaas | Formulário/redirecionamento conforme o provedor |
| 9.2.2 | Tentar sacar antes de concluir | Recusado, explicando o que falta |

### 9.3 Indicação com desconto

| # | Passo | Resultado esperado |
|---|---|---|
| 9.3.1 | Contratar em `/contratar` **usando o código** do revendedor | Assinatura nasce vinculada ao revendedor |
| 9.3.2 | Conferir a tela de ativação do novo cliente | Pix/boleto **R$ 135,92**; cartão **R$ 140,61** |
| 9.3.3 | Conferir `/painel/assinatura` do cliente | Mostra o código e a data de fim do desconto |
| 9.3.4 | Avançar 3 meses (ajustar `discountEndsAt`) e rodar o worker | Assinatura volta para R$ 159,90 no Asaas; `discountRemovedAt` preenchido |
| 9.3.5 | Rodar o worker de novo | Não repete a atualização |

### 9.4 Comissão

| # | Passo | Resultado esperado |
|---|---|---|
| 9.4.1 | Cliente indicado paga a 1ª mensalidade (com desconto) | Comissão de **R$ 40,78** (30% de 135,92) |
| 9.4.2 | Conferir o status logo após `PAYMENT_CONFIRMED` | Comissão existe, mas **não** liberada para saque |
| 9.4.3 | Após `PAYMENT_RECEIVED` | Passa para "Disponível para saque" |
| 9.4.4 | Cliente paga já sem desconto | Comissão de **R$ 47,97** (30% de 159,90) |
| 9.4.5 | Fatura com consumo além do plano | Comissão para na mensalidade, não acompanha o total |
| 9.4.6 | Cliente contesta o pagamento | Valor vai para "em análise" e não pode ser sacado |

### 9.5 Prazos exibidos

Em `/revendedor/financeiro`, confira que a tabela mostra:

| Forma | Prazo |
|---|---|
| Pix | no mesmo dia |
| Boleto | 1 a 2 dias úteis |
| Cartão de débito | até 3 dias úteis |
| Cartão de crédito | 32 dias corridos |

### 9.6 Saque

| # | Passo | Resultado esperado |
|---|---|---|
| 9.6.1 | Solicitar com saldo abaixo de R$ 10 | Recusado |
| 9.6.2 | Solicitar com saldo suficiente | Lote criado; comissões travam em `PROCESSANDO`; e-mail de confirmação |
| 9.6.3 | Solicitar de novo com um lote em andamento | Recusado |
| 9.6.4 | Duas solicitações simultâneas | Só uma vence; a outra recebe conflito |
| 9.6.5 | Transferência confirmada | Comissões viram `PAGA`, com data |

### 9.7 Leads e prospects

| # | Passo | Resultado esperado |
|---|---|---|
| 9.7.1 | Cadastrar prospect em `/revendedor/clientes` | Aparece na lista do próprio revendedor |
| 9.7.2 | Reivindicar um lead em `/revendedor/leads` | Lead fica vinculado a quem reivindicou |
| 9.7.3 | Outro revendedor tenta reivindicar o mesmo | Recusado |
| 9.7.4 | Lead vira cliente | Status `CONVERTIDO` |
| 9.7.5 | Perguntar ao assistente sobre o código | Responde o código e a regra de 15% por 3 meses |

---

## 10. Super admin

| # | Passo | Resultado esperado |
|---|---|---|
| 10.1 | `/super-admin/dashboard` | Números consolidados da plataforma |
| 10.2 | `/super-admin/empresas` e abrir uma | Dados da empresa, sem precisar de senha dela |
| 10.3 | `/super-admin/empresas/nova` | Empresa criada já como comercial (`isTestOnly = false`) |
| 10.4 | `/super-admin/planos` | Alterar preço reflete em nova contratação, **não** nas assinaturas existentes |
| 10.5 | `/super-admin/aprovacoes` | Aprovar/reprovar candidaturas |
| 10.6 | `/super-admin/operacao` | Fila de eventos e dead-letters |
| 10.7 | `/super-admin/suporte` | Abrir acesso de suporte a uma empresa |

### 10.8 Acesso assumido (suporte)

| # | Passo | Resultado esperado |
|---|---|---|
| 10.8.1 | Gerar link de acesso a uma empresa | Link com validade curta |
| 10.8.2 | Abrir o link | Entra no painel **daquela empresa**, vendo produtos e pedidos dela |
| 10.8.3 | Conferir o token | Papel e `companyId` são da empresa assumida; `sub` continua sendo o super admin |
| 10.8.4 | Reutilizar o link já consumido | Recusado |
| 10.8.5 | Encerrar a sessão de suporte | Acesso volta ao super admin |
| 10.8.6 | Acesso assumido de revendedor | Mesma checagem, com escrita bloqueada onde a regra exige |

---

## 11. Checklist rápido de regressão

Antes de qualquer deploy, o mínimo:

1. `npm run verify` — exit 0
2. `npm run test:e2e` — exit 0
3. Login de cada papel abre a rota certa e nega a errada (6.2)
4. Pedido do consumidor até `ENTREGUE` (4.2 + 5.1)
5. Emitir uma NFC-e e abrir o DANFE (7.3.1, 7.3.5)
6. Tela de ativação mostrando os três valores (8.1.4–8.1.7)
7. Isolamento multiempresa (6.3)

---

## 12. O que não dá para testar sozinho

Registre como **não executado**, nunca como aprovado.

| Assunto | Por quê | O que dá para fazer |
|---|---|---|
| Emissão real na SEFAZ | Exige certificado A1 e credenciamento da empresa | Validar o XML contra os XSD oficiais 4.00 e usar o botão "Testar conexão" |
| Cobrança real no Asaas | Exige conta e chave de produção | Usar o ambiente de teste do Asaas e os testes automatizados de webhook |
| Recebimento em conta de revendedor | Exige subconta Asaas real | Conferir que o lote é criado e a transferência é chamada |
| Envio de WhatsApp | Exige Gupshup configurado | Testes de formato e invariantes de schema |
| Publicação no Security do GitHub | Exige Advanced Security no plano | O portão de CVE roda e falha sozinho, sem a publicação |

---

## 13. Pendências conhecidas

Não são falhas de teste — são coisas que já sabemos e que podem aparecer durante a execução.

- **Grupo IBS/CBS da Reforma Tributária não é emitido.** Hoje não rejeita: as regras
  foram suspensas em 01/08/2026. Simples Nacional passa a dever em 01/01/2027.
- **Loja com assinatura vencida continua no catálogo.** O painel do lojista é
  bloqueado, mas a vitrine segue aceitando pedido. Decisão de produto em aberto.
- **Cidade compara por igualdade.** Cidade vizinha não aparece mesmo que a loja
  entregue lá; o raio de entrega não entra nesse filtro.
