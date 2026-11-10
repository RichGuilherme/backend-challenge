# Arquitetura

Decisões, trade-offs e limitações do Distributed Wagering Processor. Setup e comandos estão no [README](README.md).

## Visão geral

Quatro processos da mesma imagem, cada um com um papel. Falham e escalam de forma independente.

```text
HTTP ──► api ─────────┐
                      ├──► PostgreSQL ◄── outbox-publisher ──► SNS FIFO ──► fila assinante
SQS ──► consumer ─────┤    (saldo, ledger,
                      │     inbox, outbox)
reference-worker ─────┘
```

- `api`: HTTP, health e métricas.
- `consumer`: lê `wager-transactions.fifo` e usa o mesmo caso de uso do HTTP.
- `outbox-publisher`: publica os eventos gravados na outbox.
- `reference-worker`: reprocessa reversões que chegaram antes da referência.

## DDD e camadas

Um único bounded context, com dois aggregates: `Wallet` (com seu `WalletLedgerEntry`) e `WagerTransaction`. Separar em contextos exigiria consistência eventual, e o enunciado exige uma única transação SQL.

| Pasta | O que tem | Regra |
|---|---|---|
| `src/domain` | aggregates, `Money`, `WagerSettlement`, `ReversalPolicy`, contratos de repositório | sem NestJS, ORM, AWS SDK, log nem zod |
| `src/application` | casos de uso, portas (unit of work, clock, ids, mensageria, queries), inbox, outbox, eventos de integração | só orquestra, não decide regra de negócio |
| `src/infrastructure` | repositórios e mappers (MikroORM), SQS/SNS, pino, prom-client, verificador de JWT | implementa as portas |
| `src/presentation` | controllers HTTP, consumidor SQS, workers, health | valida a entrada com zod |
| `src/main` | um entrypoint (`main.ts <papel>`) e os módulos do Nest | só liga as peças |

Os imports apontam para dentro: `presentation → application → domain`.

- **Invariantes dentro das classes.** Construtor privado e factories (`create`, `rehydrate`). `rehydrate` reconstrói do banco sem revalidar transições.
- **`WagerSettlement` (domain service)** aplica a transação na wallet e traduz a recusa para um `failureCode`. Reversões são validadas por `ReversalPolicy`.
- **Recusa de negócio** (`BusinessRuleError`) vira `REJECTED` com commit. **Bug** (transição inválida, ledger que não fecha) é exceção que sobe. Nenhum `catch` genérico engole erro.
- **Persistência separada do domínio.** O ORM mapeia registros em `infrastructure` (`defineEntity`, sem decorators). Mappers convertem registro ⇄ domínio.
- **Sem domain events.** O enunciado pede só eventos de integração, que ficam em `application`.

## Decisões principais

| Tema | Decisão | Por quê |
|---|---|---|
| Dinheiro | `bigint` de centavos no código, `numeric(20,2)` no banco, string na API | nenhum `number` no caminho; o mapper converte a string do driver direto |
| Entrada de valor | 0 a 2 casas, normaliza para 2, rejeita 3 ou mais, nunca arredonda | `"25.5"` e `"25.50"` são a mesma operação |
| Concorrência | `SELECT … FOR UPDATE` na wallet, mais `UPDATE … WHERE version = ?`, mais `CHECK (balance >= 0)` | o lock é por wallet (nunca global); o banco é a última barreira |
| Espera por lock | `lock_timeout` de 5s, depois falha transitória (503 com `Retry-After`) | evita fila infinita numa hot wallet |
| Idempotência | `Idempotency-Key` por provedor, `UNIQUE(provider_id, idempotency_key)`, SHA-256 de JSON canônico | persistente; sobrevive a restart e a várias instâncias |
| Hash | campos de negócio com chaves ordenadas; fora dele, header e metadados | mesma chave com payload diferente é conflito (409) |
| Atomicidade | `UnitOfWork`: transação, saldo, ledger, inbox e outbox no mesmo commit | nada é publicado nem confirmado pela metade |
| Outbox | publicador com `FOR UPDATE SKIP LOCKED` em lote, SNS FIFO | vários publishers sem perder evento; duplicata é segura (dedup por `eventId`) |
| Fila | inbox `(consumer_name, message_id)`, ack só depois do commit | redelivery e morte antes do ack não duplicam efeito |
| Erros na fila | negócio: ack; permanente: DLQ; transitório: retry com backoff e DLQ na 5ª entrega | o provedor sabe se reenvia, corrige ou desiste |
| Backoff | exponencial com full jitter | evita rajadas sincronizadas |
| Referência fora de ordem | `PENDING_REFERENCE`, worker com TTL de 24h; esgotado vira `REJECTED` + evento | a reversão que chega cedo termina processada |
| Reversões | no máximo uma por transação referenciada, de qualquer tipo | a leitura literal do enunciado permitiria crédito em dobro |
| Schema | unicidade, imutabilidade (triggers) e não-negatividade no banco | a garantia não depende do código da aplicação |
| Saldo e ledger | constraint trigger exige, no commit, um lançamento que explique o saldo | `wallet.balance` sempre bate com o ledger |
| Autenticação | Keycloak (client credentials) e `jose`; `azp` é o `providerId` | opcional no enunciado; fica atrás da porta `TokenVerifier` |

