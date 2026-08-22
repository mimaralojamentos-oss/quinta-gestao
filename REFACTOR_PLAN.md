# Plano de Refatoração — Lógica Duplicada

**Estado: Fase 2 em curso. Plano aprovado, perguntas respondidas.**

## Progresso

- [x] **Passo 1** — `getTenantName`/`getSpaceRef` → `lib/utils.ts` (item 16) — commit feito
- [x] **Passo 2** — Abrir documento do storage → helper único (item 17) — commit feito
- [x] **Passo 3** — Nome de ficheiro sem acentos → helper único (item 18) — commit feito
- [x] **Passo 4** — `handleSort` → hook `useSort` (item 15) — commit feito
- [x] **Passo 5** — Apagar despesa com segurança → helper único (item 1) — commit feito
- [x] **Passo 6** — Datas por extenso → `getMonthLabel`/`formatMonthShort` (item 14) — commit feito. Levantamento de órfãos pedido no fim do Passo 5: 0 encontrados (24 movimentos de caixa por despesa, 167 documentos com expense_id, todos com destino válido).
- [x] **Passo 7** — Moeda em templates → `formatCurrency` (item 19) — commit feito
- [x] **Passo 8** — Categorias de despesa → lista única + corrigir `types.ts` + `despesas/page.tsx` (itens 2, 11) — commit feito
- [x] **Passo 9** — Etiquetas de tipo de pagamento → lista única (item 13) — commit feito
- [x] **Passo 10** — `getDebtRemaining` → helper único (item 12) — commit feito, 1 de 7 sítios deixado de fora (ver nota abaixo)
- [x] **Passo 11** — Critério de duplicado em leituras de contador → unificar (item 6) — commit feito
- [x] **Passo 12** — Cálculo "rendas em falta mês a mês" → função única (item 7) — commit feito
- [x] **Passo 13** — Corrigir `ManualDocumentModal` (item 3) e faturas de eletricidade (item 4) — commit feito
- [ ] Passo 14 — Criação de despesas → `createExpense()` único (item 9) — **ronda final em curso (Temas A-D), ver nota abaixo**
- [x] **Passo 15** — Criação de receitas → `createIncome()` único (item 10) — commit feito, ver nota sobre o âmbito
- [ ] Passo 16 — Alocação automática de pagamentos → unificar (item 8)

Este documento é o resultado de uma leitura completa de `app/`, `components/` e `lib/`, à procura de sítios onde a mesma tarefa (criar uma despesa, apagar um registo, calcular uma dívida, etc.) foi escrita de forma diferente em páginas diferentes. Quando isso acontece, corrigir um bug ou mudar uma regra num sítio não corrige nos outros — e com o tempo os sítios começam a dar respostas diferentes para a mesma pergunta. É esse risco que este plano tenta eliminar.

**Como ler este documento:** cada achado tem uma prioridade —
- 🔴 **Alta** = já encontrámos, ou há um risco real, de dados ficarem inconsistentes (registos órfãos, valores errados, dados invisíveis)
- 🟡 **Média** = funciona hoje, mas é difícil de manter — corrigir uma coisa obriga a lembrar de corrigir em vários sítios
- 🟢 **Baixa** = repetição cosmética, sem risco para os dados

**Numa secção à parte, no fim, estão as perguntas a que só tu consegues responder** — sítios onde o código faz coisas genuinamente diferentes consoante o ecrã, e não posso escolher sozinho qual é o comportamento "certo".

---

## 🔴 Prioridade Alta — risco de dados inconsistentes

### 1. Apagar uma despesa pode deixar lixo para trás (2 casos confirmados)

**O quê:** já aconteceu no código — não é uma suposição — dois sítios que apagam uma despesa esquecem-se de um passo de limpeza.

- **`app/despesas/page.tsx:173-184`** — quando apagas uma despesa mas escolhes **manter a fatura**, o código apaga a despesa mas não avisa o documento de que a despesa já não existe. O documento fica a apontar para uma despesa que já não está lá.
- **`app/documentos/page.tsx:319-327`** — ao mudar o tipo de um documento para "receita" e apagar a despesa que tinha sido criada por engano, o código apaga a despesa **sem primeiro apagar o movimento de caixa** que essa despesa tinha gerado (se foi paga em dinheiro). O movimento de caixa fica órfão — continua a aparecer no Fundo de Maneio, mas já não corresponde a nada.

Por comparação, `app/trabalhadores/[id]/page.tsx:352-368` faz isto sempre pela ordem certa (limpa o movimento de caixa → desliga o documento → só depois apaga a despesa) — é o exemplo a seguir.

**Proposta:** uma função única `apagarDespesaComSeguranca()` em `lib/`, que faz sempre os 3 passos pela ordem certa, e todos os sítios passam a chamá-la.

