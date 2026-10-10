import { useRef, useState } from 'react'
import useTranslation from '../utils/useTranslation'
import styles from '../styles/ComicDirectMessages.module.css'

export default function ComicArtActions({ supabase, messageId, text, styleConfig, onAttached }) {
  const { t } = useTranslation()
  const input = useRef(null)
  const [busy,setBusy] = useState(false)
  const [notice,setNotice] = useState('')
  const request = async () => {
    if(busy)return
    setBusy(true);setNotice('')
    const prompt = 'Create one comic illustration for this private ComicChat message using ChatGPT image creation. Do not call an image-generation API. Draw no text, captions, labels or speech bubbles: ComicChat displays the original words separately. Art direction: ' +
      (styleConfig?.primary_style_id || 'anime') + (styleConfig?.secondary_style_id ? ' mixed with ' + styleConfig.secondary_style_id : '') +
      '. Scene context (verbatim message): ' + JSON.stringify(text) +
      '. After creation, attach the resulting image to my existing message using attach_chatgpt_illustration, messageId ' + messageId +
      '. If the host cannot pass the image file, tell me to download it and use Attach illustration in ComicChat. Do not claim it was attached without a successful tool result.'
    try {
      if(supabase.requestArt) {await supabase.requestArt(prompt);setNotice(t.artRequested)}
      else {await navigator.clipboard.writeText(prompt);setNotice(t.artPromptCopied)}
    } catch {setNotice(t.actionFailed)} finally{setBusy(false)}
  }
  const attach = async event => {
    const file=event.target.files?.[0];event.target.value=''
    if(!file || busy)return
    setBusy(true);setNotice('')
    try {
      if(file.size>8*1024*1024 || !['image/png','image/jpeg','image/webp'].includes(file.type))throw new Error('Invalid image')
      const imageBase64=await new Promise((resolve,reject)=>{
        const reader=new FileReader()
        reader.onload=()=>resolve(String(reader.result).split(',')[1])
        reader.onerror=reject;reader.readAsDataURL(file)
      })
      const {data,error}=await supabase.functions.invoke('comicchat-chatgpt-art',{body:{messageId,imageBase64}})
      if(error || !data?.assetId)throw new Error('Attachment failed')
      setNotice(t.artAttached);onAttached?.()
    } catch {setNotice(t.artFailed)} finally{setBusy(false)}
  }
  return <div className={styles.artActions}>
    <button type="button" className={styles.comicAction} disabled={busy} onClick={request}
      title={t.artRequestHelp} data-testid="chatgpt-art-request">{supabase.requestArt ? t.requestArt : t.copyArtPrompt}</button>
    <button type="button" className={styles.comicAction} disabled={busy} onClick={()=>input.current?.click()} data-testid="attach-art">{busy ? t.loading : t.attachArt}</button>
    <input ref={input} className={styles.srOnly} tabIndex={-1} type="file" aria-label={t.attachArt} accept="image/png,image/jpeg,image/webp" onChange={attach} />
    {notice && <span role="status" className={styles.artNotice}>{notice}</span>}
  </div>
}
