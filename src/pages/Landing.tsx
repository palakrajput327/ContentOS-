import { Link, useNavigate } from "react-router-dom";
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

import { platforms, PRODUCT } from "../lib/model";
export default function Landing() {
  const nav = useNavigate();
  const demo = () => nav("/signup");
  return (
    <div className="landing">
      <header className="landing-nav">
        <Link to="/" aria-label={`${PRODUCT} home`}>
          <Logo />
        </Link>
        <nav>
          <a href="#workflow">Product</a>
          <a href="#intelligence">Intelligence</a>
          <a href="#teams">For teams</a>
          <a href="#pricing">Pricing</a>
        </nav>
        <div className="row">
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
      <main>
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
                  ?.scrollIntoView({ behavior: "smooth" })
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
              <span>Workspace / Overview</span>
              <span className="preview-tag">PRODUCT PREVIEW</span>
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
                <small className="mini-label">CONNECTED CHANNELS</small>
                <div className="row">
                  {platforms.map((p) => (
                    <PlatformIcon key={p} platform={p} />
                  ))}
                </div>
              </aside>
              <section>
                <div className="mini-heading">
                  <div>
                    <span className="muted">Your workspace, in focus.</span>
                    <h2>Make room for great content.</h2>
                  </div>
                  <button onClick={demo} className="mini-create">
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
                      Up next <span>View calendar ↗</span>
                    </div>
                    {[
                      "Ideas worth sharing.",
                      "Inside our creative process.",
                      "A smarter way to work.",
                    ].map((t, i) => (
                      <div className="mini-post" key={t}>
                        <PlatformIcon platform={platforms[i]} />
                        <span>
                          {t}
                          <small>Tomorrow · {9 + i}:00 AM</small>
                        </span>
                        <span className="mini-pill">Scheduled</span>
                      </div>
                    ))}
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
                "The planned workflow requires human approval by default. Publishing is not enabled in this authentication phase.",
              ],
              [
                "Can I connect my own accounts?",
                "Social connections will be activated after the authentication and workspace foundations are verified. No social credentials are needed to create your account.",
              ],
              [
                "What is available in this development phase?",
                "Real registration, email verification, login, session management, and password recovery are available. Workspace and publishing features are the next phase.",
              ],
              [
                "Are document campaigns and video available?",
                "These are later phases. This development build focuses on real multi-user authentication first.",
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
