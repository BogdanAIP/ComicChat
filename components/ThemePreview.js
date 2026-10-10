import styles from '../styles/ThemePreview.module.css'

export default function ThemePreview({ theme }) {
 return <span className={styles.preview} data-preview-world={theme} aria-hidden="true">
   <span className={styles.masthead}><span /><i /><i /></span>
   <span className={styles.panels}>
     <span className={styles.frame}>
       <svg className={styles.person} viewBox="0 0 100 100" fill="none">
         <path d="M5 96Q9 69 35 69h17Q76 69 82 96" fill="currentColor" stroke="var(--preview-ink)" strokeWidth="3"/>
         <path d="M33 64V51h26v13" fill="var(--preview-skin)" stroke="var(--preview-ink)" strokeWidth="3"/>
         <path d="M22 30Q19 5 47 5q28 0 28 25l-5 14H27z" fill="var(--preview-ink)"/>
         <path d="M26 24Q40 32 66 20v20q0 22-20 22T26 40z" fill="var(--preview-skin)" stroke="var(--preview-ink)" strokeWidth="3"/>
         <path d="M34 40h3m17 0h3M39 50q7 5 14 0" stroke="var(--preview-ink)" strokeWidth="3" strokeLinecap="round"/>
       </svg>
       <span className={styles.bubble}><i/><i/></span>
     </span>
     <span className={styles.frame + ' ' + styles.reply}>
       <span className={styles.bubble}><i/><i/></span>
       <span className={styles.spark}>✦</span>
     </span>
   </span>
   <span className={styles.composer}><i/><b/></span>
 </span>
}
