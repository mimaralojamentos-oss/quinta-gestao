import jspdfPkg from 'jspdf'
const { jsPDF } = jspdfPkg

const doc = new jsPDF({ unit: 'mm', format: 'a4' })

const marginL = 18
const marginR = 18
const marginTop = 18
const marginBottom = 16
const pageW = 210
const pageH = 297
const contentW = pageW - marginL - marginR

let y = marginTop

function ensureSpace(h) {
  if (y + h > pageH - marginBottom) {
    doc.addPage()
    y = marginTop
  }
}

function spacer(h) {
  y += h
}

function rule() {
  ensureSpace(3)
  doc.setDrawColor(190)
  doc.setLineWidth(0.2)
  doc.line(marginL, y, pageW - marginR, y)
  y += 3
}

function title(text) {
  doc.setTextColor(20, 20, 20)
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(20)
  ensureSpace(10)
  doc.text(text, marginL, y)
  y += 9
}

function metaLine(text) {
  doc.setTextColor(110, 110, 110)
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(9.5)
  ensureSpace(4.5)
  doc.text(text, marginL, y)
  y += 4.3
}

function h1(text) {
  doc.setTextColor(20, 20, 20)
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(14)
  spacer(4)
  ensureSpace(8)
  doc.text(text, marginL, y)
  y += 5.5
  rule()
  spacer(2)
}

function h2(text) {
  doc.setTextColor(20, 20, 20)
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(11.5)
  const lines = doc.splitTextToSize(text, contentW)
  spacer(2.5)
  ensureSpace(lines.length * 5 + 2)
  for (const line of lines) {
    doc.text(line, marginL, y)
    y += 5
  }
  spacer(1)
}

function body(text) {
  doc.setTextColor(30, 30, 30)
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(10)
  const lines = doc.splitTextToSize(text, contentW)
  for (const line of lines) {
    ensureSpace(4.6)
    doc.text(line, marginL, y)
    y += 4.6
  }
  spacer(1)
}

function bullet(text) {
  doc.setTextColor(30, 30, 30)
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(10)
  const indent = 5
  const lines = doc.splitTextToSize(text, contentW - indent)
  lines.forEach((line, i) => {
    ensureSpace(4.6)
    if (i === 0) doc.text('-', marginL, y)
    doc.text(line, marginL + indent, y)
    y += 4.6
  })
}

function mono(text) {
  doc.setTextColor(40, 40, 40)
  doc.setFont('courier', 'normal')
  doc.setFontSize(8.5)
  const lines = doc.splitTextToSize(text, contentW)
  for (const line of lines) {
    ensureSpace(4)
    doc.text(line, marginL, y)
    y += 4
  }
  spacer(1)
}

function keyValue(key, value) {
  doc.setTextColor(20, 20, 20)
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(10)
  ensureSpace(4.6)
  doc.text(key, marginL, y)
  y += 4.6
  doc.setTextColor(40, 40, 40)
  doc.setFont('courier', 'normal')
  doc.setFontSize(9)
  const lines = doc.splitTextToSize(value, contentW - 4)
  for (const line of lines) {
    ensureSpace(4.2)
    doc.text(line, marginL + 4, y)
    y += 4.2
  }
  spacer(1.5)
}

function module(name, path, desc) {
  doc.setTextColor(20, 20, 20)
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(10)
  ensureSpace(4.6)
  doc.text(name, marginL, y)
  const w = doc.getTextWidth(name)
  doc.setFont('courier', 'normal')
  doc.setFontSize(9)
  doc.setTextColor(90, 90, 90)
  doc.text('  ' + path, marginL + w, y)
  y += 4.6
  if (desc) {
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(9.5)
    doc.setTextColor(60, 60, 60)
    const lines = doc.splitTextToSize(desc, contentW - 4)
    for (const line of lines) {
      ensureSpace(4.2)
      doc.text(line, marginL + 4, y)
      y += 4.2
    }
  }
  spacer(1.5)
}

// ============================================================
// CONTEUDO
// ============================================================

