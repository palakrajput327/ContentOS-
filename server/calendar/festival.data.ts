export type FestivalCategory = "NATIONAL" | "CULTURAL" | "REGIONAL";
export type FestivalRegion = "ALL" | "NORTH" | "SOUTH" | "WEST" | "EAST";
export type Language = "EN" | "HI" | "HINGLISH";

export interface MultilingualGreeting {
  en: { title: string; wish: string };
  hi: { title: string; wish: string };
  hinglish: { title: string; wish: string };
}

export interface FestivalTheme {
  primaryColor: string;
  secondaryColor: string;
  gradientBg: [string, string, string];
  accentColor: string;
  motif: "DIYA" | "FLAG" | "COLORS" | "STARS" | "PEACOCK" | "FLOWER";
}

export interface FestivalDefinition {
  id: string;
  name: string;
  nameHindi: string;
  category: FestivalCategory;
  region: FestivalRegion;
  theme: FestivalTheme;
  greetings: MultilingualGreeting;
  dates: Record<number, string>; // year -> YYYY-MM-DD
}

export const INDIAN_FESTIVALS: FestivalDefinition[] = [
  {
    id: "republic-day",
    name: "Republic Day",
    nameHindi: "गणतंत्र दिवस",
    category: "NATIONAL",
    region: "ALL",
    theme: {
      primaryColor: "#FF9933",
      secondaryColor: "#138808",
      gradientBg: ["#0f172a", "#1e1b4b", "#064e3b"],
      accentColor: "#FF9933",
      motif: "FLAG",
    },
    greetings: {
      en: {
        title: "Happy Republic Day",
        wish: "Wishing you a proud & prosperous 77th Republic Day. Let's build a stronger nation together.",
      },
      hi: {
        title: "गणतंत्र दिवस की हार्दिक शुभकामनाएं",
        wish: "आइए मिलकर देश की प्रगति और समृद्धि में अपना योगदान दें। जय हिंद!",
      },
      hinglish: {
        title: "Happy Republic Day",
        wish: "Iss Republic Day par chalo milkar desh aur apne business ko nayi uchaiyon par le jayein. Jai Hind!",
      },
    },
    dates: {
      2025: "2025-01-26",
      2026: "2026-01-26",
      2027: "2027-01-26",
    },
  },
  {
    id: "independence-day",
    name: "Independence Day",
    nameHindi: "स्वतंत्रता दिवस",
    category: "NATIONAL",
    region: "ALL",
    theme: {
      primaryColor: "#FF9933",
      secondaryColor: "#138808",
      gradientBg: ["#0f172a", "#1e3a8a", "#064e3b"],
      accentColor: "#FF9933",
      motif: "FLAG",
    },
    greetings: {
      en: {
        title: "Happy Independence Day",
        wish: "Celebrating the spirit of freedom, innovation, and unity. Happy 80th Independence Day!",
      },
      hi: {
        title: "स्वतंत्रता दिवस की ढेरों शुभकामनाएं",
        wish: "आजादी का यह पावन पर्व आप सभी के जीवन में सुख, शांति और समृद्धि लाए।",
      },
      hinglish: {
        title: "Happy Independence Day",
        wish: "Freedom of thoughts, pride in our heart. Sabhi ko Independence Day ki hardik shubhkaamnayein!",
      },
    },
    dates: {
      2025: "2025-08-15",
      2026: "2026-08-15",
      2027: "2027-08-15",
    },
  },
  {
    id: "gandhi-jayanti",
    name: "Gandhi Jayanti",
    nameHindi: "गांधी जयंती",
    category: "NATIONAL",
    region: "ALL",
    theme: {
      primaryColor: "#0284c7",
      secondaryColor: "#0d9488",
      gradientBg: ["#0f172a", "#111827", "#1e293b"],
      accentColor: "#38bdf8",
      motif: "STARS",
    },
    greetings: {
      en: {
        title: "Happy Gandhi Jayanti",
        wish: "Honoring the legacy of Truth, Non-violence, and Integrity on Gandhi Jayanti.",
      },
      hi: {
        title: "गांधी जयंती पर शत-शत नमन",
        wish: "सत्य और अहिंसा के मार्ग पर चलकर राष्ट्र निर्माण में अपना योगदान दें।",
      },
      hinglish: {
        title: "Gandhi Jayanti Greetings",
        wish: "Truth and honesty are the foundations of every successful business. Happy Gandhi Jayanti!",
      },
    },
    dates: {
      2025: "2025-10-02",
      2026: "2026-10-02",
      2027: "2027-10-02",
    },
  },
  {
    id: "diwali",
    name: "Diwali",
    nameHindi: "दिवाली",
    category: "CULTURAL",
    region: "ALL",
    theme: {
      primaryColor: "#eab308",
      secondaryColor: "#f97316",
      gradientBg: ["#1e1b4b", "#311042", "#450a0a"],
      accentColor: "#fbbf24",
      motif: "DIYA",
    },
    greetings: {
      en: {
        title: "Happy Diwali",
        wish: "May the festival of lights illuminate your life and business with joy, health, and prosperity.",
      },
      hi: {
        title: "शुभ दीपावली",
        wish: "दीपावली का यह पावन पर्व आपके और आपके परिवार के लिए सुख, समृद्धि और अपार सफलता लाए।",
      },
      hinglish: {
        title: "Shubh Deepawali",
        wish: "Iss Diwali aapke business aur ghar mein sukh-samriddhi ka ujaala ho. Happy Diwali!",
      },
    },
    dates: {
      2025: "2025-10-20",
      2026: "2026-11-08",
      2027: "2027-10-29",
    },
  },
  {
    id: "holi",
    name: "Holi",
    nameHindi: "होली",
    category: "CULTURAL",
    region: "ALL",
    theme: {
      primaryColor: "#ec4899",
      secondaryColor: "#8b5cf6",
      gradientBg: ["#4c0519", "#3b0764", "#1e1b4b"],
      accentColor: "#f43f5e",
      motif: "COLORS",
    },
    greetings: {
      en: {
        title: "Happy Holi",
        wish: "May your life and business be filled with vibrant colors of happiness, growth, and success.",
      },
      hi: {
        title: "होली की हार्दिक शुभकामनाएं",
        wish: "रंगों का यह त्योहार आपके जीवन में उमंग, उल्लास और नई ऊर्जा भर दे।",
      },
      hinglish: {
        title: "Happy & Colorful Holi",
        wish: "Iss Holi aapke business mein khushiyon aur nayi growth ke saare rang bhar jayein!",
      },
    },
    dates: {
      2025: "2025-03-14",
      2026: "2026-03-04",
      2027: "2027-03-22",
    },
  },
  {
    id: "raksha-bandhan",
    name: "Raksha Bandhan",
    nameHindi: "रक्षाबंधन",
    category: "CULTURAL",
    region: "ALL",
    theme: {
      primaryColor: "#f43f5e",
      secondaryColor: "#eab308",
      gradientBg: ["#2e1065", "#4c0519", "#1e1b4b"],
      accentColor: "#fbbf24",
      motif: "FLOWER",
    },
    greetings: {
      en: {
        title: "Happy Raksha Bandhan",
        wish: "Celebrating the sacred bond of love, care, and protection. Happy Rakhi to all!",
      },
      hi: {
        title: "रक्षाबंधन की हार्दिक शुभकामनाएं",
        wish: "भाई-बहन के अटूट स्नेह और विश्वास के पावन पर्व की ढेरों बधाई।",
      },
      hinglish: {
        title: "Happy Raksha Bandhan",
        wish: "Pyaar aur suraksha ke iss pyare tyohar par sabhi ko Raksha Bandhan ki hardik shubhkaamnayein!",
      },
    },
    dates: {
      2025: "2025-08-09",
      2026: "2026-08-28",
      2027: "2027-08-17",
    },
  },
  {
    id: "dussehra",
    name: "Dussehra (Vijayadashami)",
    nameHindi: "दशहरा",
    category: "CULTURAL",
    region: "ALL",
    theme: {
      primaryColor: "#f97316",
      secondaryColor: "#ef4444",
      gradientBg: ["#450a0a", "#2e1065", "#0f172a"],
      accentColor: "#fdba74",
      motif: "STARS",
    },
    greetings: {
      en: {
        title: "Happy Dussehra",
        wish: "May truth and righteousness triumph over all challenges. Wishing you progress & prosperity.",
      },
      hi: {
        title: "विजयादशमी की हार्दिक शुभकामनाएं",
        wish: "अधर्म पर धर्म और असत्य पर सत्य की विजय के प्रतीक विजयादशमी की ढेर सारी बधाई।",
      },
      hinglish: {
        title: "Happy Dussehra",
        wish: "Iss Vijayadashami har mushkil par jeet ho aur aapka brand nayi safalta paye. Happy Dussehra!",
      },
    },
    dates: {
      2025: "2025-10-02",
      2026: "2026-10-20",
      2027: "2027-10-09",
    },
  },
  {
    id: "eid-ul-fitr",
    name: "Eid-ul-Fitr",
    nameHindi: "ईद-उल-फ़ितर",
    category: "CULTURAL",
    region: "ALL",
    theme: {
      primaryColor: "#10b981",
      secondaryColor: "#065f46",
      gradientBg: ["#022c22", "#064e3b", "#0f172a"],
      accentColor: "#34d399",
      motif: "PEACOCK",
    },
    greetings: {
      en: {
        title: "Eid Mubarak",
        wish: "May the divine blessings of Eid bring peace, happiness, and abundant growth to your life.",
      },
      hi: {
        title: "ईद मुबारक",
        wish: "ईद का यह मुबारक त्योहार आपके जीवन में शांति, खुशहाली और तरक्की लाए।",
      },
      hinglish: {
        title: "Eid Mubarak",
        wish: "Aap sabhi ko aur aapki family ko Eid ki bohot bohot mubarakbaad. Eid Mubarak!",
      },
    },
    dates: {
      2025: "2025-03-31",
      2026: "2026-03-20",
      2027: "2027-03-10",
    },
  },
  {
    id: "christmas",
    name: "Christmas",
    nameHindi: "क्रिसमस",
    category: "CULTURAL",
    region: "ALL",
    theme: {
      primaryColor: "#dc2626",
      secondaryColor: "#16a34a",
      gradientBg: ["#450a0a", "#064e3b", "#0f172a"],
      accentColor: "#f87171",
      motif: "STARS",
    },
    greetings: {
      en: {
        title: "Merry Christmas",
        wish: "Wishing you a season filled with warmth, laughter, and successful endeavors. Merry Christmas!",
      },
      hi: {
        title: "क्रिसमस की शुभकामनाएं",
        wish: "प्रभु यीशु का आशीर्वाद आप पर बना रहे और नया साल खुशियों से भरा हो।",
      },
      hinglish: {
        title: "Merry Christmas",
        wish: "Khushiyon aur nayi umeedon se bhara ho aapka Christmas. Merry Christmas!",
      },
    },
    dates: {
      2025: "2025-12-25",
      2026: "2026-12-25",
      2027: "2027-12-25",
    },
  },
  {
    id: "makar-sankranti",
    name: "Makar Sankranti / Pongal",
    nameHindi: "मकर संक्रांति / पोंगल",
    category: "REGIONAL",
    region: "ALL",
    theme: {
      primaryColor: "#f59e0b",
      secondaryColor: "#d97706",
      gradientBg: ["#451a03", "#78350f", "#0f172a"],
      accentColor: "#fbbf24",
      motif: "FLOWER",
    },
    greetings: {
      en: {
        title: "Happy Makar Sankranti & Pongal",
        wish: "May the sun god shower warmth, health, and abundant harvest on your life and venture.",
      },
      hi: {
        title: "मकर संक्रांति व पोंगल की शुभकामनाएं",
        wish: "पतंगों की मिठास और सूर्य देव का तेज आपके जीवन में तरक्की लाए।",
      },
      hinglish: {
        title: "Happy Makar Sankranti",
        wish: "Iss Sankranti par aapke business ki patang sabse unchi udaye! Happy Makar Sankranti!",
      },
    },
    dates: {
      2025: "2025-01-14",
      2026: "2026-01-14",
      2027: "2027-01-14",
    },
  },
];

export function getFestivalById(id: string): FestivalDefinition | undefined {
  return INDIAN_FESTIVALS.find((f) => f.id === id);
}

export function listFestivalsForYear(
  year: number,
  options?: { region?: FestivalRegion; category?: FestivalCategory },
): Array<FestivalDefinition & { dateForYear: string }> {
  return INDIAN_FESTIVALS.filter((f) => {
    if (!f.dates[year]) return false;
    if (options?.region && options.region !== "ALL" && f.region !== "ALL" && f.region !== options.region)
      return false;
    if (options?.category && f.category !== options.category) return false;
    return true;
  })
    .map((f) => ({
      ...f,
      dateForYear: f.dates[year],
    }))
    .sort((a, b) => a.dateForYear.localeCompare(b.dateForYear));
}
