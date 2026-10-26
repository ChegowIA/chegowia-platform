# Central de Prospecção Inteligente

Disponível em `/super-admin/atendimento`, exclusivamente para `SUPER_ADMIN`. A prospecção sai pelo **WhatsApp institucional oficial** (canal `chegowia-institucional`, Gupshup), o mesmo número do atendimento comercial. As conversas aparecem no painel de mensagens, e quem responde é o assistente de IA do canal, com a equipe podendo assumir a qualquer momento.

## Por que o número oficial

Até outubro de 2026 a prospecção usava um número dedicado conectado por QR Code (Baileys, cliente não oficial). Esse número foi suspenso pelo WhatsApp após o primeiro disparo. Cliente não oficial e mensagem comercial para quem nunca falou com o número são exatamente o que o WhatsApp pune, então o QR foi removido do sistema.

Pela API oficial, a primeira mensagem para quem nunca escreveu **só pode ser um modelo aprovado pela Meta**. O texto é fixo; a personalização acontece nas variáveis. O limite inicial costuma ser de **250 conversas iniciadas por dia** e sobe conforme volume e qualidade. Bloqueios e denúncias derrubam a qualidade do número, e a Meta pode pausar o modelo ou limitar o envio. Como o número é o mesmo do atendimento, uma lista ruim prejudica o canal comercial inteiro: opt-in real e volume baixo no começo continuam obrigatórios.

## Modelo de abertura

Definido em `apps/api/src/messaging/outreach-template.ts` (`chegowia_prospeccao_v1`, categoria Marketing, `pt_BR`). Corpo:

> Oi, {{1}}! Tudo bem? Aqui é da ChegowIA.
>
> Vi que vocês trabalham com {{2}} em {{3}} e lembrei de vocês: a ChegowIA atende seus clientes no WhatsApp com inteligência artificial, monta o pedido com cardápio, adicionais e entrega, e manda tudo organizado para o seu painel, sem ninguém precisar ficar digitando.
>
> No mesmo sistema você também tem pedido por QR Code na mesa, acompanhamento dos motoboys e indicadores do negócio.
>
> Posso te mostrar como isso funcionaria na prática aí?

Rodapé `ChegowIA · pedidos e atendimento com IA` e três botões de resposta rápida: **Quero ver como funciona**, **Agora não** e **Não quero receber**. O último é reconhecido como descadastro: bloqueia o número na hora e o assistente confirma por escrito.

Para submeter, use **Enviar modelo para aprovação da Meta** na Central. O sistema cria o modelo pela API do Gupshup e passa a mostrar a situação (em análise, aprovado, rejeitado com o motivo). Clique de novo para atualizar. Só um modelo **aprovado** com o texto padrão libera a fila. Mudar qualquer palavra exige um nome novo (`_v2`) e nova aprovação.

Variáveis:

- `{{1}}` nome curto do negócio, como o dono falaria. A DeepSeek limpa nomes do Google Maps ("Schimidt Alimentos - Fábrica de pães - #pão para hambúrguer…" vira "Schimidt Alimentos"). Sem marca reconhecível: "pessoal".
- `{{2}}` o que o negócio vende, em minúscula ("pizzas e delivery", "pães para hamburguerias"). Sem dado: "alimentação".
- `{{3}}` cidade da planilha. Sem dado: "sua região".

Os valores passam por validação antes de chegar à Meta (tamanho, sem quebra de linha, hashtag, link, emoji, preço ou promessa) e por aprovação humana por lead. A prévia de cada lead é a mensagem exata que ele recebe.

## Implantação

1. As migrações rodam no boot da API. `20261026120000_outreach_official_whatsapp` move as campanhas abertas do antigo canal QR para o número oficial em **Rascunho**, preservando leads e autorizações e limpando as mensagens no formato antigo. Gere as variáveis de novo e aprove.
2. A fila roda junto dos demais jobs (`APP_ROLE=all` ou `worker`). **Exclua o serviço `outreach-worker` do Render**: o papel foi aposentado e o processo se recusa a subir com ele.
3. Com o WhatsApp institucional conectado pelo Gupshup, envie o modelo para aprovação e aguarde o status **Aprovado pela Meta**.

## Fluxo comercial

