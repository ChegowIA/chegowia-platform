-- No modo self-serve o callback do Gupshup identifica o aplicativo pelo nome
-- (campo `app` do payload v2), não pelo id. Para resolver o canal sem
-- ambiguidade — e sem risco de entregar conversa de um tenant a outro — o nome
-- precisa ser único, como já é o gupshupAppId.

CREATE UNIQUE INDEX `MessagingChannel_gupshupAppName_key` ON `MessagingChannel`(`gupshupAppName`);
