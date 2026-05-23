# 🏡 Gestão da Quinta — Guia de Instalação

Este guia explica como colocar a aplicação online em **5 passos simples**.

---

## O que vais precisar

- Conta gratuita no [Supabase](https://supabase.com) (base de dados)
- Conta gratuita no [Vercel](https://vercel.com) (alojamento)
- Conta gratuita no [GitHub](https://github.com) (para fazer o deploy)

---

## PASSO 1 — Criar a base de dados no Supabase

1. Vai a **supabase.com** e cria uma conta gratuita
2. Clica em **"New Project"** → nome: `quinta-gestao`, região: West EU (Ireland)
3. Aguarda ~2 minutos
4. Menu esquerdo → **"SQL Editor"** → **"New query"**
5. Copia TODO o conteúdo do ficheiro `supabase-schema.sql` e cola no editor
6. Clica **"Run"** → deves ver "Success"
7. Menu esquerdo → **"Storage"** → **"New bucket"** → nome: `documents`, **privado** (não público)
8. Menu esquerdo → **"Settings"** → **"API"** → Guarda o **Project URL** e a **anon public key**

---

## PASSO 2 — Colocar o código no GitHub

1. Cria uma conta em **github.com**
2. Cria um novo repositório chamado `quinta-gestao`
3. Faz upload de toda a pasta do projeto (usa o GitHub Desktop se preferires visual)

---

## PASSO 3 — Configurar variáveis de ambiente

1. Na pasta do projeto, cria um ficheiro `.env.local` (copia o `.env.example`)
2. Preenche com os valores do Supabase:
   ```
   NEXT_PUBLIC_SUPABASE_URL=https://xxxxx.supabase.co
   NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJhbGciOiJ...
   ```

---

## PASSO 4 — Publicar no Vercel

1. Vai a **vercel.com**, cria conta com GitHub
2. **"Add New Project"** → seleciona `quinta-gestao`
3. Antes de fazer deploy → **"Environment Variables"** → adiciona as duas variáveis acima
4. Clica **"Deploy"** → aguarda ~2 minutos
5. A app ficará em: `https://quinta-gestao.vercel.app`

---

## PASSO 5 — Criar utilizadores

1. Supabase → **"Authentication"** → **"Users"** → **"Invite user"**
2. Adiciona os emails dos 5-6 utilizadores
3. Cada um receberá um email para definir a password

---

## Módulos da Aplicação

| Módulo | O que faz |
|--------|-----------|
| Dashboard | Visão geral, ocupação, rendas do mês, alertas |
| Espaços | Todos os pavilhões e habitações |
| Inquilinos | Fichas + contratos (upload PDF) |
| Rendas & Pagamentos | Registo mensal (dinheiro/banco) |
| Eletricidade | Contadores + cobranças |
| Despesas | Custos + upload de faturas |
| Fundo de Caixa | Controlo do saldo em caixa |
| Alertas | Rendas em atraso, contratos a expirar |

**Custo total: €0/mês** (planos gratuitos do Supabase + Vercel)
