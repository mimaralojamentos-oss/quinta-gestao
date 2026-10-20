<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

# Regras de base de dados

O schema vive em ficheiros `supabase-*.sql` na raiz do repo, colados à mão nos
DOIS projetos (Quinta-Gestão e SerpaPinto131A). Não há pasta de migrações do
CLI: o ficheiro é a fonte da verdade e tem de ser idempotente, para poder
correr mais do que uma vez sem erro.

## Todo o SQL que cria uma tabela em `public` inclui, no mesmo ficheiro:

1. `ALTER TABLE ... ENABLE ROW LEVEL SECURITY;`
2. as **políticas** de leitura e de escrita, **as duas decididas por
   `user_role()`** — a leitura exige papel atribuído, a escrita exige os
   papéis que podem alterar aquela tabela:
   ```sql
   CREATE POLICY <tabela>_read ON public.<tabela> FOR SELECT TO authenticated
     USING (user_role() = ANY (ARRAY['admin','coadmin','electrician','viewer','super_reader']));
   CREATE POLICY <tabela>_write ON public.<tabela> FOR ALL TO authenticated
     USING (user_role() = ANY (ARRAY['admin','coadmin']))
     WITH CHECK (user_role() = ANY (ARRAY['admin','coadmin']));
   ```
   **A leitura nunca é `USING (true)`**: uma conta recém-criada nasce
   `'pendente'` (ver `supabase-signup-pendente.sql`) e com `true` lia tudo.
   A única exceção é a `profiles`, onde cada um tem de poder ler o seu
   próprio perfil — senão a app não descobre o papel e ninguém entra.
   O ficheiro `supabase-leitura-por-papel.sql` aplicou isto a tudo o que já
   existia;
3. os **GRANTs explícitos**:
   ```sql
   GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.<tabela> TO authenticated;
   GRANT ALL ON TABLE public.<tabela> TO service_role;
   -- colunas serial/identity: também a sequence
   GRANT USAGE, SELECT ON SEQUENCE public.<tabela>_<coluna>_seq TO authenticated, service_role;
   ```
4. `anon` **não leva nada**, salvo justificação escrita no próprio ficheiro.
   Nenhuma página lê tabelas sem sessão: a app do trabalhador
   (`/ponto/<token>`) fala só com `/api/ponto`, que corre no servidor com a
   service role, e o `proxy.ts` usa a chave anon apenas para validar a sessão.
5. o trigger de auditoria, quando a tabela guarda dados de gestão:
   ```sql
   CREATE TRIGGER trg_auditoria AFTER INSERT OR UPDATE OR DELETE ON public.<tabela>
     FOR EACH ROW EXECUTE FUNCTION registar_auditoria();
   ```
6. `NOTIFY pgrst, 'reload schema';` no fim, para a API ver a tabela sem
   esperar.

## Toda a função nova leva `SET search_path`

```sql
CREATE OR REPLACE FUNCTION public.<nome>(...) RETURNS ...
LANGUAGE plpgsql
SET search_path = public, pg_temp      -- obrigatório
AS $$ ... $$;
```

Sem isto, a função resolve os nomes das tabelas pelo `search_path` de quem a
chama — e numa função `SECURITY DEFINER` isso corre com os privilégios do
dono. O `pg_temp` vai no fim de propósito, para tabelas temporárias nunca se
fazerem passar pelas verdadeiras.

E o `EXECUTE` também se escreve: as funções nascem executáveis por `PUBLIC`,
o que no Supabase significa chamáveis **sem sessão** em
`/rest/v1/rpc/<nome>`.

```sql
REVOKE ALL ON FUNCTION public.<nome>(...) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.<nome>(...) TO authenticated, service_role;
```

As funções usadas dentro de políticas de RLS (`user_role()`, `is_admin()`)
**têm** de manter o `EXECUTE` para `authenticated`: a condição da política é
avaliada como o utilizador que faz o pedido. As funções de trigger não
precisam de `EXECUTE` para dispararem — isso é verificado quando o trigger é
criado, não a cada escrita.

O ficheiro `supabase-hardening-functions.sql` aplica isto a tudo o que já
existe, nas duas bases.

## "permission denied for table" é falta de GRANT, não de RLS

São duas coisas diferentes e são precisas as duas: o **GRANT** diz se o papel
pode tocar na tabela, a **política de RLS** diz em que linhas. Sem GRANT, a
Data API responde `permission denied for table`; com GRANT e sem política,
devolve zero linhas sem erro. Desde 30/10/2026 o Supabase já não dá grants
automáticos a tabelas novas no `public`, por isso escrevê-los deixou de ser
opcional.

As permissões de todo o schema estão consolidadas em
`supabase-grants-public.sql`, que também deixa `ALTER DEFAULT PRIVILEGES`
como rede de segurança — mas isso é só uma rede: não dispensa os GRANTs no
ficheiro de cada tabela nova, porque não se aplica a objetos criados por
outro papel.
