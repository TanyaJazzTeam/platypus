/**
 * Port of https://github.com/cloudera/hue/tree/master/desktop/core/src/desktop/js/vue/wrapper
 * for Vue 3 support of web components
 * To remove once @vuejs/vue-web-component-wrapper starts supporting Vue 3
 * https://github.com/vuejs/vue-web-component-wrapper/issues/93
 */

import {
  Component,
  CreateAppFunction,
  ConcreteComponent,
  App,
  ComponentPublicInstance,
  VNode,
  ComponentOptionsWithObjectProps
} from 'vue'

import { toHandlerKey } from '@vue/shared'

import {
  KeyHash,
  toVNodes,
  camelize,
  hyphenate,
  callHooks,
  setInitialProps,
  createCustomEvent,
  convertAttributeValue
} from './utils'

export interface WebComponentOptions {
  connectedCallback?(): void;
}

/**
 * Vue 3 wrapper to convert a Vue component into Web Component. Supports reactive attributes, events & slots.
 */
export default function wrap (
  component: Component,
  createApp: CreateAppFunction<Element>,
  h: <P>(type: ConcreteComponent<P> | string, props?: KeyHash, children?: () => unknown) => VNode,
  options?: WebComponentOptions
): CustomElementConstructor {
  const componentObj: ComponentOptionsWithObjectProps = <ComponentOptionsWithObjectProps>component

  let isInitialized = false

  let hyphenatedPropsList: string[]
  let camelizedPropsList: string[]
  let camelizedPropsMap: KeyHash

  function initialize () {
    if (isInitialized) {
      return
    }

    // extract props info
    const propsList: string[] = Array.isArray(componentObj.props)
      ? componentObj.props
      : Object.keys(componentObj.props || {})
    hyphenatedPropsList = propsList.map(hyphenate)
    camelizedPropsList = propsList.map(camelize)

    const originalPropsAsObject = Array.isArray(componentObj.props) ? {} : componentObj.props || {}
    camelizedPropsMap = camelizedPropsList.reduce((map: KeyHash, key, i) => {
      map[key] = originalPropsAsObject[propsList[i]]
      return map
    }, {})

    isInitialized = true
  }

  class CustomElement extends HTMLElement {
    _wrapper: App;
    _component?: ComponentPublicInstance;

    _props!: KeyHash;
    _slotChildren!: (VNode | null)[];
    _mounted = false;

    constructor () {
      super()

      const eventProxies = this.createEventProxies(<string[]>componentObj.emits)

      this._props = {}
      this._slotChildren = []

      // eslint-disable-next-line @typescript-eslint/no-this-alias
      const self = this
      this._wrapper = createApp({
        mounted () {
          self._mounted = true
        },
        unmounted () {
          self._mounted = false
        },
        render () {
          const props = Object.assign({}, self._props, eventProxies)
          delete props.dataVApp
          return h(componentObj, props, () => self._slotChildren)
        }
      })

      // Use MutationObserver to react to future attribute & slot content change
      const observer = new MutationObserver((mutations) => {
        let hasChildrenChange = false

        for (let i = 0; i < mutations.length; i++) {
          const m = mutations[i]

          if (isInitialized && m.type === 'attributes' && m.target === this) {
            if (m.attributeName) {
              this.syncAttribute(m.attributeName)
            }
          } else {
            hasChildrenChange = true
          }
        }

        if (hasChildrenChange) {
          // this.syncSlots(); Commenting as this is causing an infinit $forceUpdate loop, will fix if required!
        }
      })

      observer.observe(this, {
        childList: true,
        subtree: true,
        characterData: true,
        attributes: true
      })
    }

    createEventProxies (
      eventNames: string[] | undefined
    ): { [name: string]: (...args: unknown[]) => void } {
      const eventProxies: { [name: string]: (...args: unknown[]) => void } = {}

      if (eventNames) {
        eventNames.forEach((name) => {
          const handlerName = toHandlerKey(camelize(name))
          eventProxies[handlerName] = (...args: unknown[]): void => {
            this.dispatchEvent(createCustomEvent(name, args))
          }
        })
      }

      return eventProxies
    }

    syncAttribute (key: string): void {
      const camelized = camelize(key)
      let value

      // eslint-disable-next-line no-prototype-builtins
      if (this.hasOwnProperty(key)) {
        value = (<KeyHash> this)[key]
      } else if (this.hasAttribute(key)) {
        value = this.getAttribute(key)
      }

      this._props[camelized] = convertAttributeValue(value, key, camelizedPropsMap[camelized])

      this._component?.$forceUpdate()
    }

    syncSlots (): void {
      this._slotChildren = toVNodes(this.childNodes, h)
      this._component?.$forceUpdate()
    }

    syncInitialAttributes (): void {
      this._props = setInitialProps(camelizedPropsList)

      // parent attributes not being parsed. possibly related:
      // https://github.com/vuejs/vue-web-component-wrapper/issues/26
      const elementAttributes = this.getAttributeNames()
      hyphenatedPropsList = Array.from(new Set(hyphenatedPropsList.concat(elementAttributes)))

      hyphenatedPropsList.forEach((key) => {
        this.syncAttribute(key)
      })
    }

    connectedCallback () {
      if (!this._component || !this._mounted) {
        if (isInitialized) {
          // initialize attributes
          this.syncInitialAttributes()
        }

        // initialize children
        this.syncSlots()

        // Mount the component
        this._component = this._wrapper.mount(this)
      } else {
        // Call mounted on re-insert
        callHooks(this._component, 'mounted')
      }
      if (options?.connectedCallback) {
        options.connectedCallback.bind(this)()
      }
    }

    disconnectedCallback () {
      callHooks(this._component, 'unmounted')
    }
  }

  initialize()

  return CustomElement
}
