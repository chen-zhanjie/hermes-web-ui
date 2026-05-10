import Router from '@koa/router'
import * as ctrl from '../../controllers/hermes/gewe-router'

export const geweRouterRoutes = new Router()

geweRouterRoutes.get('/api/hermes/gewe-router/bindings', ctrl.list)
geweRouterRoutes.post('/api/hermes/gewe-router/bindings', ctrl.bind)
geweRouterRoutes.delete('/api/hermes/gewe-router/bindings/:userId', ctrl.unbind)
geweRouterRoutes.post('/api/hermes/gewe-router/invites', ctrl.invite)
geweRouterRoutes.delete('/api/hermes/gewe-router/invites/:code', ctrl.deleteInvite)
