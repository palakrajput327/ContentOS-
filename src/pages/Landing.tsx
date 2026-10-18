import { Link, useNavigate } from "react-router-dom";
import { useEffect, useRef, useState } from 'react';
import { ThemeToggle } from '../lib/appearance';
import { useScrollReveal } from '../lib/useScrollReveal';
import { Menu, X } from 'lucide-react';
import {
  ArrowRight,
  ArrowUpRight,
  FileText,
  Sparkles,
  CalendarDays,
  Check,
  ShieldCheck,
  Layers,
  Clapperboard,
  GitBranch,
  Users,
  BookOpen,
  Command,
  ChevronRight,
} from "lucide-react";
import { Logo, Button, PlatformIcon } from "../components/ui";

import { platforms, PRODUCT, type Platform } from "../lib/model";
import { useSession } from "../lib/session";
export default function Landing() {
  const nav = useNavigate();
  const session = useSession();
  const landingRef = useRef<HTMLDivElement>(null);
  const [menuOpen,setMenuOpen] = useState(false);
  const [activePlatform, setActivePlatform] = useState<Platform>("LinkedIn");
  useEffect(()=>{
    if(!menuOpen)return;
    const close=(event:KeyboardEvent)=>{if(event.key==='Escape')setMenuOpen(false);};
    document.addEventListener('keydown',close);
    return ()=>document.removeEventListener('keydown',close);
  },[menuOpen]);
  useScrollReveal(landingRef);
  const demo = () => nav("/signup");
  const enterInteractiveDemo = () => {
    session.enterDemo();
    nav("/app");
  };
  return (
    <div className="landing" ref={landingRef}>
      <a className="skip-link" href="#marketing-main">Skip to content</a>
      <header className="landing-nav">
        <Link to="/" aria-label={`${PRODUCT} home`}>
          <Logo />
        </Link>
        <nav id="marketing-navigation" className={menuOpen?'is-open':''} onClick={()=>setMenuOpen(false)} aria-label="Main navigation">
          <a href="#workflow">Product</a>
          <a href="#intelligence">Intelligence</a>
          <a href="#teams">For teams</a>
          <a href="#pricing">Pricing</a>
        </nav>
        <div className="row">
          <ThemeToggle />
          <button type="button" className="icon-button landing-menu-toggle" aria-label={menuOpen?'Close menu':'Open menu'} aria-expanded={menuOpen} aria-controls="marketing-navigation" onClick={()=>setMenuOpen(!menuOpen)}>{menuOpen?<X size={20}/>:<Menu size={20}/>}</button>
          <Link className="login-link" to="/login">
            Log in
          </Link>
          <Button asChild variant="primary">
            <Link to="/signup">
              Start creating <ArrowUpRight size={16} />
            </Link>
          </Button>
        </div>
      </header>
      <main id="marketing-main">
        <section className="hero">
          <div className="eyebrow">
            <span className="tiny-logo">
              <Sparkles size={13} />
            </span>{" "}
            THE CONTENT OPERATING SYSTEM <ChevronRight size={13} />
          </div>
          <h1>
            One source.
            <br />
            <span>An entire social presence.</span>
          </h1>
          <p>
            Your knowledge has more to say. Turn it into on-brand content,
            <br className="desktop" /> thoughtful campaigns, and a calendar that
            works together.
          </p>
          <div className="hero-actions">
            <Button asChild variant="primary">
              <Link to="/signup">
                Start creating <ArrowRight size={17} />
              </Link>
            </Button>
            <Button
              onClick={() =>
                document
                  .getElementById("workflow")
                  ?.scrollIntoView({ behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' })
              }
            >
              <span className="play-triangle" /> See how it works
            </Button>
          </div>
          <div className="hero-note">
            Built for your ideas. Designed for your team.
          </div>
          <div className="flow" aria-label="Content workflow">
            {[
              [FileText, "Your knowledge"],
              [Sparkles, "AI intelligence"],
              [Layers, "Content & video"],
              [CalendarDays, "Your calendar"],
              [ArrowUpRight, "Your audience"],
            ].map(([Icon, label], i) => {
              const I = Icon as typeof FileText;
              return (
                <div className="flow-stage" key={String(label)}>
                  <span className={i === 1 ? "flow-icon active" : "flow-icon"}>
                    <I size={21} />
                  </span>
                  <span>{String(label)}</span>
                  {i < 4 && <span className="flow-line" />}
                </div>
              );
            })}
          </div>
          <div className="product-window">
            <div className="window-top">
              <div className="window-dots">
                <i />
                <i />
                <i />
              </div>
              <span onClick={enterInteractiveDemo} style={{ cursor: "pointer" }}>Workspace / Overview</span>
              <span className="preview-tag" onClick={enterInteractiveDemo} style={{ cursor: "pointer" }} title="Click to test interactive demo">
                TRY LIVE DEMO ↗
              </span>
            </div>
            <div className="mini-app">
              <aside>
                <Logo />
                <div className="mini-workspace">
                  A{" "}
                  <span>
                    Acme Studio <small>Workspace</small>
                  </span>
                </div>
                {[
                  "Overview",
                  "AI Studio",
                  "Create post",
                  "Calendar",
                  "Content library",
                ].map((x, i) => (
                  <div
                    className={i === 0 ? "mini-nav selected" : "mini-nav"}
                    key={x}
                    onClick={() => {
                      session.enterDemo();
                      const path = i === 0 ? "/app" : i === 1 ? "/app/studio" : i === 2 ? "/app/compose" : i === 3 ? "/app/calendar" : "/app/library";
                      nav(path);
                    }}
                    style={{ cursor: "pointer" }}
                  >
                    {
                      [
                        <Command size={14} />,
                        <Sparkles size={14} />,
                        <Layers size={14} />,
                        <CalendarDays size={14} />,
                        <BookOpen size={14} />,
                      ][i]
                    }
                    {x}
                  </div>
                ))}
                <small className="mini-label">ACTIVE PLATFORM (CLICK TO TEST)</small>
                <div className="mini-channel-buttons" style={{ display: 'flex', flexDirection: 'column', gap: '6px', marginTop: '6px' }}>
                  {platforms.filter(p => p !== 'X').map((p) => (
                    <button
                      key={p}
                      type="button"
                      className={`mini-nav ${activePlatform === p ? "selected" : ""}`}
                      onClick={() => setActivePlatform(p)}
                      style={{ cursor: 'pointer', textAlign: 'left', border: '1px solid transparent', padding: '7px 10px' }}
                    >
                      <PlatformIcon platform={p} />
                      <span style={{ marginLeft: '6px', fontSize: '.76rem' }}>{p}</span>
                      {activePlatform === p && <span style={{ marginLeft: 'auto', fontSize: '.6rem', color: 'var(--success)' }}>● Live</span>}
                    </button>
                  ))}
                </div>
              </aside>
              <section>
                <div className="mini-heading">
                  <div>
                    <span className="muted">Your workspace, in focus.</span>
                    <h2>Multi-Channel Publishing Studio</h2>
                  </div>
                  <button onClick={() => { session.enterDemo(); nav("/app/compose"); }} className="mini-create">
                    + Create post
                  </button>
                </div>
                <div className="mini-stats">
                  {[
                    ["12", "Scheduled posts"],
                    ["04", "Awaiting approval"],
                    ["28", "Published this month"],
                    ["05", "Connected channels"],
                  ].map(([n, l]) => (
                    <div key={l}>
                      <span>{l}</span>
                      <strong>{n}</strong>
                      <small>Sample workspace</small>
                    </div>
                  ))}
                </div>
                <div className="mini-panels">
                  <div>
                    <div className="panel-heading">
                      Your content pipeline <span>This month ↗</span>
                    </div>
                    <div className="pipeline-bars">
                      {[
                        ["Drafts", 42],
                        ["In review", 28],
                        ["Scheduled", 62],
                        ["Published", 92],
                      ].map(([x, w]) => (
                        <div key={x}>
                          <span>{x}</span>
                          <i>
                            <b style={{ width: `${w}%` }} />
                          </i>
                          <small>{Number(w) / 2}</small>
                        </div>
                      ))}
                    </div>
                  </div>
                  <div>
                    <div className="panel-heading">
                      <span>Live Preview · {activePlatform}</span>
                      <span style={{ color: 'var(--accent)', cursor: 'pointer' }} onClick={() => { session.enterDemo(); nav("/app/compose"); }}>Open composer ↗</span>
                    </div>
                    <div key={activePlatform} className="mini-post preview-card-morph" style={{ border: '1px solid var(--border-strong)', padding: '14px', borderRadius: '12px', background: 'var(--surface2)', transition: 'all .25s ease' }}>
                      <PlatformIcon platform={activePlatform} />
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '3px', flex: 1, minWidth: 0 }}>
                        <strong style={{ fontSize: '.84rem', color: 'var(--ink)', lineHeight: 1.35 }}>
                          {activePlatform === "LinkedIn" && "How high-performing creator teams build a 30-day content pipeline."}
                          {activePlatform === "Instagram" && "Design principles for peaceful dark mode interfaces & visual carousels."}
                          {activePlatform === "YouTube" && "ContentOS Architecture: Proactive Token Refresh & 4K Resumable Uploads."}
                          {activePlatform === "Facebook" && "Product Release: Multi-Tenant Workspaces, Festival Automation & RBAC."}
                          {activePlatform === "Telegram" && "Production Update: All social publishing queues operational at 99.98%."}
                        </strong>
                        <small style={{ color: 'var(--muted)', fontSize: '.72rem' }}>
                          {activePlatform === "LinkedIn" && "Tomorrow · 9:00 AM · Carousel + PDF"}
                          {activePlatform === "Instagram" && "Tomorrow · 11:30 AM · In-Memory HD JPEG"}
                          {activePlatform === "YouTube" && "Tomorrow · 2:00 PM · YouTube Shorts (4K)"}
                          {activePlatform === "Facebook" && "Tomorrow · 4:15 PM · Photo + Link (Graph API)"}
                          {activePlatform === "Telegram" && "Tomorrow · 6:00 PM · Instant Markdown Broadcast"}
                        </small>
                      </div>
                      <span className="mini-pill" style={{ flexShrink: 0, padding: '4px 8px', borderRadius: '6px', fontSize: '.68rem' }}>
                        Scheduled
                      </span>
                    </div>
                    <div style={{ marginTop: '10px', fontSize: '.72rem', color: 'var(--subtle)', display: 'flex', alignItems: 'center', gap: '6px' }}>
                      <span style={{ width: '6px', height: '6px', borderRadius: '50%', background: 'var(--success)', display: 'inline-block' }}></span>
                      OAuth Token Active & Health Verified
                    </div>
                  </div>
                </div>
              </section>
            </div>
            <button className="preview-explore" onClick={demo}>
              Start creating <ArrowUpRight size={15} />
            </button>
          </div>
        </section>
        <section className="platform-strip">
          <p>One workspace. Every conversation.</p>
          <div>
            {platforms.map((p) => (
              <span key={p}>
                <PlatformIcon platform={p} />
                {p}
              </span>
            ))}
          </div>
        </section>
        <section id="workflow" className="section workflow-section">
          <div className="section-kicker">01 / FROM KNOWLEDGE TO IMPACT</div>
          <div className="section-heading">
            <h2>
              Less busywork.
              <br />
              More worth sharing.
            </h2>
            <p>
              Bring your ideas, your expertise, your point of view.
              <br />
              Give every piece of content a clear path forward.
            </p>
          </div>
          <div className="feature-grid three">
            {[
              [
                FileText,
                "Start with what you know.",
                "Write a post or bring a source. Your company knowledge is the starting point, not an afterthought.",
              ],
              [
                Sparkles,
                "Find the right words.",
                "Create a distinct caption for each platform, grounded in your brand voice and audience.",
              ],
              [
                CalendarDays,
                "Publish with intention.",
                "Review together, choose the moment, and keep the whole team in the loop.",
              ],
            ].map(([Icon, title, body], i) => {
              const I = Icon as typeof FileText;
              return (
                <article key={String(title)}>
                  <div className="feature-number">
                    0{i + 1}
                    <I size={22} />
                  </div>
                  <h3>{String(title)}</h3>
                  <p>{String(body)}</p>
                </article>
              );
            })}
          </div>
        </section>
        <section className="section intelligence" id="intelligence">
          <div className="intelligence-copy">
            <div className="section-kicker">02 / BRAND INTELLIGENCE</div>
            <h2>
              Your expertise.
              <br />A thousand possibilities.
            </h2>
            <p>
              Keep your voice consistent across every channel. A shared Brand
              Kit brings your tone, message, and calls to action into every
              generation.
            </p>
            <div className="feature-line">
              <Check size={17} /> Platform-specific captions
            </div>
            <div className="feature-line">
              <Check size={17} /> Editable drafts, always
            </div>
            <div className="feature-line">
              <Check size={17} /> Human approval before publishing
            </div>
            <Button onClick={demo}>
              Create your account <ArrowUpRight size={16} />
            </Button>
          </div>
          <div className="intelligence-panel">
            <div className="panel-heading">
              <Sparkles size={17} /> A little context. A better starting point.
            </div>
            <div className="prompt-sample">
              Share three practical ways to give a small team more time for
              creative work.
            </div>
            <div className="generated-card">
              <div className="row">
                <PlatformIcon platform="LinkedIn" />
                <span>LinkedIn variant</span>
                <span className="badge">Example</span>
              </div>
              <p>
                Your team doesn’t need more hours.
                <br />
                It needs fewer things getting in the way.
              </p>
              <p className="muted">
                Start with one shared calendar, a clear review process, and a
                home for the ideas worth keeping.
              </p>
              <div className="example-actions">
                <span>Professional</span>
                <span>Brand aligned</span>
                <span>Ready to edit</span>
              </div>
            </div>
          </div>
        </section>
        <section className="section" id="teams">
          <div className="section-kicker">03 / BETTER, TOGETHER</div>
          <h2>One team. A shared sense of direction.</h2>
          <div className="feature-grid three">
            {[
              [
                Users,
                "Built for collaboration",
                "Roles, workspace ownership, and a review queue that makes the next step clear.",
              ],
              [
                GitBranch,
                "A history you can follow",
                "See who created, edited, approved, and scheduled your content in one activity feed.",
              ],
              [
                ShieldCheck,
                "Control at every step",
                "Server-side permissions, encrypted connection tokens, and deliberate publishing workflows.",
              ],
            ].map(([Icon, t, d]) => {
              const I = Icon as typeof Users;
              return (
                <article key={String(t)}>
                  <I size={24} />
                  <h3>{String(t)}</h3>
                  <p>{String(d)}</p>
                </article>
              );
            })}
          </div>
        </section>
        <section className="section roadmap-section">
          <div>
            <div className="section-kicker">WHAT COMES NEXT</div>
            <h2>
              A foundation for
              <br />
              your entire content engine.
            </h2>
          </div>
          <div className="roadmap-list">
            {[
              [
                FileText,
                "PDF → social campaign",
                "Document evidence, content pillars, and campaign planning.",
              ],
              [
                Clapperboard,
                "AI Video Studio",
                "From a scene plan to multiple formats with Remotion.",
              ],
              [
                Layers,
                "Deeper analytics",
                "A clearer view of what your audience responds to.",
              ],
            ].map(([Icon, t, d]) => {
              const I = Icon as typeof FileText;
              return (
                <div key={String(t)}>
                  <I size={22} />
                  <section>
                    <h3>
                      {String(t)} <span className="badge">Planned</span>
                    </h3>
                    <p>{String(d)}</p>
                  </section>
                </div>
              );
            })}
          </div>
        </section>
        <section id="pricing" className="section pricing">
          <div>
            <div className="section-kicker">EARLY ACCESS</div>
            <h2>Start with a better workflow.</h2>
            <p>
              Pricing is being finalized. Create an account and verify your
              email to get started.
            </p>
          </div>
          <Button variant="primary" onClick={demo}>
            Create your account <ArrowUpRight size={17} />
          </Button>
        </section>
        <section className="section faq">
          <h2>A few good questions.</h2>
          <div>
            {[
              [
                "Does AI publish without my approval?",
                "Review Mode is the default. Generated drafts stay in your approval queue so your team can review the content and schedule before publishing.",
              ],
              [
                "Can I connect my own accounts?",
                "Connect supported accounts from your workspace’s Channels page. Check account readiness and choose the destinations for each post before scheduling.",
              ],
              [
                "How does my knowledge become content?",
                "Upload a business PDF, review its extracted knowledge, and turn approved facts into platform-specific drafts. Keep the source evidence alongside your content.",
              ],
              [
                "Can I create images and videos?",
                "Use the existing visual tools and media attachments in your post workflow. Automated AI video generation is planned for a later phase.",
              ],
            ].map(([q, a]) => (
              <details key={q}>
                <summary>
                  {q}
                  <span>+</span>
                </summary>
                <p>{a}</p>
              </details>
            ))}
          </div>
        </section>
        <section className="final-cta">
          <Sparkles size={26} />
          <h2>Your next great post starts here.</h2>
          <Button asChild variant="primary">
            <Link to="/signup">
              Start creating <ArrowRight size={17} />
            </Link>
          </Button>
        </section>
      </main>
      <footer>
        <Logo />
        <span>Thoughtful content. Connected workflows.</span>
        <small>
          © {new Date().getFullYear()} {PRODUCT}
        </small>
      </footer>
    </div>
  );
}
