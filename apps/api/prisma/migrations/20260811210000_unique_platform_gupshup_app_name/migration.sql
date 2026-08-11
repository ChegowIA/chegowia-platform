-- O canal institucional é resolvido pelo nome do aplicativo quando o callback
-- v2 do Gupshup chega, exatamente como o canal das empresas. Sem o índice único
-- o `findUnique` por esse campo é rejeitado pelo Prisma em tempo de execução, e
-- o webhook institucional nunca entregaria mensagem.

CREATE UNIQUE INDEX `PlatformWhatsAppChannel_gupshupAppName_key` ON `PlatformWhatsAppChannel`(`gupshupAppName`);
