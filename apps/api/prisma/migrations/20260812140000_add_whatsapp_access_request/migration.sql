-- Pedido de acesso ao WhatsApp feito pelo empresário.
--
-- No modo self-serve do Gupshup o aplicativo de cada empresa é criado à mão no
-- painel do BSP. Sem registrar o pedido, o superadmin não tem como saber que
-- alguém está esperando — o empresário clicaria em um botão e nada aconteceria
-- do outro lado.

ALTER TABLE `MessagingChannel`
  ADD COLUMN `accessRequestedAt` DATETIME(3) NULL;
