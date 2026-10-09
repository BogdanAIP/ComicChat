import { useRouter } from 'next/router'
import { translations } from './translations'

export default function useTranslation() {
  const router = useRouter()
  const locale = router.locale || 'ar'
  const t = translations[locale] || translations.en
  const toggleLanguage = () => {
    const nextLocale = locale === 'ar' ? 'en' : 'ar'
    router.replace(router.pathname, router.asPath, { locale: nextLocale })
  }
  return { t, locale, toggleLanguage }
}
