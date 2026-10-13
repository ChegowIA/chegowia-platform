# Localização e frete de entregas

O CEP identifica uma região, não a entrada de um imóvel. Por isso, no checkout
do site o cliente escolhe o endereço, procura a região no mapa, arrasta ou toca
no ponto de entrada e confirma o marcador. A loja confirma o ponto de saída em
`/painel/configuracoes`. A busca automática e a localização do aparelho são
somente sugestões: não são salvas como ponto confirmado sem ação da pessoa.

## Fluxo de pedidos pelo site

1. O cliente seleciona um endereço com CEP e confirma o pino no mapa. Alterar
   rua, número, bairro, cidade, estado ou CEP remove a confirmação.
2. A loja precisa ter coordenadas de origem. Lojas antigas que já possuem
   coordenadas operam durante a transição; ao editar o endereço, precisam
   confirmar o novo ponto no mapa.
3. A API calcula a rota de carro entre os dois pontos. Se a rota falhar ou
   encaixar um marcador muito longe da rua, o checkout explica o problema e
   não usa o centro do CEP para cobrar um frete potencialmente errado.
4. O preço é `taxa base + distância da rota em km × taxa por km`, limitado
   pelo raio de entrega configurado. A API recalcula ao criar o pedido.
5. O pedido guarda uma cópia das coordenadas de destino. O link do motoboy
   navega até esse ponto mesmo que o cliente edite o endereço depois. Número,
   complemento e referência continuam visíveis para localizar a entrada.

O catálogo usa o centro aproximado do CEP apenas para encontrar candidatas.
A confirmação de alcance e cobrança acontece na cotação da rota. Pedidos pelo
WhatsApp têm um fluxo próprio de endereço; ainda podem sinalizar estimativa
por CEP quando o endereço não for encontrado.

## Provedores e operação

Configure `GEOCODING_BASE_URL`, `ROUTING_BASE_URL` e
`NEXT_PUBLIC_MAP_TILES_URL` com serviços contratados ou hospedados pela
operação para ter capacidade e suporte adequados. O mapa usa tiles
OpenStreetMap quando `NEXT_PUBLIC_MAP_TILES_URL` não é definido; esse serviço
público e o roteador OSRM público são demonstrativos, sem SLA comercial.
Mantenha a atribuição cartográfica exibida na interface. HTTPS e permissão do
navegador são necessários para o botão de localização atual.

Nenhum provedor garante que todo endereço brasileiro seja geocodificado com
precisão absoluta. O marcador manual e a referência de entrega permitem
corrigir resultados imprecisos. Quando a rota estiver indisponível, o sistema
deve falhar de forma explícita em vez de cobrar uma distância inventada.
