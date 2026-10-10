import { createContext, useContext, useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/router'
const Context = createContext(null)
export const THEMES = ['classic','manga','anime','superhero','cartoon']
export const LOCALES = ['ru','en','ar']
const valid = value => ({ locale: LOCALES.includes(value?.locale) ? value.locale : 'ru', theme: THEMES.includes(value?.theme) ? value.theme : 'classic' })
export function PreferencesProvider({ userId, supabase, children }) {
  const router = useRouter()
  const [state,setState] = useState({locale:LOCALES.includes(router.locale)?router.locale:'ru',theme:'classic'})
  const [sync,setSync] = useState('')
  const version = useRef(0)
  const persistence = useRef(Promise.resolve())
  const mounted = useRef(true)
  const current = useRef(state)
  const key = 'comicchat:preferences:' + (userId || 'guest')
  useEffect(() => {
    let active = true
    mounted.current = true
    const requestVersion = version.current
    const cachedTimer = setTimeout(() => { if(!active || version.current!==requestVersion) return; try { const cached=localStorage.getItem(key); if(cached) { const next=valid(JSON.parse(cached));current.current=next;setState(next) } } catch {} }, 0)
    if(userId) supabase.rpc('comic_get_my_preferences').then(({data,error}) => {
      if(!active || version.current!==requestVersion) return
      if(error) { setSync('local');return }
      const row=Array.isArray(data)?data[0]:data
      clearTimeout(cachedTimer)
      if(row) { const next=valid(row);current.current=next;setState(next);try{localStorage.setItem(key,JSON.stringify(next))}catch{} }
      setSync('account')
    }).catch(()=>{if(active)setSync('local')})
    return ()=>{active=false;mounted.current=false;clearTimeout(cachedTimer)}
  },[key,userId,supabase])
  useEffect(() => {
    document.documentElement.lang=state.locale
    document.documentElement.dir=state.locale==='ar'?'rtl':'ltr'
    document.documentElement.dataset.theme=state.theme
    document.cookie='NEXT_LOCALE='+state.locale+';path=/;SameSite=Lax'
  },[state])
  const update = async patch => {
    const next=valid({...current.current,...patch})
    const request=++version.current
    current.current=next;setState(next)
    try {localStorage.setItem(key,JSON.stringify(next))} catch {}
    if(!userId)return
    setSync('saving')
    const work = persistence.current.catch(()=>{}).then(async () => {
      if(!mounted.current) return {error:true}
      if(supabase.transport !== 'mcp') {
        const {data,error}=await supabase.auth.getUser()
        if(error || data.user?.id!==userId)return {error:true}
      }
      return supabase.rpc('comic_set_my_preferences',{p_locale:next.locale,p_theme:next.theme})
    })
    persistence.current=work
    const {error}=await work.catch(()=>({error:true}))
    if(mounted.current && request===version.current)setSync(error?'local':'saved')
  }
  return <Context.Provider value={{...state,update,sync}}>{children}</Context.Provider>
}
export function usePreferences(){return useContext(Context)}
