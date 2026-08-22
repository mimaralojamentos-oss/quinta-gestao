// Data de início do Fundo de Maneio. Só a partir daqui é que uma despesa ou
// receita paga em dinheiro cria movimento no fundo — datas anteriores nunca
// mexem no saldo, venha o sítio que vier.
//
// Módulo à parte (em vez de viver em lib/bankExpense.ts) para evitar um
// import circular entre lib/bankExpense.ts e lib/createExpense.ts, que
// passaram a depender uma da outra.
export const CASH_FUND_START_DATE = '2026-06-01'