title('Gestao da Quinta - Evora')
metaLine('Data: 13 de Junho de 2026')
metaLine('Versao v13.0 - Auditoria de Seguranca (substitui v12.0 - este documento esmaga o anterior)')
metaLine('Utilizador admin: miguelseverino')
spacer(2)

h1('REGRAS CRITICAS - LER ANTES DE QUALQUER ALTERACAO')
bullet("NUNCA usar export const dynamic = 'force-dynamic' (causa loop infinito)")
bullet('SEMPRE incluir GRANT SELECT, INSERT, UPDATE, DELETE em novas tabelas Supabase')
bullet('NUNCA substituir qualquer pagina sem pedir ficheiro atual do GitHub primeiro')
bullet('fetchRendas SEMPRE usar leasesMap separado, NUNCA join direto')
bullet('Codigo SEMPRE ficheiro completo - nunca patches parciais')
bullet('SEMPRE pedir ficheiro atual do GitHub antes de modificar qualquer pagina')
bullet('PRIMEIRA ATIVIDADE num novo chat: abrir terminal, cd C:\\Projetos\\quinta-app, git pull, claude')
bullet('NOVA REGRA (13/06/2026): a PRIMEIRA prioridade deste chat e a Seccao 4 (Auditoria de Seguranca) - existe uma fuga de dados ativa em producao, ver Prioridade 0')

h1('1. URLs e Acessos')
keyValue('App Web:', 'https://quinta-gestao.vercel.app')
keyValue('GitHub:', 'https://github.com/mimaralojamentos-oss/quinta-gestao')
keyValue('Supabase:', 'https://supabase.com/dashboard/project/szjwtccjrljprettcfxm')
keyValue('Vercel:', 'https://vercel.com/miguel-severino-s-projects/quinta-gestao')
keyValue('SQL Editor:', 'https://supabase.com/dashboard/project/szjwtccjrljprettcfxm/sql/new')
keyValue('Supabase ID:', 'szjwtccjrljprettcfxm')
keyValue('Twilio Number:', '+19452024418')
keyValue('Claude Code:', 'C:\\Projetos\\quinta-app')

h1('2. Stack Tecnica')
keyValue('Frontend:', 'Next.js 16.2.6 + TypeScript')
keyValue('Estilo:', 'Tailwind CSS v4')
keyValue('Base de dados:', 'Supabase PostgreSQL - Plano PRO - backups diarios 7 dias')
keyValue('Auth:', 'Supabase Auth - sessionStorage - timeout 15min')
keyValue('Alojamento:', 'Vercel Hobby Gratuito')
keyValue('IA/OCR:', '@anthropic-ai/sdk 0.39.0 - Pago por uso - claude-sonnet-4-5')
keyValue('SMS:', 'Twilio +19452024418 (EUA)')
keyValue('Claude Code:', 'v2.1.170 - C:\\Projetos\\quinta-app - git pull antes de comecar')

h1('3. Modulos Implementados')
module('Dashboard', '/dashboard', 'KPIs, rendas, alertas, EDP, projetos')
module('Espacos', '/espacos', '39 espacos')
module('Inquilinos', '/inquilinos', 'conta corrente com eletricidade e adiantamentos')
module('Rendas & Pagamentos', '/pagamentos', 'adiantamento automatico quando paga a mais')
module('Eletricidade Quadros', '/eletricidade/quadros', '3 quadros EDP, grafico atualiza automaticamente')
module('Eletricidade Espacos', '/eletricidade/espacos', 'cobrar/acumular, filtro checkboxes por espaco')
module('Projetos', '/projetos', '')
module('Documentos', '/documentos', 'OCR, 7 tipos incl. transferencia_interna')
module('Despesas', '/despesas', '')
module('Fundo de Maneio', '/caixa', 'movimentos automaticos de documentos')
module('Notas', '/notas', 'arquivar/restaurar')
module('Alertas', '/alertas', '')
module('Relatorios', '/relatorios', '')
module('Utilizadores', '/utilizadores', 'gestao de roles + log de acessos (so admin)')

