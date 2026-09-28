# Panda Project (MVP)

> **MVP (Produto Mínimo Viável)**: Sistema ágil e direto de gerenciamento de projetos com **controle financeiro integrado de obras e serviços** (cronograma de pagamentos por fornecedor, comprovantes, notas fiscais e aviso automático de "reta final").

O Panda Project é um fork do [Kaneo](https://github.com/usekaneo/kaneo) (licença MIT), customizado com módulo Financeiro específico para obras/serviços e interface integralmente em português do Brasil (pt-BR).

## Principais Recursos do MVP

- **Financeiro por Fornecedor:** Valores em reais (R$), datas no formato `dd/mm/aaaa`, definição de linhas de pagamento e etiquetas de orçamento (ex: Obra Civil, RH, Equipamentos).
- **Comprovante + Nota Fiscal Integrados:** Cada pagamento guarda comprovante e NF, unidos automaticamente em PDF organizado por pasta.
- **Recálculo Inteligente:** Se uma parcela for paga com valor diferente do previsto, as parcelas seguintes são recalculadas automaticamente.
- **Aviso de "Reta Final":** Verificação diária e notificação aos administradores quando as 3 últimas parcelas do projeto se aproximam.
- **Anexos e Documentos:** Contratos, plantas e arquivos centralizados com download individual ou em ZIP.
- **Quadro Kanban & Calendário:** Visualização de tarefas e vencimentos financeiros agregados.
- **Instalação Rápida:** Execução com um comando via Docker Compose (PostgreSQL 16 + armazenamento S3 SeaweedFS + API Hono e Frontend React).

---

## Instalação e Execução (Docker)

Requisitos: [Docker](https://www.docker.com/) com o plugin Compose e cerca de 2 GB de memória livre.

1. Clone o repositório:
```bash
git clone https://github.com/pandaktwok/panda-project.git
cd panda-project
```

2. Crie o arquivo de ambiente:
```bash
cp .env.example .env
```

3. Abra o arquivo `.env` e preencha as variáveis essenciais:

| Variável | O que colocar |
|---|---|
| `KANEO_CLIENT_URL` | Endereço de acesso (ex: `http://localhost:5173`) |
| `AUTH_SECRET` | Chave de 32 bytes gerada por `openssl rand -hex 32` |
| `NOTIFICATION_SECRET_ENCRYPTION_KEY` | Chave de 32 bytes gerada por `openssl rand -hex 32` |
| `POSTGRES_PASSWORD` | Senha forte para o banco de dados PostgreSQL |
| `S3_ACCESS_KEY_ID` / `S3_SECRET_ACCESS_KEY` | Usuário e senha (8+ caracteres) do armazenamento SeaweedFS S3 |
| `S3_ENDPOINT` | `http://host.docker.internal:9000` (Docker Desktop) ou `http://IP-DO-SERVIDOR:9000` |

4. Suba o ambiente:
```bash
docker compose up -d --build
```

Acesse no navegador: **http://localhost:5173**

---

## Primeiro Acesso

1. Crie a primeira conta na tela inicial. Ela se torna **Administrador** automaticamente.
2. Após o primeiro cadastro, o registro aberto permanece fechado por padrão (`DISABLE_REGISTRATION=true`), permitindo adicionar novos membros apenas via convite.
3. Crie seu projeto e configure as informações financeiras (fornecedores, valores, quantidade de parcelas e primeira data).
4. No projeto, acesse a aba **Resumo** para acompanhar o cronograma, marcar parcelas pagas e gerenciar documentos.

---

## Uso Básico do Financeiro

- **Marcar parcela como paga:** Clique na parcela, informe o valor e a data, e anexe o comprovante e a nota fiscal. O sistema recalcula as parcelas seguintes e gera o arquivo `Fornecedor - Parcela N.pdf` na pasta correspondente.
- **Desfazer pagamento:** O pagamento volta para o status "em aberto", mantendo histórico para administradores.
- **Aviso de reta final:** Diariamente às 08:00 (horário de Brasília) o sistema audita os projetos e emite aviso aos administradores. Para integração via webhook/WhatsApp, consulte [docs/whatsapp-aviso-reta-final.md](docs/whatsapp-aviso-reta-final.md).
- **Anexos:** Contratos e plantas ficam centralizados na seção de anexos com opção de download em lote (ZIP).

---

## Outras Formas de Instalação

- **Coolify:** utilize `compose.coolify.yml` (construção direta do repositório).
- **Kubernetes / Helm:** consulte `charts/kaneo/README.md` e `charts/kaneo/values.yaml`.
- **Desenvolvimento Local:** consulte [ENVIRONMENT_SETUP.md](ENVIRONMENT_SETUP.md) (Node 24+, pnpm 10.32.1).

---

## Créditos e Agradecimentos

O **Panda Project** é baseado no projeto open-source **[Kaneo](https://github.com/usekaneo/kaneo)**, criado e mantido pela equipe Kaneo ([@usekaneo](https://github.com/usekaneo)). Agradecemos e reconhecemos expressamente o trabalho dos autores e colaboradores do repositório original Kaneo pelo desenvolvimento de sua arquitetura robusta e elegante.

---

## Licença

Distribuído sob a licença [MIT](LICENSE), a mesma licença do projeto original Kaneo. O arquivo [LICENSE](LICENSE) preserva os direitos autorais originais.
