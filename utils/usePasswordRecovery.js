import { useCallback, useEffect, useState } from 'react'
import { useRouter } from 'next/router'

export default function usePasswordRecovery(supabase) {
  const router = useRouter()
  const [recoveryEvent, setRecoveryMode] = useState(false)
  const recoveryMode = recoveryEvent || router.query.recovery === '1'
  useEffect(() => {
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event) => {
      if (event === 'PASSWORD_RECOVERY') setRecoveryMode(true)
    })
    return () => subscription.unsubscribe()
  }, [supabase])
  const finishRecovery = useCallback(async () => {
    const { recovery, ...query } = router.query
    await router.replace({ pathname: router.pathname, query }, undefined, { shallow: true })
    setRecoveryMode(false)
  }, [router])
  return { recoveryMode, finishRecovery }
}
