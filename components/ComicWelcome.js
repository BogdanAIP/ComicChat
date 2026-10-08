import styles from '../styles/ComicWelcome.module.css'

export default function ComicWelcome({ onOpenProfile }) {
  return (
    <section className={styles.welcome} aria-labelledby="comic-welcome-title">
      <div className={styles.masthead}>
        <span className={styles.issue}>ISSUE 001</span>
        <span className={styles.mastheadRule} aria-hidden="true" />
        <span className={styles.edition}>YOUR ORIGIN STORY</span>
      </div>

      <div className={styles.spread}>
        <div className={styles.intro}>
          <span className={styles.introLabel}>WELCOME TO THE PANEL</span>
          <h2 id="comic-welcome-title">
            Every chat deserves a <em>plot twist.</em>
          </h2>
          <p>
            Your messages, told like a comic. Start a private conversation,
            build a story together, and watch every line become a panel.
          </p>
          <button type="button" className={styles.cta} onClick={onOpenProfile}>
            <span>01</span>
            Set your creator name
            <span aria-hidden="true">↗</span>
          </button>
          <p className={styles.ctaHint}>
            Then find a friend by their username to start your first scene.
          </p>
        </div>

        <div className={styles.preview} aria-label="Illustrated preview of a comic conversation">
          <div className={styles.previewTop}>
            <div className={styles.panelOne}>
              <div className={styles.dots} aria-hidden="true" />
              <div className={styles.figureOne} aria-hidden="true">
                <span className={styles.figureHead} />
                <span className={styles.figureTorso} />
              </div>
              <span className={styles.bubbleOne}>Hey, you!</span>
              <span className={styles.cornerLabel}>FRAME 01</span>
            </div>
            <div className={styles.panelTwo}>
              <span className={styles.sparkle} aria-hidden="true">✳</span>
              <span className={styles.kapow}>POW!</span>
              <span className={styles.cornerLabel}>FRAME 02</span>
            </div>
          </div>
          <div className={styles.panelThree}>
            <span className={styles.star} aria-hidden="true">★</span>
            <div className={styles.bubbleThree}>Let&apos;s make a story.</div>
            <span className={styles.caption}>TO BE CONTINUED…</span>
          </div>
        </div>
      </div>

      <div className={styles.footerStrip}>
        <span>PRIVATE BY DESIGN</span>
        <span aria-hidden="true">✦</span>
        <span>COMIC PANELS FIRST</span>
        <span aria-hidden="true">✦</span>
        <span>YOUR STORY STARTS HERE</span>
      </div>
      <p className={styles.betaNote}>
        Beta preview: comic artwork is stylized while AI image generation is switched off.
      </p>
    </section>
  )
}