### 2. A categoria "Administração" está invisível na página principal de Despesas

**O quê:** confirmei diretamente na base de dados — há **10 despesas reais** com categoria "administracao". Mas em `app/despesas/page.tsx`, nem o filtro de categoria (linha 384-392) nem as cores da etiqueta (linha 247-251) sabem desta categoria — só aparece corretamente nos ecrãs de documentos e de reconciliação bancária. Isto significa que hoje, na página onde se gerem as despesas, não dá para filtrar por "Administração" nem a etiqueta tem cor própria, apesar de 10 despesas reais serem dessa categoria.

Relacionado: o tipo `ExpenseCategory` em `lib/types.ts:4` também não inclui `'administracao'` — é a raiz do problema, o resto são sintomas.

**Proposta:** corrigir `lib/types.ts` e criar uma lista única de categorias (ver item 6) usada em todo o lado.

### 3. Um modal de despesas manuais pode criar um movimento de caixa "invisível" à limpeza automática

**O quê:** `components/ManualDocumentModal.tsx` tem dois checkboxes independentes: um para criar a despesa, outro para criar o movimento no Fundo de Maneio. Quando ambos estão marcados, o movimento de caixa é gravado a apontar para o **documento**, não para a despesa (`source_id = documento.id`, não `expense.id`). Todos os outros sítios da app que limpam movimentos de caixa ao apagar uma despesa procuram por `source_id = despesa.id` — nunca vão encontrar este. Se apagares uma despesa criada por este modal, o movimento de caixa correspondente fica para sempre no Fundo de Maneio.

**Proposta:** alinhar este sítio com o resto — o movimento de caixa deve apontar sempre para a despesa, nunca para o documento.

### 4. Faturas de eletricidade usam uma categoria e um método de pagamento próprios, diferentes do resto da app

**O quê:** `app/eletricidade/quadros/page.tsx:345-358` (função `ensureExpense`) grava as despesas de faturas EDP com `category: 'eletricidade'` e `payment_method: 'transferencia'`. Todos os outros sítios da app que lidam com faturas de eletricidade usam `category: 'edp'`, e nenhuma despesa real na base de dados tem `payment_method = 'transferencia'` (confirmei: só existem `'dinheiro'` e `'banco'` nos 320 registos reais). Isto quer dizer que despesas de eletricidade criadas por este ecrã específico não aparecem corretamente nos relatórios/filtros que procuram por `'edp'`, e usam um método de pagamento que mais nenhuma parte da app reconhece.

**Proposta:** corrigir para `category: 'edp'` e decidir o `payment_method` correto (ver pergunta P1, mais abaixo).

### 5. Método de pagamento "Cartão" / "Cheque" nunca foi gravado com sucesso

**O quê:** `components/ManualDocumentModal.tsx` oferece "Cartão" e "Cheque" como opções de pagamento. Nos 320 registos reais de despesas, **nunca aparece nenhum destes dois valores** — só `'dinheiro'` e `'banco'`. É um sinal forte (não uma prova definitiva, não tentei gravar um registo de teste) de que a base de dados pode estar a recusar esses valores silenciosamente — a pessoa que tentasse pagar por cartão ou cheque veria a despesa "desaparecer" sem explicação clara.

**Proposta:** confirmar com um teste controlado, e decidir se estas opções devem ficar (exige alargar a regra na base de dados) ou ser removidas do formulário (ver pergunta P5).

### 6. Três critérios diferentes para saber se uma leitura de contador já foi registada

**O quê:** há 3 sítios que criam leituras de contador elétrico, cada um com uma regra diferente para evitar duplicados:
- `app/eletricidade/quadros/page.tsx:288-303` — não verifica nada, deixa duplicar.
- `app/eletricidade/quadros/page.tsx:387-406` e `app/documentos/page.tsx:387-406` — verificam só por contador + data.
- `app/api/process-document/route.ts:295-338` — verifica por contador + data **e** por número de fatura (mais seguro).

Como as regras são diferentes, é possível criar pela app uma leitura duplicada que a importação automática de documentos teria bloqueado.

**Proposta:** uma função única de verificação, usada nos 3 sítios.

### 7. O cálculo de "quanto falta pagar de renda, mês a mês" está copiado 3 vezes, incluindo uma data fixa no meio do código

**O quê:** este é o achado mais importante do relatório. O cálculo de rendas em atraso de um inquilino — que renda se aplicava em cada mês, o que já foi pago, o que falta — está escrito de forma quase idêntica em **três sítios**, cada um com a sua própria cópia da mesma data fixa (`'2026-05-01'`) a marcar a partir de quando se começa a contar:

