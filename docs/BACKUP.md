# Backup e restauração

O Panda Project guarda dados em dois lugares. **Os dois precisam entrar no backup**:

| O quê | Onde | Volume Docker |
|---|---|---|
| Projetos, tarefas, financeiro, usuários | PostgreSQL | `postgres_data` |
| Comprovantes, notas fiscais, anexos, PDFs | Armazenamento S3 (SeaweedFS) | `storage_data` |

Guarde também uma cópia segura do arquivo `.env` (principalmente `NOTIFICATION_SECRET_ENCRYPTION_KEY` e `AUTH_SECRET`). Sem a chave de criptografia, segredos de webhook já salvos deixam de abrir.

Os comandos abaixo rodam na pasta do projeto (onde está o `compose.yml`).

## Fazer backup

```bash
mkdir -p backup
STAMP=$(date +%Y-%m-%d_%H%M)

# 1) Banco de dados
docker compose exec -T postgres sh -c 'pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Fc' > backup/banco_$STAMP.dump

# 2) Arquivos (volume do armazenamento). Para o backup ficar consistente, o
#    armazenamento fica parado alguns segundos.
docker compose stop storage
docker run --rm -v "$(docker compose ps -aq storage | xargs docker inspect -f '{{range .Mounts}}{{if eq .Destination "/data"}}{{.Name}}{{end}}{{end}}')":/data -v "$PWD/backup":/backup alpine \
  tar czf /backup/arquivos_$STAMP.tar.gz -C /data .
docker compose start storage

# 3) Configuração
cp .env backup/env_$STAMP.txt
```

Copie a pasta `backup/` para outro lugar (outro computador, nuvem). Backup que fica só no mesmo servidor não protege contra perda do servidor.

**Automático (Linux):** adicione ao `crontab -e` uma linha que rode os comandos acima todo dia, por exemplo `0 3 * * * cd /caminho/panda-project && ./backup.sh`, guardando os comandos em um `backup.sh`.

## Restaurar

Em uma instalação nova (ou para voltar a um ponto anterior):

```bash
# Pare o sistema, mantenha só o banco ligado
docker compose stop kaneo storage
docker compose up -d postgres

# 1) Banco (apaga e recria o conteúdo)
docker compose exec -T postgres sh -c 'dropdb -U "$POSTGRES_USER" --if-exists "$POSTGRES_DB" && createdb -U "$POSTGRES_USER" "$POSTGRES_DB"'
docker compose exec -T postgres sh -c 'pg_restore -U "$POSTGRES_USER" -d "$POSTGRES_DB" --no-owner' < backup/banco_AAAA-MM-DD_HHMM.dump

# 2) Arquivos
docker run --rm -v "$(docker compose ps -aq storage | xargs docker inspect -f '{{range .Mounts}}{{if eq .Destination "/data"}}{{.Name}}{{end}}{{end}}')":/data -v "$PWD/backup":/backup alpine \
  sh -c 'rm -rf /data/* && tar xzf /backup/arquivos_AAAA-MM-DD_HHMM.tar.gz -C /data'

# 3) Suba tudo de novo (o storage volta junto)
docker compose up -d
```

Confira abrindo o sistema, entrando em um projeto e baixando um comprovante.

## Dicas

- Faça backup **antes** de cada atualização e teste a restauração ao menos uma vez em um computador de teste.
- Não use `docker compose down -v`: o `-v` apaga os volumes (seus dados).
