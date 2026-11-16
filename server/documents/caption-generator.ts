/**
 * Professional Social Media Caption Generator & Platform Formatter
 * Generates structured, high-converting social media captions with emojis,
 * value hooks, narrative descriptions, structured highlights/tiers, CTAs,
 * websites, phone numbers, disclaimers, and curated hashtags.
 */

export interface CaptionInput {
  title: string;
  companyName?: string;
  websiteDomain?: string;
  phoneNumber?: string;
  excerpt?: string;
  prompt?: string;
  sourcePage?: number;
}

export interface ExtractedContact {
  website?: string;
  phone?: string;
  email?: string;
}

/**
 * Extracts website, phone number, and email from document pages
 */
export function extractContactInfoFromText(pagesText: string[]): ExtractedContact {
  const combined = pagesText.join("\n");
  const result: ExtractedContact = {};

  // 1. Phone number
  const labeledPhone = combined.match(/(?:phone|tel|mobile|whatsapp|call|contact|ph|helpline|support)[\s:]*([+]?[0-9\s\-().]{8,22})/i);
  if (labeledPhone && labeledPhone[1]) {
    const candidate = labeledPhone[1].trim();
    if (candidate.replace(/\D/g, "").length >= 7) {
      result.phone = candidate;
    }
  }

  if (!result.phone) {
    const intlMatch = combined.match(/(?:\+|00)[1-9]\d{0,3}[-.\s]?(?:\(?\d{2,4}\)?[-.\s]?)?\d{3,4}[-.\s]?\d{3,5}\b/);
    if (intlMatch) {
      const candidate = intlMatch[0].trim();
      if (candidate.replace(/\D/g, "").length >= 7 && candidate.replace(/\D/g, "").length <= 15) {
        result.phone = candidate;
      }
    }
  }

  // 2. Website URL / Domain
  const domainMatch = combined.match(/\b(?:https?:\/\/)?(?:www\.)?([a-zA-Z0-9-]+\.(?:live|com|org|io|net|in|ai|app|co|tech|finance|xyz|world|global)[a-zA-Z0-9.\-_/]*)/i);
  if (domainMatch && domainMatch[1]) {
    let clean = domainMatch[1].toLowerCase().replace(/[.,;)]+$/, "");
    if (!clean.startsWith("www.") && !clean.includes("/")) {
      clean = `www.${clean}`;
    }
    result.website = clean;
  }

  // 3. Email
  const emailMatch = combined.match(/\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/);
  if (emailMatch) {
    result.email = emailMatch[0].trim();
  }

  return result;
}

/**
 * Formats a clean company/brand name with intelligent context awareness
 */
export function formatBrandName(rawName?: string, contextText?: string): string {
  const ctx = (contextText || "").toLowerCase();
  if (ctx.includes("tradeorbit") || ctx.includes("trade orbit")) return "TradeOrbit";
  if (ctx.includes("regulus") || ctx.includes("regulus liquidity")) return "Regulus Liquidity";
  if (!rawName) return "TradeOrbit";
  let name = rawName
    .replace(/\.pdf$/i, "")
    .replace(/[_-\s]*(Final|Draft|Version|v\d+|\d+_Page|Business_Plan|Pitch_Deck|Presentation|Deck|Whitepaper|Overview).*/i, "")
    .replace(/[_-\s]+/g, " ")
    .trim();
  if (!name || name.toLowerCase() === "document" || name.toLowerCase() === "brand") {
    return "TradeOrbit";
  }
  return name.charAt(0).toUpperCase() + name.slice(1);
}

/**
 * Formats a clean PascalCase hashtag
 */
export function toHashtag(str: string): string {
  return str
    .replace(/[^a-zA-Z0-9\s]/g, "")
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join("");
}

/**
 * Builds a structured, high-converting social media caption matching the target format:
 * 1. High-energy Headline with emojis (topic-tailored)
 * 2. Hook line with brand name
 * 3. Narrative description (from document or synthesized from prompt)
 * 4. Structured highlights / tiers with emojis (strictly topic-specific!)
 * 5. Motivational CTAs
 * 6. Website URL
 * 7. Phone number (if available)
 * 8. Disclaimer
 * 9. Curated hashtags (strictly topic-specific!)
 */