- `app/inquilinos/page.tsx:116-167`
- `app/relatorios/page.tsx:183-268`
- `app/inquilinos/TenantModal.tsx:~150-230`

Todos os três usam corretamente os adiantamentos já existentes em `lib/advanceCredit.ts`, mas o resto do cálculo — o mais importante — está copiado à mão. Se um dia for preciso mudar essa data, ou corrigir um erro no cálculo, alguém tem de se lembrar de o fazer nos 3 sítios ao mesmo tempo. Se se esquecer de um, a app passa a mostrar valores de dívida **diferentes** para o mesmo inquilino consoante o ecrã onde olhas — Inquilinos, Relatórios, ou a ficha do inquilino.

**Proposta:** extrair para uma única função em `lib/`, usada pelos 3 ecrãs.

### 8. "Receber pagamento com alocação automática" está implementado duas vezes, por inteiro, sem reaproveitar o que já existe

**O quê:** já existe em `lib/rentPaymentPlan.ts` uma função pronta para distribuir um pagamento por rendas em atraso, eletricidade e dívidas, com o excedente a virar adiantamento — e é usada corretamente nalguns sítios. Mas `app/pagamentos/PaymentModal.tsx` (linhas 174-318) e `app/inquilinos/TenantModal.tsx` (linhas 538-700) têm cada um a sua própria versão completa deste algoritmo, escrita à parte, sem chamar essa função partilhada. Ficam assim **três** caminhos diferentes no código para a mesma operação de negócio.

**Proposta:** o mais arriscado do plano — reescrever os dois modais para usarem `lib/rentPaymentPlan.ts`. Fica para o fim, depois de todo o resto estar feito e testado.

---

## 🟡 Prioridade Média — funciona, mas difícil de manter

### 9. Criação de despesas — 9 sítios diferentes, muitos comportamentos a divergir

Já cobri os casos mais graves (itens 2-5) em cima. Mas há mais divergências sem risco imediato de dados errados, só de manutenção difícil — por exemplo, o texto gravado em `notes` é diferente em cada um dos 9 sítios, só 2 dos 9 verificam se já existe uma despesa parecida antes de criar outra, e só alguns sítios sabem preencher `project_id`. Lista completa dos 9 sítios e das suas diferenças, campo a campo, no anexo A.

**Proposta:** função única `createExpense()` em `lib/`, depois de decididas as perguntas P1-P4.

### 10. Criação de receitas — 4 sítios, uma categoria errada confirmada

`app/documentos/page.tsx` (linha ~335), ao converter um documento em receita, grava sempre `category: 'energia_solar'` — mesmo que a categoria escolhida no formulário seja outra. É um bug pequeno mas real: a categoria que aparece no ecrã não é a que fica gravada. Além disso, só 1 dos 4 sítios verifica duplicados antes de criar. Detalhe completo no anexo B.

**Proposta:** função única `createIncome()` em `lib/`, que usa sempre a categoria fornecida pelo chamador.

### 11. Listas de categorias de despesa escritas à mão em 4 sítios

`app/despesas/ExpenseModal.tsx`, `app/despesas/page.tsx`, `app/documentos/page.tsx`, `components/BankMatchModal.tsx` — cada um com a sua cópia da lista de categorias. Já confirmámos (item 2) que uma delas está incompleta.

**Proposta:** uma lista única em `lib/expenseCategories.ts` (valor + etiqueta + cor), usada por todos.

### 12. Cálculo de "quanto falta pagar de uma dívida" repetido em 7 sítios

O mesmo cálculo simples — dívida original menos o que já foi pago — está copiado em `lib/rentPaymentPlan.ts`, `PaymentModal.tsx`, `TenantModal.tsx`, `inquilinos/page.tsx` (3 vezes), `inquilinos/[id]/page.tsx` (2 vezes), `pagamentos/page.tsx` e `relatorios/page.tsx`. Baixo risco por ser um cálculo simples, mas 7 cópias é demasiado.

**Proposta:** uma função `getDebtRemaining()` em `lib/`.

### 13. Etiquetas de tipo de pagamento (Renda, Caução, Extra...) duplicadas

`app/pagamentos/PaymentModal.tsx` e `app/pagamentos/page.tsx` têm a mesma lista, palavra por palavra. `PaymentModal.tsx` ainda por cima tem a lista **duas vezes dentro do próprio ficheiro** (`tipoConfig` e `tipoLabels`, linhas 19-33).

**Proposta:** lista única em `lib/paymentTypes.ts`.

### 14. Datas por extenso calculadas à mão em pelo menos 11 sítios, reintroduzindo um bug já corrigido

