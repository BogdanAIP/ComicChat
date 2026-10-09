import { useEffect, useState } from 'react'
import { STYLE_SKILLS, normalizeStyleConfig, styleVisualTokens } from '../utils/comicStyleSkills.mjs'
import styles from '../styles/ComicStylePicker.module.css'

export default function ComicStylePicker({
  current, onSave, pending = false, notice = '', error = '',
  editable = true, group = false,
}) {
  const [primary, setPrimary] = useState(current.primary_style_id)
  const [secondary, setSecondary] = useState(current.secondary_style_id || '')
  const [weight, setWeight] = useState(current.secondary_weight || 30)

  useEffect(() => {
    setPrimary(current.primary_style_id)
    setSecondary(current.secondary_style_id || '')
    setWeight(current.secondary_weight || 30)
  }, [current])

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
    <details className={styles.studio} data-testid="comic-style-picker">
      <summary>✳ Visual Style Skills · {STYLE_SKILLS.find((s) => s.id === current.primary_style_id)?.label || 'Anime'}
        {current.secondary_style_id ? ' + mix' : ''}
      </summary>
      <form onSubmit={submit} className={styles.panel}>
        <p className={styles.explainer}>
          A style is a reusable AI art-direction Skill, not just a photo filter.
          It guides characters, line work, framing and colors. Changes affect
          future messages only — your earlier comic panels stay as they were.
        </p>
        {group && <p className={styles.explainer}>The group owner chooses the shared style.</p>}
        <div className={styles.controls}>
          <label>
            Main comic style
            <select data-testid="comic-style-primary" value={primary}
              disabled={!editable || pending}
              onChange={(e) => {
                setPrimary(e.target.value)
                if (secondary === e.target.value) setSecondary('')
              }}>
              {STYLE_SKILLS.map((skill) =>
                <option value={skill.id} key={skill.id}>{skill.label}</option>
              )}
            </select>
          </label>
          <label>
            Mix with (optional)
            <select data-testid="comic-style-secondary" value={secondary}
              disabled={!editable || pending}
              onChange={(e) => setSecondary(e.target.value)}>
              <option value="">One style</option>
              {STYLE_SKILLS.filter((s) => s.id !== primary).map((skill) =>
                <option value={skill.id} key={skill.id}>{skill.label}</option>
              )}
            </select>
          </label>
          {secondary && (
            <label>
              Secondary style: {weight}% · main: {100 - weight}%
              <input data-testid="comic-style-weight" type="range" min="10" max="90" step="10"
                value={weight} disabled={!editable || pending}
                onChange={(e) => setWeight(Number(e.target.value))} />
            </label>
          )}
        </div>
        <div className={styles.preview} style={palette} aria-label="Comic style palette preview">
          <span aria-hidden="true">✦</span>
          <div>
            <strong>{STYLE_SKILLS.find((s) => s.id === primary)?.label}</strong>
            {secondary && <p>+ {STYLE_SKILLS.find((s) => s.id === secondary)?.label} ({weight}%)</p>}
            <small>{STYLE_SKILLS.find((s) => s.id === primary)?.description}</small>
          </div>
          <div className={styles.sampleBubble}>Your words become a comic!</div>
        </div>
        {editable && <button type="submit" data-testid="comic-style-save"
          disabled={pending}>{pending ? 'Saving…' : 'Apply to future messages'}</button>}
        {!editable && <p className={styles.explainer}>Only the owner can change the group style.</p>}
        {notice && <p role="status" className={styles.notice}>{notice}</p>}
        {error && <p role="alert" className={styles.error}>{error}</p>}
        <p className={styles.disclaimer}>
          AI-generated art is currently off. Style Skills guide the immediate
          local comic preview; external illustration requires a separate opt-in.
        </p>
      </form>
    </details>
  )
}