1. Importe XLSX até 5 MB. O parser local preserva linhas originais; regras mapeiam colunas conhecidas e a DeepSeek recebe apenas cabeçalhos ambíguos. A prévia exige confirmação de hash, aba e mapeamento.
2. Telefones brasileiros são validados por código e deduplicados. A importação reconhece as colunas **Origem da autorização**, **Evidência da autorização** e **Data da autorização**; o cabeçalho exato **Data** também é aceito (confira o mapeamento na prévia se houver outras datas na planilha). Quando os três valores estão completos e a data é válida e anterior à importação, o lead é criado com a autorização declarada na planilha já preenchida, sem registro manual por lead. Campos parciais também aparecem no formulário para correção, mas não liberam o envio. A prévia mostra cada campo e destaca dados ausentes ou inválidos; a linha original fica preservada. Uma coluna isolada de `Permissão para WhatsApp: Sim` não comprova opt-in. A equipe é responsável por fornecer evidências reais e verificáveis, não apenas texto afirmativo. Datas aceitas: `dd/mm/aaaa`, `dd/mm/aaaa HH:mm`, `aaaa-mm-dd`, `aaaa-mm-dd HH:mm` (horário de Brasília) ou ISO 8601 com fuso, como `2026-10-25T14:30:00-03:00`. Uma data sem hora é persistida como 00:00 Brasília por convenção técnica; o sistema não afirma que a autorização ocorreu exatamente à meia-noite. Datas futuras ou inválidas permanecem pendentes. A importação não altera campanhas antigas; para aproveitar essas colunas, importe a planilha revisada como nova campanha.
3. A DeepSeek, usando a integração existente, preenche o **nome** e a **atividade** de cada lead no modelo aprovado. O administrador pode regenerar, editar as variáveis, aprovar, rejeitar ou excluir. JSON inválido e variáveis reprovadas têm no máximo duas tentativas; depois ficam para revisão manual. O prompt versionado e os tokens consumidos são registrados.
4. Simule a campanha sem enviar. A aprovação da campanha não envia nada. Inicie somente com o número oficial conectado, o modelo aprovado pela Meta, mensagens aprovadas e consentimento comprovado. Pause, retome ou cancele na mesma tela. A lixeira de cada campanha a apaga da lista (exceto enquanto estiver enviando); leads e tentativas continuam no banco, então quem já foi abordado segue bloqueado para novas importações e o teto de 24h continua contando esses envios.
5. O worker da API consome a fila persistida no MySQL e envia cada lead pelo mesmo caminho da conversa avulsa: modelo do Gupshup, conversa no painel em modo IA e custo registrado como marketing. Uma trava transacional em `PlatformOutreachSenderState` reserva **60 segundos entre os inícios** de tentativas para destinatários diferentes, globalmente entre campanhas e instâncias. Há no máximo uma tentativa por lead/telefone, envio 24h todos os dias e teto diário operacional. Reinício não limpa os intervalos.
6. Se o Gupshup recusar um envio, o lead fica como falho e **nunca** é reenviado, a trava é liberada e a campanha pausa com o motivo na tela (erro do provedor costuma ser geral: modelo, saldo ou credencial). O aceite do Gupshup não prova entrega; os status de entrega e leitura chegam pelo webhook. Quando o lead responde ou toca num botão, a janela de 24h abre e o assistente de IA responde na hora: "Quero ver como funciona" leva à demonstração; "Agora não" recebe um agradecimento e a conversa encerra. A primeira resposta também é classificada pela DeepSeek na Central. Descadastro bloqueia contatos futuros imediatamente.

A fila atual é transacional no MySQL, não BullMQ/Redis: o projeto já possuía estado persistente de campanhas, tentativa única e trava global no banco. Redis não é necessário para cumprir essas garantias e não foi introduzido como nova dependência operacional.

## Validação segura

`npm run prisma:generate --workspace apps/api`, `npm run typecheck --workspace apps/api`, `npm run typecheck --workspace apps/web`, `npm test --workspace apps/api -- --runInBand`. Os testes simulam o Gupshup e não enviam mensagens reais. Antes da primeira campanha, envie a um número da equipe com autorização documentada e confira a mensagem, os três botões e a resposta do assistente. Não armazene a planilha real no repositório nem a envie integralmente à DeepSeek.