`lib/utils.ts` já tem `getMonthLabel`/`formatMonthShort`, escritas de propósito para evitar um bug de fuso horário que existia antes (a data podia recuar um dia). Ainda assim, o padrão antigo e problemático (`new Date(x).toLocaleDateString('pt-PT', {...})`) continua espalhado por `relatorios/page.tsx` (6 vezes), `caixa/page.tsx`, `despesas/page.tsx`, `LeaseModal.tsx` e `eletricidade/quadros/page.tsx`. Isto não é só repetição — é o mesmo bug que já foi corrigido noutro sítio, à espreita de acontecer outra vez nestes.

**Proposta:** substituir todas as ocorrências pelas funções já existentes em `lib/utils.ts`.

### 15. `handleSort` copiado, palavra por palavra, em 5 páginas

`caixa/page.tsx`, `despesas/page.tsx`, `documentos/page.tsx`, `pagamentos/page.tsx`, `inquilinos/page.tsx` — a função que trata do clique para ordenar uma coluna é exatamente igual nas 5.

**Proposta:** um "hook" reutilizável (`useSort`) que substitui as 5 cópias — o componente `SortIcon` (já partilhado) fica exatamente como está.

---

## 🟢 Prioridade Baixa — cosmético, sem risco

### 16. `getTenantName`/`getSpaceRef` copiados 2 vezes, com pequena diferença
`documentos/page.tsx` e `eletricidade/espacos/page.tsx` — a lógica é igual, mas uma mostra `'—'` quando não há dados e a outra mostra vazio. Mover para `lib/utils.ts`, com essa diferença como opção.

### 17. Abrir documento do storage — 9 sítios (não 8), só o tratamento de erro diverge
Bucket e tempo de validade do link (60 segundos) são consistentes nos 9. Só `app/extras/fornecedores/page.tsx` avisa o utilizador se falhar a abrir — os outros 8 falham em silêncio. Um helper único (`openStorageDocument`) resolve isto e corrige o aviso em falta de uma vez.

### 18. Nome de ficheiro sem acentos, calculado à mão em 3 sítios
`ManualDocumentModal.tsx`, `LeaseModal.tsx`, `trabalhadores/[id]/page.tsx` — a mesma fórmula para limpar o nome de um ficheiro antes de o guardar. Extrair para `lib/utils.ts`.

### 19. Moeda formatada à mão em templates de impressão/email
Em vez de `formatCurrency`, alguns templates de PDF/email fazem `valor.toFixed(2) + ' €'` manualmente (`relatorios/page.tsx`, `eletricidade/espacos/page.tsx`, `api/compose-email/route.ts`). Cosmético, sem risco.

---

## Respostas às perguntas (decididas em 2026-08-21)

**P1 — Faturas de eletricidade: método de pagamento e categoria.**
Decidido: `payment_method: 'banco'` (como o resto da app) e `category: 'edp'`, corrigidos em `eletricidade/quadros/page.tsx`.

**P2 — O movimento no Fundo de Maneio deve estar sempre ligado à criação da despesa, ou pode ser um passo à parte?**
Decidido: mantém-se a flexibilidade dos dois checkboxes independentes no `ManualDocumentModal`. Corrige-se só o defeito técnico — o movimento passa a apontar sempre para `source_id = despesa.id`, nunca para o documento. Nada muda visualmente para o utilizador.

**P3 — A partir de quando é que uma despesa em dinheiro deve mexer no Fundo de Maneio?**
Decidido: o limite `2026-06-01` (hoje só em `api/process-document/route.ts`) passa a aplicar-se em todo o lado — despesas em dinheiro com data anterior nunca criam movimento de caixa, seja qual for o ecrã. A constante já existe em `lib/bankExpense.ts` (`CASH_FUND_START_DATE`) — vai ser movida para um sítio partilhado por todos os pontos de criação de despesa.

**P4 — Despesa ↔ documento: qual é a ligação "oficial"?**
Decidido: `documents.expense_id` é a ligação oficial. Antes de deixar de escrever `expenses.invoice_id`, é preciso confirmar se algum sítio o LÊ — se ninguém ler, deixa de se escrever (documentado aqui quando chegarmos ao passo 14); se alguém ler, esse sítio migra primeiro para `documents.expense_id`.

**P5 — "Cartão" e "Cheque" como método de pagamento: manter ou remover?**
Decidido: remover do formulário do `ManualDocumentModal`. Pagamentos com cartão passam a registar-se como `'banco'` (é como aparecem no extrato). Não é preciso mexer na regra da base de dados.

**P6 — Verificação de duplicados ao criar uma despesa: deve ser obrigatória em todo o lado?**
Decidido: passa a existir em todo o lado, sempre como aviso que pode ser ignorado — nunca bloqueio automático. Os fluxos automáticos (banco, importação de documentos) mantêm o comportamento que já têm hoje.