// ============================================================
// SECCAO 4 - AUDITORIA DE SEGURANCA
// ============================================================

doc.addPage()
y = marginTop

h1('4. AUDITORIA DE SEGURANCA (13/06/2026) - PRIORIDADES PARA ESTE CHAT')
body('Auditoria realizada em 13/06/2026. Conclusao: existe uma fuga de dados ATIVA e exploravel sem qualquer login. As prioridades abaixo estao ordenadas - resolver pela ordem indicada, comecando pela PRIORIDADE 0 que e a mais urgente de todo o projeto.')

spacer(1)
doc.setFont('helvetica', 'bold')
doc.setFontSize(10)
ensureSpace(4.6)
doc.setTextColor(20, 20, 20)
doc.text('Resumo rapido:', marginL, y)
y += 4.6
mono([
  '0 - Fuga de dados sem login (RLS/anon)              CRITICO MAXIMO - ATIVO AGORA',
  '1 - /api/create-user + /api/update-user sem role    CRITICO',
  '2 - RLS "authenticated = tudo" nas tabelas core      CRITICO',
  '3 - Tabela profiles sem policy versionada            CRITICO',
  '4 - process-document/process-contract sem role      IMPORTANTE',
  '5 - /api/send-sms aberto + sent_by falso             IMPORTANTE',
  '6 - xlsx 0.18.5 vulnerabilidade alta sem fix         IMPORTANTE',
  'R - Headers HTTP, postcss, schemas em falta          RECOMENDACAO',
].join('\n'))

// ---- Prioridade 0 ----
h2('PRIORIDADE 0 [CRITICO MAXIMO - ATIVO AGORA] - Fuga de dados sem autenticacao')
body('Testado em 13/06/2026 com a chave publica NEXT_PUBLIC_SUPABASE_ANON_KEY (role: anon), SEM qualquer login - exatamente o que um visitante anonimo consegue fazer a partir da consola do browser (a anon key vai embutida no JS publico do site). As seguintes tabelas devolveram DADOS/CONTAGENS REAIS a um utilizador anonimo (GET ?select=id&limit=1 + Prefer: count=exact):')
mono([
  'tenants               -> 32 linhas',
  'rent_payments         -> 180 linhas',
  'profiles              -> 4 linhas',
  'cash_fund_movements   -> 43 linhas',
  'expenses              -> 219 linhas',
  'leases                -> 32 linhas',
  'spaces                -> 39 linhas',
  'bank_transactions     -> 146 linhas',
  'banks                 -> 1 linha',
  'sms_log               -> 3 linhas',
  'gate_phones           -> 69 linhas',
  'electricity_readings  -> 54 linhas',
  'electricity_charges   -> 3 linhas',
].join('\n'))
body('As seguintes devolveram 0 linhas - podem estar vazias OU protegidas, nao ha forma de distinguir so com leitura: documents, access_logs, debts, debt_payments, owners, tenant_contacts, notes, meters, meter_readings.')
body('Causa provavel: RLS nao esta ativo nestas tabelas em producao (ou existe policy "TO public"/"anon"), apesar de supabase-schema.sql definir "FOR ALL TO authenticated USING (true)".')

doc.setFont('helvetica', 'bold')
doc.setFontSize(10)
ensureSpace(4.6)
doc.setTextColor(20, 20, 20)
doc.text('ACAO IMEDIATA (fazer ANTES de qualquer outra alteracao):', marginL, y)
y += 4.6
bullet('1. Abrir Supabase Dashboard -> Database -> Tables -> verificar se "RLS enabled" esta ativo em TODAS as tabelas do schema public (as 13 listadas + as 9 que devolveram 0).')
bullet('2. Para cada tabela sem RLS: ALTER TABLE <tabela> ENABLE ROW LEVEL SECURITY;')
bullet('3. Ir a Database -> Policies e procurar policies "TO public" ou que incluam "anon" - remover/corrigir.')
bullet('4. Recriar policies para excluir anon por completo e introduzir controlo por role (ver Prioridade 2).')
bullet('5. Verificar especificamente a tabela profiles: confirmar se UPDATE de "role" e permitido a qualquer utilizador (mesmo anonimo). Se sim, e a forma mais direta de account takeover total: PATCH profiles SET role=admin sem login.')
bullet('6. Depois de corrigir, correr: node scripts/rls-check.mjs (existe no repo, le .env.local, faz so GET com limit=1 usando a anon key, nao escreve nada). Sucesso = todas as tabelas devolvem status 401 OU rows_returned=0 / content-range=*/0 para o role anon.')
body('NOTA: nao foram testados INSERT/UPDATE/DELETE com a anon key (seria destrutivo em producao). Assumir que a escrita tambem esta exposta enquanto o RLS nao for corrigido.')

