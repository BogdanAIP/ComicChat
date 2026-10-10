import React, { createContext, useContext, useMemo, useState } from 'react'
const Context = createContext(null)
export function RouterProvider({ children }) {
  const [locale, setLocale] = useState('ru')
  const router = useMemo(() => ({
    locale, pathname: '/', asPath: '/', query: {},
    async replace(_path, _as, options = {}) {
      if (options.locale) {
        setLocale(options.locale)
        document.documentElement.lang = options.locale
        document.documentElement.dir = options.locale === 'ar' ? 'rtl' : 'ltr'
      }
      return true
    },
  }), [locale])
  return <Context.Provider value={router}>{children}</Context.Provider>
}
export function useRouter() { return useContext(Context) }
