# Configuração do Supabase — GAMAA BURGUER

O projeto foi adaptado para manter o GitHub Pages como hospedagem e usar o Supabase para persistir configurações, categorias, produtos e arquivos enviados pelo painel.

## 1. Crie uma conta e um projeto no Supabase

1. Acesse [https://supabase.com](https://supabase.com) e crie uma conta gratuita.
2. Clique em "New Project" e escolha um nome (ex: `cardapio-gamaa`).
3. Defina uma senha forte para o banco de dados.
4. Escolha a região mais próxima (ex: São Paulo).
5. Aguarde o projeto ser criado (~2 minutos).

## 2. Configure as credenciais públicas

No Supabase Dashboard, vá em **Project Settings > API** e copie:
- **Project URL** (ex: `https://xyzxyz.supabase.co`)
- **anon / public key** (a chave longa que começa com `eyJ...`)

Edite o arquivo `supabase-config.js` e substitua:
- `COLE_AQUI_A_URL_DO_PROJETO` pela Project URL.
- `COLE_AQUI_A_CHAVE_PUBLICA` pela chave anon/public.

> ⚠️ **NUNCA** use `service_role`, secret keys ou senha de administrador no JavaScript.

## 3. Execute o SQL

No Supabase Dashboard:
1. Vá em **SQL Editor > New query**
2. Cole todo o conteúdo do arquivo `supabase-setup.sql`
3. Clique em **Run**

Isso cria a tabela `site_data` e os buckets de armazenamento de imagens/vídeos.

## 4. Crie o usuário administrador

1. No Supabase Dashboard, vá em **Authentication > Users**
2. Clique em **Add user > Create new user**
3. Preencha um e-mail e senha (ex: `admin@seurestaurante.com` / `SuaSenhaForte123`)
4. Marque "Auto Confirm User"
5. Em **Authentication > Providers**, desative o cadastro público (Sign Up) para que apenas você tenha acesso.

O login do `admin.html` agora usa esse e-mail e senha do Supabase.

## 5. Publique no GitHub Pages

Envie todos os arquivos do projeto para o repositório, incluindo `supabase-config.js`. Aguarde o GitHub Pages publicar.

> ⚠️ Acesse o site por **HTTPS** — não abra os HTMLs diretamente com `file://`.

## 6. Primeira sincronização

Entre primeiro no `admin.html` usando a conta do Supabase:
- Se a tabela estiver vazia, o sistema envia os dados locais atuais para o banco.
- Se já houver cardápio remoto, esse conteúdo passa a ser a fonte principal.
- Em seguida, teste alterações em outro navegador ou janela anônima.

## 7. Imagens e vídeos

- Imagens enviadas pelo painel vão para o bucket público `cardapio-imagens`.
- Vídeos MP4 vão para `cardapio-videos`.
- Ambos são públicos para leitura e permitem upload/remoção somente a usuários autenticados.

## Observações

- O conteúdo do cardápio é sincronizado no Supabase; mudanças no layout ou no código ainda exigem commit/publicação no GitHub.
- A primeira carga migra o estado local do navegador que inicializar o banco.
- Vídeos antigos salvos somente no IndexedDB de um navegador não podem ser recuperados por outros dispositivos automaticamente; envie-os novamente pelo painel.
- Para produção com múltiplos administradores, limite as políticas de escrita a usuários explicitamente autorizados.