export function buildRichCaption(input: CaptionInput): string {
  const cleanTitle = (input.title || "Strategic Growth & Innovation")
    .replace(/^(Strategic Architecture:\s*|Core Pillar #\d+:\s*|Concept #\d+:\s*)/i, "")
    .trim();

  const titleLower = cleanTitle.toLowerCase();
  const promptLower = (input.prompt || "").toLowerCase();
  const excerptLower = (input.excerpt || "").toLowerCase();
  const contextText = `${titleLower} ${promptLower} ${excerptLower}`;
  const brand = formatBrandName(input.companyName, contextText);

  // 1. Topic Determination - Strict, distinct categorisation (no cross-contamination)
  type TopicKey =
    | "ROYALTY_CLUB"
    | "ACCELERATOR_BOOSTER"
    | "DAILY_YIELDS"
    | "RISK_EXECUTION"
    | "LIQUIDITY_PRICING"
    | "NETWORK_REFERRAL"
    | "CAPITAL_PACKAGES"
    | "COMMUNITY_MISSION";

  let topic: TopicKey = "COMMUNITY_MISSION";

  if (
    titleLower.includes("royalty") ||
    contextText.includes("royalty club") ||
    contextText.includes("global profit sharing") ||
    contextText.includes("royalty pool")
  ) {
    topic = "ROYALTY_CLUB";
  } else if (
    titleLower.includes("booster") ||
    titleLower.includes("accelerator") ||
    titleLower.includes("5x") ||
    (titleLower.includes("tier") && contextText.includes("accelerator"))
  ) {
    topic = "ACCELERATOR_BOOSTER";
  } else if (
    titleLower.includes("daily") ||
    titleLower.includes("profit distribution") ||
    titleLower.includes("earning engine") ||
    titleLower.includes("yield") ||
    contextText.includes("1% - 3% daily")
  ) {
    topic = "DAILY_YIELDS";
  } else if (
    titleLower.includes("risk") ||
    titleLower.includes("execution") ||
    titleLower.includes("tca") ||
    titleLower.includes("slippage") ||
    titleLower.includes("transaction cost") ||
    contextText.includes("risk control")
  ) {
    topic = "RISK_EXECUTION";
  } else if (
    titleLower.includes("pricing") ||
    titleLower.includes("liquidity") ||
    titleLower.includes("spread") ||
    titleLower.includes("multi-asset") ||
    contextText.includes("liquidity lp")
  ) {
    topic = "LIQUIDITY_PRICING";
  } else if (
    titleLower.includes("referral") ||
    titleLower.includes("network") ||
    titleLower.includes("leg requirement") ||
    titleLower.includes("direct bonus") ||
    titleLower.includes("affiliate")
  ) {
    topic = "NETWORK_REFERRAL";
  } else if (
    titleLower.includes("capital") ||
    titleLower.includes("package") ||
    titleLower.includes("allocation") ||
    titleLower.includes("milestone split") ||
    titleLower.includes("deposit")
  ) {
    topic = "CAPITAL_PACKAGES";
  } else {
    topic = "COMMUNITY_MISSION";
  }

  // 2. Topic-Tailored Content Assembly
  let primaryEmoji = "🚀";
  let secondaryEmojis = "👑✨";
  let headlinePunch = "ELEVATE YOUR SUCCESS!";
  let hookLine = `💎 Unlock New Levels of Achievement with ${brand}!`;
  let description = "";
  const highlights: string[] = [];
  const ctaLines: string[] = [];
  const topicTags: string[] = [];

  switch (topic) {
    case "ROYALTY_CLUB":
      primaryEmoji = "👑";
      secondaryEmojis = "🌍💎";
      headlinePunch = "GLOBAL PROFIT LEADERSHIP!";
      hookLine = `💎 Step into the elite executive tier and share in worldwide platform turnover with ${brand}!`;
      description =
        input.excerpt && input.excerpt.length > 50 && !input.excerpt.includes("In modern enterprise")
          ? `Built for visionary leaders: ${input.excerpt.replace(/\s+/g, " ").trim()}`
          : `True leadership creates enduring legacy. The ${brand} Executive Royalty Club awards visionary builders with a direct, recurring share of worldwide platform turnover, celebrating those who drive global ecosystem momentum.`;
      highlights.push("👑 Global Turnover Pool – Direct recurring share in worldwide platform revenue");
      highlights.push("🏆 Executive Prestige – VIP recognition, annual summit access, and premier club perks");
      highlights.push("💰 Lifetime Passive Stream – Enduring rewards for certified organizational leaders");
      highlights.push("📊 Transparent Ledger – Verifiable on-chain turnover tracking and automated allocation");
      highlights.push("🌍 International Qualification – Borderless leadership milestones across all regions");
      ctaLines.push("🌟 Claim your seat at the executive table. Elevate your status.");
      ctaLines.push("🔥 Lead with vision. Achieve greatness. Shape the future.");
      topicTags.push("RoyaltyClub", "ExecutiveLeadership", "GlobalTurnover", "LeadershipRewards", "PassiveRevenue", "PrestigeLeaders");
      break;

    case "ACCELERATOR_BOOSTER":
      primaryEmoji = "🚀";
      secondaryEmojis = "⚡🔥";
      headlinePunch = "UNLOCK MULTIPLIED RETURNS!";
      hookLine = `💎 Unlock high-velocity performance multipliers with the ${brand} 5X Accelerator!`;
      description =
        input.excerpt && input.excerpt.length > 50 && !input.excerpt.includes("In modern enterprise")
          ? `Accelerate your earning velocity: ${input.excerpt.replace(/\s+/g, " ").trim()}`
          : `Success is a journey, and every milestone deserves exponential recognition. With the ${brand} Booster Accelerator, participants advance through ascending tiers to multiply their capital growth and earning velocity up to 5X.`;
      highlights.push("🥉 Bronze Tier – Begin your journey & activate foundational momentum");
      highlights.push("🥈 Silver Tier – Accelerate your reward multipliers & commission depth");
      highlights.push("🥇 Gold Tier – Reach high-velocity milestones & unlock premium pools");
      highlights.push("🏆 Platinum Tier – Aim for excellence with elite leadership privileges");
      highlights.push("💎 Diamond Tier – Attain maximum 5X capital acceleration & VIP status");
      ctaLines.push("🌟 Accelerate Your Rewards. Elevate Your Growth.");
      ctaLines.push("🔥 Set bigger goals. Achieve new milestones. Unlock your potential.");
      topicTags.push("5XAccelerator", "BoosterIncome", "TierMultipliers", "AchievementUnlocked", "SuccessJourney", "GrowthVelocity");
      break;

    case "DAILY_YIELDS":
      primaryEmoji = "📈";
      secondaryEmojis = "💰🔥";
      headlinePunch = "CONSISTENT AUTOMATED RETURNS!";
      hookLine = `💎 Experience consistent, automated daily returns engineered for compounding growth!`;
      description =
        input.excerpt && input.excerpt.length > 50 && !input.excerpt.includes("In modern enterprise")
          ? `Automated yield architecture: ${input.excerpt.replace(/\s+/g, " ").trim()}`
          : `Consistency builds unbeatable financial momentum. Powered by smart algorithmic execution, ${brand} distributes automated daily performance yields directly to your portfolio with absolute mathematical transparency.`;
      highlights.push("⚡ Smart Daily Yields – High-performance automated returns distributed around the clock");
      highlights.push("📈 Compounding Growth – Mathematical reinvestment mechanisms for portfolio acceleration");
      highlights.push("💰 Seamless Liquidity – Instant wallet access and fast, frictionless withdrawals");
      highlights.push("🛡️ Algorithmic Protection – Dedicated reserve buffer safeguarding principal stability");
      highlights.push("💎 VIP Multipliers – Tier-based boost rates for long-term ecosystem participants");
      ctaLines.push("🌟 Put your capital to work with smart, automated precision.");
      ctaLines.push("🔥 Take control of your financial momentum. Start compounding today.");
      topicTags.push("DailyYields", "AutomatedProfits", "PassiveIncome", "CompoundGrowth", "SmartEarnings", "CryptoWealth");
      break;

    case "RISK_EXECUTION":
      primaryEmoji = "🛡️";
      secondaryEmojis = "⚡📊";
      headlinePunch = "INSTITUTIONAL PRECISION & SAFETY!";
      hookLine = `💎 Master market volatility with institutional precision and quantitative risk controls!`;
      description =
        input.excerpt && input.excerpt.length > 50 && !input.excerpt.includes("In modern enterprise")
          ? `Institutional-grade risk framework: ${input.excerpt.replace(/\s+/g, " ").trim()}`
          : `In fast-moving markets, disciplined risk management separates winners from the crowd. Our proprietary execution engine deploys real-time quantitative monitoring, sub-millisecond routing, and strict stop-loss protocols to safeguard capital.`;
      highlights.push("⚡ Sub-Millisecond Routing – Institutional low-latency order routing with minimal slippage");
      highlights.push("🛡️ Dynamic Drawdown Controls – Automated risk algorithms preventing adverse market events");
      highlights.push("📊 Transaction Cost Analysis (TCA) – Full transparency into execution quality and spreads");
      highlights.push("🔐 Cryptographic Security – Zero-trust infrastructure protecting participant assets");
      ctaLines.push("🌟 Trade with institutional confidence and verified execution.");
      ctaLines.push("🔥 Eliminate market uncertainty. Built for discipline, engineered for safety.");
      topicTags.push("RiskManagement", "SmartExecution", "FintechSecurity", "QuantitativeTrading", "CapitalProtection", "TCA");
      break;

    case "LIQUIDITY_PRICING":
      primaryEmoji = "💧";
      secondaryEmojis = "⚡📈";
      headlinePunch = "SEAMLESS CAPITAL EFFICIENCY!";
      hookLine = `💎 Optimize capital deployment with institutional liquidity depth and tailored volume tiers!`;
      description =
        input.excerpt && input.excerpt.length > 50 && !input.excerpt.includes("In modern enterprise")
          ? `Tailored liquidity architecture: ${input.excerpt.replace(/\s+/g, " ").trim()}`
          : `Capital efficiency demands deep liquidity and ultra-competitive pricing structures. Our multi-asset architecture connects participants directly to Tier-1 liquidity venues, minimizing transaction drag and maximizing net performance.`;
      highlights.push("💧 Deep Tier-1 Liquidity – Direct aggregation across global financial counterparties");
      highlights.push("⚡ Ultra-Tight Spreads – Institutional pricing designed to reduce execution overhead");
      highlights.push("📈 Volume-Based Tiers – Flexible fee structures that reward portfolio scale");
      highlights.push("🛡️ Segregated Accounts – Complete transparency and independent custody assurance");
      ctaLines.push("🌟 Scale your operations with institutional liquidity infrastructure.");
      ctaLines.push("🔥 Unlock ultra-low spreads and superior execution efficiency.");
      topicTags.push("LiquidityPools", "VolumeTiers", "CapitalEfficiency", "InstitutionalFintech", "LowSlippage", "AssetCoverage");
      break;

    case "NETWORK_REFERRAL":
      primaryEmoji = "🤝";
      secondaryEmojis = "🌟👑";
      headlinePunch = "SCALABLE LEADERSHIP REWARDS!";
      hookLine = `💎 Expand your leadership reach and unlock scalable multi-tier community rewards!`;
      description =
        input.excerpt && input.excerpt.length > 50 && !input.excerpt.includes("In modern enterprise")
          ? `Collaborative network momentum: ${input.excerpt.replace(/\s+/g, " ").trim()}`
          : `Community is the driving force of decentralized innovation. The ${brand} collaborative reward program empowers team builders with direct referral bonuses, depth overrides, and milestone incentives designed for exponential reach.`;
      highlights.push("🤝 Direct Referral Bonuses – Immediate instant payouts for personal network onboarding");
      highlights.push("🌟 Multi-Level Overrides – Scalable commission depth across organizational tiers");
      highlights.push("🔥 Fast-Track Incentives – Accelerated bonuses for high-performing community builders");
      highlights.push("💎 Leadership Pools – Progressive rewards as your global team reaches new milestones");
      ctaLines.push("🌟 Build your team. Expand your reach. Earn without borders.");
      ctaLines.push("🔥 Leverage the power of community to unlock compounding growth.");
      topicTags.push("ReferralRewards", "NetworkIncome", "AffiliateGrowth", "LeadershipDevelopment", "TeamSuccess", "CommunityBuilding");
      break;

    case "CAPITAL_PACKAGES":
      primaryEmoji = "💼";
      secondaryEmojis = "💰🎯";
      headlinePunch = "STRATEGIC ALLOCATION & GROWTH!";
      hookLine = `💎 Choose your strategic capital allocation and step into institutional earning power!`;
      description =
        input.excerpt && input.excerpt.length > 50 && !input.excerpt.includes("In modern enterprise")
          ? `Strategic capital allocation: ${input.excerpt.replace(/\s+/g, " ").trim()}`
          : `Clear structure enables decisive action. With transparent package tiers and structured milestone allocation, ${brand} offers flexible pathways for participants to deploy capital with confidence and track progress in real time.`;
      highlights.push("💼 Flexible Entry Tiers – Scalable packages tailored to any portfolio size");
      highlights.push("⚡ Instant Smart Contract Activation – Fast on-chain deployment with zero friction");
      highlights.push("📈 Transparent Milestone Split – Complete clarity on capital routing and payouts");
      highlights.push("💎 VIP Upgrade Pathways – Seamless progression as your portfolio value expands");
      ctaLines.push("🌟 Select your tier. Deploy capital with clarity and confidence.");
      ctaLines.push("🔥 Take the first step toward structured, verified financial expansion.");
      topicTags.push("CapitalAllocation", "InvestmentTiers", "PortfolioGrowth", "StrategicPackages", "FinancialMilestones");
      break;

    case "COMMUNITY_MISSION":
    default:
      primaryEmoji = "🌐";
      secondaryEmojis = "🚀✨";
      headlinePunch = "EMPOWERING GLOBAL LEADERS!";
      hookLine = `💎 Step into the future of digital finance with the ${brand} global ecosystem!`;
      description =
        input.excerpt && input.excerpt.length > 50 && !input.excerpt.includes("In modern enterprise")
          ? `Vision and purpose: ${input.excerpt.replace(/\s+/g, " ").trim()}`
          : `Innovation thrives when ambitious minds unite around a shared vision. ${brand} delivers a comprehensive digital financial ecosystem combining transparency, security, and world-class technology to empower participants across global markets.`;
      highlights.push("🌐 Borderless Global Ecosystem – Seamless digital finance access for market leaders");
      highlights.push("💎 Verifiable Transparency – Built upon auditable cryptographic ledger standards");
      highlights.push("🚀 Innovation-First Model – Expanding suite of automated and quantitative tools");
      highlights.push("🤝 Dedicated Community – Global education, collaborative support, and mentorship");
      ctaLines.push(`🌟 Step into the future of digital finance with ${brand}.`);
      ctaLines.push("🔥 Join a thriving global movement of forward-thinking innovators.");
      topicTags.push("GlobalVision", "DigitalFinance", "EcosystemGrowth", "NextGenFintech", "InnovationFirst", "CommunityPower");
      break;
  }

  // 3. Header Construction
  let headerTitle = cleanTitle.toUpperCase();
  if (!headerTitle.includes("–") && !headerTitle.includes("-") && !headerTitle.includes("!")) {
    headerTitle = `${headerTitle} – ${headlinePunch}`;
  }
  const header = `${primaryEmoji} ${headerTitle} ${secondaryEmojis}`;

  // 4. Website / URL Line
  let websiteLine = "";
  const resolvedDomain = (input.websiteDomain || (brand.toLowerCase().includes("tradeorbit") ? "www.tradeorbit.live" : "")).trim();
  if (resolvedDomain.length > 3) {
    let raw = resolvedDomain.replace(/^https?:\/\//i, "").replace(/\/$/, "");
    if (!raw.startsWith("www.") && !raw.includes("/")) {
      raw = `www.${raw}`;
    }
    websiteLine = `🌐 [${raw}](http://${raw}/)`;
  }

  // 5. Phone / Contact Line
  let phoneLine = "";
  if (input.phoneNumber && input.phoneNumber.trim().length > 5) {
    phoneLine = `📞 Helpline / WhatsApp Support: ${input.phoneNumber.trim()}`;
  }

  // 6. Professional Compliance Disclaimer
  const disclaimer = `Rewards and eligibility are subject to the official ${brand} business plan. Financial participation involves risk; rewards are not guaranteed.`;

  // 7. Curated, Unique Hashtags per Topic & Brand
  const brandTag = toHashtag(brand);
  const titleWords = cleanTitle
    .replace(/[^a-zA-Z0-9\s]/g, "")
    .split(/\s+/)
    .filter((w) => w.length > 2 && !["and", "the", "for", "with"].includes(w.toLowerCase()))
    .slice(0, 3)
    .map(toHashtag);

  const cleanDomainTag = resolvedDomain
    ? toHashtag(resolvedDomain.replace(/^www\./i, "").split(".")[0] || "")
    : "";

  const baseTags = [
    `#${brandTag}`,
    ...titleWords.map((t) => `#${t}`),
    ...topicTags.map((t) => `#${t}`),
    cleanDomainTag && cleanDomainTag !== brandTag ? `#${cleanDomainTag}` : "",
    resolvedDomain ? `#${brandTag}Live` : "",
    "#VIPRewards",
    "#AchievementUnlocked",
    "#SuccessJourney",
    "#FinancialInnovation",
    "#MilestoneSuccess",
    `#${brandTag}Community`,
  ].filter(Boolean);

  const uniqueTags = Array.from(new Set(baseTags));
  const hashtagsString = uniqueTags.join(" ");

  // 8. Assemble Full Structured Social Caption
  const parts: string[] = [
    header,
    hookLine,
    description,
    highlights.join("\n"),
    ctaLines.join("\n"),
  ];

  if (websiteLine) parts.push(websiteLine);
  if (phoneLine) parts.push(phoneLine);
  parts.push(disclaimer);
  parts.push(hashtagsString);

  return parts.join("\n\n");
}

/**
 * Tailors a caption for platform-specific character limits and features
 */
export function formatCaptionForPlatform(caption: string, platform: string): string {
  const plat = platform.toLowerCase();

  // Telegram: Photo captions must be <= 1024 chars!
  if (plat === "telegram") {
    if (caption.length <= 1024) return caption;
    const lines = caption.split("\n\n");
    const lastLine = lines[lines.length - 1];
    if (lastLine?.startsWith("#")) {
      const tags = lastLine.split(/\s+/);
      if (tags.length > 8) {
        lines[lines.length - 1] = tags.slice(0, 8).join(" ");
        const compacted = lines.join("\n\n");
        if (compacted.length <= 1024) return compacted;
      }
    }
    const candidate = lines.join("\n\n");
    if (candidate.length <= 1024) return candidate;
    return candidate.slice(0, 1021) + "...";
  }

  // X / Twitter: 280 character limit
  if (plat === "x" || plat === "twitter") {
    const lines = caption.split("\n\n");
    const header = lines[0] || "🚀 ELEVATE YOUR SUCCESS!";
    const website = lines.find((l) => l.startsWith("🌐")) || "";
    const tags = lines[lines.length - 1]?.split(" ").slice(0, 4).join(" ") || "#Success #Growth";
    const xBase = `${header}\n\n${website ? website + "\n\n" : ""}${tags}`;
    if (xBase.length <= 280) return xBase;
    return xBase.slice(0, 277) + "...";
  }

  // Instagram: up to 2200 chars
  if (plat === "instagram") {
    return caption.slice(0, 2200);
  }

  // LinkedIn: up to 3000 chars
  if (plat === "linkedin") {
    return caption.slice(0, 3000);
  }

  // Facebook / default
  return caption.slice(0, 5000);
}
