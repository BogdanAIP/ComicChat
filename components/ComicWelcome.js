import styles from '../styles/ComicWelcome.module.css'
import useTranslation from '../utils/useTranslation'

export default function ComicWelcome({ onOpenProfile }) {
  const { t } = useTranslation()
  return (
    <section className={styles.welcome} aria-labelledby="comic-welcome-title">
      <div className={styles.masthead}>
        <span className={styles.issue}>{t.welcomeIssue}</span>
        <span className={styles.mastheadRule} aria-hidden="true" />
        <span className={styles.edition}>{t.welcomeOrigin}</span>
      </div>

      <div className={styles.spread}>
        <div className={styles.intro}>
          <span className={styles.introLabel}>{t.welcomeLabel}</span>
          <h2 id="comic-welcome-title">
            {t.welcomeTitle} <em>{t.welcomeTitleEmphasis}</em>
          </h2>
          <p>
            {t.welcomeDescription}
          </p>
          <button type="button" className={styles.cta} onClick={onOpenProfile}>
            <span>01</span>
            {t.welcomeNameAction}
            <span aria-hidden="true">↗</span>
          </button>
          <p className={styles.ctaHint}>
            {t.welcomeNameHint}
          </p>
        </div>

        <div className={styles.preview} aria-label={t.welcomePreview}>
          <div className={styles.previewTop}>
            <div className={styles.panelOne}>
              <div className={styles.dots} aria-hidden="true" />
              <div className={styles.figureOne} aria-hidden="true">
                <span className={styles.figureHead} />
                <span className={styles.figureTorso} />
              </div>
              <span className={styles.bubbleOne}>{t.welcomeGreeting}</span>
              <span className={styles.cornerLabel}>{t.welcomeFrameOne}</span>
            </div>
            <div className={styles.panelTwo}>
              <span className={styles.sparkle} aria-hidden="true">✳</span>
              <span className={styles.kapow}>{t.welcomePow}</span>
              <span className={styles.cornerLabel}>{t.welcomeFrameTwo}</span>
            </div>
          </div>
          <div className={styles.panelThree}>
            <span className={styles.star} aria-hidden="true">★</span>
            <div className={styles.bubbleThree}>{t.welcomeStoryGreeting}</div>
            <span className={styles.caption}>{t.welcomeContinued}</span>
          </div>
        </div>
      </div>

      <div className={styles.footerStrip}>
        <span>{t.welcomePrivate}</span>
        <span aria-hidden="true">✦</span>
        <span>{t.welcomePanels}</span>
        <span aria-hidden="true">✦</span>
        <span>{t.welcomeStarts}</span>
      </div>
      <p className={styles.betaNote}>
        {t.welcomeBetaNote}
      </p>
    </section>
  )
}
