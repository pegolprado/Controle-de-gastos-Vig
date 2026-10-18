// Cloudflare Pages Functions: todas as rotas /api/* vão para o servidor de login do MARX.
import { type Env, handle } from '../../server/app'

export const onRequest = (ctx: { request: Request; env: Env }) => handle(ctx.request, ctx.env)