Códigos HTTP: 200 processada, 202 referência pendente, 422 rejeição de negócio, 400 payload inválido, 409 conflito de idempotência, 503 falha transitória.

## Testes e TDD

Cada fatia nasceu com seus testes, e nenhuma etapa foi dada como pronta sem eles verdes.

| Pasta | O que prova | Infraestrutura |
|---|---|---|
| `test/unit` | regras do domínio e casos de uso | nenhuma |
| `test/integration` | migrations, constraints, atomicidade, inbox, outbox, DLQ | PostgreSQL e LocalStack reais |
| `test/concurrency` | 50× a mesma aposta, 80+80, várias instâncias, morte com SIGKILL, reinício geral | processos reais, sem mocks |

- **Prova por sabotagem.** Cada garantia crítica tem um teste que fica vermelho quando o mecanismo que a sustenta é removido (lock, unicidade, ack depois do commit, publicação). Onde um teste passava com o bug, ele foi reforçado.
- **Invariante final.** Todo teste de fluxo termina conferindo `wallet.balance == saldo reconstruído pelo ledger`.
- **Constraints.** O schema é testado violando as regras direto no banco, sem passar pelo código da aplicação.

## Interpretações do enunciado

- Uma transação referenciada aceita uma única reversão, de qualquer tipo. O ROLLBACK de um REFUND continua permitido.
- O replay devolve o saldo observado quando a transação foi processada, inclusive em LOSS e REJECTED.
- Valor zero é payload inválido em todos os kinds, inclusive LOSS.
- BET e LOSS não aceitam referência. WIN guarda a referência só para auditoria e é aplicado na hora.
- `PENDING_REFERENCE` responde com o saldo atual, porque ainda não há saldo observado.
- A `Idempotency-Key` vale por provedor: dois provedores podem usar a mesma chave.
- `ready` verifica as dependências que cada processo usa: a API e o consumer, Postgres e SQS; o publicador, Postgres e SNS.

## Limitações

- O publicador envia ao SNS com a linha travada. É simples e seguro, mas segura uma conexão durante o envio; lotes pequenos limitam o impacto.
- Com vários publicadores a ordem dos eventos por wallet não é garantida. Os consumidores devem usar `walletVersion` e deduplicar por `eventId`.
- `FAILED` está modelado e protegido no schema, mas nenhum caminho o grava: falha de infraestrutura segue retry e depois DLQ.
- Uma mensagem em processamento num consumidor morto só volta depois do `VisibilityTimeout` (30s), e a wallet fica bloqueada nesse intervalo por ser FIFO.
- Wallets não pertencem a um provedor: qualquer client autenticado cria e consulta wallets.
- LocalStack não reproduz a latência nem as falhas de rede da AWS real. As mortes por SIGKILL são amostragem, não uma exploração exaustiva dos pontos de falha.
- Fora do escopo entregue, e opcionais no enunciado: teste de carga, OpenTelemetry e ledger de partidas dobradas.
