import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  CheckCircle2, Clock, Lock, ShieldCheck, KeyRound, EyeOff, Building2, FileCheck2, ChevronDown, Smartphone,
} from 'lucide-react';
import api from '../api/client';
import { useAuth } from '../context/AuthContext';
import Logo from '../components/Logo';
import '../styles/landing.css';

const SCHOOL = 'Caloocan City Elementary School';
const HOME_BY_ROLE = { admin: '/admin/dashboard', registrar: '/registrar', parent: '/dashboard' };

// Used only if the public API cannot be reached, so the page is never empty.
const FALLBACK_GRADES = ['Kinder', 'Grade 1', 'Grade 2', 'Grade 3', 'Grade 4', 'Grade 5', 'Grade 6'];

const STEPS = [
  {
    title: 'Create your account',
    body: 'Sign up with your email address and accept the Data Privacy Notice. We send a verification link; once you open it, your account is ready.',
  },
  {
    title: 'Fill out the application',
    body: "Enter your child's details, choose the grade level and add your contact details. A returning student moves up to the next grade in a few clicks.",
  },
  {
    title: 'Upload the documents',
    body: 'Attach a clear photo or scan of each required document. Any file type except audio and video is accepted, up to 5 MB each.',
  },
  {
    title: 'The registrar reviews it',
    body: 'The school registrar checks your application and documents. Your dashboard always shows where it stands: submitted, under review, approved or rejected.',
  },
  {
    title: 'See the class schedule',
    body: "Once an application is approved, your child's class schedule appears under Student\u2019s Schedule in your account.",
  },
];

const FAQS = [
  {
    q: 'Does SecureEnroll charge any fees?',
    a: 'No. SecureEnroll does not process payments of any kind, and it will never ask you for card or e-wallet details.',
  },
  {
    q: 'I did not receive the verification email.',
    a: 'Check your spam or junk folder first. If it is not there, sign in with your email and password and choose "Resend email" to get a new link.',
  },
  {
    q: 'Can I enroll more than one child?',
    a: 'Yes. Use one account and submit a separate application for each child.',
  },
  {
    q: 'My child already studies here. Do I start over?',
    a: 'No. Choose "Find Returning Student" when you start a new application and your child is moved up to the next grade level.',
  },
  {
    q: 'What if enrollment is closed?',
    a: 'Online applications can only be submitted while enrollment is open, and the status box at the top of this page always shows the current dates. If you have missed the period, please visit the school registrar’s office.',
  },
  {
    q: 'I do not have internet access. Can I still enroll my child?',
    a: 'Yes. Visit the school registrar’s office with the required documents and the staff can encode the enrollment for you through the walk-in process.',
  },
  {
    q: 'I forgot my password.',
    a: 'On the sign-in page, choose "Forgot password" and we will email you a link to set a new one.',
  },
];

// Dates are written the way a Philippine reader writes them, day before
// month: "2 June 2026", not "June 2, 2026". The time zone is pinned to UTC
// because the value is already a plain Y-M-D decided in Manila on the
// server, and reading it in the visitor's own zone would shift it by a day
// for anyone abroad.
const fmtDate = (ymd, opts) =>
  new Intl.DateTimeFormat('en-GB', { timeZone: 'UTC', ...opts }).format(new Date(`${ymd}T00:00:00Z`));
const short = (ymd) => fmtDate(ymd, { month: 'short', day: 'numeric' });
const long = (ymd) => fmtDate(ymd, { month: 'long', day: 'numeric', year: 'numeric' });
// "1 April to 15 May 2026" — the year is said once when both dates fall in
// it, so the sentence reads the way it would be spoken.
const range = (from, to) => (from.slice(0, 4) === to.slice(0, 4)
  ? `${fmtDate(from, { month: 'long', day: 'numeric' })} to ${long(to)}`
  : `${long(from)} to ${long(to)}`);
const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

// How far through the enrollment window today is, from 0 to 1.
function progressOf({ opensOn, closesOn, today }) {
  if (!opensOn || !closesOn || !today) return 0;
  const a = Date.parse(`${opensOn}T00:00:00Z`);
  const b = Date.parse(`${closesOn}T00:00:00Z`);
  const t = Date.parse(`${today}T00:00:00Z`);
  if (b <= a) return 1;
  return Math.min(1, Math.max(0, (t - a) / (b - a)));
}

