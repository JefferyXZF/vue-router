/* @flow */

import { install } from './install'
import { START } from './util/route'
import { assert, warn } from './util/warn'
import { inBrowser } from './util/dom'
import { cleanPath } from './util/path'
import { createMatcher } from './create-matcher'
import { normalizeLocation } from './util/location'
import { supportsPushState } from './util/push-state'
import { handleScroll } from './util/scroll'

import { HashHistory } from './history/hash'
import { HTML5History } from './history/html5'
import { AbstractHistory } from './history/abstract'

import type { Matcher } from './create-matcher'

import { isNavigationFailure, NavigationFailureType } from './util/errors'

export default class VueRouter {
  static install: () => void
  static version: string
  static isNavigationFailure: Function
  static NavigationFailureType: any
  static START_LOCATION: Route

  app: any
  apps: Array<any>
  ready: boolean
  readyCbs: Array<Function>
  options: RouterOptions
  mode: string
  history: HashHistory | HTML5History | AbstractHistory
  matcher: Matcher
  fallback: boolean
  beforeHooks: Array<?NavigationGuard>
  resolveHooks: Array<?NavigationGuard>
  afterHooks: Array<?AfterNavigationHook>

  constructor (options: RouterOptions = {}) {
    this.app = null // vue实例
    this.apps = [] // 存放正在被使用的组件（vue实例），只有destroyed掉的组件，才会从这里移除）
    this.options = options // vueRouter实例化时，传来的参数，也就是router.js中配置项的内容
    this.beforeHooks = [] // 存放各组件的全局beforeEach钩子
    this.resolveHooks = [] // 存放各组件的全局beforeResolve钩子
    this.afterHooks = [] // 存放各组件的全局afterEach钩子
    // 创建 match 匹配函数
    this.matcher = createMatcher(options.routes || [], this) // 由createMatcher生成的matcher，里面有一些匹配相关方法

    // 根据 mode 实例化具体的 History
    let mode = options.mode || 'hash'
    this.fallback =
      mode === 'history' && !supportsPushState && options.fallback !== false
    if (this.fallback) {
      mode = 'hash'
    }
    // 若不在浏览器环境下，强制使用abstract模式
    if (!inBrowser) {
      mode = 'abstract'
    }
    this.mode = mode

    // 不同模式，使用对应模式Histroty管理器去管理history
    switch (mode) {
      case 'history':
        this.history = new HTML5History(this, options.base)
        break
      case 'hash':
        this.history = new HashHistory(this, options.base, this.fallback)
        break
      case 'abstract':
        this.history = new AbstractHistory(this, options.base)
        break
      default:
        if (process.env.NODE_ENV !== 'production') {
          assert(false, `invalid mode: ${mode}`)
        }
    }
  }

  // 输入参数raw，current，redirectedFrom，结果返回匹配route
  match (raw: RawLocation, current?: Route, redirectedFrom?: Location): Route {
    return this.matcher.match(raw, current, redirectedFrom)
  }

  // 获取当前history.current，也就是当前route，包括path、component、meta等。
  get currentRoute (): ?Route {
    return this.history && this.history.current
  }

  // install 方法会调用此 init 初始化方法，在 Vue.use 里面调用
  init (app: any /* Vue component instance */) {
    process.env.NODE_ENV !== 'production' &&
      assert(
        install.installed,
        `not installed. Make sure to call \`Vue.use(VueRouter)\` ` +
          `before creating root instance.`
      )

    // 将vue实例推到apps列表中，install里面最初是将vue根实例推进去的
    this.apps.push(app)

    // set up app destroyed handler
    // https://github.com/vuejs/vue-router/issues/2639
    // app被destroyed时候，会$emit ‘hook:destroyed’事件，监听这个事件，执行下面方法
    app.$once('hook:destroyed', () => {
      // clean out app from this.apps array once destroyed
      const index = this.apps.indexOf(app)
      if (index > -1) this.apps.splice(index, 1)
      // ensure we still have a main app or null if no apps
      // we do not release the router so it can be reused
      if (this.app === app) this.app = this.apps[0] || null

      if (!this.app) this.history.teardown()
    })

    // main app previously initialized
    // return as we don't need to set up new history listener
    /* 已存在说明已经被init过了，直接返回 */
    if (this.app) {
      return
    }

    // 新增一个history，并添加route监听器
    // 并根据不同路由模式进行跳转。hashHistory需要监听hashchange和popshate两个事件，而html5History监听popstate事件。
    this.app = app

    const history = this.history

    if (history instanceof HTML5History || history instanceof HashHistory) {
      const handleInitialScroll = routeOrError => {
        const from = history.current
        const expectScroll = this.options.scrollBehavior
        const supportsScroll = supportsPushState && expectScroll

        if (supportsScroll && 'fullPath' in routeOrError) {
          handleScroll(this, routeOrError, from, false)
        }
      }
      const setupListeners = routeOrError => {
        history.setupListeners()
        handleInitialScroll(routeOrError)
      }
      history.transitionTo( // 做路由过渡
        history.getCurrentLocation(), // 浏览器 window 地址的 hash 值
        setupListeners, // 成功回调
        setupListeners // 失败回调
      )
    }

    history.listen(route => {
      this.apps.forEach(app => {
        app._route = route
      })
    })
  }

