import { useMemo } from 'react'
import { useRouter } from 'next/router'
import { translations } from './translations'
import { uiTranslations } from './uiTranslations'
import { russianTranslations } from './russianTranslations'
import { usePreferences } from './usePreferences'
export default function useTranslation() {
  const router=useRouter(), preferences=usePreferences()
  const locale=preferences?.locale || router.locale || 'ru'
  const t=useMemo(()=>({...translations.en,...translations[locale],...(locale==='ru'?russianTranslations:{}),...uiTranslations[locale]}),[locale])
  const setLanguage=value=>preferences?preferences.update({locale:value}):router.replace(router.pathname,router.asPath,{locale:value})
  const toggleLanguage=()=>setLanguage(locale==='ar'?'en':locale==='en'?'ru':'ar')
  return {t,locale,setLanguage,toggleLanguage}
}