function describe(e) {
  if (!e) return null;
  const year = e.schoolYear ? e.schoolYear.replace('-', '–') : '';
  if (e.state === 'open') {
    let detail;
    if (e.daysLeft === 0) detail = 'Today is the last day to apply.';
    else if (e.daysLeft === 1) detail = '1 day left to apply.';
    else detail = `${e.daysLeft} days left to apply.`;
    return { tone: 'open', label: 'Enrollment is open', year, detail, cta: 'start' };
  }
  if (e.state === 'upcoming') {
    const detail = e.daysUntilOpen === 1 ? 'Opens tomorrow.' : `Opens in ${plural(e.daysUntilOpen, 'day')}.`;
    return { tone: 'soon', label: 'Opens soon', year, detail, cta: 'prepare' };
  }
  if (e.state === 'closed') {
    const detail = e.reason === 'ended'
      ? `Enrollment closed on ${long(e.closesOn)}.`
      : e.reason === 'classes_started'
        ? 'Online enrollment is closed now that classes have started. Transferees may enroll in person at the school office.'
        : e.reason === 'full'
          ? 'All slots are filled, so enrollment is closed.'
          : 'Enrollment is temporarily closed. Please check back soon.';
    return { tone: 'closed', label: 'Enrollment is closed', year, detail, cta: 'closed' };
  }
  return { tone: 'none', label: 'Dates not announced yet', year: '', detail: 'The school has not set the enrollment period yet.', cta: 'prepare' };
}

function EnrollmentStatus({ status, onRetry }) {
  if (status.loading) {
    return (
      <div className="lp-window lp-window-loading" aria-busy="true" aria-live="polite">
        <div className="lp-skel lp-skel-pill" /><div className="lp-skel lp-skel-line" /><div className="lp-skel lp-skel-bar" />
        <span className="lp-sr">Loading the current enrollment period</span>
      </div>
    );
  }
  if (status.error) {
    return (
      <div className="lp-window lp-window-error" role="status">
        <p className="lp-window-state"><Clock size={18} aria-hidden="true" /> We could not load the enrollment dates</p>
        <p className="lp-window-detail">Please check your connection and try again. You can still create an account in the meantime.</p>
        <div className="lp-window-actions">
          <button type="button" className="lp-btn lp-btn-gold" onClick={onRetry}>Try again</button>
          <Link to="/register" className="lp-btn lp-btn-ghost-light">Create account</Link>
        </div>
      </div>
    );
  }

  const e = status.data.enrollment;
  const sy = status.data.schoolYear;
  const d = describe(e);
  // A school year the system started by itself carries provisional dates
  // until the registrar's office enters the real ones. Printing those as
  // though they were settled would have parents turning up on a day the
  // school never agreed to, so until they are confirmed the page says plainly
  // that they are not final yet and shows no dates at all.
  const confirmed = sy ? sy.datesConfirmed : true;
  const hasDates = confirmed && e.opensOn && e.closesOn;
  const pct = Math.round(progressOf(e) * 100);

  return (
    <div className={`lp-window lp-window-${d.tone}`} role="status" aria-live="polite">
      <p className="lp-window-state">
        <span className="lp-dot" aria-hidden="true" />{d.label}
      </p>
      {d.year && <p className="lp-window-year">School Year {d.year}</p>}

      {hasDates && (
        <div className="lp-track" aria-hidden="true">
          <div className="lp-track-line">
            <div className="lp-track-fill" style={{ width: `${pct}%` }} />
            {e.state !== 'upcoming' && <span className="lp-track-today" style={{ left: `${pct}%` }} />}
          </div>
          <div className="lp-track-ends">
            <span>{short(e.opensOn)}</span>
            <span>{short(e.closesOn)}</span>
          </div>
        </div>
      )}
      {hasDates && (
        <p className="lp-window-range">
          <span className="lp-sr">Enrollment period: </span>
          Enrollment is open from {range(e.opensOn, e.closesOn)}
        </p>
      )}
      {hasDates && sy?.classesStartOn && (
        <p className="lp-class-start">
          <span className="lp-sr">First day of classes: </span>
          Classes start {long(sy.classesStartOn)}
        </p>
      )}
      {!confirmed ? (
        <p className="lp-window-detail">
          The school has not confirmed the dates for School Year {d.year} yet. The day classes start and the
          enrollment period will appear here as soon as the registrar&rsquo;s office sets them.
        </p>
      ) : (
        <p className="lp-window-detail">{d.detail}</p>
      )}

      <div className="lp-window-actions">
        {d.cta === 'start' && <Link to="/register" className="lp-btn lp-btn-gold">Create account and apply</Link>}
        {d.cta === 'prepare' && <Link to="/register" className="lp-btn lp-btn-gold">Create your account now</Link>}
        {d.cta === 'closed' && <a href="#faq" className="lp-btn lp-btn-gold">What can I do?</a>}
        <Link to="/login" className="lp-btn lp-btn-ghost-light">Sign in</Link>
      </div>
    </div>
  );
}

