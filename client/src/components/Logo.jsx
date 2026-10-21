// SecureEnroll logo: a shield (security) holding an open book (school) under a
// rising sun (a new school year). It is an original mark, drawn inline so it
// stays sharp at every size. The same artwork lives in public/logo.svg, which
// is also the favicon.
//
// To use the official school seal instead, drop the image into
// client/public/school-seal.png and pass `src` (or change LOGO_SRC below).
const LOGO_SRC = null; // e.g. '/school-seal.png'

export default function Logo({ size = 40, src = LOGO_SRC, title = 'SecureEnroll', className = '' }) {
  if (src) {
    return <img className={`logo-mark ${className}`} src={src} width={size} height={size} alt={title} style={{ objectFit: 'contain' }} />;
  }
  return (
    <svg className={`logo-mark ${className}`} width={size * (64 / 72)} height={size} viewBox="0 0 64 72"
      role="img" aria-label={title} focusable="false">
      <path d="M32 2.5 58.5 11.5v22.8c0 16-11.6 28.2-26.5 36.2C17.1 62.5 5.5 50.3 5.5 34.3V11.5L32 2.5Z"
        fill="#FFFFFF" stroke="#163B7C" strokeWidth="3" strokeLinejoin="round" />
      <path d="M32 9.2 52.2 16v18.2c0 12.6-8.8 22.5-20.2 29-11.4-6.5-20.2-16.4-20.2-29V16L32 9.2Z" fill="#E4ECF9" />
      <path d="M32 12.4v3.6M22.6 17l2.5 2.5M41.4 17l-2.5 2.5M17.4 25.4h3.4M43.2 25.4h3.4"
        stroke="#E0A526" strokeWidth="2.2" strokeLinecap="round" fill="none" />
      <path d="M24.2 30a7.8 7.8 0 0 1 15.6 0Z" fill="#F2B33D" />
      <path d="M32 55.5C27 50.6 19.5 49.4 14 50.4V36.6c5.5-1 13 .2 18 5v13.9Z" fill="#1E4FA3" />
      <path d="M32 55.5c5-4.9 12.5-6.1 18-5.1V36.6c-5.5-1-13 .2-18 5v13.9Z" fill="#163B7C" />
      <path d="M32 41.6v14" stroke="#FFFFFF" strokeWidth="1.6" strokeLinecap="round" />
      <path d="M18 41.4c3.2-.3 7 .4 10 2.2M18 45.6c3.2-.3 7 .4 10 2.2M46 41.4c-3.2-.3-7 .4-10 2.2M46 45.6c-3.2-.3-7 .4-10 2.2"
        stroke="#9DB6E0" strokeWidth="1.2" strokeLinecap="round" fill="none" />
    </svg>
  );
}
