import View from './components/view'
import Link from './components/link'

export let _Vue

export function install (Vue) {
  if (install.installed && _Vue === Vue) return
  install.installed = true

  _Vue = Vue

  const isDef = v => v !== undefined

  // 通过registerRouteInstance方法注册router实例
  const registerInstance = (vm, callVal) => {
    let i = vm.$options._parentVnode
    if (isDef(i) && isDef(i = i.data) && isDef(i = i.registerRouteInstance)) {
      i(vm, callVal)
    }
  }

  Vue.mixin({
    beforeCreate () {
      // 在option上面存在router则代表是根组件
      if (isDef(this.$options.router)) {
        this._routerRoot = this
        this._router = this.$options.router
        // VueRouter对象的init方法
        this._router.init(this)
        // 定义响应式的 _route 对象
        Vue.util.defineReactive(this, '_route', this._router.history.current) // 使用vue 提供的响应式API，将_route响应式化，作为其他组件的this.$route
      } else {
        // 非根组件则直接从父组件中获取
        this._routerRoot = (this.$parent && this.$parent._routerRoot) || this
      }
      // 通过registerRouteInstance方法注册router实例
      registerInstance(this, this)
    },
    destroyed () {
      registerInstance(this)
    }
  })

  // 在Vue的prototype上面绑定$router，这样可以在任意Vue对象中使用this.$router访问，同时经过Object.defineProperty，访问this.$router即访问this._routerRoot._router
  Object.defineProperty(Vue.prototype, '$router', {
    get () { return this._routerRoot._router }
  })

  // 以上同理，访问this.$route即访问this._routerRoot._route
  Object.defineProperty(Vue.prototype, '$route', {
    get () { return this._routerRoot._route }
  })

  // 注册全局组件 router-view, router-link
  Vue.component('RouterView', View)
  Vue.component('RouterLink', Link)

  const strats = Vue.config.optionMergeStrategies
  // use the same hook merging strategy for route hooks
  strats.beforeRouteEnter = strats.beforeRouteLeave = strats.beforeRouteUpdate = strats.created
}