  // 注册 beforeHooks 事件，将回调方法fn注册到beforeHooks里。registerHook会返回，fn执行后的callback方法，功能是将fn从beforeHooks删除。
  beforeEach (fn: Function): Function {
    return registerHook(this.beforeHooks, fn)
  }

  // 将回调方法fn注册到resolveHooks里。registerHook会返回，fn执行后的callback方法，功能是将fn从resolveHooks删除。
  beforeResolve (fn: Function): Function {
    return registerHook(this.resolveHooks, fn)
  }

  // 将回调方法fn注册到afterHooks里。registerHook会返回，fn执行后的callback方法，功能是将fn从afterHooks删除。
  afterEach (fn: Function): Function {
    return registerHook(this.afterHooks, fn)
  }

  onReady (cb: Function, errorCb?: Function) {
    this.history.onReady(cb, errorCb)
  }

  onError (errorCb: Function) {
    this.history.onError(errorCb)
  }

  // 调用 transitionTo 跳转路由。新增路由跳转
  push (location: RawLocation, onComplete?: Function, onAbort?: Function) {
    // $flow-disable-line
    if (!onComplete && !onAbort && typeof Promise !== 'undefined') {
      return new Promise((resolve, reject) => {
        this.history.push(location, resolve, reject)
      })
    } else {
      this.history.push(location, onComplete, onAbort)
    }
  }

  // 路由替换
  replace (location: RawLocation, onComplete?: Function, onAbort?: Function) {
    // $flow-disable-line
    if (!onComplete && !onAbort && typeof Promise !== 'undefined') {
      return new Promise((resolve, reject) => {
        this.history.replace(location, resolve, reject)
      })
    } else {
      this.history.replace(location, onComplete, onAbort)
    }
  }

  go (n: number) {
    this.history.go(n)
  }

  back () {
    this.go(-1)
  }

  forward () {
    this.go(1)
  }

  // 根据路径或者路由获取匹配的组件
  getMatchedComponents (to?: RawLocation | Route): Array<any> {
    const route: any = to
      ? to.matched
        ? to
        : this.resolve(to).route
      : this.currentRoute
    if (!route) {
      return []
    }
    return [].concat.apply(
      [],
      route.matched.map(m => {
        return Object.keys(m.components).map(key => {
          return m.components[key]
        })
      })
    )
  }

  /**
   * 根据路由对象返回浏览器路径等信息
   * @param to 要跳转的路由
   * @param current 当前路由
   * @param append
   * @returns {{route: Route, location: {path, query, _normalized, hash}, href: *, normalizedTo: {path, query, _normalized, hash}, resolved: Route}}
   */
  resolve (
    to: RawLocation,
    current?: Route,
    append?: boolean
  ): {
    location: Location,
    route: Route,
    href: string,
    // for backwards compat
    normalizedTo: Location,
    resolved: Route
  } {
    current = current || this.history.current
    const location = normalizeLocation(to, current, append, this)
    const route = this.match(location, current)
    const fullPath = route.redirectedFrom || route.fullPath
    const base = this.history.base
    const href = createHref(base, fullPath, this.mode)
    return {
      location,
      route,
      href,
      // for backwards compat
      normalizedTo: location,
      resolved: route
    }
  }

  getRoutes () {
    return this.matcher.getRoutes()
  }

  addRoute (parentOrRoute: string | RouteConfig, route?: RouteConfig) {
    this.matcher.addRoute(parentOrRoute, route)
    if (this.history.current !== START) {
      this.history.transitionTo(this.history.getCurrentLocation())
    }
  }

  /**
   * 动态添加路由
   * @param routes 路由配置
   */
  addRoutes (routes: Array<RouteConfig>) {
    if (process.env.NODE_ENV !== 'production') {
      warn(false, 'router.addRoutes() is deprecated and has been removed in Vue Router 4. Use router.addRoute() instead.')
    }
    this.matcher.addRoutes(routes)
    if (this.history.current !== START) {
      this.history.transitionTo(this.history.getCurrentLocation())
    }
  }
}

/**
 * 注册指定钩子函数
 * @param list
 * @param fn
 * @returns {Function}
 */
function registerHook (list: Array<any>, fn: Function): Function {
  list.push(fn)
  return () => {
    const i = list.indexOf(fn)
    if (i > -1) list.splice(i, 1)
  }
}

/**
 * 创建页面 href 链接
 * @param base
 * @param fullPath
 * @param mode
 * @returns {string}
 */
function createHref (base: string, fullPath: string, mode) {
  var path = mode === 'hash' ? '#' + fullPath : fullPath
  return base ? cleanPath(base + '/' + path) : path
}

VueRouter.install = install
VueRouter.version = '__VERSION__'
VueRouter.isNavigationFailure = isNavigationFailure
VueRouter.NavigationFailureType = NavigationFailureType
VueRouter.START_LOCATION = START

if (inBrowser && window.Vue) {
  window.Vue.use(VueRouter)
}