**P7 — Passo 6: formato de "Mês Ano" — manter o texto atual ("julho de 2026") ou unificar com o resto da app ("Julho 2026")?**
Decidido em 2026-08-21: unificar para "Julho 2026" (o formato que `getMonthLabel` já usa no Dashboard, Alertas, Pagamentos, etc.). O texto muda visivelmente nestes 10 sítios (perde a palavra "de"), decisão consciente para corrigir a inconsistência já existente na app e o bug de fuso horário escondido por trás de `toLocaleDateString`. Aplicado também ao gráfico de `eletricidade/quadros/page.tsx`, cujo eixo mostrava "07/26" em vez de um nome de mês (bug do ambiente, não intencional) — passa a mostrar "Jul 2026".

**P8 — Passo 7: formato de moeda manual ("1234.50 €") vs `formatCurrency` ("1 234,50 €")?**
Decidido em 2026-08-21: mesmo critério do Passo 6 — unificar com `formatCurrency`. O texto muda nestes 8 sítios (`relatorios.tsx` x5, `eletricidade/espacos.tsx` x3): vírgula decimal em vez de ponto, e espaço a separar milhares em valores acima de 1000€. O helper `eur()` local em `api/compose-email/route.ts` já produzia texto idêntico ao `formatCurrency` para valores pequenos — só diverge (sem separador de milhares) em valores grandes, por isso foi unificado também.

Nota à parte (não corrigida neste passo, fora de âmbito): `app/relatorios/page.tsx` tem uma terceira forma de mostrar moeda, `fmt()` (linha ~727, usa `toLocaleString` em vez de `Intl.NumberFormat`) — produz o mesmo resultado que `formatCurrency`, só o caminho de código é diferente. Fica registado para uma limpeza futura, não fazia parte do que este passo cobria.

**Passo 10 — nota: `lib/rentPaymentPlan.ts:161-163` deixado de fora, de propósito.** Os outros 6 sítios calculavam "quanto falta pagar" exatamente da mesma forma (`Math.max(0, original - pago)`). Este sétimo faz a conta de forma ligeiramente diferente: em vez de `Math.max(0, ...)`, arredonda a subtração a 2 casas decimais (`parseFloat((original - pago).toFixed(2))`) e só depois verifica se é `&lt;= 0`. Na prática dá o mesmo resultado quase sempre, mas não é garantidamente idêntico em casos extremos de arredondamento de vírgula flutuante (uma fração de cêntimo). Como as regras deste trabalho dizem para não decidir sozinho quando um sítio diverge, não toquei — fica como estava, sinalizado aqui para decidires se deve ser unificado também.

**Passo 11 — nota: 4º sítio encontrado, para além dos 3 do levantamento inicial.** Além dos 3 sítios já identificados na auditoria (importação automática de documentos, ligação manual de documento a leitura, e o carregamento em lote de PDFs de eletricidade), havia um 4º: o formulário manual de registar leitura (`saveReading()` em `eletricidade/quadros/page.tsx`), que **não tinha nenhuma verificação de duplicado**. Os 4 sítios passam agora a usar o mesmo critério (o mais robusto, que já existia na importação automática): contador+data, ou contador+nº de fatura quando a data pode ter mudado entre versões do mesmo documento. Nos 3 sítios que já tinham alguma verificação, o comportamento em caso de duplicado manteve-se igual (2 bloqueiam, 1 salta e marca como duplicado na importação em lote) — só o critério de deteção ficou mais abrangente. No 4º sítio (o formulário manual), foi acrescentado um aviso novo, não bloqueante: "Já existe uma leitura para este quadro nesta data (ou com este nº de fatura). Registar mesmo assim?" — o utilizador pode sempre continuar se quiser, conforme a regra P6.

**Passo 12 — nota: só a parte realmente igual foi unificada.** Os 3 sítios (`inquilinos/page.tsx`, `relatorios/page.tsx`, `TenantModal.tsx`) percorriam mês a mês da mesma forma (mesma data de corte 2026-05-01, mesma procura de renda no histórico, mesmo filtro de pagamentos do mês) mas cada um fazia uma coisa diferente com esses dados: um soma um total de dívida, outro constrói uma lista de linhas descritivas para o relatório, e o terceiro constrói linhas para a tabela do modal (incluindo juntar adiantamentos à última renda paga do mês). Criado `lib/rentShortfall.ts` com `getMonthlyRentStatus()`, que faz só a parte comum (percorrer os meses e devolver a renda aplicável, os pagamentos desse mês e o crédito aplicado); cada sítio continua a calcular o valor em falta à sua maneira, com a mesma fórmula de arredondamento que já usava antes (não são exatamente iguais entre sítios — ver nota do Passo 10 sobre isso — por isso não foram forçadas a ficar iguais).

