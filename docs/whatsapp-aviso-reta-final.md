# Aviso de reta final no WhatsApp

O Panda Project **não envia WhatsApp por conta própria**. O caminho é o webhook
pessoal de cada usuário: o aviso de reta final sai como um `POST` com JSON para
uma automação sua (n8n, Make, Zapier ou similar), e a automação manda a mensagem
no WhatsApp. Nenhum código de mensageria foi adicionado ao sistema.

## Quando o aviso sai

- O projeto entra na reta final no vencimento da antepenúltima parcela do
  cronograma (a 3ª contando de trás para frente).
- Nesse dia, a partir das 08:00 (horário de Brasília), sai **um aviso por mês**,
  no mesmo dia do mês (nos meses curtos, no último dia), até todas as parcelas
  estarem pagas.
- Quem recebe: o **dono** e os **administradores** do espaço de trabalho. Usuário
  comum não recebe.
- Cada envio fica registrado no projeto (data e canais) e aparece na faixa
  vermelha da página **Resumo**.

## Passo a passo

1. Na sua automação, crie um gatilho **Webhook** (método `POST`) e copie a URL.
   A URL precisa ser pública (endereços locais ou de rede interna são recusados).
2. No Panda Project, abra **Configurações > Notificações**, seção **Webhook
   personalizado**, cole a URL e (opcional) um segredo. Clique em **Conectar
   webhook**.
3. Ainda em Notificações, no cartão do espaço de trabalho, ligue o canal
   **Webhook personalizado** (e deixe o espaço de trabalho ativo).
4. Na automação, use o corpo recebido para montar o texto e enviar pelo seu
   provedor de WhatsApp (API oficial, Evolution API, Z-API etc.).

## Corpo enviado

`Content-Type: application/json`. Exemplo real, capturado nos testes do
projeto (ids e e-mail são de teste):

```json
{
  "notification": {
    "id": "dcy12tgw3a5o7mijxfpbpx4r",
    "type": "project_final_stretch",
    "title": "Reta final: Cultura e Informação para a Pessoa Idosa",
    "content": "As últimas parcelas vencem em 10/08/2026, 10/09/2026 e 10/10/2026. Faltam R$ 65.600,00 a pagar.",
    "createdAt": "2026-09-24T14:47:00.849Z",
    "eventData": {
      "dates": [
        "2026-08-10",
        "2026-09-10",
        "2026-10-10"
      ],
      "month": "2026-08",
      "projectId": "xqlyhkqa9r5a6d2w5t2z9sbb",
      "workspaceId": "workspace-e7bb4ef2-cf27-49c1-9e5b-181cbe3faa7c",
      "remainingCents": 6560000
    },
    "resourceId": "xqlyhkqa9r5a6d2w5t2z9sbb",
    "resourceType": "project"
  },
  "workspace": {
    "id": "workspace-e7bb4ef2-cf27-49c1-9e5b-181cbe3faa7c",
    "name": "Financeiro"
  },
  "project": {
    "id": "xqlyhkqa9r5a6d2w5t2z9sbb",
    "name": "Cultura e Informação para a Pessoa Idosa",
    "url": "https://panda.example.com/dashboard/workspace/workspace-e7bb4ef2-cf27-49c1-9e5b-181cbe3faa7c/project/xqlyhkqa9r5a6d2w5t2z9sbb/summary"
  },
  "task": null,
  "user": {
    "id": "user-admin-7930009e-0bff-4d44-82ba-869c1b0d559a",
    "email": "user-admin-7930009e-0bff-4d44-82ba-869c1b0d559a@example.com",
    "name": "Finance admin"
  }
}
```

Campos úteis para a mensagem:

| Campo | O que é |
| --- | --- |
| `notification.type` | sempre `project_final_stretch` neste aviso |
| `notification.title` | `Reta final: <nome do projeto>` |
| `notification.content` | texto pronto: datas das últimas parcelas e quanto falta pagar |
| `notification.eventData.dates` | as últimas datas de vencimento (`AAAA-MM-DD`) |
| `notification.eventData.remainingCents` | quanto falta pagar, em **centavos** |
| `notification.eventData.month` | mês do aviso (`AAAA-MM`) |
| `project.name` / `project.url` | projeto e link direto para a página Resumo |
| `workspace.name` | espaço de trabalho |
| `user.name` / `user.email` | quem está recebendo o aviso |

## Segredo (opcional)

Se você definiu um segredo, cada envio leva o cabeçalho `X-Kaneo-Signature` com
o HMAC-SHA256 (hexadecimal) do corpo bruto. Na automação, confira antes de agir:

```js
const esperado = crypto.createHmac("sha256", SEGREDO).update(corpoBruto).digest("hex");
if (esperado !== cabecalho["x-kaneo-signature"]) throw new Error("assinatura inválida");
```

## Exemplo de fluxo no n8n

1. **Webhook** (POST) recebe o corpo acima.
2. **IF** `{{ $json.body.notification.type }}` igual a `project_final_stretch`.
3. **HTTP Request** para o seu provedor de WhatsApp, com a mensagem:
   `{{ $json.body.notification.title }}\n{{ $json.body.notification.content }}\n{{ $json.body.project.url }}`

## Testar sem esperar

Na máquina do servidor (ou no container da API), rode uma vez:

```bash
pnpm --filter @kaneo/api finance:notices
# simulando uma data:
NOW=2026-09-10T08:00:00-03:00 pnpm --filter @kaneo/api finance:notices
```

O mesmo mês nunca é enviado duas vezes; para repetir um teste, apague a linha do
mês em `project_final_stretch_notice`.