// ---- Prioridade 1 ----
h2('PRIORIDADE 1 [CRITICO] - /api/create-user e /api/update-user sem verificacao de role')
mono('Ficheiros: app/api/create-user/route.ts, app/api/update-user/route.ts')
body('Estas rotas usam SUPABASE_SERVICE_ROLE_KEY (ignora RLS) e NAO verificam profiles.role do utilizador que faz o pedido - middleware.ts so garante "esta autenticado", nao distingue admin de viewer.')
body('Com qualquer conta autenticada (incl. "Visualizador"):')
bullet("GET /api/create-user -> lista id + email de todos os utilizadores (incl. admins)")
bullet("POST /api/create-user {email,password,role:'admin'} -> cria conta admin nova (escalamento total)")
bullet("POST /api/update-user {userId:<id-admin>, password:'nova'} -> rouba conta admin (account takeover)")
bullet("DELETE /api/create-user {id:<id-admin>} -> apaga conta admin (sabotagem)")
body('ACAO: no inicio de cada handler, obter a sessao via lib/supabase-server.ts (createClient), buscar profiles.role do utilizador autenticado e devolver 403 se role !== "admin".')

// ---- Prioridade 2 ----
h2('PRIORIDADE 2 [CRITICO] - RLS "authenticated = tudo" em todas as tabelas core')
mono('Ficheiro: supabase-schema.sql (linhas ~110-127)')
body('Todas as tabelas (spaces, tenants, leases, rent_payments, electricity_readings, electricity_charges, expenses, cash_fund_movements) tem:')
mono('CREATE POLICY "Authenticated users can do everything" ON <tabela>\n  FOR ALL TO authenticated USING (true) WITH CHECK (true);')
body('O controlo de role (isAdmin, isCoAdmin, isElectrician em lib/auth-context.tsx) e so cosmetico/UI. Um "Visualizador" autenticado pode abrir a consola do browser e correr supabase.from("expenses").delete()... e a base de dados aceita.')
body('ACAO: substituir por policies role-based que leem profiles.role:')
bullet('viewer -> apenas SELECT')
bullet('electrician -> SELECT em tudo + INSERT/UPDATE nas tabelas de eletricidade')
bullet('admin/coadmin -> CRUD total')
body('Seguir o padrao ja correto em supabase-access-logs.sql.')

// ---- Prioridade 3 ----
h2('PRIORIDADE 3 [CRITICO] - Tabela profiles sem schema/policy versionados')
body('profiles guarda o role de cada utilizador mas NAO tem CREATE TABLE nem policy em supabase-schema.sql nem supabase-access-logs.sql. app/perfil/page.tsx e app/utilizadores/page.tsx fazem supabase.from("profiles").update(...) direto do browser.')
body('ACAO: confirmar na Supabase Dashboard a policy de UPDATE em profiles - deve permitir ao proprio utilizador so atualizar "name" (NUNCA "role"); "role" so editavel via policy/funcao restrita a admin. Versionar essa policy num novo ficheiro .sql.')

