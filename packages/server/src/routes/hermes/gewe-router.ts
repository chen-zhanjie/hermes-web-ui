import Router from '@koa/router'
import * as ctrl from '../../controllers/hermes/gewe-router'

export const geweRouterRoutes = new Router()

geweRouterRoutes.get('/api/hermes/gewe-router/config', ctrl.config)
geweRouterRoutes.put('/api/hermes/gewe-router/config/common', ctrl.updateCommonConfig)
geweRouterRoutes.put('/api/hermes/gewe-router/config/profiles/:profile', ctrl.updateProfileConfig)
geweRouterRoutes.get('/api/hermes/gewe-router/pairing-users', ctrl.pairingUsers)
geweRouterRoutes.get('/api/hermes/gewe-router/bindings', ctrl.list)
geweRouterRoutes.post('/api/hermes/gewe-router/bindings', ctrl.bind)
geweRouterRoutes.delete('/api/hermes/gewe-router/bindings/:userId', ctrl.unbind)