**Passo 13 — nota sobre a correção do movimento de caixa (P2).** O defeito técnico era: quando o "Documento Manual" criava despesa E movimento de caixa ao mesmo tempo, o movimento de caixa ficava sempre associado ao documento (`source: 'documento_manual', source_id: doc.id`), nunca à despesa. Isto divergia do padrão usado em todos os outros sítios da app (`ExpenseModal.tsx`, `despesas/page.tsx`, etc.), que associam sempre o movimento à despesa (`source: 'despesa', source_id: despesa.id`). Na prática isto significava que, ao apagar essa despesa mais tarde, o movimento de caixa correspondente NÃO era limpo automaticamente (o "apagar despesa com segurança" do Passo 5 procura pelo id da despesa, não do documento) — ficava órfão. Corrigido: agora, quando a despesa é criada, o movimento aponta para o id dela; só quando não há despesa (checkbox "criar despesa" desligado) é que continua a apontar para o documento, como antes. As duas checkboxes continuam independentes, como pedido.

**Passo 14 — saltada a unificação completa em `createExpense()`, mas corrigido o bug do P3.** Este era o passo mais arriscado do plano (a auditoria já o assinalava assim) e, ao investigar os 9 sítios que criam despesas, confirmei que é mais complexo do que previsto — não por dificuldade técnica, mas porque exige várias decisões novas, de dinheiro real, que P1-P8 não respondem diretamente:

- `components/ManualDocumentModal.tsx` tem uma checkbox "Adicionar ao Fundo de Maneio" que serve tanto para despesas como para receitas manuais — a regra do P3 fala em "despesa paga em dinheiro", não é claro se deve aplicar-se também a receitas manuais registadas ali.
- `app/despesas/CopiarDespesasModal.tsx` copia várias despesas de uma vez, num ciclo. Um aviso de duplicado por confirm() (como pede o P6) dispararia uma fila de janelas de confirmação, uma por despesa copiada — má experiência, e o P6 não cobre este caso (fala em "um a um" vs. "automático", isto é um lote manual, não é nenhum dos dois).
- Os 9 sítios têm contextos muito diferentes (modais com o seu próprio estado, uma rota de API sem interface, um ciclo de importação em lote) — forçar todos a usar literalmente a mesma função só é seguro se cada consumidor mantiver o comportamento que já tinha (como fiz no Passo 12), o que exige perceber bem cada um antes de mexer.

Por precaução (é dinheiro real), decidi não avançar com a unificação completa nem com o P4 (migração do leitor de `invoice_id`) nem com o P6 (aviso universal de duplicado) nesta ronda sem paragens. Fica para uma sessão dedicada, com paragens entre decisões.

O que FOI corrigido, por ser um bug concreto e sem ambiguidade (o P3 já dizia explicitamente "tem de se aplicar em todo o lado"): a falta da barreira de data do fundo de maneio (`CASH_FUND_START_DATE`, 2026-06-01) em 3 sítios que criavam despesas pagas em dinheiro e mexiam sempre no fundo de maneio, nunca verificando a data — `ExpenseModal.tsx` (criar e editar despesa), `CopiarDespesasModal.tsx`, e o pagamento a trabalhadores em `trabalhadores/[id]/page.tsx`. Corrigido para só mexerem no fundo de maneio quando a data é 2026-06-01 ou posterior, tal como já acontecia na importação automática de documentos — a única correção feita foi impedir a criação de NOVOS movimentos fora da regra; nenhum movimento já existente foi tocado ou apagado. A constante deixou de estar duplicada em `api/process-document/route.ts` — passou a vir de `lib/bankExpense.ts`, que já a tinha mas não a usava.

Também confirmado (P4): há um leitor de `expenses.invoice_id` em `api/process-document/route.ts` (usa `.is('invoice_id', null)` para encontrar despesas órfãs a religar a uma fatura nova). Como há leitor, não se pode simplesmente deixar de escrever `invoice_id` sem migrar primeiro este leitor para `documents.expense_id` — fica também para a sessão dedicada ao Passo 14.

**Passo 15 — nota sobre o âmbito: só o bug concreto foi corrigido, sem forçar uma função única.** Analisados os 4 sítios que criam receitas (`financeiro/receitas/page.tsx`, `documentos/page.tsx`, `BankMatchModal.tsx`, `api/process-document/route.ts`) — ao contrário do Passo 14, aqui não há dinheiro do fundo de maneio envolvido nem políticas por decidir, mas também não há muito a sério em comum entre os 4: cada um recebe a categoria de forma diferente (escolha manual, texto livre normalizado, extração automática por IA) e só 2 têm liga a um documento. Criar uma função única só para agrupar chamadas a `insert()` já bastante diferentes entre si não trazia proteção real contra bugs — só mais uma camada. Por isso, corrigido apenas o bug concreto identificado na auditoria: `documentos/page.tsx` criava sempre a receita com categoria fixa "energia_solar", ignorando a categoria que a pessoa tivesse escolhido no formulário ao converter o documento de despesa para receita. Agora usa `editForm.category` (a mesma que já era usada, ali ao lado, para sincronizar a categoria da despesa) — com "energia_solar" só como reserva, caso o campo esteja vazio.