// ---- Prioridade 4 ----
h2('PRIORIDADE 4 [IMPORTANTE] - /api/process-document e /api/process-contract sem check de role')
mono('Ficheiros: app/api/process-document/route.ts, app/api/process-contract/route.ts')
body('Protegidos so pelo middleware (= "esta autenticado"). Qualquer utilizador (incl. Visualizador/Eletricista) pode chamar estas rotas, consumindo a API Anthropic (custo, claude-sonnet-4-5) e criando documents/expenses/cash_fund_movements/meter_readings - contorna a regra "Visualizador = so leitura".')
body('ACAO: adicionar o mesmo check de role da Prioridade 1 (bloquear viewer; provavelmente bloquear electrician tambem em process-contract).')

// ---- Prioridade 5 ----
h2('PRIORIDADE 5 [IMPORTANTE] - /api/send-sms aberto + log "sent_by" falso')
mono('Ficheiro: app/api/send-sms/route.ts')
bullet('Qualquer utilizador autenticado consegue enviar SMS arbitrarios (mensagem + lista de numeros) via Twilio do projeto (+19452024418) - risco de custo / SMS bombing.')
bullet('Linha ~67: sent_by: "admin" esta FIXO no codigo, independente de quem enviou - sms_log fica com auditoria errada.')
body('ACAO: restringir a admin/coadmin, validar recipients contra gate_phones, e gravar o user_id/email real do utilizador autenticado (padrao logAccess ja existe no projeto).')

// ---- Prioridade 6 ----
h2('PRIORIDADE 6 [IMPORTANTE] - Dependencia xlsx@0.18.5 com vulnerabilidade alta')
body('npm audit reporta xlsx - Prototype Pollution + ReDoS, severidade alta, sem fix disponivel no npm.')
body('ACAO: verificar onde xlsx e usado (exportacao vs. importacao de ficheiros enviados por utilizadores). Se importa ficheiros externos, e vetor de DoS/poluicao de prototipo - considerar SheetJS oficial via CDN (cdn.sheetjs.com) ou remover se nao for essencial.')

// ---- Recomendacoes ----
h2('RECOMENDACOES (baixa prioridade, fazer depois das anteriores)')
bullet('.env.local e segredos: corretos, fora do git (confirmado via git ls-files e git log --all) - sem accao.')
bullet('next.config.ts sem headers de seguranca HTTP (CSP, X-Frame-Options, Referrer-Policy, HSTS, X-Content-Type-Options) - adicionar via headers().')
bullet('postcss < 8.5.10 dentro de node_modules/next - severidade moderada, so build-time, acompanhar updates do Next.')
bullet('Versionar schema + policies das tabelas que faltam em supabase-schema.sql: profiles, gate_phones, sms_log, debts, debt_payments, owners, tenant_contacts, notes, meters, meter_readings, banks, bank_transactions, electricity_config, dismissed_alerts, projects.')

// ---- Ferramenta ----
h2('Ferramenta de verificacao')
body('scripts/rls-check.mjs - script Node (so usa fetch nativo, le .env.local) que faz GET ?select=id&limit=1 com header "Prefer: count=exact" contra cada tabela, usando a anon key (role anon, sem login). Nao escreve nada na base de dados. Editar o array "tables" no topo do ficheiro conforme necessario. Correr com:')
mono('node scripts/rls-check.mjs')
body('Resultado esperado APOS corrigir RLS: status 401 (ou 200 com rows_returned=0 e content-range=*/0) para todas as tabelas, quando testado com a anon key.')

// ---- Plano de acao ----
h2('Plano de acao sugerido para este chat')
bullet('1. Prioridade 0 - corrigir RLS na Supabase Dashboard (URGENTE - fuga de dados ativa, fazer primeiro)')
bullet('2. Prioridade 1 - blindar /api/create-user e /api/update-user com check de role admin')
bullet('3. Prioridades 2 e 3 - reescrever policies RLS role-based (incl. profiles), versionar em .sql')
bullet('4. Prioridades 4 e 5 - adicionar checks de role em process-document, process-contract, send-sms')
bullet('5. Prioridade 6 e Recomendacoes - resolver xlsx, adicionar headers HTTP, versionar schemas em falta')

doc.save(process.argv[2])
console.log('PDF gerado:', process.argv[2])
