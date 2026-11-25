# Sincronização do Portal da Transparência — São João da Paraúna

Copia os dados do Portal da Transparência (Megasoft) para o banco analítico (Supabase) que o site da
Prefeitura lê. Fica num repositório público separado do site para que os minutos do GitHub Actions não
sejam cobrados; o código do site continua privado.

## Como funciona

- `sync.mjs` abre o portal num navegador do Firecrawl, captura a API que a própria página usa e grava os
  registros na tabela `transparencia_registros` do banco analítico.
- `datasets.mjs` lista os conjuntos (despesas, receitas, licitações, folha...).
- Dois conjuntos vêm de fontes públicas fora do portal e não usam o Firecrawl: `emendas-bancada` (Tesouro
  Nacional) e `diario-oficial-estado` (publicações do Diário Oficial do Estado de Goiás que citam o município,
  pela busca pública de diariooficial.abc.go.gov.br). Este último grava por ano: a rodada diária atualiza o ano
  corrente, e os anos anteriores entram uma vez com `node sync.mjs diario-oficial-estado 2025` (ou em
  **Run workflow**, informando o conjunto e o ano).
- Agendamento (`.github/workflows/sincronizar.yml`): tudo às 03:00 (Brasília) e o resumo da página
  inicial de hora em hora. Também roda manualmente em **Actions › Run workflow**.

## Configuração no GitHub

Em **Settings › Secrets and variables › Actions**:

| Tipo | Nome | Valor |
|---|---|---|
| Secret | `FIRECRAWL_API_KEY` | chave do Firecrawl |
| Secret | `TRANSPARENCIA_SUPABASE_SERVICE_ROLE_KEY` | chave *service_role* do banco analítico |
| Variable | `TRANSPARENCIA_SUPABASE_URL` | `https://<projeto>.supabase.co` do banco analítico |
| Variable | `PORTAL_BASE_URL` | endereço do portal Megasoft do município |

As chaves nunca entram no código. Os registros das execuções são públicos, e o script não imprime chaves.

## Rodar fora do GitHub (servidor, VPS ou computador)

Precisa só do Node 20 ou mais novo (não há dependências para instalar).

```bash
cp .env.example .env      # e preencha as chaves
node sync.mjs todos       # tudo, ano atual
node sync.mjs despesas 2025
node sync.mjs resumo
node sync.mjs despesas --dry-run   # testa sem gravar no banco
```

Agendamento num servidor Linux (`crontab -e`), com horário de Brasília no servidor:

```cron
0 3 * * *  cd /opt/sync-transparencia-saojoao && flock -n /tmp/sync-saojoao.lock node sync.mjs todos  >> sync.log 2>&1
30 * * * * cd /opt/sync-transparencia-saojoao && flock -n /tmp/sync-saojoao.lock node sync.mjs resumo >> sync.log 2>&1
```