**Nota fora do plano (robustez) — 2026-08-22: fallback da data do Fundo de Maneio em `app/caixa/page.tsx`.** A página lia a data de início do fundo (`NEXT_PUBLIC_CASH_FUND_START_DATE`) só da variável de ambiente, com reserva para `null` quando não definida — e sem essa data, o filtro desaparecia e a página somava TODO o histórico de movimentos (mostrou 53 688,06 € em vez de 11 305,64 €, num ambiente onde a variável ainda não estava definida). Corrigido: a reserva passa a ser `'2026-05-31'` (o mesmo valor já usado em produção) em vez de `null` — a variável de ambiente, quando definida, continua a mandar; serve só para mudar a data sem mexer no código. Verificado que esta variável não é lida em mais nenhum sítio do código. **Importante:** isto é uma data diferente da `CASH_FUND_START_DATE` ('2026-06-01') em `lib/bankExpense.ts`, que decide se uma despesa nova em dinheiro cria movimento de caixa (Passo 14) — são datas com papéis diferentes de propósito e não foram unificadas.

## Ronda final do Passo 14 (2026-08-22)

Fecho das pendências deixadas em aberto na primeira tentativa do Passo 14, em 4 temas, um por commit.

**Tema A — regra da data do fundo de maneio, também nas receitas.** Decisão: qualquer movimento de caixa (despesa OU receita em dinheiro) com data anterior a `CASH_FUND_START_DATE` (2026-06-01) nunca é criado, venha do ecrã que vier. Corrigido em `ManualDocumentModal.tsx` — a checkbox "Adicionar ao Fundo de Maneio" (que serve tanto para despesas como para receitas manuais) passa a respeitar esta data. Ao procurar mais sítios que criassem movimentos sem respeitar a data, não encontrei mais nenhum ligado a receitas (os outros 3 sítios que criam receitas — `financeiro/receitas`, deteção bancária, importação automática — nunca criaram movimento de caixa a partir de uma receita, só o Documento Manual o fazia). Encontrei, em vez disso, um sítio do lado das DESPESAS que tinha ficado de fora da primeira ronda: o botão de alternar rapidamente o método de pagamento em `despesas/page.tsx` (`handlePaymentMethodToggle`) também criava sempre movimento de caixa ao mudar para "Dinheiro", sem verificar a data — corrigido com a mesma regra dos outros 3 sítios já corrigidos (só impede criar movimentos novos; nenhum existente foi tocado).

**Tema B — migração do `expenses.invoice_id`.** O leitor confirmado no Passo 14 original (`api/process-document/route.ts`, usava `.is('invoice_id', null)` para achar despesas "órfãs" antes de decidir criar uma despesa nova) foi verificado com dados reais antes de mexer, como pedido — e a verificação revelou uma divergência importante: das 320 despesas existentes, **nenhuma** tem `invoice_id` preenchido (o campo nunca chegou a ser escrito na prática, apesar de o código o tentar em 2 sítios), enquanto 167 já têm documento ligado via `documents.expense_id`. Ou seja, o critério antigo considerava as 320 despesas como "livres para reutilizar", incluindo as 167 já pertencentes a outro documento — uma falha viva: uma fatura nova com valor igual (±1 dia) a uma despesa já ligada a outro documento podia ficar incorretamente associada a essa despesa antiga. Reportado ao Miguel, que escolheu migrar. Criado `lib/expenseDuplicates.ts` com `findUnlinkedExpenseByAmount()` (usa `documents.expense_id`, o link oficial) e `findSimilarExpenses()` (para o aviso de duplicados do Tema C/D — não filtra por "sem documento", é só um aviso). Deixou de se escrever `invoice_id` nos 3 sítios encontrados (2 já esperados — `trabalhadores/[id]/page.tsx` e `ManualDocumentModal.tsx` — mais um 3º em `documentos/page.tsx`, que o punha a `null` ao apagar um documento, também morto na prática). **A coluna `invoice_id` continua na base de dados** — só deixou de ser lida/escrita pelo código.

