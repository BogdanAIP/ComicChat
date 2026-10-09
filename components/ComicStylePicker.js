import { useState } from 'react'
import { STYLE_SKILLS, normalizeStyleConfig, styleVisualTokens } from '../utils/comicStyleSkills.mjs'
import styles from '../styles/ComicStylePicker.module.css'
import useTranslation from '../utils/useTranslation'

export default function ComicStylePicker({
  current, onSave, pending = false, notice = '', error = '',
  editable = true, group = false, externalGenerationEnabled = false,
}) {
  const { t } = useTranslation()
  const signature = `${current.primary_style_id}:${current.secondary_style_id}:${current.secondary_weight}`
  const initialDraft = {
    signature, primary: current.primary_style_id,
    secondary: current.secondary_style_id || '', weight: current.secondary_weight || 30,
  }
  const [draft, setDraft] = useState(initialDraft)
  if (draft.signature !== signature) setDraft(initialDraft)
  const { primary, secondary, weight } = draft.signature === signature ? draft : initialDraft

  const styleLabel = (id) => t[`style_${id}`] || STYLE_SKILLS.find((skill) => skill.id === id)?.label

  const selection = normalizeStyleConfig({
    primary_style_id: primary,
    secondary_style_id: secondary || null,
    secondary_weight: secondary ? weight : 0,
  })
  const palette = styleVisualTokens(selection)

  const submit = (event) => {
    event.preventDefault()
    if (!editable || pending) return
    onSave(selection)
  }

  return (
    <details className={styles.studio} data-testid="comic-style-picker" name="comic-studios">
      <summary>✳ {t.artStyle} · {styleLabel(current.primary_style_id)}
        {current.secondary_style_id ? ` + ${styleLabel(current.secondary_style_id)}` : ''}
      </summary>
      <form onSubmit={submit} className={styles.panel}>
        <p className={styles.explainer}>
          {t.styleExplainer}
        </p>
        {group && <p className={styles.explainer}>{t.groupStyleOwner}</p>}
        <div className={styles.controls}>
          <label>
            {t.mainComicStyle}
            <select data-testid="comic-style-primary" value={primary}
              disabled={!editable || pending}
              onChange={(e) => {
                setDraft((previous) => ({ ...previous, primary: e.target.value,
                  secondary: previous.secondary === e.target.value ? '' : previous.secondary }))
              }}>
              {STYLE_SKILLS.map((skill) =>
                <option value={skill.id} key={skill.id}>{styleLabel(skill.id)}</option>
              )}
            </select>
          </label>
          <label>
            {t.mixWith}
            <select data-testid="comic-style-secondary" value={secondary}
              disabled={!editable || pending}
              onChange={(e) => setDraft((previous) => ({ ...previous, secondary: e.target.value }))}>
              <option value="">{t.oneStyle}</option>
              {STYLE_SKILLS.filter((s) => s.id !== primary).map((skill) =>
                <option value={skill.id} key={skill.id}>{styleLabel(skill.id)}</option>
              )}
            </select>
          </label>
          {secondary && (
            <label>
              {t.secondaryStyle}: {weight}% · {t.mainStyle}: {100 - weight}%
              <input data-testid="comic-style-weight" type="range" min="10" max="90" step="10"
                value={weight} disabled={!editable || pending}
                onChange={(e) => setDraft((previous) => ({ ...previous, weight: Number(e.target.value) }))} />
            </label>
          )}
        </div>
        <div className={styles.preview} style={palette} aria-label={t.stylePalettePreview}>
          <span aria-hidden="true">✦</span>
          <div>
            <strong>{styleLabel(primary)}</strong>
            {secondary && <p>+ {styleLabel(secondary)} ({weight}%)</p>}
            <small>{t[`styleDescription_${primary}`]}</small>
          </div>
          <div className={styles.sampleBubble}>{t.wordsBecomeComic}</div>
        </div>
        {editable && <button type="submit" data-testid="comic-style-save"
          disabled={pending}>{pending ? t.saving : t.applyFutureStyle}</button>}
        {!editable && <p className={styles.explainer}>{t.onlyOwnerChangesStyle}</p>}
        {notice && <p role="status" className={styles.notice}>{t[notice] || notice}</p>}
        {error && <p role="alert" className={styles.error}>{t[error] || error}</p>}
        <p className={styles.disclaimer}>
          {externalGenerationEnabled ? t.aiArtEnabled : t.aiArtDisabled}
        </p>
      </form>
    </details>
  )
}