export default function Landing() {
  const { user } = useAuth();
  const [status, setStatus] = useState({ loading: true, error: false, data: null });

  const load = useCallback(() => {
    setStatus((s) => ({ ...s, loading: true, error: false }));
    api.get('/public/enrollment')
      .then(({ data }) => setStatus({ loading: false, error: false, data }))
      .catch(() => setStatus({ loading: false, error: true, data: null }));
  }, []);
  useEffect(() => { load(); }, [load]);

  const data = status.data;
  const grades = data?.gradeLevels?.length ? data.gradeLevels : FALLBACK_GRADES;
  const docs = data?.documents || [];
  // Some papers are asked of new learners only, or returning ones only.
  const audienceNote = (d) => (d.appliesTo === 'new' ? ' (new learners only)'
    : d.appliesTo === 'returning' ? ' (returning learners only)' : '');
  const requiredDocs = docs.filter((d) => d.required);
  const otherDocs = docs.filter((d) => !d.required);
  const home = user ? HOME_BY_ROLE[user.role] || '/dashboard' : null;
  const e = data?.enrollment;
  const sy = data?.schoolYear;
  const stateIsOpen = e?.state === 'open';
  // Provisional dates are never stated as fact anywhere on the page.
  const datesSettled = Boolean(e?.opensOn && e?.closesOn && (!sy || sy.datesConfirmed));

  return (
    <div className="lp">
      <a className="lp-skip" href="#main">Skip to content</a>

      <header className="lp-nav">
        <div className="lp-wrap lp-nav-in">
          <Link to="/" className="lp-brand" aria-label="SecureEnroll home">
            <Logo size={38} />
            <span className="lp-brand-text">
              SecureEnroll
              <small>{SCHOOL}</small>
            </span>
          </Link>
          <nav className="lp-links" aria-label="Page sections">
            <a href="#how">How it works</a>
            <a href="#requirements">Requirements</a>
            <a href="#grades">Grade levels</a>
            <a href="#privacy">Privacy</a>
            <a href="#faq">FAQ</a>
          </nav>
          <div className="lp-nav-cta">
            {home ? (
              <Link to={home} className="lp-btn lp-btn-blue">Go to your dashboard</Link>
            ) : (
              <>
                <Link to="/login" className="lp-btn lp-btn-quiet">Sign in</Link>
                <Link to="/register" className="lp-btn lp-btn-blue lp-hide-xs">Create account</Link>
              </>
            )}
          </div>
        </div>
      </header>

      <main id="main">
        {/* ---------------------------------------------------------------- hero */}
        <section className="lp-hero" aria-labelledby="hero-title">
          <div className="lp-wrap lp-hero-in">
            <div className="lp-hero-copy">
              <h1 id="hero-title">Enroll your child online, from any phone or computer.</h1>
              <p className="lp-lead">
                Apply for Kinder to Grade 6 at {SCHOOL}. Fill out one form, upload your documents
                and follow your application until the registrar finishes the review.
              </p>
              <ul className="lp-ticks">
                <li><CheckCircle2 size={20} aria-hidden="true" /> Free to use, with no payment on the website</li>
                <li><CheckCircle2 size={20} aria-hidden="true" /> Works on a phone, tablet or computer</li>
                <li><CheckCircle2 size={20} aria-hidden="true" /> Your child&rsquo;s records are stored encrypted</li>
              </ul>
              <div className="lp-hero-actions">
                {home ? (
                  <Link to={home} className="lp-btn lp-btn-blue lp-btn-lg">Go to your dashboard</Link>
                ) : (
                  <>
                    <Link to="/register" className="lp-btn lp-btn-blue lp-btn-lg">
                      {stateIsOpen ? 'Start enrollment' : 'Create your account'}
                    </Link>
                    <a href="#how" className="lp-btn lp-btn-outline lp-btn-lg">See how it works</a>
                  </>
                )}
              </div>
            </div>

            <div className="lp-hero-side">
              <span className="lp-sun" aria-hidden="true" />
              <EnrollmentStatus status={status} onRetry={load} />
            </div>
          </div>
        </section>

        {/* ------------------------------------------------------------ how it works */}
        <section className="lp-section" id="how" aria-labelledby="how-title">
          <div className="lp-wrap lp-split">
            <div className="lp-split-head">
              <h2 id="how-title">Five steps from sign-up to class schedule</h2>
              <p>
                Most parents finish the application in one sitting. You can sign in later to check its status
                at any time.
              </p>
              <Link to="/register" className="lp-textlink">Create your account</Link>
            </div>
            <ol className="lp-steps">
              {STEPS.map((s, i) => (
                <li key={s.title}>
                  <span className="lp-step-n" aria-hidden="true">{i + 1}</span>
                  <div>
                    <h3>{s.title}</h3>
                    <p>{s.body}</p>
                  </div>
                </li>
              ))}
            </ol>
          </div>
        </section>

        {/* --------------------------------------------------------------- requirements */}
        <section className="lp-section lp-section-tint" id="requirements" aria-labelledby="req-title">
          <div className="lp-wrap">
            <div className="lp-head">
              <h2 id="req-title">Prepare these before you start</h2>
              <p>Take a clear photo or scan of each document. Any file type works except audio and video, up to 5 MB each.</p>
            </div>

            <div className="lp-req">
              <div className="lp-req-col">
                <h3>Documents to upload</h3>
                {status.loading && <p className="lp-muted">Loading the list&hellip;</p>}
                {!status.loading && requiredDocs.length === 0 && otherDocs.length === 0 && (
                  <p className="lp-muted">The school will confirm the document list when you apply.</p>
                )}
                {requiredDocs.length > 0 && (
                  <>
                    <p className="lp-req-label">Required</p>
                    <ul className="lp-checklist">
                      {requiredDocs.map((d) => (
                        <li key={d.label}><FileCheck2 size={20} aria-hidden="true" />{d.label}{audienceNote(d)}</li>
                      ))}
                    </ul>
                  </>
                )}
                {otherDocs.length > 0 && (
                  <>
                    <p className="lp-req-label">If you have them</p>
                    <ul className="lp-checklist lp-checklist-soft">
                      {otherDocs.map((d) => (
                        <li key={d.label}><FileCheck2 size={20} aria-hidden="true" />{d.label}</li>
                      ))}
                    </ul>
                  </>
                )}
              </div>

              <div className="lp-req-col">
                <h3>Information to have ready</h3>
                <ul className="lp-facts">
                  <li>
                    <strong>Your child&rsquo;s details</strong>
                    <span>Full name, sex, birth date and home address.</span>
                  </li>
                  <li>
                    <strong>LRN for a returning learner</strong>
                    <span>New learners do not need one; the registrar records it. For a returning learner, have the 12-digit Learner Reference Number ready to find their record.</span>
                  </li>
                  <li>
                    <strong>An email address you can open</strong>
                    <span>We send a verification link to this address, and you cannot apply until it is verified.</span>
                  </li>
                </ul>
              </div>
            </div>
          </div>
        </section>

        {/* ----------------------------------------------------------------- grades */}
        <section className="lp-section" id="grades" aria-labelledby="grades-title">
          <div className="lp-wrap">
            <div className="lp-head">
              <h2 id="grades-title">Open to every grade level, Kinder to Grade 6</h2>
              <p>Pick your child&rsquo;s grade level on the application form.</p>
            </div>
            <ol className="lp-ladder" aria-label="Grade levels offered">
              {grades.map((g, i) => (
                <li key={g} style={{ '--rise': i }}>
                  <span>{g}</span>
                </li>
              ))}
            </ol>
            <div className="lp-walkin">
              <Building2 size={26} aria-hidden="true" />
              <div>
                <h3>Prefer to enroll in person?</h3>
                <p>
                  Visit the school registrar&rsquo;s office with the documents above. The staff can encode your
                  child&rsquo;s enrollment for you, and you can sign in afterwards to follow its status.
                </p>
              </div>
            </div>
          </div>
        </section>

        {/* ---------------------------------------------------------------- privacy */}
        <section className="lp-section lp-section-tint" id="privacy" aria-labelledby="privacy-title">
          <div className="lp-wrap lp-split">
            <div className="lp-split-head">
              <h2 id="privacy-title">Built to keep your child&rsquo;s information private</h2>
              <p>
                SecureEnroll follows the Data Privacy Act of 2012 (RA 10173). You are asked for your consent
                before an account is created, and the full notice is available on the sign-up page.
              </p>
            </div>
            <ul className="lp-secure">
              <li>
                <ShieldCheck size={22} aria-hidden="true" />
                <div>
                  <h3>Verified accounts only</h3>
                  <p>Every account must confirm its email address before it can submit an application.</p>
                </div>
              </li>
              <li>
                <Lock size={22} aria-hidden="true" />
                <div>
                  <h3>Encrypted records</h3>
                  <p>Contact numbers, birth dates and LRNs are stored in encrypted form in the database.</p>
                </div>
              </li>
              <li>
                <EyeOff size={22} aria-hidden="true" />
                <div>
                  <h3>You see only your own children</h3>
                  <p>Parents can open only their own applications. Registrar and administrator tools need separate staff accounts.</p>
                </div>
              </li>
              <li>
                <KeyRound size={22} aria-hidden="true" />
                <div>
                  <h3>Guarded sign-in</h3>
                  <p>Passwords are stored as one-way hashes, and an account locks for 15 minutes after 5 wrong attempts.</p>
                </div>
              </li>
            </ul>
          </div>
        </section>

        {/* -------------------------------------------------------------------- faq */}
        <section className="lp-section" id="faq" aria-labelledby="faq-title">
          <div className="lp-wrap lp-split">
            <div className="lp-split-head">
              <h2 id="faq-title">Questions parents ask</h2>
              <p>Cannot find your answer? Visit the school registrar&rsquo;s office and the staff will help.</p>
            </div>
            <div className="lp-faq">
              {FAQS.map((f) => (
                <details key={f.q}>
                  <summary>
                    <span>{f.q}</span>
                    <ChevronDown size={20} aria-hidden="true" />
                  </summary>
                  <p>{f.a}</p>
                </details>
              ))}
            </div>
          </div>
        </section>

        {/* -------------------------------------------------------------- closing CTA */}
        <section className="lp-final" aria-labelledby="final-title">
          <div className="lp-wrap lp-final-in">
            <div>
              <h2 id="final-title">
                {stateIsOpen ? 'Enrollment is open. Start your application today.' : 'Get your account ready for enrollment.'}
              </h2>
              <p>
                {datesSettled
                  ? `School Year ${e.schoolYear.replace('-', '–')}: enrollment is open from `
                    + `${range(e.opensOn, e.closesOn)}`
                    + `${sy?.classesStartOn ? `, and classes start ${long(sy.classesStartOn)}` : ''}.`
                  : 'Create your account now and verify your email so you can apply as soon as the school announces its dates.'}
              </p>
            </div>
            <div className="lp-final-actions">
              {home ? (
                <Link to={home} className="lp-btn lp-btn-gold lp-btn-lg">Go to your dashboard</Link>
              ) : (
                <>
                  <Link to="/register" className="lp-btn lp-btn-gold lp-btn-lg">Create account</Link>
                  <Link to="/login" className="lp-btn lp-btn-ghost-light lp-btn-lg">Sign in</Link>
                </>
              )}
            </div>
          </div>
        </section>
      </main>

      <footer className="lp-foot">
        <div className="lp-wrap lp-foot-in">
          <div className="lp-foot-brand">
            <Logo size={34} />
            <div>
              <strong>SecureEnroll</strong>
              <p>The online enrollment system of {SCHOOL}.</p>
            </div>
          </div>
          <nav className="lp-foot-links" aria-label="Footer">
            <a href="#how">How it works</a>
            <a href="#requirements">Requirements</a>
            <a href="#faq">FAQ</a>
            <Link to="/login">Sign in</Link>
            <Link to="/register">Create account</Link>
          </nav>
        </div>
        <div className="lp-wrap lp-foot-fine">
          <span><Smartphone size={14} aria-hidden="true" /> Works on any modern phone, tablet or computer.</span>
          <span>&copy; {new Date().getFullYear()} {SCHOOL}. This system contains only dummy data.</span>
        </div>
      </footer>
    </div>
  );
}