**Tema C — `createExpense()` único em `lib/createExpense.ts`.** Os 9 sítios que criavam despesas diretamente (`documentos/page.tsx`, `ExpenseModal.tsx` — só ao criar, não ao editar, `CopiarDespesasModal.tsx`, `ManualDocumentModal.tsx`, `BankMatchModal.tsx`, `eletricidade/quadros/page.tsx`, `trabalhadores/[id]/page.tsx`, `api/process-document/route.ts`, `lib/bankExpense.ts`) passam a usar a mesma função para a mecânica: gravar a despesa, ligar ao documento oficial (`documents.expense_id`) e, quando é paga em dinheiro, criar a saída do Fundo de Maneio (sempre a apontar para a despesa, sempre a respeitar `CASH_FUND_START_DATE`). Confirmado no fim: já não sobra nenhum `insert` direto em `expenses` fora de `lib/` — só a própria `createExpense()` o faz.

O que cada sítio já fazia de forma diferente (textos de `notes`/descrição do movimento de caixa, se há aviso de duplicado antes de criar) ficou à responsabilidade de quem chama, através de parâmetros (`cashMovementDescription`, `cashMovementNotes`, `skipCashMovement`) — não foi forçada nenhuma uniformização de texto onde os sítios já divergiam antes por motivo válido:
- **`ManualDocumentModal.tsx`** é o único sítio onde criar o movimento de caixa é decidido por uma checkbox à parte ("Adicionar ao Fundo de Maneio"), não automaticamente pelo método de pagamento — usa `skipCashMovement: true` e continua a gerir o seu próprio movimento, como já fazia.
- **`trabalhadores/[id]/page.tsx`** e **`api/process-document/route.ts`** têm textos próprios para a descrição/notas do movimento de caixa (sem repetir o fornecedor, por exemplo) — passam esses textos explicitamente.

**Aviso de duplicados (P6)** — usa `findSimilarExpenses()` (criada no Tema B) antes de criar, com `confirm()`, aplicado nos fluxos manuais de um-a-um: `documentos/page.tsx`, `ExpenseModal.tsx`, `ManualDocumentModal.tsx`, `BankMatchModal.tsx`, `trabalhadores/[id]/page.tsx`. **Sem aviso** em 3 sítios, por decisão já tomada ou por continuar a valer o mesmo raciocínio do P6 para fluxos automáticos:
- `api/process-document/route.ts` e `lib/bankExpense.ts` — fluxos automáticos, já tinham a sua própria lógica de reaproveitar despesa órfã (Tema B), P6 diz para manter o comportamento atual.
- `CopiarDespesasModal.tsx` e `eletricidade/quadros/page.tsx` (`ensureExpense`, chamado num ciclo de importação em lote) — correm em ciclo sobre várias despesas de uma vez; um `confirm()` por despesa criaria uma fila de popups, o mesmo problema que motivou o Tema D. `CopiarDespesasModal.tsx` vai ganhar o resumo único do Tema D; `ensureExpense` não tinha esse pedido explícito, mas fica com a mesma lógica (sem aviso aqui) até se decidir se também precisa de um resumo — sinalizado, não decidido sozinho para além do que já foi dito.

**Passo 8 — nota sobre estilo visual preservado.** A app tinha 2 estilos diferentes para mostrar a categoria: os formulários de criar/editar despesa (sem emoji, ex. "Eletricidade (EDP)") e o filtro da página de Despesas (com emoji, ex. "⚡ Eletricidade"). Em vez de unificar os dois (o que mudaria texto onde não havia bug), `lib/expenseCategories.ts` guarda os dois rótulos lado a lado (`label` e `filterLabel`) — cada sítio continua a mostrar exatamente o que mostrava antes, exceto "administracao", que estava mesmo em falta no filtro e nas cores da página de Despesas (o bug confirmado com dados reais: 10 despesas). Essa categoria ganha agora uma cor própria (cinza-azulado) em vez de cair na cor "outros" por omissão.

---

## Ordem de execução (Fase 2)

Ordem aprovada em 2026-08-21, com o passo "Apagar despesa com segurança" adiantado para logo a seguir ao `useSort` — é o único problema a criar registos órfãos ativamente, é autocontido, e não depende de nenhuma das respostas acima. Ver a lista de progresso no topo deste documento para o estado atual de cada passo.

---

## Anexos

**Anexo A — quadro completo dos 9 sítios de criação de despesas** (campo a campo): disponível se quiseres antes de aprovarmos o passo 14. Fica documentado nas notas desta auditoria, não reproduzido aqui para não tornar este ficheiro enorme — digo-te quando chegarmos lá.

**Anexo B — quadro completo dos 4 sítios de criação de receitas**: idem, disponível quando chegarmos ao passo 15.

---

*Este ficheiro é para ser atualizado à medida que os passos da Fase 2 forem sendo concluídos, para podermos retomar noutro dia sem perder o fio.*
