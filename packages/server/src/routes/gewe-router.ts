import Router from '@koa/router'
import * as ctrl from '../controllers/hermes/gewe-router'

export const publicGeweRouterRoutes = new Router()

publicGeweRouterRoutes.post('/gewe/callback', ctrl.callback)
publicGeweRouterRoutes.post('/api/hermes/gewe-router/callback', ctrl.callback)
