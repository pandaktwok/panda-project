# Panda Project Widget (Windows)

Janelinha de área de trabalho com: **próximo pagamento**, **pagamentos atrasados**,
**projetos dos últimos 3 meses**, **tarefas novas (7 dias)** e **calendário**
(grade do mês ou lista, com alternância). Atualiza sozinho a cada 5 minutos.

## Requisito no servidor
O widget usa a rota nova `GET /api/workspace-calendar/widget-summary`
(arquivos em `apps/api/src/workspace-calendar/`). O Panda Project no servidor
precisa estar atualizado com ela.

## Rodar / gerar o .exe (no seu PC, com Node 20+)
```
cd tools/desktop-widget
npm install
npm start          # abre o widget
npm run dist       # gera dist/PandaProjectWidget.exe (portátil)
npm test           # testes da lógica de datas/calendário
```

## Primeiro uso
1. No Panda Project (navegador), vá em **Configurações › Conta › Desenvolvedor** e crie uma chave de API.
2. Abra o widget, cole o endereço de qualquer página dentro do workspace
   (ex.: `https://seu-site/dashboard/workspace/…/project/…`) e a chave.
3. Pronto. A chave fica criptografada neste computador (Windows DPAPI).

Fechar a janela (–) só a esconde na bandeja; **Sair** fica no menu do ícone da bandeja.
Clique em um pagamento, projeto ou tarefa para abrir no navegador.
