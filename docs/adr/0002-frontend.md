# ADR 0002 — Frontend: SPA estática no Cloudflare Pages

Status: proposto · Data: 2026-11-24

## Contexto
- O painel é interno, com poucos usuários autenticados; não precisa de SEO nem renderização no servidor.
- Os dados vêm do Supabase com RLS; ações passam por `backend/api`.
- O plano gratuito da Vercel é restrito a uso pessoal e não comercial.

## Decisão
- SPA com Vite, React e TypeScript estrito; TanStack Query para dados; `supabase-js` com a chave pública e JWT do usuário.
- Hospedagem estática no Cloudflare Pages, plano Free. A conta é criada apenas na E6, quando houver painel a publicar.
- Biblioteca de componentes definida na E6, priorizando componentes acessíveis.

## Alternativas
| Opção | Motivo de não adotar |
|---|---|
| Next.js na Vercel | Exige plano Pro para uso comercial; SSR não é necessário. |
| GitHub Pages | Termos não permitem hospedagem gratuita para negócio ou e-commerce. |
| Supabase (Storage ou Edge Functions) | Respostas HTML no domínio padrão são convertidas em `text/plain`; servir HTML exige o adicional pago de domínio personalizado. |
| Somente Cloudflare (Workers, D1) | Unificaria a plataforma, mas troca Postgres por SQLite, perde RLS e tem 10 ms de CPU por requisição no plano gratuito. |

## Consequências
- Custo zero de hospedagem; requisições a arquivos estáticos não são limitadas no plano Free.
- Dados, autenticação, regras, filas e monitoramento ficam no Supabase; o Cloudflare Pages só serve arquivos estáticos publicados pelo CI a partir do GitHub.
- Nenhum segredo no frontend: apenas URL do projeto e chave pública. A chave `service_role` nunca é empacotada.
- Os termos atuais do Cloudflare para o plano Free devem ser confirmados antes do deploy da E6.

## Referências (consultadas em 2026-11-24)
- https://vercel.com/docs/limits/fair-use-guidelines
- https://developers.cloudflare.com/pages/platform/limits/
- https://developers.cloudflare.com/pages/functions/pricing/
- https://supabase.com/docs/guides/functions/development-tips
- https://supabase.com/changelog/29633-xhtml-responses-are-only-allowed-with-a-custom-domain-enabled
